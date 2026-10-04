// api/_lib/ripestat.js : visibilité Internet des six grands réseaux français (spec 2026-10-04 souveraineté § 3.3 ; contrats § 2.6,
// arbitrage 31 ; faits § 5.4). RIPEstat « routing-status » (routeurs témoins RIS) : instantanés de 00 h, 08 h et 16 h UTC, jamais en
// continu ; relevé toutes les heures (six appels, deux à la fois, sourceapp=francemonitor, délai de 30 s : la première requête est
// lente). Visibilité = min(pairs qui voient le réseau en IPv4 / total, en IPv6 / total) × 100. L'échantillon de la visibilité minimale
// n'entre dans la série de 30 jours que si les six réseaux sont lus, une fois par instantané. Dernier relevé gardé en KV, servi daté.
import { appendSample, kvGetJson, kvSetJson } from './kv-history.js';
import { mapLimit } from './map-limit.js';
import { fetchStrictJson, sourceError } from './source-http.js';

export const MAJOR_NETWORKS = [
  { asn: 3215, name: 'Orange' }, { asn: 15557, name: 'SFR' }, { asn: 5410, name: 'Bouygues Telecom' }, { asn: 12322, name: 'Free' },
  { asn: 2200, name: 'RENATER' }, { asn: 16276, name: 'OVHcloud' },
];
export const RIPE_INTERVAL_MS = 60 * 60_000;
export const RIPE_TIMEOUT_MS = 30_000;
export const RIPE_LAST_KEY = 'sov:ripe:last';
export const RIPE_SAMPLES_KEY = 'sov:ripe:samples';
/** Préfixes annoncés par réseau (IPv4 + IPv6), 30 jours, mêmes instantanés complets : historique de la règle de baisse (S8, seuil posé par B26). */
export const RIPE_PREFIXES_KEY = 'sov:ripe:prefixes';
export const RIPE_SAMPLES_MAX_AGE_MS = 30 * 86_400_000;
/** Lecture plus longue que l'échéance de la route : note d'avancement, jamais une panne. */
export const RIPE_PENDING_NOTE = 'RIPEstat : lecture en cours';
const LAST_TTL_SEC = 3 * 86_400;
const MINUTE_MS = 60_000;

let queue = Promise.resolve();

/** Réservé aux tests : file libre. */
export function __resetRipeForTests() {
  queue = Promise.resolve();
}

export function routingStatusUrl(asn) {
  return `https://stat.ripe.net/data/routing-status/data.json?resource=AS${asn}&sourceapp=francemonitor`;
}

