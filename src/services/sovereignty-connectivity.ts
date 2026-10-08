// src/services/sovereignty-connectivity.ts : lecture client de la visibilité des grands réseaux et des points d'échange (spec
// 2026-10-04 souveraineté § 3.3 ; contrats § 3.3 ; amendement 7, S8). Garde de forme exacte élément par élément, lecture qui ne rejette
// jamais, fusion à l'écriture ; ligne « RIPEstat » datée par l'instantané (query_time), en retard après 10 h. Hors score. Un réseau
// non lu est nommé dans `unread` (jamais compté à 0) ; un pourcentage hors de 0 à 100 refuse la réponse.
import type { ConnectivityResponse, MajorNetworkAsn } from '../types/index.ts';
import {
  isCount, isDate, isDateOrNull, isNum, isOneOf, isStr, isStrOrNull, isStringList, list, loadSovereigntySlot, mergeSlot, nullable,
  record, shapeOf, sovereigntySlotStatus, value, type SourceSlot, type SovereigntyStatus,
} from './sovereignty-source.ts';
import { isRecord } from './health-surveillance.ts';

export const CONNECTIVITY_URL = '/api/sovereignty/connectivity';
/** Cache client : 50 min, sous la relève d'une heure du serveur. */
export const CONNECTIVITY_TTL_MS = 50 * 60_000;

export interface ConnectivityState { connectivity: SourceSlot<ConnectivityResponse> }

const ASNS: ReadonlySet<MajorNetworkAsn> = new Set<MajorNetworkAsn>([3215, 15557, 5410, 12322, 2200, 16276]);

const count = value(isCount);
const str = value(isStr);
const strOrNull = value(isStrOrNull);
const date = value(isDate);
const dateOrNull = value(isDateOrNull);
const asn = value((v) => isOneOf(v, ASNS));
/** Pourcentage fini entre 0 et 100 (S8) : NaN, Infinity ou valeur hors bornes refusent la réponse. */
const percent = value((v) => isNum(v) && v >= 0 && v <= 100);

const network = record({
  asn, name: str, v4Seeing: count, v4Total: count, v6Seeing: count, v6Total: count, v4Prefixes: count, v6Prefixes: count, visibilityPct: percent,
});
const unreadNetwork = record({ asn, name: str, error: strOrNull });
const sample = record({ at: date, minPct: percent });
/** Préfixes annoncés par réseau (clé : ASN), un nombre entier chacun. */
const prefixSample = record({ at: date, prefixes: value((v) => isRecord(v) && Object.entries(v).every(([k, n]) => /^\d+$/.test(k) && isCount(n))) });
const exchange = record({ id: count, name: str, city: strOrNull, updated: dateOrNull, url: str });

const CONNECTIVITY_SHAPE = shapeOf<ConnectivityResponse>(record({
  readAt: dateOrNull, snapshotAt: dateOrNull, networks: list(network), unread: list(unreadNetwork),
  history: record({ samples: list(sample), since: dateOrNull, prefixSamples: list(prefixSample) }, ['prefixSamples']),
  exchanges: nullable(record({ readAt: dateOrNull, items: list(exchange) })),
  errors: value(isStringList),
}, ['unread']));

/** Écarts à la forme de /api/sovereignty/connectivity, nommés un par un ; liste vide : conforme. */
export function connectivityResponseProblems(v: unknown): string[] {
  return CONNECTIVITY_SHAPE.problems(v);
}

export function isConnectivityResponse(v: unknown): v is ConnectivityResponse {
  return CONNECTIVITY_SHAPE.is(v);
}

export async function fetchConnectivity(previous: ConnectivityState | null, now: number = Date.now()): Promise<ConnectivityState> {
  return {
    connectivity: await loadSovereigntySlot(
      CONNECTIVITY_URL, CONNECTIVITY_TTL_MS, previous?.connectivity, now, CONNECTIVITY_SHAPE, 'de RIPEstat et PeeringDB',
    ),
  };
}

export function mergeConnectivity(current: ConnectivityState | null, incoming: ConnectivityState): ConnectivityState {
  return { connectivity: mergeSlot(current?.connectivity, incoming.connectivity) };
}

/**
 * Panneau des sources : « RIPEstat », daté par l'instantané (query_time) ; les pannes de PeeringDB ne sont pas les siennes ; jamais
 * lu alors que la réponse est là : « error », période « n.d. » (tâche A9). « RIPEstat : lecture en cours » est une note.
 */
export function ripeStatus(state: ConnectivityState, now: number): SovereigntyStatus {
  return sovereigntySlotStatus(
    state.connectivity, 'ripestat', state.connectivity.data?.snapshotAt ?? null, now, 'RIPEstat', { parts: ['RIPEstat', 'PeeringDB'] },
  );
}
