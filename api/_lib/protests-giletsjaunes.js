// api/_lib/protests-giletsjaunes.js : actions recensées sur la carte participative des gilets jaunes, 17octobregiletjaune.net
// (20/10/2026, demandée par l'utilisateur). Vérifié le 20/10 : lecture libre, sans protection (le contrôle anti-robot Turnstile du
// site ne garde que les envois) et robots.txt sans interdiction. `/api/actions` donne, par identifiant de lieu, des actions
// [type, heure, jour, assemblée liée, lieu précisé, message] ; le lieu vient de trois listes : sites fixes (/data/sites.json : gares,
// péages, ponts, dépôts…), lieux ajoutés par les visiteurs (/api/lieux) et stations-service (/data/stations.json, flux des prix
// carburants). ~10 % des actions visent un lieu retiré de la carte : écartées. Les assemblées (réunions) et les messages libres des
// visiteurs ne sont pas repris. Annonces participatives, non confirmées.
import { cachedSource, cleanText, fetchStrictJson } from './source-http.js';
import { icsTime } from './protests-demosphere.js';

export const GJ_BASE = 'https://www.17octobregiletjaune.net';
export const GJ_MAP_URL = `${GJ_BASE}/carte/`;
export const GJ_EDITION = '17octobregiletjaune.net';

/** Mêmes fenêtres que les autres annonces : commencées depuis moins de 6 h, ou à venir dans les 7 jours. */
export const PAST_WINDOW_MS = 6 * 3_600_000;
export const FUTURE_WINDOW_MS = 7 * 86_400_000;
const TTL_SEC = 1_800;
const TIMEOUT_MS = 20_000;

/** Libellés du site (carte.js). */
export const GJ_ACTION_LABEL = Object.freeze({
  rassemblement: 'Rassemblement',
  tractage: 'Distribution de tracts',
  pancartes: 'Pancartes et banderoles',
  prise_de_parole: 'Prise de parole',
  barrage_filtrant: 'Barrage filtrant',
  blocage: 'Blocage',
  operation_escargot: 'Opération escargot',
  manifestation: 'Manifestation',
  piquet_de_greve: 'Piquet de grève',
  rond_point: 'Rassemblement sur un rond-point',
  autre: 'Action',
});

/** Genre de lieu lisible à côté du nom (« Gare », « Péage ») ; les autres genres gardent le seul nom. */
const GENRE_LABEL = { gare: 'gare', peage: 'péage', pont: 'pont', depot: 'dépôt pétrolier', raffinerie: 'raffinerie', port: 'port', lycee: 'lycée', superieur: 'université', station: 'station-service' };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' && v.trim() ? cleanText(v).trim() : null);

/**
 * Index des lieux par identifiant (texte) : `{ lat, lon, name, city, dept, genre }`. Sites et lieux ajoutés :
 * [id, genre, lat, lon, nom, opérateur, ville, cp, dép., …] ; stations : colonnes nommées (id, lat, lon, ville, cp, adresse, dep).
 */
export function indexPlaces(sites, lieux, stations) {
  const places = new Map();
  for (const row of [...(sites?.lieux ?? []), ...(lieux?.lieux ?? [])]) {
    if (!Array.isArray(row)) continue;
    const lat = num(row[2]);
    const lon = num(row[3]);
    if (lat === null || lon === null) continue;
    places.set(String(row[0]), { lat, lon, genre: str(row[1]), name: str(row[4]), city: str(row[6]), dept: str(row[8]) });
  }
  const cols = Array.isArray(stations?.colonnes) ? stations.colonnes : [];
  const at = (name) => cols.indexOf(name);
  const [iId, iLat, iLon, iCity, iAddr, iDept] = ['id', 'lat', 'lon', 'ville', 'adresse', 'dep'].map(at);
  if (iId >= 0 && iLat >= 0 && iLon >= 0) {
    for (const row of stations.stations ?? []) {
      if (!Array.isArray(row)) continue;
      const lat = num(row[iLat]);
      const lon = num(row[iLon]);
      if (lat === null || lon === null) continue;
      places.set(String(row[iId]), { lat, lon, genre: 'station', name: str(row[iAddr]), city: str(row[iCity]), dept: str(row[iDept]) });
    }
  }
  return places;
}

