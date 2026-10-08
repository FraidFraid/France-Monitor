// src/services/environment-floods.ts : lecture client des crues (spec 2026-10-04 environnement § 2.2 ; contrats § 3.3) : tronçons
// Vigicrues en vigilance et stations Hub'Eau, collectés par le serveur. Garde stricte par élément, jamais de rejet, fusion à
// l'écriture, statut daté par le relevé du serveur (le flux n'a pas d'heure de bulletin), références des tronçons pour le score.
import type { FloodSectionRef, FloodsResponse } from '../types/index.ts';
import { isEnvironmentDataLate } from './environment-levels.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  dataMs, environmentSlotStatus, isColorId, isMultiPath, isNum, isNumOrNull, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn,
  type EnvironmentStatus, type SourceSlot,
} from './environment-source.ts';

export const FLOODS_URL = '/api/environment/floods';
/** Cache client : 8 min, sous la relève de 10 min (App.ts). */
export const FLOODS_TTL_MS = 8 * 60_000;

export interface FloodsState { floods: SourceSlot<FloodsResponse> }

const isPoint = (e: Record<string, unknown>): boolean => isStr(e.at) && isNum(e.value);
const isStation = (e: Record<string, unknown>): boolean => isStr(e.code) && isStr(e.name) && isNumOrNull(e.lat) && isNumOrNull(e.lon)
  && isStrOrNull(e.lastAt) && (e.flowAt === undefined || isStrOrNull(e.flowAt)) && isNumOrNull(e.heightM) && isNumOrNull(e.flowM3s) && isNumOrNull(e.change1hM)
  && listOf(e.heightSeries, isPoint) && listOf(e.flowSeries, isPoint);
const isSection = (e: Record<string, unknown>): boolean => isStr(e.id) && isStr(e.name) && isColorId(e.level)
  && isRecord(e.territory) && isStr(e.territory.code) && isStrOrNull(e.territory.name) && isStr(e.territory.url)
  && isMultiPath(e.path) && listOf(e.stations, isStation);

export function isFloodsResponse(v: unknown): v is FloodsResponse {
  return isRecord(v) && isStrOrNull(v.readAt) && isNum(v.total) && numbersIn(v.counts, ['vert', 'jaune', 'orange', 'rouge'])
    && listOf(v.sections, isSection) && isStrOrNull(v.stationsReadAt) && isNum(v.stationsOmitted) && isStringArray(v.errors);
}

/** Ne rejette jamais : une lecture en échec porte `error` et garde les dernières données. */
export async function fetchFloods(previous: FloodsState | null, now: number = Date.now()): Promise<FloodsState> {
  return { floods: await loadSlot(FLOODS_URL, FLOODS_TTL_MS, previous?.floods, now, isFloodsResponse, 'de Vigicrues') };
}

export function mergeFloods(current: FloodsState | null, incoming: FloodsState): FloodsState {
  return { floods: mergeSlot(current?.floods, incoming.floods) };
}

/** Panneau des sources : « Vigicrues », daté par le relevé du serveur (S1 ; InfoVigiCru ne publie pas d'heure de bulletin). */
export function floodsStatus(state: FloodsState, now: number): EnvironmentStatus {
  const base = environmentSlotStatus(state.floods, 'vigicrues', state.floods.data?.readAt ?? null, now);
  const data = state.floods.data;
  if (data === null) return base;
  // Hauteurs Hub'Eau : la plus récente mesure de toutes les stations ; au-delà du seuil (1 h), la ligne le dit.
  const newest = data.sections.flatMap((s) => s.stations).map((st) => dataMs(st.lastAt)).filter((m): m is number => m !== null).reduce<number | null>((a, m) => (a === null || m > a ? m : a), null);
  if (newest === null || !isEnvironmentDataLate('hubeau', new Date(newest).toISOString(), now)) return base;
  const note = "hauteurs Hub'Eau en retard";
  return { ...base, status: 'stale', error: base.error ? `${base.error} ; ${note}` : note };
}

const REF_LEVEL: Readonly<Record<2 | 3 | 4, FloodSectionRef['level']>> = { 2: 'yellow', 3: 'orange', 4: 'red' };

/** Références des tronçons en vigilance (jaune et plus) pour le score, la note, la file de travail, le stress hydro et le poste v2. */
export function floodsToSectionRefs(f: FloodsResponse | null): FloodSectionRef[] {
  if (!f) return [];
  return f.sections.flatMap((s): FloodSectionRef[] => (s.level === 1 ? [] : [{
    id: s.id, name: s.name, level: REF_LEVEL[s.level], geometry: { type: 'MultiLineString', coordinates: s.path.map((line) => line.map(([lng, lat]) => [lng, lat])) },
  }]));
}
