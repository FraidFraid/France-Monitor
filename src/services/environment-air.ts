// src/services/environment-air.ts : lecture client du panneau Qualité de l'air (spec 2026-10-04 environnement § 3.2) : épisodes de J à
// J+2 et indice ATMO agrégé par département (Atmo France). Lu au démarrage et relevé sans arrêt (situation « épisode d'alerte »).
import type { AirEpisodeState, AirQualityResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  environmentSlotStatus, isNum, isNumOrNull, isOneOf, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, type EnvironmentStatus, type SourceSlot,
} from './environment-source.ts';

export const AIR_QUALITY_URL = '/api/environment/air';
/** Cache client : 25 min, sous la relève de 30 min. */
export const AIR_QUALITY_TTL_MS = 25 * 60_000;

export interface AirQualityState { air: SourceSlot<AirQualityResponse> }

const STATES: ReadonlySet<AirEpisodeState> = new Set<AirEpisodeState>(['information', 'alerte', 'inconnu']);
const isEpisode = (e: Record<string, unknown>): boolean => isStr(e.zoneCode) && isStr(e.zone) && isStr(e.pollutantCode) && isStr(e.pollutant)
  && isStr(e.date) && isOneOf(e.state, STATES) && isStr(e.stateRaw) && isStrOrNull(e.updatedAt);
const isPollutantDays = (p: Record<string, unknown>): boolean => isStr(p.pollutantCode) && isStr(p.pollutant)
  && listOf(p.days, (d) => isStr(d.date) && numbersIn(d, ['information', 'alerte']));
const isIndexDept = (d: Record<string, unknown>): boolean => isStr(d.dept) && isStr(d.name)
  && numbersIn(d, ['communes', 'degrade', 'mauvais', 'tresMauvaisEtPlus']) && isNumOrNull(d.maxIndex);

export function isAirQualityResponse(v: unknown): v is AirQualityResponse {
  if (!isRecord(v) || !Array.isArray(v.days) || !v.days.every(isStr) || !isStrOrNull(v.episodesUpdatedAt) || !isNum(v.zonesCovered)
    || !isStrOrNull(v.readAt) || !isStringArray(v.errors)) return false;
  const { index } = v;
  return listOf(v.episodes, isEpisode) && listOf(v.perPollutant, isPollutantDays) && isRecord(index) && isStrOrNull(index.date)
    && isStrOrNull(index.updatedAt) && isNum(index.communes) && listOf(index.departments, isIndexDept);
}

export async function fetchAirQuality(previous: AirQualityState | null, now: number = Date.now()): Promise<AirQualityState> {
  return { air: await loadSlot(AIR_QUALITY_URL, AIR_QUALITY_TTL_MS, previous?.air, now, isAirQualityResponse, 'Atmo France') };
}

export function mergeAirQuality(current: AirQualityState | null, incoming: AirQualityState): AirQualityState {
  return { air: mergeSlot(current?.air, incoming.air) };
}

/** Date de la donnée Atmo : la mise à jour la plus récente des épisodes et de l'indice ; null si aucune n'est lisible. */
export function airLatestUpdate(a: AirQualityResponse | null): string | null {
  const dates = [a?.episodesUpdatedAt ?? null, a?.index.updatedAt ?? null].filter((d): d is string => d !== null && Number.isFinite(Date.parse(d)));
  return dates.sort((x, y) => Date.parse(x) - Date.parse(y)).at(-1) ?? null;
}

/** Panneau des sources (« Atmo France ») : retard au-delà de 36 h après la mise à jour. */
export function airQualityStatus(state: AirQualityState, now: number): EnvironmentStatus {
  return environmentSlotStatus(state.air, 'atmo', airLatestUpdate(state.air.data), now);
}
