// api/_lib/atmo.js : qualité de l'air (Atmo France, Atmo Data WFS sans clé, licence ODbL ; spec 2026-10-04 environnement § 3.2,
// contrats § 2.7). TOUTE requête est filtrée en CQL par date et réduite par propertyName : une requête sans filtre a renvoyé 285 Mo
// (faits § 5.1). Garde « réponse WFS non filtrée » : trop d'entités annoncées, une date hors du filtre, ou un corps de plus de 30 Mo
// est une erreur. Épisodes de J à J+2 (alrt:alrt3j) ; indice ATMO de J par commune (ind:ind_atmo_2021), agrégé par département.
import { DEPT_NAMES } from '../_shared/departments.js';
import { parisDay, parisHour } from './paris-time.js';
import { cachedSource, fetchStrictText, sourceError } from './source-http.js';

export const ATMO_EPISODES_BASE = 'https://data.atmo-france.org/geoserver/alrt/ows';
export const ATMO_INDEX_BASE = 'https://data.atmo-france.org/geoserver/ind/ows';
/** Plafonds de la garde : 274 entités par jour pour les épisodes (822 sur 3 jours), 27 022 communes pour l'indice (04/10). */
export const EPISODES_MAX_MATCHED = 3_000;
export const INDEX_MAX_MATCHED = 40_000;
/** Corps borné à 30 Mo, contrôlé après lecture (le délai de 20 s borne la lecture ; arbitrage 9). */
export const MAX_BODY_CHARS = 30_000_000;
const WFS_TIMEOUT_MS = 20_000;

function wfsUrl(base, typeName, propertyName, cql) {
  const url = new URL(base);
  const params = { service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName, outputFormat: 'application/json', propertyName, cql_filter: cql };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export function episodesUrl(j, j2) {
  return wfsUrl(ATMO_EPISODES_BASE, 'alrt:alrt3j', 'date_maj,etat,lib_zone,code_zone,lib_pol,code_pol,date_ech', `date_ech>='${j}' AND date_ech<='${j2}'`);
}

export function indexUrl(j) {
  return wfsUrl(ATMO_INDEX_BASE, 'ind:ind_atmo_2021', 'code_zone,code_qual,date_maj,date_ech', `date_ech='${j}'`);
}

/** Jour civil « AAAA-MM-JJ » plus k jours, par le calendrier (jamais + 24 h : le jour du changement d'heure dure 25 h). */
export function addDays(day, k) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10);
}

/** Relève : toutes les heures de 13 h à 19 h (Paris, publication de la prévision vers 14 h), toutes les 6 h sinon. */
export function airQualityTtlSec(now) {
  const h = parisHour(now);
  return h >= 13 && h < 19 ? 3_600 : 21_600;
}

