// src/services/outages-now.ts : lecture client des pannes de téléphone et d'internet en cours (/api/outages/now, 21/10/2026). Garde de forme
// exacte, lecture qui ne rejette jamais (la précédente est gardée), relue toutes les 2 min dans tous les onglets.
import type { OutageNow, OutagesNowResponse } from '../types/index.ts';
import {
  isBool, isDateOrNull, isOneOf, isStr, isStrOrNull, isStringList, list, loadSovereigntySlot, record, shapeOf, value, type SourceSlot,
} from './sovereignty-source.ts';

export const OUTAGES_NOW_URL = '/api/outages/now';
/** Relève : 2 min (réponse en cache CDN 1 min). */
export const OUTAGES_NOW_POLL_MS = 2 * 60_000;
const TTL_MS = 90_000;

const SOURCES: ReadonlySet<string> = new Set(['presse', 'arcep', 'ioda', 'radar']);
const source = value((v) => isOneOf(v, SOURCES));
const SHAPE = shapeOf<OutagesNowResponse>(record({
  generatedAt: value(isStr),
  outages: list(record({
    id: value(isStr), scope: value((v) => isOneOf(v, new Set(['operateur', 'departement', 'national', 'inconnu']))),
    operator: value(isStrOrNull), dept: value(isStrOrNull), label: value(isStrOrNull),
    level: value((v) => isOneOf(v, new Set(['jaune', 'orange', 'rouge']))), since: value(isDateOrNull),
    national: value(isBool), measured: value(isBool),
    evidence: list(record({ source, text: value(isStr), at: value(isDateOrNull), link: value(isStrOrNull) })),
  })),
  sources: list(record({ source, readAt: value(isDateOrNull), ok: value(isBool) })),
  errors: value(isStringList),
}));

export function isOutagesNowResponse(v: unknown): v is OutagesNowResponse { return SHAPE.is(v); }

export async function fetchOutagesNow(previous: SourceSlot<OutagesNowResponse> | undefined, now: number = Date.now()): Promise<SourceSlot<OutagesNowResponse>> {
  return loadSovereigntySlot(OUTAGES_NOW_URL, TTL_MS, previous, now, SHAPE, 'des pannes en cours');
}

/** Mesurée par une source, ou presse seule (non confirmée) : le bandeau le dit toujours. */
export function outageProof(o: Pick<OutageNow, 'measured' | 'evidence'>): string {
  const names = [...new Set(o.evidence.map((e) => SOURCE_LABEL[e.source]))];
  return o.measured ? `mesurée : ${names.join(', ')}` : 'presse seule, non confirmée par une mesure';
}

export const SOURCE_LABEL: Readonly<Record<OutageNow['evidence'][number]['source'], string>> = {
  presse: 'presse', arcep: 'ARCEP', ioda: 'IODA', radar: 'Cloudflare Radar',
};
