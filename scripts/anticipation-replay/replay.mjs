// scripts/anticipation-replay/replay.mjs : rejeu du moteur d'anticipation sur des instants passés (04/11/2026). Fait tourner le moteur
// réel (toSignals puis evaluate, jamais une copie des règles) sur ce que les archives publiques permettent de reconstituer à chaque
// instant, avec un registre vide en mémoire. Sert à regarder ce que le moteur aurait ouvert, pas à valider quoi que ce soit.
//
// Ce qui est rejouable : la presse (/api/news avec since/until, 90 jours) et les manifestations (/api/social/protests-archive, un fichier
// par jour depuis le 27/10/2026 seulement). Tout le reste (vigilance par département, SNCF, pannes, cyber, Écowatt, carburants, football)
// n'est pas archivé à l'échelle fine : il est passé en null, donc nommé dans `unknown`, et listé dans les limites de chaque instant.
// La vigilance archivée (api/_lib/vigilance-archive.js) ne garde que des comptes par jour (jaune, orange, rouge), pas les départements :
// elle n'est pas rejouable. Les archives de signaux (Task 3) n'existent qu'à partir du déploiement.
//
// Lancement :
//   npm run replay:anticipation
//   REPLAY_AT=2026-10-17T10:00:00Z,2026-10-31T11:00:00Z REPLAY_OUT=docs/rejeu/anticipation-2026-11.md npm run replay:anticipation
// Cache des lectures : node_modules/.cache/anticipation-replay.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { toSignals } from '../../api/_lib/anticipation/signals.js';
import { evaluate } from '../../api/_lib/anticipation/engine.js';

export const DEFAULT_INSTANTS = ['2026-10-17T10:00:00Z', '2026-10-18T18:00:00Z', '2026-10-26T15:00:00Z', '2026-10-31T11:00:00Z'];

/** Entrées de toSignals et libellé de leur absence dans les limites. */
const INPUTS = [
  ['news', 'presse'], ['protests', 'manifestations'], ['vigilance', 'vigilance par département (l\'archive ne garde que des comptes par jour)'],
  ['rail', 'SNCF'], ['room', 'pannes'], ['cyber', 'veille cyber'], ['ecowatt', 'Écowatt'], ['fuel', 'carburants'], ['football', 'calendrier sportif'],
];

/**
 * @param {string[]} instants Instants ISO.
 * @param {Record<string, ((at: string) => Promise<unknown>) | undefined>} sources Une fonction par entrée (news, protests, vigilance…) ; absente ou null : entrée inconnue.
 * @returns {Promise<Array<{ at: string, scenarios: any[], unknown: string[], errors: string[], limits: string[] }>>}
 */
