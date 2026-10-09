// src/services/outages-cloud.ts : lecture client du panneau Cloud (spec 2026-10-08 panneaux pannes § 2.4, § 4). Garde de forme exacte
// élément par élément (un champ en trop ou manquant refuse la réponse, nommé par son chemin), lecture qui ne rejette jamais, fusion à
// l'écriture, ligne « Pages d'état cloud » datée par la lecture la plus récente d'un fournisseur. Le client ne lit que /api/outages/cloud.
import type { CloudOutagesResponse } from '../types/index.ts';
import { outagesSlotStatus, type OutagesStatus } from './outages-source.ts';
import {
  isBool, isDate, isDateOrNull, isNum, isOneOf, isStr, isStrOrNull, isStringList, list, loadSovereigntySlot, mergeSlot, record, shapeOf, value,
  type SourceSlot,
} from './sovereignty-source.ts';

export const CLOUD_URL = '/api/outages/cloud';
/** Cache client : 25 min, sous la relève de 30 min. */
export const CLOUD_TTL_MS = 25 * 60_000;
/** Note du serveur quand la collecte n'a pas fini dans son délai : un avancement, pas une panne (même texte que api/_lib/outages-cloud.js). */
export const CLOUD_PENDING_NOTE = 'Cloud : collecte en cours';

export interface CloudState { cloud: SourceSlot<CloudOutagesResponse> }

const str = value(isStr);
const strOrNull = value(isStrOrNull);
const date = value(isDate);
const dateOrNull = value(isDateOrNull);
const num = value(isNum);
const bool = value(isBool);
const numOrNull = value((v) => v === null || isNum(v));

const PROVIDERS: ReadonlySet<string> = new Set(['ovhcloud', 'scaleway', 'cloudflare', 'gcp', 'aws', 'outscale', 'azure']);
const STATUSES: ReadonlySet<string> = new Set(['operational', 'maintenance', 'degraded', 'partial', 'major', 'unknown']);
const provider = value((v) => isOneOf(v, PROVIDERS));
const zone = record({ id: str, label: str, status: value((v) => isOneOf(v, STATUSES)), updatedAt: dateOrNull, lat: numOrNull, lon: numOrNull });
const incident = record({
  id: str, provider, title: str, zones: value(isStringList), state: value((v) => v === 'en-cours' || v === 'surveille'),
  impact: value((v) => v === 'none' || v === 'minor' || v === 'major' || v === 'critical'), start: date, updatedAt: dateOrNull, url: strOrNull,
});

const SHAPE = shapeOf<CloudOutagesResponse>(record({
  readAt: dateOrNull,
  providers: list(record({ provider, label: str, readAt: dateOrNull, zones: list(zone), note: strOrNull, error: strOrNull })),
  incidents: list(incident),
  maintenances: list(record({ id: str, provider, title: str, zones: value(isStringList), inProgress: bool, start: date, end: dateOrNull })),
  elsewhere: list(incident),
  reference: record({
    generatedAt: dateOrNull,
    datacenters: list(record({ id: str, name: str, operator: strOrNull, city: strOrNull, lat: num, lon: num, stage: strOrNull, power: strOrNull, source: str })),
    exchanges: list(record({ id: num, name: str, city: strOrNull, url: str })),
  }),
  errors: value(isStringList),
}));

export function cloudResponseProblems(v: unknown): string[] { return SHAPE.problems(v); }
export function isCloudOutagesResponse(v: unknown): v is CloudOutagesResponse { return SHAPE.is(v); }

export async function fetchCloud(previous: CloudState | null, now: number = Date.now()): Promise<CloudState> {
  return { cloud: await loadSovereigntySlot(CLOUD_URL, CLOUD_TTL_MS, previous?.cloud, now, SHAPE, 'des pages d’état cloud') };
}

export function mergeCloud(current: CloudState | null, incoming: CloudState): CloudState {
  return { cloud: mergeSlot(current?.cloud, incoming.cloud) };
}

/**
 * Ligne « Pages d'état cloud » : datée par la lecture la plus récente d'un fournisseur (horloge du serveur), en retard au-delà de 2 h ;
 * la panne d'une page est nommée par son fournisseur et dégrade la ligne. La note d'avancement n'est pas une panne.
 */
export function cloudStatus(state: CloudState, now: number): OutagesStatus {
  const d = state.cloud.data;
  const own: CloudState = { cloud: { ...state.cloud, data: d ? { ...d, errors: d.errors.filter((e) => e !== CLOUD_PENDING_NOTE) } : null } };
  const latest = d?.providers.map((p) => p.readAt).filter((at): at is string => at !== null).sort().at(-1) ?? null;
  return outagesSlotStatus(own.cloud, 'cloud', latest, now);
}