/** État d'un épisode : null pour « PAS DE DEPASSEMENT » ; mots-clés sinon (contrats § 9, point 10). */
export function episodeState(etat) {
  const s = String(etat ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (s.includes('PAS DE DEPASSEMENT')) return null;
  if (s.includes('ALERTE')) return 'alerte';
  if (s.includes('INFORMATION') || s.includes('RECOMMANDATION')) return 'information';
  return 'inconnu';
}

/** Polluants : regroupés par nom (codes hétérogènes selon les AASQA, arbitrage 6) ; PM2,5 avant PM10 (« particules fines PM2.5 »). */
const POLLUTANTS = [
  { code: 'PM2.5', label: 'particules fines PM2,5', test: /pm\s*2[.,]?5|2[.,]5\s*(?:µ|u)m/ },
  { code: 'PM10', label: 'particules PM10', test: /pm\s*10|particule|10\s*(?:µ|u)m/ },
  { code: 'O3', label: 'ozone', test: /ozone|\bo3\b/ },
  { code: 'NO2', label: 'dioxyde d’azote', test: /azote|\bno2\b/ },
  { code: 'SO2', label: 'dioxyde de soufre', test: /soufre|\bso2\b/ },
];
const POLLUTANT_ORDER = POLLUTANTS.map((p) => p.code);

export function normalizePollutant(code, label) {
  const text = String(label ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const hit = POLLUTANTS.find((p) => p.test.test(text));
  if (hit) return { code: hit.code, label: hit.label };
  return { code: String(code ?? label ?? 'inconnu'), label: String(label ?? code ?? 'polluant inconnu') };
}

/** Lecture WFS stricte et garde « réponse non filtrée » ; lève avec un message nommé (jamais mis en cache). */
export async function fetchWfs(url, maxMatched, allowedDates) {
  const text = await fetchStrictText(url, { expect: 'json', timeoutMs: WFS_TIMEOUT_MS });
  if (text.length > MAX_BODY_CHARS) throw new Error('réponse WFS non filtrée (corps de plus de 30 Mo)');
  let fc;
  try {
    fc = JSON.parse(text);
  } catch {
    throw new Error('JSON illisible');
  }
  if (!fc || typeof fc !== 'object' || !Array.isArray(fc.features)) throw new Error('FeatureCollection attendue');
  const matched = Number(fc.numberMatched ?? fc.totalFeatures ?? fc.features.length);
  if (Number.isFinite(matched) && matched > maxMatched) throw new Error(`réponse WFS non filtrée (${matched} entités)`);
  for (const f of fc.features) {
    const date = String(f?.properties?.date_ech ?? '').slice(0, 10);
    if (!allowedDates.has(date)) throw new Error(`réponse WFS non filtrée (date ${date || 'absente'} hors du filtre)`);
  }
  return fc;
}

const STATE_RANK = { alerte: 0, information: 1, inconnu: 2 };

function isoOrNull(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Épisodes publiés de J à J+2 : liste des états autres que « PAS DE DEPASSEMENT », comptes par polluant et par jour publié. */
export function parseEpisodes(fc, days) {
  const wanted = new Set(days);
  const episodes = [];
  const perPollutant = new Map();
  const zones = new Set();
  let updatedMs = -Infinity;
  for (const f of fc.features) {
    const p = f?.properties ?? {};
    const date = String(p.date_ech ?? '').slice(0, 10);
    if (!wanted.has(date)) continue;
    const { code, label } = normalizePollutant(p.code_pol, p.lib_pol);
    const zoneCode = String(p.code_zone ?? '').trim();
    const zone = String(p.lib_zone ?? zoneCode).trim();
    zones.add(zoneCode || zone);
    const majMs = typeof p.date_maj === 'string' ? Date.parse(p.date_maj) : Number.NaN;
    if (Number.isFinite(majMs) && majMs > updatedMs) updatedMs = majMs;
    const entry = perPollutant.get(code) ?? { pollutantCode: code, pollutant: label, days: new Map() };
    const day = entry.days.get(date) ?? { date, information: 0, alerte: 0 };
    const state = episodeState(p.etat);
    if (state === 'information') day.information += 1;
    if (state === 'alerte') day.alerte += 1;
    entry.days.set(date, day);
    perPollutant.set(code, entry);
    if (state !== null) {
      episodes.push({ zoneCode, zone, pollutantCode: code, pollutant: label, date, state, stateRaw: String(p.etat ?? ''), updatedAt: isoOrNull(majMs) });
    }
  }
  const rank = (code) => {
    const i = POLLUTANT_ORDER.indexOf(code);
    return i < 0 ? POLLUTANT_ORDER.length : i;
  };
  return {
    updatedAt: isoOrNull(updatedMs),
    zonesCovered: zones.size,
    episodes: episodes.sort((a, b) => a.date.localeCompare(b.date) || STATE_RANK[a.state] - STATE_RANK[b.state] || a.zone.localeCompare(b.zone, 'fr')),
    perPollutant: [...perPollutant.values()]
      .sort((a, b) => rank(a.pollutantCode) - rank(b.pollutantCode) || a.pollutant.localeCompare(b.pollutant, 'fr'))
      .map((e) => ({ pollutantCode: e.pollutantCode, pollutant: e.pollutant, days: [...e.days.values()].sort((a, b) => a.date.localeCompare(b.date)) })),
  };
}

/** Code de commune INSEE (5 caractères, Corse 2A et 2B) ; les zones intercommunales (SIREN à 9 chiffres) ne sont pas rattachées. */
const COMMUNE_RE = /^(?:\d{5}|2[AB]\d{3})$/;
/** Collectivités absentes de DEPT_NAMES mais publiées par Atmo (Saint-Martin le 04/10). */
const EXTRA_NAMES = { 975: 'Saint-Pierre-et-Miquelon', 977: 'Saint-Barthélemy', 978: 'Saint-Martin' };

export function deptOfCommune(code) {
  return code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2);
}

function deptKey(code) {
  if (code === '2A') return 20.1;
  if (code === '2B') return 20.2;
  return Number(code);
}

/** Indice ATMO de J par département : communes couvertes, dégradées (3), mauvaises (4), très mauvaises et plus (5 à 7), plus haut indice. */
export function aggregateIndex(fc, date) {
  const best = new Map();
  let updatedMs = -Infinity;
  for (const f of fc.features) {
    const p = f?.properties ?? {};
    const code = String(p.code_zone ?? '');
    const q = Number(p.code_qual);
    if (!COMMUNE_RE.test(code) || !Number.isInteger(q) || q < 1 || q > 7) continue;
    best.set(code, Math.max(best.get(code) ?? 0, q));
    const t = typeof p.date_maj === 'string' ? Date.parse(p.date_maj) : Number.NaN;
    if (Number.isFinite(t) && t > updatedMs) updatedMs = t;
  }
  const byDept = new Map();
  for (const [code, q] of best) {
    const dept = deptOfCommune(code);
    const d = byDept.get(dept) ?? { dept, name: DEPT_NAMES[dept] ?? EXTRA_NAMES[dept] ?? dept, communes: 0, degrade: 0, mauvais: 0, tresMauvaisEtPlus: 0, maxIndex: null };
    d.communes += 1;
    if (q === 3) d.degrade += 1;
    if (q === 4) d.mauvais += 1;
    if (q >= 5) d.tresMauvaisEtPlus += 1;
    d.maxIndex = Math.max(d.maxIndex ?? 0, q);
    byDept.set(dept, d);
  }
  return {
    date: best.size > 0 ? date : null,
    updatedAt: isoOrNull(updatedMs),
    communes: best.size,
    departments: [...byDept.values()].sort((a, b) => deptKey(a.dept) - deptKey(b.dept)),
  };
}

export function emptyAir(days, errors) {
  return {
    days, episodesUpdatedAt: null, zonesCovered: 0, episodes: [], perPollutant: [],
    index: { date: null, updatedAt: null, communes: 0, departments: [] }, readAt: null, errors,
  };
}

/** Réponse de la route : 200 si une des deux couches a été lue (ou servie du cache avec sa date), sinon 502. */
export async function loadAirQuality(now = Date.now()) {
  const j = parisDay(now);
  const days = [j, addDays(j, 1), addDays(j, 2)];
  const ttlSec = airQualityTtlSec(now);
  const readAt = new Date(now).toISOString();
  const [episodes, index] = await Promise.allSettled([
    cachedSource(`env:atmo:episodes:${j}`, { ttlSec, staleSec: 2 * 86_400, shared: true }, async () => ({
      ...parseEpisodes(await fetchWfs(episodesUrl(days[0], days[2]), EPISODES_MAX_MATCHED, new Set(days)), days), readAt,
    })),
    cachedSource(`env:atmo:indice:${j}`, { ttlSec, staleSec: 2 * 86_400, shared: true }, async () => ({
      ...aggregateIndex(await fetchWfs(indexUrl(j), INDEX_MAX_MATCHED, new Set([j])), j), readAt,
    })),
  ]);
  const errors = [];
  if (episodes.status === 'rejected') errors.push(sourceError('Atmo France, épisodes', episodes.reason));
  if (index.status === 'rejected') errors.push(sourceError('Atmo France, indice', index.reason));
  const ep = episodes.status === 'fulfilled' ? episodes.value : null;
  const ix = index.status === 'fulfilled' ? index.value : null;
  if (!ep && !ix) return emptyAir(days, errors);
  const reads = [ep?.readAt, ix?.readAt].filter((x) => typeof x === 'string').sort();
  return {
    days,
    episodesUpdatedAt: ep?.updatedAt ?? null,
    zonesCovered: ep?.zonesCovered ?? 0,
    episodes: ep?.episodes ?? [],
    perPollutant: ep?.perPollutant ?? [],
    index: ix ? { date: ix.date, updatedAt: ix.updatedAt, communes: ix.communes, departments: ix.departments } : { date: null, updatedAt: null, communes: 0, departments: [] },
    readAt: reads.at(-1) ?? null,
    errors,
  };
}
