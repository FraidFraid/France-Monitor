// api/_lib/copernicus-ems.js : activations Copernicus EMS (cartographie satellite d'urgence) pour la couche Catastrophes (spec
// 2026-10-12 Copernicus EMS). API publique sans clé (vérifiée le 12/10/2026) : liste complète en une page, détail par code.
// L'outre-mer est rangé sous le pays « France » : le territoire est déduit du nom, puis du pays. TAAF écartées. Dates sans
// fuseau lues en UTC (comme GDACS).
import { cachedSource, cachedSourceReport, fetchStrictResponse, sourceError } from './source-http.js';

export const EMS_BASE = 'https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api';
export const EMS_LIST_URL = `${EMS_BASE}/public-activations-info/?limit=400`;
export const emsDetailUrl = (code) => `${EMS_BASE}/public-activations/?code=${encodeURIComponent(code)}`;
export const emsPageUrl = (code) => `https://mapping.emergency.copernicus.eu/activations/${encodeURIComponent(code)}`;
export const METROPOLE_LABEL = 'France (Hexagone et Corse)';
export const EMS_RECENT_MS = 365 * 86_400_000;

const COUNTRY_TERRITORY = {
  'New Caledonia': 'Nouvelle-Calédonie', 'French Polynesia': 'Polynésie française', Guadeloupe: 'Guadeloupe', Martinique: 'Martinique',
  'French Guiana': 'Guyane', Reunion: 'La Réunion', Mayotte: 'Mayotte', 'Saint Martin': 'Saint-Martin',
  'Saint Barthelemy': 'Saint-Barthélemy', 'Wallis and Futuna': 'Wallis-et-Futuna', 'Saint Pierre and Miquelon': 'Saint-Pierre-et-Miquelon',
};
const NAME_TERRITORY = [
  [/mayotte/, 'Mayotte'], [/reunion/, 'La Réunion'], [/guadeloupe/, 'Guadeloupe'], [/martinique/, 'Martinique'],
  [/guiana|guyane/, 'Guyane'], [/new caledonia|nouvelle-caledonie/, 'Nouvelle-Calédonie'], [/polynesia|tahiti/, 'Polynésie française'],
  // Ancrés : « Saint-Martin-Vésubie », « Saint-Pierre-d'Oléron » sont des communes de métropole (revue finale).
  [/saint[- ]martin(?![- ]\w)/, 'Saint-Martin'], [/saint[- ]barth/, 'Saint-Barthélemy'], [/wallis/, 'Wallis-et-Futuna'],
  [/saint[- ]pierre(?:[- ](?:et|and)[- ]|\s*,|\s*$)|miquelon/, 'Saint-Pierre-et-Miquelon'],
];
const TAAF_COUNTRIES = new Set(['French Southern and Antarctic Lands', 'French Southern Territories']);
const TAAF = /amsterdam island|kerguelen|crozet|saint[- ]paul island|\btaaf\b/;
const CATEGORY = {
  wildfire: 'feu', flood: 'inondation', storm: 'tempete', earthquake: 'seisme', 'mass movement': 'mouvement',
  'volcanic activity': 'volcan', 'industrial accident': 'industriel', 'transport accident': 'transport',
};
const COUNTRY_FR = {
  Greece: 'Grèce', Spain: 'Espagne', Germany: 'Allemagne', Italy: 'Italie', Portugal: 'Portugal', Panama: 'Panama', Mexico: 'Mexique',
  Albania: 'Albanie', 'United Kingdom': 'Royaume-Uni', Croatia: 'Croatie', 'Bosnia and Herzegovina': 'Bosnie-Herzégovine',
  Slovenia: 'Slovénie', Belgium: 'Belgique', Switzerland: 'Suisse', Austria: 'Autriche', Poland: 'Pologne', Romania: 'Roumanie',
  'Czech Republic': 'République tchèque', Netherlands: 'Pays-Bas', Turkey: 'Turquie', Ukraine: 'Ukraine', Morocco: 'Maroc',
  Algeria: 'Algérie', Tunisia: 'Tunisie', Ireland: 'Irlande', Hungary: 'Hongrie', Slovakia: 'Slovaquie', Bulgaria: 'Bulgarie',
};

