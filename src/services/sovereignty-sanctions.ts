// src/services/sovereignty-sanctions.ts : lecture client du registre national des gels (spec 2026-10-04 souveraineté § 3.4 ; contrats
// § 3.3 ; amendement 7, S7). Garde de forme exacte (dates, comptes et différences seulement : tout champ nominatif refuse la réponse),
// lecture qui ne rejette jamais, fusion à l'écriture ; ligne « Registre des gels » datée par la dernière lecture réussie de la date de
// publication (une publication ancienne n'est jamais « en retard »).
import type { SanctionsResponse } from '../types/index.ts';
import {
  isCount, isCountOrNull, isDate, isDateOrNull, isStringList, list, loadSovereigntySlot, mergeSlot, nullable, record, shapeOf,
  sovereigntySlotStatus, value, type SourceSlot, type SovereigntyStatus,
} from './sovereignty-source.ts';

export const SANCTIONS_URL = '/api/sovereignty/sanctions';
/** Cache client : 50 min, sous la relève d'une heure du serveur. */
export const SANCTIONS_TTL_MS = 50 * 60_000;
/** Registre officiel (DG Trésor) : lien « consulter la dernière version du registre » (S7), porté par le client (jamais dans la réponse). */
export const GELS_REGISTRY_URL = 'https://gels-avoirs.dgtresor.gouv.fr/';

export interface SanctionsState { sanctions: SourceSlot<SanctionsResponse> }

const count = value(isCount);
const countOrNull = value(isCountOrNull);
const date = value(isDate);
const dateOrNull = value(isDateOrNull);

const publication = record({ publishedAt: date, total: count, physiques: count, morales: count, navires: count, added: countOrNull, removed: countOrNull });

const SANCTIONS_SHAPE = shapeOf<SanctionsResponse>(record({
  readAt: dateOrNull, dateCheckedAt: dateOrNull, current: nullable(publication),
  history: record({ publications: list(publication), since: dateOrNull }), errors: value(isStringList),
}));

/** Écarts à la forme de /api/sovereignty/sanctions, nommés un par un ; liste vide : conforme. */
export function sanctionsResponseProblems(v: unknown): string[] {
  return SANCTIONS_SHAPE.problems(v);
}

export function isSanctionsResponse(v: unknown): v is SanctionsResponse {
  return SANCTIONS_SHAPE.is(v);
}

export async function fetchSanctions(previous: SanctionsState | null, now: number = Date.now()): Promise<SanctionsState> {
  return { sanctions: await loadSovereigntySlot(SANCTIONS_URL, SANCTIONS_TTL_MS, previous?.sanctions, now, SANCTIONS_SHAPE, 'du registre des gels') };
}

export function mergeSanctions(current: SanctionsState | null, incoming: SanctionsState): SanctionsState {
  return { sanctions: mergeSlot(current?.sanctions, incoming.sanctions) };
}

/**
 * Panneau des sources : « Registre des gels », daté par la dernière date relue ; jamais relue alors que la réponse est là : « error »,
 * période « n.d. ». « Registre des gels : lecture en cours » est une note.
 */
export function gelsStatus(state: SanctionsState, now: number): SovereigntyStatus {
  return sovereigntySlotStatus(state.sanctions, 'gels', state.sanctions.data?.dateCheckedAt ?? null, now, 'Registre des gels');
}
