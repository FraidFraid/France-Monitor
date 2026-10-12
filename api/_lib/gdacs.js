// api/_lib/gdacs.js : alertes catastrophes GDACS (ONU / Commission européenne ; spec 2026-10-12 GDACS). Deux familles de requêtes
// (vérifiées le 12/10/2026) : Monde, orange et rouge, sans pays ; Territoire, tous niveaux, une requête par territoire français
// (le filtre `country` n'accepte qu'un pays, clé ISO3 pour FRA, nom anglais ailleurs). 100 résultats au plus par page ; 204 à corps
// vide = aucun événement. Fenêtre par chevauchement de 7 jours. Le territoire est celui de la requête qui a rendu l'événement.
import { cachedSource, cleanText, fetchStrictResponse, sourceError } from './source-http.js';

export const GDACS_SEARCH = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';
export const GDACS_EVENT_TYPES = 'EQ;TC;FL;VO;DR;WF';
export const GDACS_PAGE_SIZE = 100;
export const DISASTER_WINDOW_MS = 7 * 86_400_000;
const MAX_PAGES = 3;
const FETCH_TIMEOUT_MS = 20_000;
const FRESH_SEC = 600;
/** Relevé encore servi sans panne : 10 min de cache après une lecture d'au plus FETCH_TIMEOUT_MS (même marge que Séismes). */
const FRESH_READ_MS = FRESH_SEC * 1000 + FETCH_TIMEOUT_MS;
export const GDACS_STALE_SERVED_ERROR = 'GDACS : source indisponible, relevé précédent servi';

/** Territoires français interrogés, dans cet ordre (le premier qui rend un événement le nomme). TAAF écartées : aucune population. */
export const FRENCH_TERRITORIES = Object.freeze([
  { key: 'FRA', iso3: 'FRA', label: 'France (Hexagone et Corse)' },
  { key: 'Guadeloupe', iso3: 'GLP', label: 'Guadeloupe' },
  { key: 'Martinique', iso3: 'MTQ', label: 'Martinique' },
  { key: 'French Guiana', iso3: 'GUF', label: 'Guyane' },
  { key: 'Reunion', iso3: 'REU', label: 'La Réunion' },
  { key: 'Mayotte', iso3: 'MYT', label: 'Mayotte' },
  { key: 'Saint Pierre and Miquelon', iso3: 'SPM', label: 'Saint-Pierre-et-Miquelon' },
  { key: 'Saint Barthelemy', iso3: 'BLM', label: 'Saint-Barthélemy' },
  { key: 'Saint Martin', iso3: 'MAF', label: 'Saint-Martin' },
  { key: 'Wallis and Futuna', iso3: 'WLF', label: 'Wallis-et-Futuna' },
  { key: 'French Polynesia', iso3: 'PYF', label: 'Polynésie française' },
  { key: 'New Caledonia', iso3: 'NCL', label: 'Nouvelle-Calédonie' },
]);
const TERRITORY_BY_ISO3 = new Map(FRENCH_TERRITORIES.map((t) => [t.iso3, t.label]));
const TYPES = { EQ: 'seisme', TC: 'cyclone', FL: 'inondation', VO: 'volcan', DR: 'secheresse', WF: 'feu' };
const LEVELS = { Green: 'vert', Orange: 'orange', Red: 'rouge' };
const LEVEL_RANK = { rouge: 0, orange: 1, vert: 2 };
const QUERIES = [
  { country: null, territory: null, label: 'GDACS monde' },
  ...FRENCH_TERRITORIES.map((t) => ({ country: t.key, territory: t.label, label: `GDACS ${t.label}` })),
];

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const round4 = (v) => Math.round(v * 10_000) / 10_000;

/** URL d'une requête : Monde (country null) en orange et rouge, Territoire en tous niveaux ; page au-delà de 1 seulement si demandée. */
export function gdacsUrl(now, { country = null, page = 1 } = {}) {
  const levels = country === null ? 'orange;red' : 'green;orange;red';
  const params = [`eventlist=${GDACS_EVENT_TYPES}`, `fromDate=${utcDay(now - DISASTER_WINDOW_MS)}`, `toDate=${utcDay(now)}`, `alertlevel=${levels}`];
  if (country !== null) params.push(`country=${encodeURIComponent(country)}`);
  if (page > 1) params.push(`pagenumber=${page}`);
  return `${GDACS_SEARCH}?${params.join('&')}`;
}

