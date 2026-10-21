// api/_lib/outages-social.js : signalements d'usagers (control room des pannes, 21/10/2026), l'équivalent gratuit de Downdetector.
// Bluesky (recherche publique, sans compte, 100 derniers messages en français par requête) et Mastodon (fils des mots-dièses #panne et
// #coupure de trois instances francophones, sans compte). Un pic de messages sur 15 min fait une panne « signalée » (jamais « mesurée ») :
// 10 messages ou plus, ou 5 ou plus à 3 fois la normale ; orange à 30. Seuls des décomptes sont gardés : aucun compte, aucun message.
// Relève toutes les 2 min (collecteur de server/prod/outages-collectors.mjs), en mémoire seulement.
import { fetchStrictJson, sourceError } from './source-http.js';

export const SOCIAL_INTERVAL_MS = 2 * 60_000;
/** Une lecture plus vieille que 10 min ne signale plus rien. */
export const SOCIAL_MAX_AGE_MS = 10 * 60_000;
const WINDOW_MS = 15 * 60_000;
const BASELINE_MAX_MS = 7 * 24 * 3600 * 1000;
const BLUESKY_SEARCH = 'https://api.bsky.app/xrpc/app.bsky.feed.searchPosts';
const MASTODON = ['mastodon.social', 'piaille.fr', 'mamot.fr'];
const MASTODON_TAGS = ['panne', 'coupure'];

/** Requêtes : un réseau, un opérateur (ou null), les mots cherchés (tous présents dans un message Mastodon). */
export const SOCIAL_QUERIES = [
  { network: 'mobile', operator: 'Orange', q: 'panne orange' },
  { network: 'mobile', operator: 'Orange', q: 'panne sosh' },
  { network: 'mobile', operator: 'SFR', q: 'panne sfr' },
  { network: 'mobile', operator: 'Free', q: 'panne free' },
  { network: 'mobile', operator: 'Bouygues Telecom', q: 'panne bouygues' },
  { network: 'mobile', operator: null, q: 'panne réseau' },
  { network: 'internet', operator: null, q: 'panne internet' },
  { network: 'electricite', operator: null, q: 'panne de courant' },
  { network: 'electricite', operator: 'Enedis', q: 'coupure enedis' },
  { network: 'gaz', operator: null, q: 'coupure de gaz' },
  { network: 'eau', operator: null, q: "coupure d'eau" },
  { network: 'urgence', operator: null, q: '112 injoignable' },
  { network: 'paiement', operator: null, q: 'panne carte bancaire' },
];

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ').toLowerCase();
const STOP = new Set(['de', 'd', 'du', 'la', 'le']);
const wordsOf = (q) => fold(q).split(/\s+/).filter((w) => w.length > 0 && !STOP.has(w));

/**
 * Pic de messages : `recent` dans les 15 dernières minutes, `baseline` = rythme des plus anciens ramené à 15 min (7 jours au plus).
 * @param {number[]} times instants des messages (ms)
 * @returns {{ recent: number, baseline: number, level: 'jaune' | 'orange' | null }}
 */
export function socialSignal(times, now) {
  const recent = times.filter((t) => t <= now && now - t <= WINDOW_MS).length;
  const older = times.filter((t) => now - t > WINDOW_MS && now - t <= BASELINE_MAX_MS);
  const oldest = older.length > 0 ? Math.min(...older) : null;
  const span = oldest === null ? 0 : now - WINDOW_MS - oldest;
  const baseline = span > 0 ? (older.length / span) * WINDOW_MS : 0;
  const level = recent >= 30 ? 'orange' : recent >= 10 || (recent >= 5 && recent >= 3 * baseline) ? 'jaune' : null;
  return { recent, baseline: Math.round(baseline * 10) / 10, level };
}

/** Instants des messages d'une réponse de recherche Bluesky. */
export function blueskyTimes(json) {
  const posts = Array.isArray(json?.posts) ? json.posts : [];
  return posts.map((p) => Date.parse(p?.record?.createdAt ?? '')).filter((t) => Number.isFinite(t));
}

