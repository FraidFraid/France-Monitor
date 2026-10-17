// api/_lib/protests-gdelt.js : manifestations en France relevées par GDELT dans la presse mondiale (spec 2026-10-17 manifestations).
// Vérifié le 17/10/2026 : `lastupdate.txt` donne le dernier export de 15 min (`AAAAMMJJHHMMSS.export.CSV.zip`, une entrée deflate,
// ~50 Ko, 61 colonnes séparées par tabulation, redirection 301 http → https). Sur 24 h : ~20 événements CAMEO 14 en France, presque
// tous placés « Paris, France (general) » ou « France » : GDELT dit que la presse parle de manifestations, pas où elles ont lieu.
// Écartés : acteur d'un autre pays (une manifestation albanaise placée en France), événement daté de plus d'un jour (article de fond).
import { inflateRawSync } from 'node:zlib';
import { SOURCE_USER_AGENT, cachedSource, formatTimeoutMs } from './source-http.js';

export const GDELT_LAST_UPDATE = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt';
export const GDELT_WINDOW_MS = 24 * 3_600_000;
const SLOT_MS = 15 * 60_000;
const SLOTS = GDELT_WINDOW_MS / SLOT_MS;
const FETCH_TIMEOUT_MS = 20_000;
const CONCURRENCY = 8;
const MAX_ARTICLES = 8;

/** Pays GDELT (FIPS 10-4) du territoire français : métropole et outre-mer. */
export const FRENCH_FIPS = Object.freeze({
  FR: 'France', RE: 'La Réunion', GP: 'Guadeloupe', MB: 'Martinique', FG: 'Guyane', MF: 'Mayotte', NC: 'Nouvelle-Calédonie',
  FP: 'Polynésie française', SB: 'Saint-Pierre-et-Miquelon', WF: 'Wallis-et-Futuna',
});
/** Codes acteur CAMEO admis : France, ou pays non renseigné. */
const FRENCH_ACTOR = new Set(['', 'FRA']);
/** Libellés français des codes CAMEO 140 à 145 (trois premiers chiffres). */
export const CAMEO_LABELS = Object.freeze({
  140: 'Contestation', 141: 'Manifestation ou rassemblement', 142: 'Grève de la faim', 143: 'Grève ou boycott',
  144: 'Blocage', 145: 'Heurts ou émeute',
});
const COL = {
  sqlDate: 1, actor1Country: 7, actor2Country: 17, eventCode: 26, rootCode: 28, geoType: 51, geoName: 52, geoCountry: 53,
  lat: 56, lon: 57, featureId: 58, dateAdded: 59, url: 60,
};

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);
const fromStamp = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
export const exportUrl = (slotStamp) => `http://data.gdeltproject.org/gdeltv2/${slotStamp}.export.CSV.zip`;

/** Horodatage du dernier export annoncé par lastupdate.txt (première ligne), ou null. */
export function latestExportStamp(text) {
  return /(\d{14})\.export\.CSV\.zip/.exec(String(text ?? ''))?.[1] ?? null;
}

/** Les 96 exports des 24 h qui finissent à `latest` (plus récent d'abord). */
export function windowStamps(latest) {
  const end = fromStamp(latest);
  return Array.from({ length: SLOTS }, (_, i) => stamp(end - i * SLOT_MS));
}

/** Contenu de la première entrée d'une archive zip (deflate ou stockée). Lève si l'archive est illisible. */
export function unzipFirstEntry(buf) {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('archive zip illisible');
  const method = buf.readUInt16LE(8);
  const size = buf.readUInt32LE(18);
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  const data = size > 0 ? buf.subarray(start, start + size) : buf.subarray(start);
  if (method === 0) return data.toString('utf8');
  if (method !== 8) throw new Error(`compression zip ${method} non lue`);
  return inflateRawSync(data).toString('utf8');
}

const parseDateAdded = (s) => (/^\d{14}$/.test(s) ? fromStamp(s) : null);
const sqlDay = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

/**
 * Événements de manifestation en France d'un export : `{ code, place, fips, lat, lon, featureId, seenAt, url, violent }`.
 * Gardés : code racine 14, lieu sur le territoire français, acteurs français ou sans pays, événement daté d'hier ou d'aujourd'hui.
 */
export function parseExport(text, now) {
  const minDay = sqlDay(now - 86_400_000);
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const c = line.split('\t');
    if (c.length < 61 || c[COL.rootCode] !== '14') continue;
    const fips = c[COL.geoCountry];
    if (!Object.hasOwn(FRENCH_FIPS, fips)) continue;
    if (!FRENCH_ACTOR.has(c[COL.actor1Country]) || !FRENCH_ACTOR.has(c[COL.actor2Country])) continue;
    if (c[COL.sqlDate] < minDay) continue;
    const seenAt = parseDateAdded(c[COL.dateAdded]);
    const url = c[COL.url].trim();
    if (seenAt === null || !/^https?:\/\//.test(url)) continue;
    // Lieu précis seulement pour une ville (type 4) ; un pays ou une région (types 1 et 5) reste sans point.
    const precise = c[COL.geoType] === '4';
    const lat = Number.parseFloat(c[COL.lat]);
    const lon = Number.parseFloat(c[COL.lon]);
    out.push({
      code: Number(c[COL.eventCode].slice(0, 3)),
      place: precise ? c[COL.geoName].split(',')[0].trim() : null,
      fips,
      lat: precise && Number.isFinite(lat) ? lat : null,
      lon: precise && Number.isFinite(lon) ? lon : null,
      featureId: precise ? c[COL.featureId] : `pays:${fips}`,
      seenAt,
      url,
      violent: c[COL.eventCode].startsWith('145'),
    });
  }
  return out;
}

