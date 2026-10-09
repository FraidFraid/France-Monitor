// api/_lib/outages-internet.js : collecteur du panneau Internet (spec 2026-10-08 panneaux pannes § 3.1 ; faits § 5 à 7). IODA (événements
// sur 30 jours pour la France, ses départements par la table fixe des codes et six opérateurs) ; un événement en cours depuis plus de 7 jours
// est écarté du « en cours » (staleOpen : probable recalage de référence). Cloudflare Radar (anomalies de trafic et pannes signalées en
// France) si CLOUDFLARE_RADAR_TOKEN est posé, sinon « non configuré ». RIPEstat est repris du collecteur Connectivité (relevé gardé en KV,
// aucune requête en double). Chaque partie a sa cadence : IODA 10 min, Radar 15 min, d'après l'heure de sa dernière lecture RÉUSSIE ;
// une partie en échec garde ses dernières données, nomme son erreur et est retentée après 5 min (modèle outages-power.js). Dernier relevé
// gardé en KV, servi daté. Le jeton n'est ni journalisé, ni servi, ni gardé.
import { DEPT_NAMES } from '../_shared/departments.js';
import { deptOfIodaRegion } from './ioda-regions.js';
import { kvGetJson, kvSetJson } from './kv-history.js';
import { failed, partDue, succeeded } from './outages-power.js';
import { storedRipe } from './ripestat.js';
import { fetchStrictJson, sourceError } from './source-http.js';

export const IODA_BASE = 'https://api.ioda.inetintel.cc.gatech.edu/v2';
export const IODA_ASNS = [
  { asn: 3215, name: 'Orange' }, { asn: 12322, name: 'Free' }, { asn: 15557, name: 'SFR' }, { asn: 5410, name: 'Bouygues Telecom' },
  { asn: 16276, name: 'OVHcloud' }, { asn: 12876, name: 'Scaleway' },
];
export const RADAR_ANOMALIES_URL = 'https://api.cloudflare.com/client/v4/radar/traffic_anomalies';
export const RADAR_OUTAGES_URL = 'https://api.cloudflare.com/client/v4/radar/annotations/outages';
export const INTERNET_LAST_KEY = 'out:internet:last';
export const INTERNET_PENDING_NOTE = 'Internet : collecte en cours';
export const STALE_OPEN_SEC = 7 * 86_400;
export const ONGOING_SLACK_SEC = 20 * 60;
/** Nombre d'événements par requête IODA : une liste qui l'atteint est peut-être tronquée (P32). */
export const IODA_LIMIT = 200;
/** Nombre d'éléments par liste Radar : une liste qui l'atteint est peut-être tronquée (même règle que P32). */
export const RADAR_LIMIT = 50;
const IODA_INTERVAL_MS = 10 * 60_000;
const RADAR_INTERVAL_MS = 15 * 60_000;
const WINDOW_SEC = 30 * 86_400;
const LAST_TTL_SEC = 3 * 86_400;
const CAUSE_FR = { POWER_OUTAGE: 'coupure d’électricité', CABLE_CUT: 'câble coupé', GOVERNMENT_DIRECTED: 'coupure ordonnée', TECHNICAL_PROBLEM: 'problème technique', WEATHER: 'intempéries', MAINTENANCE: 'maintenance', UNKNOWN: 'cause inconnue' };
const TYPE_FR = { NATIONWIDE: 'nationale', REGIONAL: 'régionale', NETWORK: 'réseau' };

let queue = Promise.resolve();

/** Réservé aux tests : file libre. */
export function __resetInternetForTests() {
  queue = Promise.resolve();
}

/** Jeton Cloudflare Radar posé ? (lu à chaque appel ; sa valeur ne sort jamais de ce module). */
export function radarTokenSet() {
  return tokenOf() !== '';
}

const tokenOf = () => String(process.env.CLOUDFLARE_RADAR_TOKEN ?? '').trim();
const iso = (sec) => new Date(sec * 1000).toISOString();
const isoOrNull = (v) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const asnName = (asn, fallback) => IODA_ASNS.find((a) => a.asn === asn)?.name ?? fallback ?? `AS${asn}`;

