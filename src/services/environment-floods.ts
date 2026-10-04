// src/services/environment-floods.ts : lecture client des crues (spec 2026-10-04 environnement § 2.2 ; contrats § 3.3) : tronçons
// Vigicrues en vigilance et stations Hub'Eau, collectés par le serveur. Garde stricte par élément, jamais de rejet, fusion à
// l'écriture, statut daté par le relevé du serveur (le flux n'a pas d'heure de bulletin), références des tronçons pour le score.
import type { FloodSectionRef, FloodsResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  environmentSlotStatus, isColorId, isMultiPath, isNum, isNumOrNull, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn,
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
  return environmentSlotStatus(state.floods, 'vigicrues', state.floods.data?.readAt ?? null, now);
}

const REF_LEVEL: Readonly<Record<2 | 3 | 4, FloodSectionRef['level']>> = { 2: 'yellow', 3: 'orange', 4: 'red' };

/** Références des tronçons en vigilance (jaune et plus) pour le score, la note, la file de travail, le stress hydro et le poste v2. */
export function floodsToSectionRefs(f: FloodsResponse | null): FloodSectionRef[] {
  if (!f) return [];
  return f.sections.flatMap((s): FloodSectionRef[] => (s.level === 1 ? [] : [{
    id: s.id, name: s.name, level: REF_LEVEL[s.level], geometry: { type: 'MultiLineString', coordinates: s.path.map((line) => line.map(([lng, lat]) => [lng, lat])) },
  }]));
}