const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

/**
 * Un relevé par lieu sur la fenêtre : articles sans doublon d'adresse (heurts si un des événements de l'article est 145), plus récent
 * d'abord ; titre = libellé du code le plus fréquent. Les événements hors fenêtre de 24 h sont écartés.
 */
export function groupGdelt(events, now) {
  const byPlace = new Map();
  for (const ev of events) {
    if (ev.seenAt < now - GDELT_WINDOW_MS) continue;
    const group = byPlace.get(ev.featureId) ?? { events: [], articles: new Map() };
    group.events.push(ev);
    const prev = group.articles.get(ev.url);
    group.articles.set(ev.url, {
      url: ev.url, domain: domainOf(ev.url), seenAt: Math.max(prev?.seenAt ?? 0, ev.seenAt), violent: Boolean(prev?.violent) || ev.violent,
    });
    byPlace.set(ev.featureId, group);
  }
  const items = [];
  for (const [featureId, group] of byPlace) {
    const first = group.events[0];
    const counts = new Map();
    for (const ev of group.events) if (ev.code !== 140) counts.set(ev.code, (counts.get(ev.code) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 140;
    const articles = [...group.articles.values()].sort((a, b) => b.seenAt - a.seenAt);
    const territory = FRENCH_FIPS[first.fips];
    items.push({
      id: `gdelt:${featureId}`,
      source: 'gdelt',
      status: 'signale',
      title: CAMEO_LABELS[top] ?? CAMEO_LABELS[140],
      startsAt: new Date(articles[0].seenAt).toISOString(),
      allDay: false,
      city: first.fips === 'FR' ? first.place : first.place ? `${first.place} (${territory})` : territory,
      dept: null,
      lat: first.lat,
      lon: first.lon,
      url: articles[0].url,
      edition: null,
      violent: articles.some((a) => a.violent),
      articles: articles.slice(0, MAX_ARTICLES).map((a) => ({ ...a, seenAt: new Date(a.seenAt).toISOString() })),
    });
  }
  return items;
}

/** Corps binaire d'une URL (redirections suivies) ; null sur 404 (export manquant, fréquent chez GDELT). */
async function fetchBinary(url) {
  let resp;
  try {
    resp = await fetch(url, { headers: { 'User-Agent': SOURCE_USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    throw new Error(name === 'TimeoutError' || name === 'AbortError' ? `délai dépassé (${formatTimeoutMs(FETCH_TIMEOUT_MS)})` : `réseau : ${String(err)}`);
  }
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

/** Exports déjà lus (immuables) : événements retenus par horodatage, gardés le temps de la fenêtre. Mémoire du processus. */
const exportsRead = new Map();

/** Réservé aux tests. */
export function __resetGdeltForTests() {
  exportsRead.clear();
}

async function readExport(slotStamp, now) {
  if (exportsRead.has(slotStamp)) return exportsRead.get(slotStamp);
  const buf = await fetchBinary(exportUrl(slotStamp));
  const events = buf === null ? null : parseExport(unzipFirstEntry(buf), now);
  exportsRead.set(slotStamp, events);
  return events;
}

/**
 * Relevés GDELT des 24 h : `{ items, files, missingFiles }`. Seuls les exports pas encore lus sont téléchargés (8 à la fois) ; un export
 * absent (404) compte comme manquant ; un export en panne n'est pas mémorisé (relu au prochain relevé). Lève si lastupdate.txt est
 * illisible ou si aucun export n'a pu être lu.
 */
export async function loadGdelt(now) {
  return cachedSource('protests:gdelt', { ttlSec: 900, waitMs: 30_000 }, async () => {
    const res = await fetchBinary(GDELT_LAST_UPDATE);
    const latest = res === null ? null : latestExportStamp(res.toString('utf8'));
    if (latest === null) throw new Error('dernier export introuvable');
    const stamps = windowStamps(latest);
    for (const key of exportsRead.keys()) if (!stamps.includes(key)) exportsRead.delete(key);
    const results = new Array(stamps.length);
    let next = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (next < stamps.length) {
        const i = next;
        next += 1;
        results[i] = await readExport(stamps[i], now).then((v) => ({ ok: true, v }), (err) => ({ ok: false, err }));
      }
    }));
    const read = results.filter((r) => r.ok && r.v !== null);
    if (read.length === 0) throw new Error(results.find((r) => !r.ok)?.err?.message ?? 'aucun export lisible');
    return {
      items: groupGdelt(read.flatMap((r) => r.v), now),
      files: read.length,
      missingFiles: stamps.length - read.length,
    };
  });
}