const fold = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const countriesOf = (x) => (Array.isArray(x?.countries) ? x.countries.filter((c) => typeof c === 'string') : []);

/** Territoire français d'une activation ; 'TAAF' (écartée) ; null hors de France. */
export function frenchTerritoryOf(x) {
  const countries = countriesOf(x);
  if (countries.some((c) => TAAF_COUNTRIES.has(c))) return 'TAAF';
  if (!countries.some((c) => c === 'France' || Object.hasOwn(COUNTRY_TERRITORY, c))) return null;
  const name = fold(x?.name);
  if (TAAF.test(name)) return 'TAAF';
  for (const [re, label] of NAME_TERRITORY) if (re.test(name)) return label;
  const fromCountry = countries.find((c) => Object.hasOwn(COUNTRY_TERRITORY, c));
  return fromCountry ? COUNTRY_TERRITORY[fromCountry] : METROPOLE_LABEL;
}

export function categoryOf(raw) {
  return CATEGORY[fold(raw)] ?? 'autre';
}

/** Lieu du nom : après le dernier « in », sans « , France ». */
export function placeOf(name) {
  const text = String(name ?? '').trim();
  const at = text.toLowerCase().lastIndexOf(' in ');
  const place = at >= 0 ? text.slice(at + 4) : text;
  return place.replace(/,\s*France\s*$/i, '').trim() || text;
}

/** Déclencheur : partie après « | », sigle entre parenthèses préféré, sans points (« C.O.G.I.C » → « COGIC »). */
export function activatorOf(raw) {
  const text = String(raw ?? '');
  const part = (text.includes('|') ? text.slice(text.indexOf('|') + 1) : text).trim();
  if (part === '') return null;
  const acronym = /\(([^)]+)\)\s*$/.exec(part)?.[1]?.replace(/\./g, '').trim();
  return acronym || part;
}

