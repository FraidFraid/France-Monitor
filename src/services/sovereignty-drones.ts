// src/services/sovereignty-drones.ts : fichier des zones drones DGAC (spec 2026-10-04 souveraineté § 3.2 ; contrats § 1.2, § 3.3 ;
// amendement 7, S6 ; réexporté par sovereignty-military.ts). Fichier statique de l'application (pas une source tierce), hors du
// précache : lu une fois par session, à la demande (option de la couche Défense ou ouverture du panneau), garde de forme exacte,
// jamais de rejet ; un échec n'est pas gardé. Titre, légende et renvoi aux sources qui font foi (S6) recopiés de api/_lib/drone-zones.js
// (un test du contrat vérifie l'identité des textes).
import type { DroneZonesFile } from '../types/index.ts';
import {
  describeProblems, isCount, isNum, isStr, list, record, shapeOf, value,
} from './sovereignty-source.ts';

export const DRONE_ZONES_URL = '/data/drone-restrictions.json';

/** Titre officiel de la couche (S6), repris tel quel. */
export const DRONES_TITLE = 'Restrictions UAS catégorie Ouverte et Aéromodélisme';
/** Légende officielle de la couche (S6) : date de mise à jour et limite (« ne couvre pas les interdictions temporaires »). */
export const DRONES_LEGEND = 'Zones soumises à interdictions ou à restrictions pour l’usage, à titre de loisir, d’aéronefs télépilotés (ou drones), '
  + 'sur le territoire métropolitain, en Guyane, aux Antilles françaises, Saint-Pierre et Miquelon, Mayotte, La Réunion et aux Terres Australes, '
  + 'à jour au 07-2025. Elle intègre partiellement les interdictions s’appuyant sur des données non publiées à l’AIP et ne couvre pas '
  + 'les interdictions temporaires.';
/** Renvoi aux sources qui font foi (S6) : la carte ne remplace ni le SIA ni les arrêtés préfectoraux. */
export const DRONES_POINTER = 'Cette carte ne fait pas foi : consulter le SIA (sia.aviation-civile.gouv.fr) et les arrêtés préfectoraux en vigueur.';
export const DRONES_POINTER_URL = 'https://www.sia.aviation-civile.gouv.fr/';

const isPosition = (p: unknown): boolean => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
/** Anneau fermé d'au moins 4 positions [lng, lat]. */
const isRing = (r: unknown): boolean => Array.isArray(r) && r.length >= 4 && r.every(isPosition);
const isPolygon = (poly: unknown): boolean => Array.isArray(poly) && poly.length > 0 && poly.every(isRing);

const str = value(isStr);
const zone = record({
  id: str, remarque: value((v) => v === null || isStr(v)),
  polygons: value((v) => Array.isArray(v) && v.length > 0 && v.every(isPolygon)),
});

const DRONES_SHAPE = shapeOf<DroneZonesFile>(record({
  generatedAt: str, edition: str, source: str, licence: str,
  counts: record({ volInterdit: value(isCount), agglomerations: value(isCount), kept: value(isCount) }),
  zones: list(zone, 'id'),
}));

export function isDroneZonesFile(v: unknown): v is DroneZonesFile {
  return DRONES_SHAPE.is(v);
}

let session: Promise<DroneZonesFile> | null = null;

/** Tests seulement : oublie la lecture de la session. */
export function resetDroneZonesCache(): void {
  session = null;
}

const READ_TIMEOUT_MS = 60_000;

async function read(): Promise<DroneZonesFile> {
  let res: Response;
  try {
    res = await fetch(DRONE_ZONES_URL, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  } catch {
    throw new Error('zones drones : source injoignable');
  }
  if (!res.ok) throw new Error(`zones drones : HTTP ${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error('zones drones : fichier illisible');
  }
  if (!DRONES_SHAPE.is(json)) throw new Error(`zones drones : fichier mal formé : ${describeProblems(DRONES_SHAPE.problems(json))}`);
  return json;
}

/** Une lecture par session ; ne rejette jamais (un échec n'est pas gardé : la suivante repart). */
export async function fetchDroneZones(): Promise<{ data: DroneZonesFile | null; error: string | null }> {
  session ??= read();
  try {
    return { data: await session, error: null };
  } catch (err) {
    session = null;
    return { data: null, error: err instanceof Error ? err.message : 'zones drones : erreur inconnue' };
  }
}
