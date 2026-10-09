// src/services/outages-cloud.ts : lecture client du panneau Cloud (spec 2026-10-08 panneaux pannes § 2.4, § 4). Garde de forme exacte
// élément par élément (un champ en trop ou manquant refuse la réponse, nommé par son chemin), lecture qui ne rejette jamais, fusion à
// l'écriture, ligne « Pages d'état cloud » datée par la lecture la plus récente d'un fournisseur (par la plus ancienne si l'un est en
// retard). Le client ne lit que /api/outages/cloud.
import type { CloudOutagesResponse } from '../types/index.ts';
import { isOutagesDataLate } from './outages-levels.ts';
import { outagesSlotStatus, outagesStatusOf, type OutagesStatus } from './outages-source.ts';
import {
  isBool, isDate, isDateOrNull, isNamedBy, isNum, isOneOf, isStr, isStrOrNull, isStringList, list, loadSovereigntySlot, mergeSlot, record, shapeOf, value,
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

/** Pannes du référentiel (inventaire, jamais un état, P5) : n'appartiennent ni à la ligne des pages d'état ni à l'en-tête du panneau. */
export const isCloudReferenceError = (e: string): boolean => isNamedBy(e, 'Référentiel') || isNamedBy(e, 'PeeringDB');

/**
 * Ligne « Pages d'état cloud » : datée par la lecture la plus récente d'un fournisseur (horloge du serveur) tant que tous les fournisseurs
 * suivis sont à jour (lecture + 2 h) ; dès qu'un fournisseur suivi est en retard ou jamais lu, la ligne passe en « stale », datée par la
 * lecture la plus ancienne, et nomme ces fournisseurs (m3). Azure, qui ne publie aucun état par région France, n'est pas suivi.
 * La panne d'une page est nommée par son fournisseur et dégrade la ligne. Ni la note d'avancement ni les pannes du référentiel
 * (DRIEAT, uMap, PeeringDB), qui ne sont pas des pages d'état, ne la dégradent ; elles valent aussi dans l'erreur de lecture (`slot.error`).
 */
export function cloudStatus(state: CloudState, now: number): OutagesStatus {
  const { data, error } = state.cloud;
  const keep = (e: string): boolean => e !== CLOUD_PENDING_NOTE && !isCloudReferenceError(e);
  const own = error === null ? [] : error.split(' ; ').filter(keep);
  const tracked = data?.providers.filter((p) => p.note === null) ?? [];
  const reads = tracked.map((p) => p.readAt).filter((at): at is string => at !== null).sort();
  const late = tracked.filter((p) => isOutagesDataLate('cloud', p.readAt, now)).map((p) => (p.readAt === null ? `${p.label} (n.d.)` : p.label));
  const named = late.length > 0 ? [`fournisseurs en retard : ${late.join(', ')}`] : [];
  const errors = [...own, ...named];
  const slot: SourceSlot<CloudOutagesResponse> = { ...state.cloud, data: data ? { ...data, errors: data.errors.filter(keep) } : null, error: errors.length > 0 ? errors.join(' ; ') : null };
  return late.length > 0 ? outagesStatusOf(slot, reads[0] ?? null, true, now) : outagesSlotStatus(slot, 'cloud', reads.at(-1) ?? null, now);
}