/** Instants des messages Mastodon qui contiennent tous les mots de la requête (HTML retiré). */
export function mastodonTimes(statuses, words) {
  if (!Array.isArray(statuses)) return [];
  return statuses.filter((s) => {
    const text = fold(String(s?.content ?? '').replace(/<[^>]+>/g, ' '));
    return words.every((w) => new RegExp(`\\b${w}\\b`).test(text));
  }).map((s) => Date.parse(s?.created_at ?? '')).filter((t) => Number.isFinite(t));
}

/** @type {{ at: number, signals: Array<{ network: string, operator: string | null, q: string, recent: number, baseline: number, level: string | null, sinceMs: number | null }>, errors: string[] } | null} */
let last = null;
/** @type {Promise<void> | null} */
let running = null;

/** Réservé aux tests. */
export function __resetSocialForTests() {
  last = null;
  running = null;
}

async function collect(now) {
  const errors = [];
  const statuses = [];
  for (const host of MASTODON) {
    for (const tag of MASTODON_TAGS) {
      try {
        const json = await fetchStrictJson(`https://${host}/api/v1/timelines/tag/${tag}?limit=40`, { timeoutMs: 10_000 });
        if (Array.isArray(json)) statuses.push(...json);
      } catch (err) {
        errors.push(sourceError(`Mastodon (${host})`, err));
      }
    }
  }
  const signals = [];
  for (const query of SOCIAL_QUERIES) {
    let times = [];
    try {
      const params = new URLSearchParams({ q: query.q, lang: 'fr', sort: 'latest', limit: '100' });
      times = blueskyTimes(await fetchStrictJson(`${BLUESKY_SEARCH}?${params.toString()}`, { timeoutMs: 10_000 }));
    } catch (err) {
      errors.push(sourceError(`Bluesky (${query.q})`, err));
    }
    times.push(...mastodonTimes(statuses, wordsOf(query.q)));
    const signal = socialSignal(times, now);
    const recentTimes = times.filter((t) => t <= now && now - t <= WINDOW_MS);
    signals.push({ ...query, ...signal, sinceMs: recentTimes.length > 0 ? Math.min(...recentTimes) : null });
  }
  last = { at: now, signals, errors };
}

/** Relève au plus toutes les 2 min, une seule à la fois. Ne lève jamais. */
export async function ensureSocialFresh(now = Date.now()) {
  if (last !== null && now - last.at < SOCIAL_INTERVAL_MS) return;
  running ??= collect(now).catch((err) => console.warn('[outages-social] relève en échec :', err instanceof Error ? err.message : err))
    .finally(() => { running = null; });
  await running;
}

/**
 * Pannes signalées par les usagers (dernière relève de moins de 10 min), regroupées par réseau et opérateur (somme des requêtes).
 * @returns {Array<{ network: string, operator: string | null, level: 'jaune' | 'orange', recent: number, baseline: number, since: string, link: string, queries: string[] }>}
 */
export function socialOutages(now = Date.now()) {
  if (last === null || now - last.at > SOCIAL_MAX_AGE_MS) return [];
  const groups = new Map();
  for (const s of last.signals) {
    const key = `${s.network}|${s.operator ?? ''}`;
    const g = groups.get(key) ?? { network: s.network, operator: s.operator, recent: 0, baseline: 0, sinceMs: null, queries: [] };
    g.recent += s.recent;
    g.baseline += s.baseline;
    if (s.sinceMs !== null) g.sinceMs = g.sinceMs === null ? s.sinceMs : Math.min(g.sinceMs, s.sinceMs);
    g.queries.push(s.q);
    groups.set(key, g);
  }
  return [...groups.values()].flatMap((g) => {
    const level = g.recent >= 30 ? 'orange' : g.recent >= 10 || (g.recent >= 5 && g.recent >= 3 * g.baseline) ? 'jaune' : null;
    if (level === null || g.sinceMs === null) return [];
    return [{
      network: g.network, operator: g.operator, level, recent: g.recent, baseline: Math.round(g.baseline * 10) / 10,
      since: new Date(g.sinceMs).toISOString(), queries: g.queries,
      link: `https://bsky.app/search?${new URLSearchParams({ q: g.queries[0] }).toString()}`,
    }];
  });
}

/** Erreurs de la dernière relève (sources nommées). */
export function socialErrors() {
  return last?.errors ?? [];
}

/** Instant de la dernière relève (ISO), null si aucune. */
export function socialReadAt() {
  return last === null ? null : new Date(last.at).toISOString();
}
