// src/services/outages-telecom.ts : lecture client du panneau Télécoms (spec 2026-10-08 panneaux pannes § 2.1, § 4). Garde de forme
// exacte élément par élément (un champ en trop ou manquant refuse la réponse, nommé par son chemin), lecture qui ne rejette jamais,
// fusion à l'écriture, statut « ARCEP sites mobiles » daté par la publication du fichier ; fichier de la veille en retard après 15 h.
import type { TelecomOutagesResponse } from '../types/index.ts';
import { isArcepFileLate } from './outages-levels.ts';
import { outagesStatusOf, type OutagesStatus } from './outages-source.ts';
import {
  isCount, isDate, isDateOrNull, isDay, isNum, isOneOf, isStr, isStrOrNull, isStringList, list, loadSovereigntySlot, mergeSlot, nullable,
  record, shapeOf, value, type SourceSlot,
} from './sovereignty-source.ts';

export const TELECOM_URL = '/api/outages/telecom';
/** Cache client : 25 min, sous la relève de 30 min. */
export const TELECOM_TTL_MS = 25 * 60_000;

export interface TelecomState { telecom: SourceSlot<TelecomOutagesResponse> }

const str = value(isStr);
const strOrNull = value(isStrOrNull);
const num = value(isNum);
const count = value(isCount);
const date = value(isDate);
const day = value(isDay);
const hsOk = value((v) => v === null || v === 'HS' || v === 'OK');
const TECHS: ReadonlySet<string> = new Set(['2G', '3G', '4G', '5G']);
const CLASSES: ReadonlySet<string> = new Set(['recente', 'longue', 'maintenance', 'sans-date']);
const BANDS: ReadonlySet<string> = new Set(['1-3j', '3-7j', '7-30j', '30j+']);
const countOrNull = value((v) => v === null || isCount(v));
const fileRef = record({ day, publishedAt: date });

const site = record({
  id: str, operator: str, dept: strOrNull, commune: strOrNull, insee: strOrNull, lat: num, lon: num,
  techs: value((v) => Array.isArray(v) && v.every((t) => isOneOf(t, TECHS))), voice: hsOk, data: hsOk,
  cause: value((v) => v === null || v === 'incident' || v === 'maintenance'), since: value(isDateOrNull), detail: strOrNull,
  cls: value((v) => isOneOf(v, CLASSES)), band: value((v) => v === null || isOneOf(v, BANDS)),
});

const SHAPE = shapeOf<TelecomOutagesResponse>(record({
  readAt: value(isDateOrNull), file: nullable(fileRef), previousFile: nullable(fileRef),
  summary: nullable(record({
    total: count, recent: count, long: count, maintenance: count, undated: count,
    bands: record({ '1-3j': count, '3-7j': count, '7-30j': count, '30j+': count }),
    newSincePrevious: countOrNull, resolvedSincePrevious: countOrNull,
  })),
  byOperator: list(record({ operator: str, recent: count, long: count, maintenance: count, voiceCut: count, dataCut: count })),
  byDept: list(record({ dept: strOrNull, recent: count })),
  sites: list(site), history: list(record({ day, recent: count })), errors: value(isStringList),
}));

export function telecomResponseProblems(v: unknown): string[] { return SHAPE.problems(v); }
export function isTelecomOutagesResponse(v: unknown): v is TelecomOutagesResponse { return SHAPE.is(v); }

export async function fetchTelecom(previous: TelecomState | null, now: number = Date.now()): Promise<TelecomState> {
  return { telecom: await loadSovereigntySlot(TELECOM_URL, TELECOM_TTL_MS, previous?.telecom, now, SHAPE, 'des pannes télécoms') };
}

export function mergeTelecom(current: TelecomState | null, incoming: TelecomState): TelecomState {
  return { telecom: mergeSlot(current?.telecom, incoming.telecom) };
}

/**
 * Ligne « ARCEP sites mobiles » : date de publication du fichier (avec le jour, il peut dater de la veille) ; le retard est celui
 * d'isArcepFileLate, passé explicitement (R30 : jamais le seuil de 0 min de la table des retards).
 */
export function arcepStatus(state: TelecomState, now: number): OutagesStatus {
  const file = state.telecom.data?.file ?? null;
  return outagesStatusOf(state.telecom, file?.publishedAt ?? null, isArcepFileLate(file?.day ?? null, now), now, true);
}