/** « 2026-10-04T08:00:00 » (UTC sans fuseau) vers ISO UTC ; null si illisible. */
function utcIso(text) {
  const s = String(text ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s)) return null;
  const t = Date.parse(`${s}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/** Visibilité d'un réseau ; lève sur une réponse illisible, un autre réseau, une visibilité, des préfixes ou un instantané absents. */
export function parseRoutingStatus(json, asn, name) {
  const d = json && typeof json === 'object' ? json.data : null;
  if (!json || json.status !== 'ok' || !d || typeof d !== 'object') throw new Error('réponse illisible');
  if (String(d.resource) !== String(asn)) throw new Error(`ressource inattendue (${String(d.resource)})`);
  const v4 = d.visibility?.v4 ?? {};
  const v6 = d.visibility?.v6 ?? {};
  const [v4Seeing, v4Total, v6Seeing, v6Total] = [v4.ris_peers_seeing, v4.total_ris_peers, v6.ris_peers_seeing, v6.total_ris_peers].map(count);
  if (v4Seeing === null || v6Seeing === null || !(v4Total > 0) || !(v6Total > 0) || v4Seeing > v4Total || v6Seeing > v6Total) throw new Error('visibilité non publiée');
  const v4Prefixes = count(d.announced_space?.v4?.prefixes);
  const v6Prefixes = count(d.announced_space?.v6?.prefixes);
  if (v4Prefixes === null || v6Prefixes === null) throw new Error('préfixes annoncés non publiés');
  const queryTime = utcIso(d.query_time);
  if (queryTime === null) throw new Error('instantané non daté');
  const pct = Math.min(v4Seeing / v4Total, v6Seeing / v6Total) * 100;
  if (!Number.isFinite(pct)) throw new Error('visibilité non publiée');
  return { asn, name, v4Seeing, v4Total, v6Seeing, v6Total, v4Prefixes, v6Prefixes, visibilityPct: Math.round(pct * 100) / 100, queryTime };
}

/** Relevé vide (jamais lu). */
export function emptyRipe(errors = []) {
  return { readAt: null, snapshotAt: null, networks: [], errors };
}

function served(record, errors) {
  if (!record || typeof record !== 'object' || typeof record.snapshotAt !== 'string') return emptyRipe(errors);
  return { readAt: record.readAt ?? null, snapshotAt: record.snapshotAt, networks: Array.isArray(record.networks) ? record.networks.filter((n) => n && Number.isFinite(n.visibilityPct)) : [], errors };
}

function errorsOf(record) {
  return record && typeof record === 'object' && Array.isArray(record.errors) ? record.errors : [];
}

/**
 * Un relevé : six appels, deux à la fois ; au moins un réseau lu : nouveau relevé (pannes nommées) ; aucun : dernier relevé gardé.
 * @param {number} [now]
 */
export async function collectRipe(now = Date.now()) {
  const attemptedAt = new Date(now).toISOString();
  const stored = await kvGetJson(RIPE_LAST_KEY, now);
  const results = await mapLimit(MAJOR_NETWORKS, 2, async (n) => parseRoutingStatus(
    await fetchStrictJson(routingStatusUrl(n.asn), { timeoutMs: RIPE_TIMEOUT_MS }), n.asn, n.name,
  ));
  const errors = [];
  const read = [];
  results.forEach((r, i) => {
    if (r.ok) read.push(r.value);
    else errors.push(sourceError(`RIPEstat, AS${MAJOR_NETWORKS[i].asn}`, r.error));
  });
  if (read.length === 0) {
    const kept = stored && typeof stored === 'object' && typeof stored.snapshotAt === 'string' ? stored : emptyRipe();
    const record = { ...kept, errors, attemptedAt };
    await kvSetJson(RIPE_LAST_KEY, record, LAST_TTL_SEC, now);
    return served(record, errors);
  }
  const snapshotAt = read.map((n) => n.queryTime).sort().at(-1);
  const networks = read.map((n) => { const { queryTime, ...visible } = n; return queryTime ? visible : n; });
  if (read.length === MAJOR_NETWORKS.length) {
    const minPct = Math.min(...networks.map((n) => n.visibilityPct));
    await appendSample(RIPE_SAMPLES_KEY, { at: snapshotAt, minPct }, { maxAgeMs: RIPE_SAMPLES_MAX_AGE_MS, minIntervalMs: MINUTE_MS, now });
    const prefixes = Object.fromEntries(networks.map((n) => [String(n.asn), n.v4Prefixes + n.v6Prefixes]));
    await appendSample(RIPE_PREFIXES_KEY, { at: snapshotAt, prefixes }, { maxAgeMs: RIPE_SAMPLES_MAX_AGE_MS, minIntervalMs: MINUTE_MS, now });
  }
  const record = { readAt: attemptedAt, snapshotAt, networks, errors, attemptedAt };
  await kvSetJson(RIPE_LAST_KEY, record, LAST_TTL_SEC, now);
  return served(record, errors);
}

function isDue(attemptedAt, now) {
  const t = attemptedAt ? Date.parse(attemptedAt) : Number.NaN;
  return !Number.isFinite(t) || now - t >= RIPE_INTERVAL_MS - MINUTE_MS;
}

/**
 * Dernier relevé, après une nouvelle lecture si elle est due (route et relève serveur) ; jamais deux lectures à la fois.
 * @param {number} [now]
 */
export function ensureRipeFresh(now = Date.now()) {
  const turn = queue.then(async () => {
    const last = await kvGetJson(RIPE_LAST_KEY, now);
    if (last && !isDue(last.attemptedAt ?? null, now)) return served(last, errorsOf(last));
    return collectRipe(now);
  });
  queue = turn.then(() => undefined, () => undefined);
  return turn;
}

/** Relevé gardé, sans attendre la lecture en cours (échéance de la route), avec `note`. */
export async function storedRipe(now, note) {
  const record = await kvGetJson(RIPE_LAST_KEY, now);
  return served(record, [...errorsOf(record), note]);
}