/** Événement IODA brut → InternetEvent ; `untilSec` : fin de la fenêtre lue (instant de lecture). Null si l'événement est illisible. */
export function normalizeIodaEvent(raw, untilSec) {
  if (!raw || typeof raw !== 'object' || typeof raw.location !== 'string' || !Number.isFinite(raw.start) || !Number.isFinite(raw.duration)) return null;
  const [kind, code] = raw.location.split('/');
  let scope = 'inconnu'; let dept = null; let asn = null; let label = String(raw.location_name ?? raw.location);
  if (kind === 'country') { scope = 'national'; label = 'France'; }
  if (kind === 'region') {
    dept = deptOfIodaRegion(code);
    scope = dept === null ? 'inconnu' : 'departement';
    label = dept === null ? 'région non identifiée' : DEPT_NAMES[dept] ?? label;
  }
  if (kind === 'asn') {
    asn = Number(code);
    if (!Number.isInteger(asn)) return null;
    scope = 'operateur';
    label = `${asnName(asn)} (AS${asn})`;
  }
  const endSec = raw.start + raw.duration;
  const ongoing = raw.overlaps_window === true && endSec >= untilSec - ONGOING_SLACK_SEC;
  return {
    id: `${raw.location}:${raw.start}:${raw.datasource ?? 'n.d.'}`, scope, dept, asn, label, signal: String(raw.datasource ?? 'n.d.'),
    start: iso(raw.start), end: ongoing ? null : iso(endSec), durationSec: raw.duration,
    ongoing, staleOpen: ongoing && raw.duration > STALE_OPEN_SEC, score: Number(raw.score) || 0,
  };
}

/** Réponses Radar → éléments de la France seulement (anomalies d'un réseau étranger écartées), en cours d'abord puis plus récents. */
export function normalizeRadar(anomaliesJson, outagesJson) {
  const out = [];
  for (const a of anomaliesJson?.result?.trafficAnomalies ?? []) {
    const fr = a?.locationDetails?.code === 'FR' || a?.asnDetails?.location?.code === 'FR';
    const start = isoOrNull(a?.startDate);
    const end = a?.endDate ? isoOrNull(a.endDate) : null;
    if (!fr || start === null || (a.endDate && end === null)) continue;
    // Un réseau dont le numéro est illisible est écarté : il deviendrait une anomalie « du pays » (portée nationale).
    const asn = a.asnDetails ? Number(a.asnDetails.asn) : null;
    if (asn !== null && !Number.isInteger(asn)) continue;
    out.push({
      id: String(a.uuid), kind: 'anomalie', label: asn !== null ? `${asnName(asn, a.asnDetails.name)} (AS${asn})` : 'France', asn, start, end,
      verified: a.status === 'VERIFIED', cause: null, outageType: null, national: asn === null,
    });
  }
  for (const o of outagesJson?.result?.annotations ?? []) {
    const start = isoOrNull(o?.startDate);
    const end = o?.endDate ? isoOrNull(o.endDate) : null;
    if (!Array.isArray(o?.locations) || !o.locations.includes('FR') || start === null || (o.endDate && end === null)) continue;
    const asn = Array.isArray(o.asns) && o.asns.length === 1 && Number.isInteger(Number(o.asns[0])) ? Number(o.asns[0]) : null;
    const type = o.outage ? TYPE_FR[o.outage.outageType] ?? String(o.outage.outageType).toLowerCase() : null;
    // Une coupure « nationale » vue sur plusieurs pays n'est pas forcément celle de la France (P2) : nationale pour la France seulement si
    // le pays est seul. La portée est portée par `national`, jamais déduite du texte affiché.
    const national = type === 'nationale' && o.locations.length === 1;
    const outageType = type === 'nationale' && !national ? 'nationale, plusieurs pays' : type;
    // Sans portée nommée : « France » si nationale, sinon l'opérateur s'il y en a un, sinon « non localisé ».
    const label = o.scope ? String(o.scope) : national ? 'France' : asn !== null ? `${asnName(asn, o.asnsDetails?.[0]?.name)} (AS${asn})` : 'non localisé';
    out.push({
      id: `radar-${o.id}`, kind: 'panne', label, asn, start, end, verified: null, national,
      cause: o.outage ? CAUSE_FR[o.outage.outageCause] ?? String(o.outage.outageCause).toLowerCase() : null, outageType,
    });
  }
  return out.sort((a, b) => (a.end === null ? 0 : 1) - (b.end === null ? 0 : 1) || b.start.localeCompare(a.start));
}