/** Date GDACS (« 2026-10-07T15:00:00 », sans fuseau) lue en UTC ; null si illisible. */
export function gdacsTime(raw) {
  const text = String(raw ?? '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return null;
  const ms = Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function severityOf(p) {
  const text = cleanText(p.severitydata?.severitytext ?? '');
  return text === '' || /^Magnitude 0(?![\d.,])/.test(text) ? null : text;
}

function nameOf(p) {
  return cleanText(p.name ?? p.eventname ?? '').replace(/[,\s]+$/, '');
}

/**
 * Une page GDACS → alertes : six types connus, point lisible, fenêtre de 7 jours (en cours, ou terminée depuis 7 jours au plus ;
 * datée de plus d'un jour dans le futur : écartée). Monde (territory null) : orange et rouge seulement, territoire déduit des pays
 * touchés ; Territoire : tous niveaux, territoire imposé (GDACS y rattache des séismes en mer sans pays).
 */
export function parseGdacs(fc, now, territory) {
  if (!fc || typeof fc !== 'object' || !Array.isArray(fc.features)) throw new Error('FeatureCollection attendue');
  const alerts = [];
  for (const f of fc.features) {
    const p = f?.properties ?? {};
    const type = TYPES[p.eventtype];
    const level = LEVELS[p.alertlevel];
    const coords = f?.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    const lon = Number(coords?.[0]);
    const lat = Number(coords?.[1]);
    const from = gdacsTime(p.fromdate);
    const to = gdacsTime(p.todate);
    if (!type || !level || !Number.isFinite(lat) || !Number.isFinite(lon) || from === null || to === null) continue;
    if (territory === null && level === 'vert') continue;
    const current = String(p.iscurrent).toLowerCase() === 'true';
    if ((!current && now - to > DISASTER_WINDOW_MS) || from > now + 86_400_000) continue;
    const listed = Array.isArray(p.affectedcountries) ? p.affectedcountries.map((c) => c?.iso3) : [];
    const countries = [...new Set([p.iso3, ...listed].filter((c) => typeof c === 'string' && c !== ''))];
    const french = territory ?? countries.map((c) => TERRITORY_BY_ISO3.get(c)).find((l) => l !== undefined) ?? null;
    alerts.push({
      id: `${p.eventtype}-${p.eventid}`, type, level, name: nameOf(p), countries, frenchTerritory: french,
      lat: round4(lat), lon: round4(lon), from: new Date(from).toISOString(), to: new Date(to).toISOString(), current,
      severity: severityOf(p), url: typeof p.url?.report === 'string' ? p.url.report : null,
    });
  }
  return alerts;
}

function byPriority(a, b) {
  return Number(b.frenchTerritory !== null) - Number(a.frenchTerritory !== null)
    || LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
    || Date.parse(b.from) - Date.parse(a.from);
}

/** Fusion par événement : la version portant un territoire français l'emporte ; tri France, niveau, date. */
export function mergeAlerts(lists) {
  const byId = new Map();
  for (const a of lists.flat()) {
    const prev = byId.get(a.id);
    if (!prev || (prev.frenchTerritory === null && a.frenchTerritory !== null)) byId.set(a.id, a);
  }
  return [...byId.values()].sort(byPriority);
}

/** Pages d'une requête (suivante lue seulement si la page est pleine) ; 204 à corps vide = aucun événement. */
async function readQuery(now, q) {
  const alerts = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let text;
    try {
      ({ text } = await fetchStrictResponse(gdacsUrl(now, { country: q.country, page }), { expect: 'json', timeoutMs: FETCH_TIMEOUT_MS }));
    } catch (err) {
      if (err?.kind === 'empty' && err?.status === 204) return alerts;
      throw err;
    }
    let fc;
    try { fc = JSON.parse(text); } catch { throw new Error('JSON illisible'); }
    alerts.push(...parseGdacs(fc, now, q.territory));
    if (fc.features.length < GDACS_PAGE_SIZE) break;
  }
  return alerts;
}

export function emptyDisasters(errors) {
  return { readAt: null, alerts: [], errors };
}

function served(v, now, errors) {
  return {
    readAt: v.readAt,
    alerts: v.alerts.filter((a) => a.current || now - Date.parse(a.to) <= DISASTER_WINDOW_MS),
    errors,
  };
}

/**
 * 13 requêtes en parallèle (cache de 10 min, mémoire du processus) : 200 dès qu'une a répondu, les autres pannes nommées
 * (« GDACS Guadeloupe : HTTP 500 »). Toutes en échec : le relevé précédent est servi avec sa date et la panne nommée ; sans relevé,
 * réponse vide datée null. Jamais de panne silencieuse.
 */
export async function loadDisasters(now = Date.now()) {
  const readAt = new Date(now).toISOString();
  try {
    const v = await cachedSource('env:gdacs', { ttlSec: FRESH_SEC, staleSec: 86_400, shared: false, waitMs: FETCH_TIMEOUT_MS + 5_000 }, async () => {
      const settled = await Promise.allSettled(QUERIES.map((q) => readQuery(now, q)));
      const errors = [];
      const lists = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') lists.push(r.value);
        else errors.push(sourceError(QUERIES[i].label, r.reason));
      });
      if (lists.length === 0) throw new Error(errors.join(' ; '));
      return { readAt, alerts: mergeAlerts(lists), errors };
    });
    const fresh = now - Date.parse(v.readAt) <= FRESH_READ_MS;
    return served(v, now, fresh ? v.errors : [GDACS_STALE_SERVED_ERROR, ...v.errors]);
  } catch (err) {
    return emptyDisasters([sourceError('GDACS', err)]);
  }
}
