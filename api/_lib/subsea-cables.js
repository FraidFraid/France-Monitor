// api/_lib/subsea-cables.js : fichier daté des câbles télécom sous-marins des approches de la métropole (spec 2026-10-04
// souveraineté § 2.2, V5 ; contrats § 2.3, arbitrage 9 ; amendement 7, règle O18). Référence : le Shom (câbles, zones de câbles
// et zones de mouillage, lus par api/_lib/shom-cables.js) ; complément : OpenStreetMap pour les câbles absents du Shom (pose
// récente). Chaque objet porte sa source et sa licence. Fonctions pures partagées par le script d'extraction
// (scripts/fetch-subsea-cables.mjs) et la veille des câbles (api/_lib/cable-watch.js). Côté OpenStreetMap, retenus : chemins
// `communication=line` ou `telecom=line` posés sous l'eau (`location=underwater`, `submarine=yes` ou
// `seamark:type=cable_submarine`) ; écartés : câbles électriques seuls et câbles sans nature. Les fichiers de TeleGeography sont
// exclus (données réservées aux abonnés payants, faits § 5.5).
//
// Forme du fichier public/data/subsea-cables.json (SubseaCablesFile, amendement 7) :
// { generatedAt: ISO de génération ; osmBase: base Overpass ;
//   sources: [{ source: 'Shom' | 'OpenStreetMap', dataset, layer, licence, attribution, edition: date publiée ou null, url, count }]
//     dans l'ordre câbles du Shom, zones de câbles, zones de mouillage, OpenStreetMap ;
//   cables: [{ id: « shom/FR… » ou « way/… », name, operator, path: [[[lng, lat]]], landings: [{ commune, dept, lat, lon }],
//     source: 'Shom' | 'OpenStreetMap', licence: 'CC BY-SA' | 'ODbL 1.0', outOfService: hors service selon le Shom }] (Shom
//     d'abord ; un tronçon du Shom en mer n'a pas d'atterrage, un complément OpenStreetMap en a au moins un) ;
//   cableZones: [{ id, name, info, cableCategory: 'telecom' | 'power' | null, source: 'Shom', licence: 'Licence ouverte 2.0',
//     polygons: [[[[lng, lat]]]] }] ;
//   anchorageZones: [{ id, name, info, anchoringProhibited, crossesCableZone, source: 'Shom', licence: 'Licence ouverte 2.0',
//     polygons }] }
import { readFileSync } from 'node:fs';
import { haversineKm, inPolygon } from './geo-fr.js';
import { cleanText } from './source-http.js';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
/** Une seule requête, télécom seulement (jamais `communication=line` seul : les lignes aériennes de la terre ferme seraient lues). */
export const CABLES_OVERPASS_QUERY = '[out:json][timeout:180];('
  + 'way["communication"="line"]["location"="underwater"](41,-6,51.5,10);'
  + 'way["communication"="line"]["submarine"="yes"](41,-6,51.5,10);'
  + 'way["telecom"="line"]["location"="underwater"](41,-6,51.5,10);'
  + 'way["telecom"="line"]["submarine"="yes"](41,-6,51.5,10);'
  + 'way["communication"="line"]["seamark:type"="cable_submarine"](41,-6,51.5,10);'
  + ');out geom;';
/** Fichier des câbles (Shom en référence, compléments OpenStreetMap), lu par la veille et livré avec l'API sur la VM. */
export const CABLES_FILE_PATH = new URL('../../public/data/subsea-cables.json', import.meta.url);
/** Atterrage : extrémité dans un département ou à moins de 2 km de sa côte. */
export const LANDING_KM = 2;
export const OSM_SOURCE = "© les contributeurs d'OpenStreetMap";
export const OSM_LICENCE = 'ODbL 1.0';
/** Câbles du Shom (fiche data.gouv.fr « Conduites et câbles sous-marins répertoriés par le Shom »). */
export const SHOM_CABLES_LICENCE = 'CC BY-SA';
/** Zones de câbles et de mouillage du Shom (fiche data.gouv.fr « Réglementation - Navigation »). */
export const SHOM_REGULATION_LICENCE = 'Licence ouverte 2.0';
/** Attribution demandée par le Shom. */
export const SHOM_SOURCE = 'Shom';
const EARTH_M = 6_371_000;

/** Valeurs `power` d'une liaison électrique (revue finale M5). */
const POWER_LINK_VALUES = new Set(['cable', 'line', 'minor_line']);

/**
 * Liaison électrique : `power=cable`, `power=line` ou `power=minor_line`, même si elle porte aussi une fibre (`communication=line`) ;
 * relevé du 05/10 : Normandie 1 et 2, liaisons électriques Jersey-France, lues comme câbles télécom à Bretteville-sur-Ay (revue finale M5).
 */
export function isPowerLink(tags) {
  return Boolean(tags) && typeof tags === 'object' && POWER_LINK_VALUES.has(tags.power);
}

