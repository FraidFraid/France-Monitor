// src/services/environment-fires.ts : lecture client des feux de forêt (spec 2026-10-04 environnement § 2.4 ; contrats § 3.3) :
// détections FIRMS en France regroupées en foyers par le serveur, météo des forêts, communes autour d'un foyer. Garde stricte par
// élément, jamais de rejet, fusion à l'écriture ; deux lignes datées du panneau des sources (« NASA FIRMS » par la dernière
// acquisition, « Météo des forêts » par sa publication) ; entrée nettoyée du score et du regroupement DBSCAN (spec § 2.7).
import type { ActiveFire, FireConfidence, FireDetection, FireImpactsResponse, FireSatellite, FiresResponse, FirmsSourceId } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  environmentSlotStatus, isBool, isNum, isNumOrNull, isOneOf, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn,
  type EnvironmentStatus, type SourceSlot,
} from './environment-source.ts';

export const FIRES_URL = '/api/environment/fires';
/** Cache client : 12 min, sous la relève de 15 min (App.ts). */
export const FIRES_TTL_MS = 12 * 60_000;
export const FIRE_IMPACTS_URL = '/api/fires/impacts';
const IMPACTS_TTL_MS = 60 * 60_000;

export interface FiresState { fires: SourceSlot<FiresResponse> }

const SATELLITES: ReadonlySet<FireSatellite> = new Set<FireSatellite>(['Suomi NPP', 'NOAA-20', 'NOAA-21', 'Terra', 'Aqua']);
const SENSORS: ReadonlySet<string> = new Set(['VIIRS', 'MODIS']);
const CONFIDENCES: ReadonlySet<FireConfidence> = new Set<FireConfidence>(['faible', 'nominale', 'haute']);
const SOURCE_IDS: ReadonlySet<FirmsSourceId> = new Set<FirmsSourceId>(['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT', 'VIIRS_SNPP_PUBLIC_24H']);
const DANGER: ReadonlySet<number> = new Set([1, 2, 3, 4]);

const isDetection = (e: Record<string, unknown>): boolean => isStr(e.id) && isNum(e.lat) && isNum(e.lon) && isStr(e.acquiredAt)
  && isOneOf(e.satellite, SATELLITES) && isOneOf(e.sensor, SENSORS) && isOneOf(e.confidence, CONFIDENCES) && isStr(e.confidenceRaw)
  && isNum(e.frpMw) && (e.daynight === 'D' || e.daynight === 'N') && isStr(e.dept) && isBool(e.recurrent) && isStr(e.foyerId);
const isAbroad = (e: Record<string, unknown>): boolean => isNum(e.lat) && isNum(e.lon) && isStr(e.acquiredAt) && isNum(e.frpMw) && isOneOf(e.satellite, SATELLITES);
const isFoyer = (e: Record<string, unknown>): boolean => isStr(e.id) && isStr(e.dept) && isStringArray(e.depts)
  && numbersIn(e, ['lat', 'lon', 'detections', 'passes', 'frpTotalMw', 'frpMaxMw', 'nightDetections']) && isBool(e.confirmed) && isBool(e.recurrent)
  && isStr(e.firstAt) && isStr(e.lastAt) && Array.isArray(e.satellites) && e.satellites.every((s: unknown) => isOneOf(s, SATELLITES))
  && isOneOf(e.confidenceMax, CONFIDENCES);
const isSource = (e: Record<string, unknown>): boolean => isOneOf(e.id, SOURCE_IDS) && isBool(e.ok) && isStrOrNull(e.lastAcquisitionAt);
const isDay = (e: Record<string, unknown>): boolean => isStr(e.date) && isNum(e.france) && isNum(e.recurrent);
const isPass = (e: Record<string, unknown>): boolean => isOneOf(e.satellite, SATELLITES) && isStr(e.expectedAt);
const isDangerDept = (e: Record<string, unknown>): boolean => isStr(e.dept) && isStr(e.name) && isOneOf(e.j1, DANGER) && isOneOf(e.j2, DANGER);
const isDangerDay = (e: Record<string, unknown>): boolean => isStr(e.date) && numbersIn(e, ['n1', 'n2', 'n3', 'n4']);
function isForestDanger(v: unknown): boolean {
  return v === null || (isRecord(v) && isStr(v.publishedAt) && isStr(v.j1Date) && isStr(v.j2Date)
    && (v.season === 'en-saison' || v.season === 'hors-saison') && listOf(v.departments, isDangerDept) && listOf(v.history, isDangerDay));
}

export function isFiresResponse(v: unknown): v is FiresResponse {
  return isRecord(v) && isStrOrNull(v.readAt) && isStrOrNull(v.lastAcquisitionAt) && listOf(v.sources, isSource) && listOf(v.detections, isDetection)
    && isNum(v.abroadCount) && listOf(v.abroad, isAbroad) && listOf(v.foyers, isFoyer)
    && isRecord(v.daily) && listOf(v.daily.days, isDay) && isStrOrNull(v.daily.since) && listOf(v.nextPasses, isPass)
    && isForestDanger(v.forestDanger) && isStringArray(v.errors);
}