export async function replayAt(instants, sources) {
  const out = [];
  for (const at of instants) {
    const now = Date.parse(at);
    /** @type {string[]} */
    const limits = [];
    /** @type {string[]} */
    const read_ = [];
    /** @type {Record<string, unknown>} */
    const inputs = {};
    for (const [key, label] of INPUTS) {
      const read = sources?.[key];
      if (typeof read !== 'function') { inputs[key] = null; limits.push(`${label} : non rejouable`); continue; }
      try {
        const v = await read(at);
        inputs[key] = v ?? null;
        if (v == null) limits.push(`${label} : non archivé à cet instant`);
        else { const n = Array.isArray(v) ? v.length : Array.isArray(v?.items) ? v.items.length : null; if (n !== null) read_.push(`${label} : ${n} élément(s) lus`); }
      } catch (e) {
        inputs[key] = null;
        limits.push(`${label} : lecture en échec (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    // @ts-ignore entrées nulles acceptées par toSignals (elles deviennent « inconnu »)
    const { signals, unknown, errors: sigErrors } = toSignals(inputs, now);
    const registry = { state: () => new Map() };
    const res = evaluate(signals, registry, now, undefined, unknown);
    out.push({ at, scenarios: res.open, unknown, errors: [...sigErrors, ...res.errors], limits, read: read_ });
  }
  return out;
}

const cell = (/** @type {unknown} */ v) => String(v ?? 'n.d.').replace(/\|/g, '/').replace(/\s+/g, ' ');
const WORD_LABEL = { peu_probable: 'peu probable', possibilite_reelle: 'possibilité réelle', probable: 'probable', tres_probable: 'très probable' };

/** Rapport Markdown : un tableau par instant, les inconnus et les limites. */
export function renderReport(results, generatedAt = new Date().toISOString()) {
  const lines = [
    '# Rejeu du moteur d\'anticipation', '',
    `Généré le ${generatedAt}. Constats, pas des critères de recette : le moteur réel est rejoué sur ce que les archives publiques permettent de reconstituer, avec un registre vide à chaque instant. Les entrées non archivées sont inconnues, donc une règle qui en dépend ne peut pas s'ouvrir : l'absence de scénario ne prouve rien.`, '',
  ];
  for (const r of results) {
    lines.push(`## ${r.at}`, '');
    if (r.scenarios.length === 0) lines.push('Aucun scénario ouvert.', '');
    else {
      lines.push('| Règle | Département | Mot | Fenêtre | Titre |', '| --- | --- | --- | --- | --- |');
      for (const s of r.scenarios) {
        lines.push(`| ${cell(s.ruleId)} | ${cell(s.zone?.dept?.join(', ') || 'national')} | ${cell(WORD_LABEL[s.word] ?? s.word)} | ${cell(`${s.window?.from} à ${s.window?.to}`)} | ${cell(s.title)} |`);
      }
      lines.push('');
    }
    lines.push(`Lu : ${(r.read ?? []).join(' · ') || 'rien'}`, '', `Inconnus : ${r.unknown.length ? r.unknown.join(' · ') : 'aucun'}`, '', '### Limites', '');
    for (const l of r.limits) lines.push(`- ${l}`);
    if (!r.limits.length) lines.push('- aucune');
    if (r.errors.length) { lines.push('', 'Erreurs du moteur :'); for (const e of r.errors) lines.push(`- ${e}`); }
    lines.push('');
  }
  return lines.join('\n');
}

// ─── Lecture des archives publiques (CLI seulement) ───

const SITE = process.env.REPLAY_SITE ?? 'https://www.francemonitor.com';
const CACHE_DIR = path.resolve('node_modules/.cache/anticipation-replay');
const DAY_MS = 24 * 3_600_000;
const PAGE_LIMIT = 1000;
const MAX_PAGES = 12;
const DELAY_MS = 500;
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** Lecture JSON en lecture seule, sans identifiants, trois essais espacés. 404 : null. */
async function fetchJson(/** @type {string} */ url) {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await sleep(5_000 * attempt);
    await sleep(DELAY_MS);
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (resp.status === 404) return null;
      if (resp.ok) return await resp.json();
      last = `HTTP ${resp.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`${url} : ${last}`);
}

async function cached(/** @type {string} */ name, /** @type {() => Promise<unknown>} */ load) {
  const file = path.join(CACHE_DIR, name);
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* pas encore en cache */ }
  const v = await load();
  if (v !== null) { await mkdir(CACHE_DIR, { recursive: true }); await writeFile(file, JSON.stringify(v)); }
  return v;
}

/** Articles archivés des 24 h avant l'instant (tous, par pages, tels que /api/news les sert). */
async function archivedNews(/** @type {string} */ at) {
  return cached(`news-${at.replace(/[:.]/g, '-')}.json`, async () => {
    const atMs = Date.parse(at);
    const since = new Date(atMs - DAY_MS).toISOString();
    const items = [];
    let until = new Date(atMs).toISOString();
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await fetchJson(`${SITE}/api/news?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=${PAGE_LIMIT}`);
      const got = body?.items ?? [];
      items.push(...got);
      if (got.length < PAGE_LIMIT) break;
      const oldest = got[got.length - 1]?.publishedAt;
      if (!oldest) break;
      until = new Date(Date.parse(oldest) - 1).toISOString();
    }
    return items;
  });
}

let archiveDays = null;
/** Manifestations archivées : lignes vues au plus tard à l'instant, jours de la veille et du jour ; null si le jour n'est pas archivé. */
async function archivedProtests(/** @type {string} */ at) {
  archiveDays ??= (await fetchJson(`${SITE}/api/social/protests-archive`))?.days ?? [];
  const day = at.slice(0, 10);
  if (!archiveDays.includes(day)) return null;
  const prev = new Date(Date.parse(at) - DAY_MS).toISOString().slice(0, 10);
  const rows = [];
  for (const d of [prev, day]) {
    if (!archiveDays.includes(d)) continue;
    const body = await cached(`protests-${d}.json`, () => fetchJson(`${SITE}/api/social/protests-archive?day=${d}`));
    rows.push(...(body?.items ?? []));
  }
  // Une ligne d'archive porte son dernier état, relevé peut-être après l'instant : limite assumée dans le rapport.
  return { readAt: at, items: rows.filter((r) => typeof r.firstSeenAt === 'string' && r.firstSeenAt <= at) };
}

async function main() {
  const instants = (process.env.REPLAY_AT ?? DEFAULT_INSTANTS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const outFile = process.env.REPLAY_OUT ?? 'docs/rejeu/anticipation-2026-11.md';
  const results = await replayAt(instants, { news: archivedNews, protests: archivedProtests });
  const md = renderReport(results);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${md}\n`);
  for (const r of results) console.log(`${r.at} : ${r.scenarios.length} scénario(s), ${r.unknown.length} inconnu(s)`);
  console.log(`Rapport : ${outFile}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