export function parsePoint(text) {
  const m = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(String(text ?? ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Anneau extérieur d'un POLYGON WKT en [lon, lat] ; null si moins de 4 points ou coordonnée illisible. */
export function parseWktPolygon(text) {
  // MULTIPOLYGON : premier polygone (mineur du 12/10).
  const m = /POLYGON\s*\(\s*\(?\s*\(([^()]+)\)/i.exec(String(text ?? ''));
  if (!m) return null;
  const ring = [];
  for (const pair of m[1].split(',')) {
    const [lon, lat] = pair.trim().split(/\s+/).map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    ring.push([lon, lat]);
  }
  return ring.length >= 4 ? ring : null;
}

function utcIso(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function activationOf(x, territory) {
  const point = parsePoint(x.centroid);
  return {
    code: String(x.code), category: categoryOf(x.category), name: String(x.name ?? ''), place: placeOf(x.name), territory,
    activationTime: utcIso(x.activationTime), eventTime: utcIso(x.eventTime), closed: x.closed !== false,
    gdacsId: typeof x.gdacsId === 'string' && x.gdacsId !== '' ? x.gdacsId : null,
    products: Number.isFinite(x.n_products) ? x.n_products : 0, url: emsPageUrl(String(x.code)),
    activator: null, population: null, zones: [], lon: point ? point[0] : null, lat: point ? point[1] : null,
  };
}

const newestFirst = (a, b) => Date.parse(b.activationTime) - Date.parse(a.activationTime);

/** En cours (françaises ouvertes), historique (françaises closes de moins de 12 mois), ailleurs (ouvertes hors de France). */
export function parseEmsList(json, now) {
  const rows = Array.isArray(json?.results) ? json.results : [];
  const active = [];
  const recent = [];
  const abroad = [];
  let undated = 0;
  for (const x of rows) {
    if (!x || typeof x.code !== 'string') continue;
    if (utcIso(x.activationTime) === null) { undated += 1; continue; }
    const territory = frenchTerritoryOf(x);
    if (territory === 'TAAF') continue;
    if (territory === null) {
      if (x.closed === false) abroad.push(x);
      continue;
    }
    const a = activationOf(x, territory);
    if (!a.closed) active.push(a);
    else if (now - Date.parse(a.activationTime) <= EMS_RECENT_MS) recent.push(a);
  }
  const countries = [...new Set(abroad.flatMap(countriesOf).map((c) => COUNTRY_FR[c] ?? c))];
  return { active: active.sort(newestFirst), recent: recent.sort(newestFirst), elsewhere: { count: abroad.length, countries }, undated };
}

/** Détail d'une activation : déclencheur, population dans l'emprise, zones lisibles. */
export function parseEmsDetail(json) {
  const r = Array.isArray(json?.results) ? json.results[0] : json;
  if (!r || typeof r !== 'object') return { activator: null, population: null, zones: [] };
  const pop = r.stats?.['Population [No.]'];
  const zones = (Array.isArray(r.aois) ? r.aois : []).flatMap((z) => {
    const ring = parseWktPolygon(z?.extent);
    return ring ? [{ name: String(z.name ?? ''), ring }] : [];
  });
  return { activator: activatorOf(r.activator), population: typeof pop === 'number' && Number.isFinite(pop) ? pop : null, zones };
}

const FETCH_TIMEOUT_MS = 20_000;
const TTL_SEC = 1_800;
/** Relevé encore servi sans panne : 30 min de cache après une lecture d'au plus FETCH_TIMEOUT_MS. */
const FRESH_READ_MS = TTL_SEC * 1000 + FETCH_TIMEOUT_MS;
const CACHE = { ttlSec: TTL_SEC, staleSec: 7 * 86_400, shared: true, waitMs: FETCH_TIMEOUT_MS + 5_000 };
export const EMS_STALE_SERVED_ERROR = 'Copernicus EMS : source indisponible, relevé précédent servi';

export const emptyEms = (errors = []) => ({ readAt: null, active: [], recent: [], elsewhere: { count: 0, countries: [] }, errors });

async function readJson(url) {
  const { text } = await fetchStrictResponse(url, { expect: 'json', timeoutMs: FETCH_TIMEOUT_MS });
  try { return JSON.parse(text); } catch { throw new Error('JSON illisible'); }
}

/** Détail d'une activation française en cours ; en échec : la ligne de la liste, sans zone, panne nommée. */
async function withDetail(a, errors) {
  const label = `Copernicus EMS ${a.code}`;
  try {
    const { value, error } = await cachedSourceReport(`env:ems:${a.code}`, CACHE, label, async () => parseEmsDetail(await readJson(emsDetailUrl(a.code))));
    if (error) errors.push(error);
    return { ...a, ...value };
  } catch (err) {
    errors.push(sourceError(label, err));
    return a;
  }
}

export async function loadEms(now) {
  const readAt = new Date(now).toISOString();
  try {
    const v = await cachedSource('env:ems', CACHE, async () => {
      const json = await readJson(EMS_LIST_URL);
      if (!Array.isArray(json?.results)) throw new Error('liste des activations absente');
      return { readAt, list: parseEmsList(json, now) };
    });
    const errors = now - Date.parse(v.readAt) <= FRESH_READ_MS ? [] : [EMS_STALE_SERVED_ERROR];
    if (v.list.undated > 0) errors.push(`Copernicus EMS : ${v.list.undated} activation(s) sans date lisible écartée(s)`);
    // Détails en parallèle : plusieurs activations ouvertes à la fois ne doivent pas faire dépasser le délai du CDN (revue finale I3).
    const active = await Promise.all(v.list.active.map((a) => withDetail(a, errors)));
    errors.sort();
    return { readAt: v.readAt, active, recent: v.list.recent, elsewhere: v.list.elsewhere, errors };
  } catch (err) {
    return emptyEms([sourceError('Copernicus EMS', err)]);
  }
}