/** Ne rejette jamais : une lecture en échec porte `error` et garde les dernières données. */
export async function fetchFires(previous: FiresState | null, now: number = Date.now()): Promise<FiresState> {
  return { fires: await loadSlot(FIRES_URL, FIRES_TTL_MS, previous?.fires, now, isFiresResponse, 'des feux') };
}

export function mergeFires(current: FiresState | null, incoming: FiresState): FiresState {
  return { fires: mergeSlot(current?.fires, incoming.fires) };
}

/** Erreurs de la météo des forêts dans `errors[]` (le serveur les nomme « Météo des forêts : … »). */
const isMdfError = (e: string): boolean => /^météo des forêts/i.test(e);

/**
 * Deux lignes du panneau des sources : « NASA FIRMS » datée par la dernière acquisition sur la zone (E3), avec les seules erreurs
 * FIRMS ; « Météo des forêts » datée par sa publication (hors saison : dit, jamais « (en retard) »), avec ses seules erreurs ;
 * météo des forêts jamais lue alors que FIRMS répond : « error », sans heure inventée.
 */
export function firesStatus(state: FiresState, part: 'firms' | 'mdf', now: number): EnvironmentStatus {
  const slot = state.fires;
  const data = slot.data;
  if (part === 'firms') {
    const firmsSlot: SourceSlot<{ errors: string[] }> = { ...slot, data: data === null ? null : { errors: data.errors.filter((e) => !isMdfError(e)) } };
    return environmentSlotStatus(firmsSlot, 'firms', data?.lastAcquisitionAt ?? null, now);
  }
  const mdfErrors = data === null ? [] : data.errors.filter(isMdfError);
  if (data !== null && data.forestDanger === null) {
    return { status: 'error', lastUpdate: null, period: undefined, error: mdfErrors.length > 0 ? mdfErrors.join(' ; ') : 'météo des forêts indisponible' };
  }
  const mdfSlot: SourceSlot<{ errors: string[] }> = { ...slot, data: data === null ? null : { errors: mdfErrors } };
  return environmentSlotStatus(mdfSlot, 'mdf', data?.forestDanger?.publishedAt ?? null, now);
}

/** Entrée nettoyée du score et des situations (spec § 2.7) : détections en France non récurrentes. */
export function scoreFireDetections(f: FiresResponse | null): FireDetection[] {
  return f ? f.detections.filter((d) => !d.recurrent) : [];
}

const CONFIDENCE_WORD: Readonly<Record<FireConfidence, string>> = { faible: 'low', nominale: 'nominal', haute: 'high' };

/**
 * Entrée du regroupement DBSCAN (fire-clustering.ts, inchangé) : mêmes coordonnées, heure, satellite, confiance, FRP et jour ou nuit.
 * La réponse ne porte pas les brillances, le balayage ni la version : 0 et « », jamais lus par le regroupement ni affichés.
 */
export function toActiveFire(d: FireDetection): ActiveFire {
  return {
    id: d.id, latitude: d.lat, longitude: d.lon, bright_ti4: 0, scan: 0, track: 0,
    acq_date: d.acquiredAt.slice(0, 10), acq_time: d.acquiredAt.slice(11, 13) + d.acquiredAt.slice(14, 16),
    satellite: d.satellite, confidence: CONFIDENCE_WORD[d.confidence], version: '', bright_ti5: 0, frp: d.frpMw, daynight: d.daynight,
  };
}

// ─── Communes autour d'un foyer (onglet « Dossier d'un feu ») ───

const isCommune = (e: Record<string, unknown>): boolean => isStr(e.code) && isStr(e.name) && isStr(e.dept) && isNumOrNull(e.population) && isNum(e.distanceKm);

export function isFireImpactsResponse(v: unknown): v is FireImpactsResponse {
  return isRecord(v) && isNum(v.lat) && isNum(v.lon) && v.radiusKm === 10 && listOf(v.communes, isCommune)
    && (v.nearest === null || (isRecord(v.nearest) && isCommune(v.nearest))) && isStrOrNull(v.georisquesUrl) && isStr(v.readAt)
    && isStringArray(v.errors);
}

const impactsCache = new Map<string, { data: FireImpactsResponse; at: number }>();

/** Communes à moins de 10 km d'un point ; jamais de rejet ; gardé 1 h par point arrondi à 3 décimales ; un échec n'est jamais gardé. */
export async function fetchFireImpacts(lat: number, lon: number, now: number = Date.now()): Promise<{ data: FireImpactsResponse | null; error: string | null }> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = impactsCache.get(key);
  if (hit && now - hit.at < IMPACTS_TTL_MS) return { data: hit.data, error: null };
  try {
    const resp = await fetch(`${FIRE_IMPACTS_URL}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return { data: null, error: `HTTP ${resp.status}` };
    const json: unknown = await resp.json();
    if (!isFireImpactsResponse(json)) return { data: null, error: 'réponse des communes mal formée' };
    impactsCache.set(key, { data: json, at: now });
    return { data: json, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'erreur inconnue' };
  }
}

/** Tests seulement. */
export function resetFireImpactsCache(): void {
  impactsCache.clear();
}