function eventsUrl(params, fromSec, untilSec) {
  const p = new URLSearchParams({ ...params, from: String(fromSec), until: String(untilSec), limit: String(IODA_LIMIT) });
  return `${IODA_BASE}/outages/events?${p.toString()}`;
}

/** IODA : huit requêtes (pays, régions, six opérateurs). Lève si l'une échoue ou n'a pas la forme d'une liste d'événements. */
async function readIoda(now) {
  const untilSec = Math.floor(now / 1000);
  const fromSec = untilSec - WINDOW_SEC;
  const urls = [
    eventsUrl({ entityType: 'country', entityCode: 'FR' }, fromSec, untilSec),
    eventsUrl({ entityType: 'region', relatedTo: 'country/FR' }, fromSec, untilSec),
    ...IODA_ASNS.map((a) => eventsUrl({ entityType: 'asn', entityCode: String(a.asn) }, fromSec, untilSec)),
  ];
  const results = await Promise.all(urls.map((url) => fetchStrictJson(url, { timeoutMs: 20_000 })));
  const byId = new Map();
  let truncated = false;
  for (const r of results) {
    // Une réponse 200 sans liste n'est pas « aucune panne » : erreur nommée (S3).
    if (!Array.isArray(r?.data)) throw new Error('réponse sans liste d’événements');
    if (r.data.length >= IODA_LIMIT) truncated = true;
    for (const raw of r.data) {
      const e = normalizeIodaEvent(raw, untilSec);
      if (e !== null) byId.set(e.id, e);
    }
  }
  const events = [...byId.values()];
  const rank = (e) => (e.ongoing && !e.staleOpen ? 0 : e.ongoing ? 1 : 2);
  events.sort((a, b) => rank(a) - rank(b) || b.start.localeCompare(a.start));
  return { events, warning: truncated ? sourceError('IODA', new Error(`plus de ${IODA_LIMIT} événements, liste tronquée`)) : null };
}

/** Radar : anomalies et pannes de la France sur 7 jours. Lève sans jeton valide, sur une réponse en échec ou sans liste ; `warning` si une liste est peut-être tronquée. */
async function readRadar(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const q = `?location=FR&dateRange=7d&format=json&limit=${RADAR_LIMIT}`;
  const [anomalies, outages] = await Promise.all([
    fetchStrictJson(`${RADAR_ANOMALIES_URL}${q}`, { timeoutMs: 15_000, headers }),
    fetchStrictJson(`${RADAR_OUTAGES_URL}${q}`, { timeoutMs: 15_000, headers }),
  ]);
  if (anomalies?.success === false || outages?.success === false) throw new Error('réponse en échec');
  if (!Array.isArray(anomalies?.result?.trafficAnomalies) || !Array.isArray(outages?.result?.annotations)) throw new Error('réponse sans liste');
  const truncated = anomalies.result.trafficAnomalies.length >= RADAR_LIMIT || outages.result.annotations.length >= RADAR_LIMIT;
  return { items: normalizeRadar(anomalies, outages), warning: truncated ? sourceError('Cloudflare Radar', new Error(`plus de ${RADAR_LIMIT} éléments par liste, liste tronquée`)) : null };
}

/** Réponse vide (jamais lu) : listes vides, dates null, jamais « aucune panne ». `configured` : le jeton Radar est posé. */
export function emptyInternet(errors = [], configured = false) {
  return { readAt: null, iodaReadAt: null, radar: { configured, readAt: null, items: [] }, events: [], ripe: null, errors };
}

/** Rappel RIPEstat : dernier instantané du collecteur Connectivité, lu en KV sans requête ; `ripe` null s'il n'y en a pas, `error` nommée si la lecture lève. */
async function ripePart(now) {
  try {
    const r = await storedRipe(now, '');
    if (!r || r.snapshotAt === null) return { ripe: null, error: null };
    return { ripe: { snapshotAt: r.snapshotAt, networks: (r.networks ?? []).map((n) => ({ asn: n.asn, name: n.name, visibilityPct: n.visibilityPct })) }, error: null };
  } catch (err) {
    return { ripe: null, error: sourceError('RIPEstat', err) };
  }
}