/** Vrai pour un câble télécom posé sous l'eau (arbitrage 9) ; une liaison électrique n'en est jamais un (isPowerLink). */
export function isTelecomSubseaCable(tags) {
  if (!tags || typeof tags !== 'object' || isPowerLink(tags)) return false;
  const telecom = tags.communication === 'line' || tags.telecom === 'line';
  const underwater = tags.location === 'underwater' || tags.submarine === 'yes' || tags['seamark:type'] === 'cable_submarine';
  return telecom && underwater;
}

/** Arrondi à 5 décimales (environ 1 m). */
export function round5(v) {
  return Math.round(v * 1e5) / 1e5;
}

/** Texte lisible (tiret cadratin remplacé par « : », règle de l'application) ; null si absent ou vide. */
export function tagText(v) {
  const t = typeof v === 'string' ? cleanText(v) : '';
  return t ? t : null;
}

/**
 * Atterrages d'un tracé : extrémités de chaque ligne situées dans un département ou à moins de 2 km de sa côte, sans doublon
 * (`commune: ''` tant que le script ne l'a pas nommée).
 * @param {Array<Array<[number, number]>>} path lignes [lng, lat]
 * @param {{ departementAt(lat: number, lon: number): string | null, departementsNear(lat: number, lon: number, km: number): string[] }} geo
 */
export function landingsOf(path, geo) {
  const landings = [];
  for (const line of path) {
    if (line.length === 0) continue;
    for (const [lon, lat] of [line[0], line[line.length - 1]]) {
      if (landings.some((l) => l.lat === lat && l.lon === lon)) continue;
      const dept = geo.departementAt(lat, lon) ?? geo.departementsNear(lat, lon, LANDING_KM)[0] ?? null;
      if (dept) landings.push({ commune: '', dept, lat, lon });
    }
  }
  return landings;
}

/**
 * Câbles télécom d'une réponse Overpass (`out geom`) : tracé [lng, lat] arrondi à 5 décimales (environ 1 m), atterrages aux extrémités
 * situées dans un département ou à moins de 2 km de sa côte (`commune: ''` tant que le script ne l'a pas nommée). Un tracé sans
 * atterrage en France n'est pas gardé. Source « OpenStreetMap », licence ODbL 1.0 ; jamais hors service (`outOfService: false` :
 * la requête ne lit que les lignes actives, sans préfixe `disused:`). Lève si la réponse n'a pas de liste « elements ».
 * @param {unknown} json
 * @param {{ departementAt(lat: number, lon: number): string | null, departementsNear(lat: number, lon: number, km: number): string[] }} geo
 */
export function overpassToCables(json, geo) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.elements)) throw new Error('réponse Overpass sans « elements »');
  const out = [];
  for (const el of json.elements) {
    if (!el || el.type !== 'way' || !isTelecomSubseaCable(el.tags) || !Array.isArray(el.geometry)) continue;
    const line = el.geometry
      .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => [round5(p.lon), round5(p.lat)]);
    if (line.length < 2) continue;
    const landings = landingsOf([line], geo);
    if (landings.length === 0) continue;
    out.push({
      id: `way/${el.id}`, name: tagText(el.tags.name), operator: tagText(el.tags.operator), path: [line], landings,
      source: 'OpenStreetMap', licence: OSM_LICENCE, outOfService: false,
    });
  }
  return out;
}

/**
 * Atterrages nommés par la commune la plus proche de leur département (`rankOf(dept, lat, lon)` rend les communes classées de la
 * plus proche à la plus lointaine, api/_lib/fire-impacts.js) ; sans commune lisible : « commune inconnue » (jamais un nom inventé).
 * @param {Array<{ landings: Array<{ commune: string, dept: string, lat: number, lon: number }> }>} cables
 * @param {(dept: string, lat: number, lon: number) => Array<{ name: string }>} rankOf
 */
export function nameLandings(cables, rankOf) {
  return cables.map((c) => ({
    ...c,
    landings: c.landings.map((l) => ({ ...l, commune: rankOf(l.dept, l.lat, l.lon)[0]?.name ?? 'commune inconnue' })),
  }));
}

/** Distance (m) d'un point au segment [a, b] ([lng, lat]), projection équirectangulaire centrée sur le point. */
function segmentM(lat, lon, a, b, k) {
  const ax = (a[0] - lon) * k; const ay = a[1] - lat;
  const bx = (b[0] - lon) * k; const by = b[1] - lat;
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy) * (Math.PI / 180) * EARTH_M;
}

/**
 * Distance (m) d'un point au segment le plus proche d'un tracé ; Infinity sans segment.
 * @param {number} lat
 * @param {number} lon
 * @param {Array<Array<[number, number]>>} path
 */
export function pointToPathM(lat, lon, path) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = Number.POSITIVE_INFINITY;
  for (const line of path) for (let i = 1; i < line.length; i += 1) best = Math.min(best, segmentM(lat, lon, line[i - 1], line[i], k));
  return best;
}

