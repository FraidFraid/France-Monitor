// src/services/outages-internet.ts : lecture client du panneau Internet (spec 2026-10-08 panneaux pannes § 2.3, § 4). Garde de forme
// exacte élément par élément (un champ en trop ou manquant refuse la réponse, nommé par son chemin), lecture qui ne rejette jamais,
// fusion à l'écriture, deux lignes du panneau des sources : « IODA » (datée par sa lecture) et « Cloudflare Radar » (sans jeton :
// « non configuré », jamais une erreur). Le client ne lit que /api/outages/internet, jamais une source tierce.
import type { InternetOutagesResponse } from '../types/index.ts';
import { outagesSlotStatus, type OutagesStatus } from './outages-source.ts';
import {
  isBool, isDate, isDateOrNull, isNum, isStr, isStrOrNull, isStringList, isNamedBy, list, loadSovereigntySlot, mergeSlot, nullable,
  record, shapeOf, value, type SourceSlot,
} from './sovereignty-source.ts';

export const INTERNET_URL = '/api/outages/internet';
/** Cache client : 8 min, sous la relève de 10 min. */
export const INTERNET_TTL_MS = 8 * 60_000;
/** Note du serveur quand la collecte n'a pas fini dans son délai : un avancement, pas une panne (même texte que api/_lib/outages-internet.js). */
export const INTERNET_PENDING_NOTE = 'Internet : collecte en cours';
/** Période de la ligne « Cloudflare Radar » sans jeton. */
export const RADAR_NOT_CONFIGURED_PERIOD = 'non configuré';

export interface InternetState { internet: SourceSlot<InternetOutagesResponse> }

const str = value(isStr);
const strOrNull = value(isStrOrNull);
const date = value(isDate);
const dateOrNull = value(isDateOrNull);
const num = value(isNum);
const bool = value(isBool);
const numOrNull = value((v) => v === null || isNum(v));

const event = record({
  id: str, scope: value((v) => v === 'national' || v === 'departement' || v === 'operateur' || v === 'inconnu'), dept: strOrNull, asn: numOrNull,
  label: str, signal: str, start: date, end: dateOrNull, durationSec: num, ongoing: bool, staleOpen: bool, score: num,
});
const radarItem = record({
  id: str, kind: value((v) => v === 'anomalie' || v === 'panne'), label: str, asn: numOrNull, start: date, end: dateOrNull,
  verified: value((v) => v === null || isBool(v)), cause: strOrNull, outageType: strOrNull, national: bool,
});

const SHAPE = shapeOf<InternetOutagesResponse>(record({
  readAt: dateOrNull, iodaReadAt: dateOrNull, radar: record({ configured: bool, readAt: dateOrNull, items: list(radarItem) }),
  events: list(event),
  ripe: nullable(record({ snapshotAt: dateOrNull, networks: list(record({ asn: num, name: str, visibilityPct: num })) })),
  errors: value(isStringList),
}));

export function internetResponseProblems(v: unknown): string[] { return SHAPE.problems(v); }
export function isInternetOutagesResponse(v: unknown): v is InternetOutagesResponse { return SHAPE.is(v); }

export async function fetchInternet(previous: InternetState | null, now: number = Date.now()): Promise<InternetState> {
  return { internet: await loadSovereigntySlot(INTERNET_URL, INTERNET_TTL_MS, previous?.internet, now, SHAPE, 'des pannes Internet') };
}

export function mergeInternet(current: InternetState | null, incoming: InternetState): InternetState {
  return { internet: mergeSlot(current?.internet, incoming.internet) };
}

/** Garde seulement les erreurs que `keep` retient : une panne Radar ou RIPEstat ne dégrade pas la ligne IODA, et inversement. */
function only(state: InternetState, keep: (error: string) => boolean): InternetState {
  const d = state.internet.data;
  return { internet: { ...state.internet, data: d ? { ...d, errors: d.errors.filter(keep) } : null } };
}

/** Ligne « IODA » : datée par la dernière lecture IODA (`iodaReadAt`), en retard au-delà de 60 min. Les notes d'avancement ne sont pas des pannes. */
export function iodaStatus(state: InternetState, now: number): OutagesStatus {
  const own = only(state, (e) => e !== INTERNET_PENDING_NOTE && (isNamedBy(e, 'IODA') || isNamedBy(e, 'Internet')));
  return outagesSlotStatus(own.internet, 'ioda', state.internet.data?.iodaReadAt ?? null, now);
}

/**
 * Ligne « Cloudflare Radar » : sans jeton posé sur le serveur, « non configuré » et statut `ok`, jamais une erreur ni un retard (la
 * source est facultative) ; avec jeton, datée par la dernière lecture Radar et nommant ses seules pannes.
 */
export function radarStatus(state: InternetState, now: number): OutagesStatus {
  const d = state.internet.data;
  if (d !== null && !d.radar.configured) return { status: 'ok', lastUpdate: null, error: undefined, period: RADAR_NOT_CONFIGURED_PERIOD };
  const own = only(state, (e) => isNamedBy(e, 'Cloudflare Radar'));
  return outagesSlotStatus(own.internet, 'radar', d?.radar.readAt ?? null, now);
}
