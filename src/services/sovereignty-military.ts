// src/services/sovereignty-military.ts : lecture client de la couche Défense (spec 2026-10-04 souveraineté § 2.1 ; contrats § 3.3 ;
// décision du 08/10/2026 : plus aucun masquage). Aéronefs militaires ou d'État au-dessus de la France (route /api/sovereignty/military) :
// tous montrés avec leur identité publiée (adresse, indicatif, immatriculation, type, position), français aussi comptés par département.
// Garde de forme exacte élément par élément (un champ en trop ou manquant refuse la réponse), lecture qui ne rejette jamais, fusion à l'écriture, statut « Vols militaires » daté par le relevé adsb.lol (S1). Ouvrages de défense
// d'OpenStreetMap (option masquée par défaut) : fichier public daté, lu une fois par session, jamais un appel Overpass du navigateur.
import type { DefenseOsmWorksFile, MilitaryResponse } from '../types/index.ts';
import { readHealthJsonShared } from './health-surveillance.ts';
import {
  describeProblems, exactly, isBool, isCount, isDate, isDateOrNull, isNum, isNumOrNull, isOneOf, isStr, isStrOrNull, isStringList, list,
  loadSovereigntySlot, mergeSlot, record, shapeOf, sovereigntySlotStatus, value, type SourceSlot, type SovereigntyStatus,
} from './sovereignty-source.ts';

export const MILITARY_URL = '/api/sovereignty/military';
/** Cache client : 100 s, sous la relève de 2 min (App.ts). */
export const MILITARY_TTL_MS = 100_000;
export const DEFENSE_OSM_URL = '/data/defense-osm-works.json';

export interface MilitaryState { military: SourceSlot<MilitaryResponse> }

const FAMILIES: ReadonlySet<string> = new Set(['francais', 'autres']);
const SQUAWKS: ReadonlySet<string> = new Set(['7500', '7600', '7700']);
const BASE_TYPES: ReadonlySet<string> = new Set(['air', 'navy', 'army', 'joint', 'fortification', 'other']);

const str = value(isStr);
const strOrNull = value(isStrOrNull);
const num = value(isNum);
const numOrNull = value(isNumOrNull);
const bool = value(isBool);
const count = value(isCount);
const date = value(isDate);
const squawk = value((v) => isOneOf(v, SQUAWKS));

const family = value((v) => isOneOf(v, FAMILIES));

const aircraft = record({
  hex: str, callsign: strOrNull, registration: strOrNull, type: strOrNull, country: strOrNull, family, lat: num, lon: num,
  dept: strOrNull, altitudeFt: numOrNull, speedKt: numOrNull, track: numOrNull, seenAt: date,
});
const abroad = record({
  hex: str, callsign: strOrNull, registration: strOrNull, type: strOrNull, country: strOrNull, family, lat: num, lon: num,
});
const deptCount = record({ dept: strOrNull, count });
const emergency = record({
  icao24: str, callsign: strOrNull, registration: strOrNull, squawk, lat: num, lon: num, altitudeM: numOrNull, firstSeen: date,
  lastSeen: date, overFrance: bool, family, type: strOrNull, country: strOrNull, emergency: strOrNull, inFrance: bool, dept: strOrNull,
});
const hour = record({ hour: value((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(v)), francais: count, autres: count });

const MILITARY_SHAPE = shapeOf<MilitaryResponse>(record({
  readAt: value(isDateOrNull), sourceNow: value(isDateOrNull), frenchByDept: list(deptCount), aircraft: list(aircraft),
  abroadCount: count, abroad: list(abroad), emergencies: list(emergency), emergencyLog: list(emergency),
  hourly: record({ hours: list(hour), since: strOrNull }), errors: value(isStringList),
}));

/** Écarts à la forme de /api/sovereignty/military, nommés un par un ; liste vide : conforme. */
export function militaryResponseProblems(v: unknown): string[] {
  return MILITARY_SHAPE.problems(v);
}

export function isMilitaryResponse(v: unknown): v is MilitaryResponse {
  return MILITARY_SHAPE.is(v);
}

/** Ne rejette jamais : une lecture en échec porte `error` et garde les dernières données. */
export async function fetchMilitary(previous: MilitaryState | null, now: number = Date.now()): Promise<MilitaryState> {
  return { military: await loadSovereigntySlot(MILITARY_URL, MILITARY_TTL_MS, previous?.military, now, MILITARY_SHAPE, 'des vols militaires') };
}

/** Fusion à l'écriture (S3) : une lecture en échec garde les données actuellement en mémoire. */
export function mergeMilitary(current: MilitaryState | null, incoming: MilitaryState): MilitaryState {
  return { military: mergeSlot(current?.military, incoming.military) };
}

/** Panneau des sources : « Vols militaires », daté par le relevé adsb.lol du serveur (S1). */
export function militaryStatus(state: MilitaryState, now: number): SovereigntyStatus {
  return sovereigntySlotStatus(state.military, 'adsb-mil', state.military.data?.readAt ?? null, now);
}

const DEFENSE_OSM_SHAPE = shapeOf<DefenseOsmWorksFile>(record({
  generatedAt: date, osmBase: date, licence: exactly('ODbL 1.0'), source: str,
  items: list(record({
    id: str, name: strOrNull, kind: str, type: value((v) => isOneOf(v, BASE_TYPES)), lat: num, lon: num, dept: str,
  })),
}));

export function isDefenseOsmWorksFile(v: unknown): v is DefenseOsmWorksFile {
  return DEFENSE_OSM_SHAPE.is(v);
}

let works: Promise<{ data: DefenseOsmWorksFile | null; error: string | null }> | null = null;

/** Ouvrages de défense d'OpenStreetMap : lus une fois par session (une lecture en échec sera retentée), jamais de rejet. */
export function fetchDefenseOsmWorks(): Promise<{ data: DefenseOsmWorksFile | null; error: string | null }> {
  works ??= readHealthJsonShared(DEFENSE_OSM_URL)
    .then((json) => {
      if (!DEFENSE_OSM_SHAPE.is(json)) throw new Error(`fichier des ouvrages de défense mal formé : ${describeProblems(DEFENSE_OSM_SHAPE.problems(json))}`);
      return { data: json, error: null };
    })
    .catch((err: unknown) => {
      works = null;
      return { data: null, error: err instanceof Error ? err.message : 'erreur inconnue' };
    });
  return works;
}

/** Tests seulement : le fichier des ouvrages sera relu. */
export function resetDefenseOsmWorksCache(): void {
  works = null;
}

// Phase B (tâche B24) : fichier des zones drones DGAC, option de la couche Défense (contrats § 3.3).
export { DRONE_ZONES_URL, fetchDroneZones, isDroneZonesFile, resetDroneZonesCache } from './sovereignty-drones.ts';