const zoneBoxes = new WeakMap();

/** Boîte englobante [minLon, minLat, maxLon, maxLat] des polygones d'une zone, calculée une fois. */
export function zoneBox(zone) {
  let box = zoneBoxes.get(zone);
  if (!box) {
    let minLon = Infinity; let minLat = Infinity; let maxLon = -Infinity; let maxLat = -Infinity;
    for (const poly of zone.polygons) for (const [lon, lat] of poly[0] ?? []) {
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }
    box = [minLon, minLat, maxLon, maxLat];
    zoneBoxes.set(zone, box);
  }
  return box;
}

/**
 * Vrai si le point est dans l'un des polygones de la zone (trous exclus).
 * @param {{ polygons: Array<Array<Array<[number, number]>>> }} zone
 */
export function zoneContains(zone, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const [x0, y0, x1, y1] = zoneBox(zone);
  if (lon < x0 || lon > x1 || lat < y0 || lat > y1) return false;
  return zone.polygons.some((p) => inPolygon(lon, lat, p));
}

/**
 * Zone de mouillage du Shom contenant le point, où le mouillage n'est pas interdit et qui ne recoupe aucune zone de câbles (S9) :
 * un navire lent dans cette zone est à sa place et n'est pas signalé. null sinon (ou fichier sans zones de mouillage).
 * @param {number} lat
 * @param {number} lon
 * @param {{ anchorageZones?: Array<{ anchoringProhibited: boolean, crossesCableZone: boolean, polygons: Array<Array<Array<[number, number]>>> }> }} file
 */
export function anchorageClearOfCablesAt(lat, lon, file) {
  const zones = Array.isArray(file?.anchorageZones) ? file.anchorageZones : [];
  return zones.find((z) => !z.anchoringProhibited && !z.crossesCableZone && zoneContains(z, lat, lon)) ?? null;
}

/**
 * Zone de câbles du Shom contenant le point (le mouillage y est réglementé) ; null sinon (ou fichier sans zones de câbles).
 * @param {number} lat
 * @param {number} lon
 * @param {{ cableZones?: Array<{ polygons: Array<Array<Array<[number, number]>>> }> }} file
 */
export function cableZoneAt(lat, lon, file) {
  const zones = Array.isArray(file?.cableZones) ? file.cableZones : [];
  return zones.find((z) => zoneContains(z, lat, lon)) ?? null;
}

const landingLists = new WeakMap();

/** Atterrages de tous les câbles du fichier (en service ou non : un port reste un port), listés une fois par fichier. */
function landingsOfFile(file) {
  let list = landingLists.get(file);
  if (!list) {
    list = (Array.isArray(file?.cables) ? file.cables : [])
      .flatMap((c) => (Array.isArray(c.landings) ? c.landings : []))
      .filter((l) => Number.isFinite(l?.lat) && Number.isFinite(l?.lon));
    landingLists.set(file, list);
  }
  return list;
}

/**
 * Atterrage du fichier le plus proche du point s'il est à moins de `km` (distance orthodromique, strictement) ; null sinon. Filtre grossier en
 * degrés avant le calcul (moins de 1 000 atterrages, un millier de navires lents par relevé).
 * @param {number} lat
 * @param {number} lon
 * @param {{ cables: Array<{ landings?: Array<{ lat: number, lon: number }> }> }} file
 * @param {number} km
 */
export function landingWithinKm(lat, lon, file, km) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || typeof file !== 'object' || file === null) return null;
  const dLat = km / 111;
  const dLon = km / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  let best = null;
  let bestKm = Infinity;
  for (const l of landingsOfFile(file)) {
    if (Math.abs(l.lat - lat) > dLat || Math.abs(l.lon - lon) > dLon) continue;
    const d = haversineKm(lat, lon, l.lat, l.lon);
    if (d < km && d < bestKm) { best = l; bestKm = d; }
  }
  return best;
}

let fileCache = null;

/** Réservé aux tests : `file` remplace le fichier lu (null : il sera relu). */
export function __resetCablesFileForTests(file = null) {
  fileCache = file;
}

/**
 * Fichier des câbles (SubseaCablesFile), lu une fois par processus ; lève s'il est absent ou illisible (l'échec n'est pas gardé :
 * le prochain appel relit le fichier).
 * @param {URL | string} [path]
 */
export function loadCablesFile(path = CABLES_FILE_PATH) {
  if (fileCache) return fileCache;
  const file = JSON.parse(readFileSync(path, 'utf8'));
  if (!file || typeof file !== 'object' || typeof file.generatedAt !== 'string' || !Array.isArray(file.sources)
    || !Array.isArray(file.cables) || !Array.isArray(file.cableZones) || !Array.isArray(file.anchorageZones)) {
    throw new Error('fichier des câbles illisible');
  }
  fileCache = file;
  return file;
}
