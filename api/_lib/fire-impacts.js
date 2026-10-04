// api/_lib/fire-impacts.js : communes autour d'un foyer de feu (spec 2026-10-04 environnement § 2.4, onglet « Dossier
// d'un feu »). Sans clé : geo.api.gouv.fr, départements dont le bord est à moins de 10 km du point (api/_lib/geo-fr.js),
// communes dont le centre est à moins de 10 km, population et distance. Aucune estimation de maisons menacées ni d'évacués :
// l'impact humain ne se déduit pas de la puissance radiative. Lien vers le rapport Géorisques de la commune la plus proche.
import { departementsNear, haversineKm } from './geo-fr.js';
import { cachedSource, fetchStrictJson, sourceError } from './source-http.js';

export const IMPACT_RADIUS_KM = 10;
/** Communes d'un département gardées 7 jours (référentiel stable). */
export const COMMUNES_TTL_SEC = 604_800;
export const GEO_API_COMMUNES_URL = 'https://geo.api.gouv.fr/communes';
/** Boîte acceptée par la route (métropole et Corse) : 400 au-delà. */
export const METROPOLE_BOX = { minLat: 41, maxLat: 51.5, minLon: -5.5, maxLon: 10 };

/** Communes d'un département (vérifié le 04/10/2026 : `centre` est un point GeoJSON [lon, lat]). */
export function communesUrl(dept) {
  return `${GEO_API_COMMUNES_URL}?codeDepartement=${encodeURIComponent(dept)}&fields=nom,code,population,centre,codeDepartement&format=json`;
}

/**
 * Rapport Géorisques d'une commune (PDF officiel, risques naturels et technologiques de la commune, dont le feu de forêt).
 * Vérifié le 04/10/2026 : `…/api/v1/rapport_pdf?code_insee=33281` répond 200 application/pdf (« Commune recherchée :
 * 33700 Mérignac ») ; les pages HTML `…/connaitre-les-risques-pres-de-chez-moi/rapport2?…&codeInsee=` répondent 404.
 */
export function georisquesReportUrl(insee) {
  return `https://www.georisques.gouv.fr/api/v1/rapport_pdf?code_insee=${encodeURIComponent(insee)}`;
}

/** Vrai si le point est un nombre fini dans la boîte de la métropole. */
export function isMetropoleBox(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= METROPOLE_BOX.minLat && lat <= METROPOLE_BOX.maxLat && lon >= METROPOLE_BOX.minLon && lon <= METROPOLE_BOX.maxLon;
}

/**
 * Communes lisibles d'une réponse geo.api.gouv.fr : `{ code, name, dept, population, lat, lon }`. Une entrée sans code, sans nom
 * ou sans centre est écartée ; population absente : null (jamais 0). Lève si la réponse n'est pas une liste ou n'a aucune
 * commune lisible (la valeur n'est alors jamais mise en cache).
 * @param {unknown} json
 * @param {string} dept
 */
export function parseCommunes(json, dept) {
  if (!Array.isArray(json)) throw new Error('liste de communes attendue');
  const out = [];
  for (const c of json) {
    const coords = c?.centre?.coordinates;
    if (typeof c?.code !== 'string' || typeof c?.nom !== 'string' || !Array.isArray(coords)) continue;
    const [lon, lat] = coords;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push({
      code: c.code,
      name: c.nom,
      dept: typeof c.codeDepartement === 'string' ? c.codeDepartement : dept,
      population: Number.isFinite(c.population) ? c.population : null,
      lat,
      lon,
    });
  }
  if (out.length === 0) throw new Error('aucune commune lisible');
  return out;
}

/** Distance arrondie à 0,1 km. */
function km1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * Communes triées de la plus proche à la plus lointaine (FireImpactCommune), toutes distances comprises.
 * @param {Array<{ code: string, name: string, dept: string, population: number | null, lat: number, lon: number }>} communes
 */
export function rankCommunes(communes, lat, lon) {
  return communes
    .map((c) => ({ code: c.code, name: c.name, dept: c.dept, population: c.population, exact: haversineKm(lat, lon, c.lat, c.lon) }))
    .sort((a, b) => a.exact - b.exact || a.code.localeCompare(b.code))
    .map(({ exact, ...c }) => ({ ...c, distanceKm: km1(exact) }));
}

/**
 * Réponse FireImpactsResponse pour un point de la métropole, et `ok` : faux seulement si des départements voisins existent et
 * qu'aucun n'a pu être lu (ni cache). `nearest` : commune la plus proche parmi celles lues, même au-delà de 10 km ; null sans
 * commune lue. Un point en mer à plus de 10 km des côtes : aucune commune, aucun appel.
 */
export async function loadFireImpacts(lat, lon, now = Date.now()) {
  const depts = departementsNear(lat, lon, IMPACT_RADIUS_KM);
  const errors = [];
  const read = [];
  const results = await Promise.allSettled(depts.map((dept) => cachedSource(
    `env:communes:${dept}`,
    { ttlSec: COMMUNES_TTL_SEC, staleSec: 30 * 86_400, shared: true },
    async () => parseCommunes(await fetchStrictJson(communesUrl(dept), { timeoutMs: 10_000 }), dept),
  )));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') read.push(...r.value);
    else errors.push(sourceError(`geo.api.gouv.fr, département ${depts[i]}`, r.reason));
  });
  const ranked = rankCommunes(read, lat, lon);
  const nearest = ranked[0] ?? null;
  const body = {
    lat,
    lon,
    radiusKm: IMPACT_RADIUS_KM,
    communes: ranked.filter((c) => c.distanceKm <= IMPACT_RADIUS_KM),
    nearest,
    georisquesUrl: nearest ? georisquesReportUrl(nearest.code) : null,
    readAt: new Date(now).toISOString(),
    errors,
  };
  return { body, ok: depts.length === 0 || results.some((r) => r.status === 'fulfilled') };
}