/** Radar est dû si le jeton vient d'être posé ou si sa dernière lecture réussie date de 15 min ; sans jeton, jamais. */
const radarDue = (part, token, now) => token !== '' && (!part?.configured || partDue(part, RADAR_INTERVAL_MS, now));
const anyDue = (parts, token, now) => partDue(parts.ioda, IODA_INTERVAL_MS, now) || radarDue(parts.radar, token, now) || (token === '' && parts.radar !== undefined);

/** Réponse à partir des parties lues. `readAt` : dernière lecture réussie d'une des deux sources, null si aucune. */
function buildInternet(parts, token, { ripe, error: ripeError }) {
  const ioda = parts.ioda;
  const radar = token !== '' ? parts.radar : null;
  const reads = [ioda?.readAt, radar?.readAt].filter((v) => typeof v === 'string');
  const errors = [ioda?.error, ioda?.warning, radar?.error, radar?.warning, ripeError].filter((e) => typeof e === 'string' && e.length > 0);
  return {
    readAt: reads.length > 0 ? reads.sort().at(-1) : null, iodaReadAt: ioda?.readAt ?? null,
    radar: token === '' ? { configured: false, readAt: null, items: [] } : { configured: true, readAt: radar?.readAt ?? null, items: radar?.items ?? [] },
    events: ioda?.events ?? [], ripe, errors,
  };
}

/** Une collecte : chaque partie relue si elle est due ; une partie en panne garde ses dernières données et nomme son erreur. */
export async function collectInternet(now = Date.now()) {
  const attemptedAt = new Date(now).toISOString();
  const token = tokenOf();
  const stored = await kvGetJson(INTERNET_LAST_KEY, now);
  const parts = { ...(stored && typeof stored === 'object' ? stored.parts : null) };
  if (token === '') delete parts.radar;

  const jobs = [];
  if (partDue(parts.ioda, IODA_INTERVAL_MS, now)) {
    jobs.push((async () => {
      try {
        parts.ioda = succeeded(await readIoda(now), attemptedAt);
      } catch (err) {
        parts.ioda = failed(parts.ioda, { readAt: null, events: [], warning: null }, sourceError('IODA', err), attemptedAt);
      }
    })());
  }
  if (radarDue(parts.radar, token, now)) {
    jobs.push((async () => {
      try {
        parts.radar = succeeded({ configured: true, ...(await readRadar(token)) }, attemptedAt);
      } catch (err) {
        parts.radar = failed(parts.radar, { configured: true, readAt: null, items: [] }, sourceError('Cloudflare Radar', err), attemptedAt);
      }
    })());
  }
  await Promise.all(jobs);

  const body = buildInternet(parts, token, await ripePart(now));
  await kvSetJson(INTERNET_LAST_KEY, { attemptedAt, parts, body }, LAST_TTL_SEC, now);
  return body;
}

/** Dernier relevé, après une collecte si une partie est due ; jamais deux à la fois. */
export function ensureInternetFresh(now = Date.now()) {
  const turn = queue.then(async () => {
    const last = await kvGetJson(INTERNET_LAST_KEY, now);
    if (last?.body && 'ripe' in last.body && last.parts && !anyDue(last.parts, tokenOf(), now)) return last.body;
    return collectInternet(now);
  });
  queue = turn.then(() => undefined, () => undefined);
  return turn;
}

/** Relevé gardé, sans attendre la collecte en cours, avec `note`. Le jeton est relu : « configuré » ne survit pas à son retrait (P36). */
export async function storedInternet(now, note) {
  const last = await kvGetJson(INTERNET_LAST_KEY, now);
  const tokenSet = radarTokenSet();
  const body = last?.body && typeof last.body === 'object' && 'ripe' in last.body ? last.body : emptyInternet([], tokenSet);
  const radar = tokenSet ? { ...body.radar, configured: true } : { configured: false, readAt: null, items: [] };
  return { ...body, radar, errors: [...body.errors, note] };
}
