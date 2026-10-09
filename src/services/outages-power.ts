// src/services/outages-power.ts : lecture client du panneau Électricité (spec 2026-10-08 panneaux pannes § 2.2, § 4). Garde de forme exacte,
// lecture qui ne rejette jamais, fusion à l'écriture, lignes « EDF indisponibilités », « RTE IIP », « EDF SEI (îles) » datées par leurs sources.
import type { PowerOutagesResponse } from '../types/index.ts';
import { outagesSlotStatus, type OutagesStatus } from './outages-source.ts';
import {
  isBool, isCount, isDate, isDateOrNull, isDay, isNum, isNumOrNull, isStr, isStrOrNull, isStringList, list, loadSovereigntySlot, mergeSlot, nullable,
  record, shapeOf, value, type SourceSlot,
} from './sovereignty-source.ts';

export const POWER_URL = '/api/outages/power';
/** Cache client : 8 min, sous la relève de 10 min. */
export const POWER_TTL_MS = 8 * 60_000;

export interface PowerState { power: SourceSlot<PowerOutagesResponse> }

const str = value(isStr);
const strOrNull = value(isStrOrNull);
const date = value(isDate);
const dateOrNull = value(isDateOrNull);
const numOrNull = value(isNumOrNull);
const kind = value((v) => v === 'imprevue' || v === 'planifiee');
const unit = record({
  id: str, name: str, sector: str, nuclear: value(isBool), kind, lostMw: value(isNum), maxMw: numOrNull,
  start: date, end: dateOrNull, publishedAt: dateOrNull, cause: strOrNull, source: value((v) => v === 'edf' || v === 'rte'),
});
const line = record({
  id: str, asset: str, kind, start: date, end: dateOrNull, publishedAt: date, reason: strOrNull,
  directions: list(record({ label: str, unavailableMw: numOrNull, installedMw: numOrNull })),
});

const SHAPE = shapeOf<PowerOutagesResponse>(record({
  readAt: dateOrNull, edfUpdatedAt: dateOrNull, edfReadAt: dateOrNull, iipPublishedAt: dateOrNull, iipReadAt: dateOrNull,
  unplanned: list(unit), planned: list(unit), upcoming: list(unit),
  transmission: nullable(record({ unplanned: list(line), planned: list(line) })),
  islands: list(record({ zone: value((v) => v === 'reunion' || v === 'corse'), at: date, color: str, text: str, cyclone: value(isBool) })),
  history: list(record({ day: value(isDay), unplannedMw: value(isCount) })), errors: value(isStringList),
}));

export function powerResponseProblems(v: unknown): string[] { return SHAPE.problems(v); }
export function isPowerOutagesResponse(v: unknown): v is PowerOutagesResponse { return SHAPE.is(v); }

export async function fetchPower(previous: PowerState | null, now: number = Date.now()): Promise<PowerState> {
  return { power: await loadSovereigntySlot(POWER_URL, POWER_TTL_MS, previous?.power, now, SHAPE, 'des arrêts de production') };
}

export function mergePower(current: PowerState | null, incoming: PowerState): PowerState {
  return { power: mergeSlot(current?.power, incoming.power) };
}

/** Erreurs d'une partie (« EDF OpenData : … », « RTE IIP : … », « EDF SEI, … ») seulement. */
function only(state: PowerState, prefix: string): PowerState {
  const d = state.power.data;
  return { power: { ...state.power, data: d ? { ...d, errors: d.errors.filter((e) => e.startsWith(prefix)) } : null } };
}

/** Daté par la mise à jour du jeu EDF ; en retard selon la dernière lecture réussie du serveur (R20). */
export function edfStatus(state: PowerState, now: number): OutagesStatus {
  const d = state.power.data;
  return outagesSlotStatus(only(state, 'EDF OpenData').power, 'edf', d?.edfUpdatedAt ?? null, now, d?.edfReadAt ?? null);
}
/** Daté par le flux (`lastBuildDate`) ; en retard selon la dernière lecture réussie du serveur, car RTE ne publie parfois rien pendant des heures. */
export function iipStatus(state: PowerState, now: number): OutagesStatus {
  const d = state.power.data;
  return outagesSlotStatus(only(state, 'RTE IIP').power, 'iip', d?.iipPublishedAt ?? null, now, d?.iipReadAt ?? null);
}
export function seiStatus(state: PowerState, now: number): OutagesStatus {
  const at = state.power.data?.islands.map((i) => i.at).sort().at(-1) ?? null;
  return outagesSlotStatus(only(state, 'EDF SEI').power, 'sei', at, now);
}
