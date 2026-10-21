// api/_lib/outages-atlas.js : sondes RIPE Atlas décrochées en France (control room des pannes, 21/10/2026). API publique sans clé,
// environ 1 100 sondes connectées, hébergées surtout chez des particuliers (box Free, Orange, Bouygues, SFR) : des sondes d'un même
// opérateur qui décrochent ensemble mesurent une coupure d'internet fixe. Une sonde est « décrochée » si elle est déconnectée depuis
// moins de 30 min ; « active » si elle est connectée ou décrochée depuis moins de 6 h. Relève toutes les 5 min, en mémoire.
import { fetchStrictJson, sourceError } from './source-http.js';
import { OPERATOR_ASN } from './outages-now.js';

export const ATLAS_INTERVAL_MS = 5 * 60_000;
/** Une relève plus vieille que 15 min ne signale plus rien. */
export const ATLAS_MAX_AGE_MS = 15 * 60_000;
const DOWN_MS = 30 * 60_000;
const ACTIVE_MS = 6 * 3600 * 1000;
const FIRST_PAGE = 'https://atlas.ripe.net/api/v2/probes/?country_code=FR&status__in=1,2&page_size=500&fields=id,asn_v4,status';
const MAX_PAGES = 6;

const levelOf = (down, active, min) => (down < min || active === 0 || down / active < 0.1 ? null : down / active >= 0.25 ? 'rouge' : 'orange');

/**
 * Décrochages par opérateur grand public et pour le pays entier.
 * @param {Array<{ asn_v4: number | null, status: { id: number, since: string } }>} probes
 */
export function atlasSignals(probes, now) {
  const by = new Map();
  let active = 0;
  let down = 0;
  let firstDown = null;
  for (const p of probes) {
    const since = Date.parse(p?.status?.since ?? '');
    const connected = p?.status?.id === 1;
    const age = Number.isFinite(since) ? now - since : Infinity;
    if (!connected && age > ACTIVE_MS) continue;
    const isDown = !connected && age <= DOWN_MS;
    active += 1;
    if (isDown) {
      down += 1;
      firstDown = firstDown === null ? since : Math.min(firstDown, since);
    }
    const asn = p?.asn_v4;
    if (!OPERATOR_ASN.has(asn)) continue;
    const g = by.get(asn) ?? { asn, operator: OPERATOR_ASN.get(asn), active: 0, down: 0, sinceMs: null };
    g.active += 1;
    if (isDown) {
      g.down += 1;
      g.sinceMs = g.sinceMs === null ? since : Math.min(g.sinceMs, since);
    }
    by.set(asn, g);
  }
  const rank = { orange: 1, rouge: 2 };
  const operators = [...by.values()].flatMap((g) => {
    const level = levelOf(g.down, g.active, 5);
    return level === null ? [] : [{ asn: g.asn, operator: g.operator, down: g.down, active: g.active, level, since: new Date(g.sinceMs).toISOString() }];
  }).sort((a, b) => rank[b.level] - rank[a.level] || b.down - a.down);
  const nationalLevel = levelOf(down, active, 20);
  return {
    operators,
    national: nationalLevel === null ? null : { down, active, level: nationalLevel, since: new Date(firstDown).toISOString() },
  };
}

/** @type {{ at: number, signals: ReturnType<typeof atlasSignals>, error: string | null } | null} */
let last = null;
/** @type {Promise<void> | null} */
let running = null;

/** Réservé aux tests. */
export function __resetAtlasForTests() {
  last = null;
  running = null;
}

async function collect(now) {
  try {
    const probes = [];
    let url = FIRST_PAGE;
    for (let page = 0; url && page < MAX_PAGES; page += 1) {
      const json = await fetchStrictJson(url, { timeoutMs: 20_000 });
      if (Array.isArray(json?.results)) probes.push(...json.results);
      url = typeof json?.next === 'string' ? json.next : null;
    }
    last = { at: now, signals: atlasSignals(probes, now), error: null };
  } catch (err) {
    last = { at: now, signals: { operators: [], national: null }, error: sourceError('RIPE Atlas', err) };
  }
}

/** Relève au plus toutes les 5 min, une seule à la fois. Ne lève jamais. */
export async function ensureAtlasFresh(now = Date.now()) {
  if (last !== null && now - last.at < ATLAS_INTERVAL_MS) return;
  running ??= collect(now).finally(() => { running = null; });
  await running;
}

/** Pannes mesurées par RIPE Atlas (relève de moins de 15 min) : opérateurs, puis pays entier (asn null). */
export function atlasOutages(now = Date.now()) {
  if (last === null || last.error !== null || now - last.at > ATLAS_MAX_AGE_MS) return [];
  const out = last.signals.operators.map((o) => ({ ...o }));
  if (last.signals.national) out.push({ asn: null, operator: null, ...last.signals.national });
  return out;
}

/** Instant de la dernière relève réussie (ISO), null sinon ; erreur de la dernière relève. */
export function atlasStatus() {
  return { readAt: last && last.error === null ? new Date(last.at).toISOString() : null, error: last?.error ?? null };
}