// Petits mots des noms de communes, en minuscules sauf en tête (« Tarascon-sur-Ariège », « Saint-Denis-lès-Bourg », « Le Mans »).
const CITY_PARTICLES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'sur', 'sous', 'en', 'lès', 'lez', 'aux', 'au', 'et', 'l', 'd']);

/** Ville écrite comme ailleurs dans la couche quand le site l'écrit en capitales (« TARASCON-SUR-ARIÈGE » → « Tarascon-sur-Ariège »). */
export function cityCase(city) {
  if (!city || city !== city.toUpperCase()) return city;
  return city.toLowerCase().replace(/(^|[\s'’-])(\p{L}+)/gu, (_, sep, word, at) =>
    sep + (at > 0 && CITY_PARTICLES.has(word) ? word : word[0].toUpperCase() + word.slice(1)));
}

/** Rendez-vous de la couche Manifestations : `{ items, actions, unplaced }`. */
export function giletsJaunesItems(actionsBody, places, now) {
  const items = [];
  let actions = 0;
  let unplaced = 0;
  for (const [placeId, list] of Object.entries(actionsBody?.actions ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      if (!Array.isArray(a)) continue;
      const [type, hour, day] = a;
      if (type === 'assemblee' || typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const clock = typeof hour === 'string' && /^\d{2}:\d{2}$/.test(hour) ? hour : null;
      const start = icsTime(`${day.replace(/-/g, '')}T${(clock ?? '00:00').replace(':', '')}00`);
      if (start === null) continue;
      const end = clock ? start + PAST_WINDOW_MS : start + 86_400_000;
      if (end < now || start > now + FUTURE_WINDOW_MS) continue;
      actions += 1;
      const p = places.get(placeId);
      if (!p) { unplaced += 1; continue; }
      const genre = p.genre ? GENRE_LABEL[p.genre] : null;
      const named = p.name ? (genre && !p.name.toLowerCase().includes(genre) ? `${p.name} (${genre})` : p.name) : genre;
      const city = cityCase(p.city);
      items.push({
        id: `giletsjaunes:${placeId}:${day}:${clock ?? 'journee'}:${type}`,
        source: 'giletsjaunes', status: 'annonce',
        title: `${GJ_ACTION_LABEL[type] ?? 'Action'} (gilets jaunes)`,
        startsAt: new Date(start).toISOString(), allDay: clock === null,
        city, dept: p.dept, lat: p.lat, lon: p.lon,
        url: GJ_MAP_URL, edition: GJ_EDITION,
        place: str(a[4]) ?? named,
        violent: false, participants: null, precision: 'commune',
        articles: [], articleCount: 0,
      });
    }
  }
  return { items, actions, unplaced };
}

/** Actions de la fenêtre, relues toutes les 30 min (les deux listes fixes, ~1 Mo chacune, avec). */
export async function loadGiletsJaunes(now) {
  const { actionsBody, places } = await cachedSource('protests:giletsjaunes:v1', { ttlSec: TTL_SEC }, async () => {
    const opts = { timeoutMs: TIMEOUT_MS };
    const [actionsBody, sites, lieux, stations] = await Promise.all([
      fetchStrictJson(`${GJ_BASE}/api/actions`, opts),
      fetchStrictJson(`${GJ_BASE}/data/sites.json`, opts),
      fetchStrictJson(`${GJ_BASE}/api/lieux`, opts).catch(() => ({ lieux: [] })),
      fetchStrictJson(`${GJ_BASE}/data/stations.json`, opts).catch(() => ({ stations: [] })),
    ]);
    if (!actionsBody || typeof actionsBody.actions !== 'object') throw new Error('liste des actions illisible');
    // Seuls les lieux qui portent une action sont gardés en cache.
    const all = indexPlaces(sites, lieux, stations);
    const used = {};
    for (const id of Object.keys(actionsBody.actions)) if (all.has(id)) used[id] = all.get(id);
    return { actionsBody: { actions: actionsBody.actions }, places: used };
  });
  return giletsJaunesItems(actionsBody, new Map(Object.entries(places)), now);
}
