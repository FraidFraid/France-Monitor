// src/services/outages-now.ts : lecture client des pannes de téléphone et d'internet en cours (/api/outages/now, 21/10/2026). Garde de forme
// exacte, lecture qui ne rejette jamais (la précédente est gardée), relue toutes les 2 min dans tous les onglets.
import type { OutageJournalEntry, OutageNetwork, OutageNow, OutageRung, OutagesNowResponse } from '../types/index.ts';
import {
  isBool, isDateOrNull, isOneOf, isStr, isStrOrNull, isStringList, list, loadSovereigntySlot, record, shapeOf, value, type SourceSlot,
} from './sovereignty-source.ts';

export const OUTAGES_NOW_URL = '/api/outages/now';
/** Relève : 2 min (réponse en cache CDN 1 min). */
export const OUTAGES_NOW_POLL_MS = 2 * 60_000;
const TTL_MS = 90_000;

const SOURCES: ReadonlySet<string> = new Set(['presse', 'usagers', 'arcep', 'ioda', 'radar', 'atlas', 'rte', 'edf', 'statut']);
const source = value((v) => isOneOf(v, SOURCES));
const NETWORKS: ReadonlySet<string> = new Set(['mobile', 'internet', 'electricite', 'cloud', 'gaz', 'eau', 'urgence', 'paiement', 'tv']);
const RUNGS: ReadonlySet<string> = new Set(['signalee', 'mesuree', 'confirmee']);
const LEVELS: ReadonlySet<string> = new Set(['jaune', 'orange', 'rouge']);
const network = value((v) => isOneOf(v, NETWORKS));
const rung = value((v) => isOneOf(v, RUNGS));
const level = value((v) => isOneOf(v, LEVELS));
const SERVICE_TYPES: ReadonlySet<string> = new Set(['prefecture', 'sous_pref', 'police', 'gendarmerie', 'sdis', 'hopital']);
const journalEntry = record({
  at: value(isStr), kind: value((v) => isOneOf(v, new Set(['nouvelle', 'aggravee', 'attenuee', 'confirmee', 'retablie']))),
  id: value(isStr), network, name: value(isStr), dept: value(isStrOrNull), level, rung,
});
const outageShape = record({
    id: value(isStr), network, rung, scope: value((v) => isOneOf(v, new Set(['operateur', 'departement', 'national', 'inconnu']))),
    operator: value(isStrOrNull), dept: value(isStrOrNull), label: value(isStrOrNull),
    level, since: value(isDateOrNull),
    national: value(isBool), measured: value(isBool),
    evidence: list(record({ source, text: value(isStr), at: value(isDateOrNull), link: value(isStrOrNull) })),
    exposed: record({
      basis: value((v) => isOneOf(v, new Set(['departement', 'communes', 'national']))), total: value((v) => typeof v === 'number' && v >= 0),
      byType: value((v) => typeof v === 'object' && v !== null && Object.entries(v).every(([k, n]) => SERVICE_TYPES.has(k) && typeof n === 'number')),
      sample: list(record({ type: value((v) => isOneOf(v, SERVICE_TYPES)), name: value(isStr), commune: value(isStrOrNull), dept: value(isStr) })),
      points: list(record({ type: value((v) => isOneOf(v, SERVICE_TYPES)), name: value(isStr), lon: value((v) => typeof v === 'number'), lat: value((v) => typeof v === 'number') })),
    }, ['points']),
  }, ['exposed']);
const SHAPE = shapeOf<OutagesNowResponse>(record({
  generatedAt: value(isStr),
  outages: list(outageShape),
  bulletin: list(outageShape),
  cascades: list(record({
    key: value(isStr), dept: value(isStrOrNull), national: value(isBool), level,
    steps: list(record({ id: value(isStr), network, since: value(isDateOrNull) })),
  })),
  journal: list(journalEntry),
  sources: list(record({ source, readAt: value(isDateOrNull), ok: value(isBool) })),
  errors: value(isStringList),
}, ['cascades', 'bulletin']));

export function isOutagesNowResponse(v: unknown): v is OutagesNowResponse { return SHAPE.is(v); }

const JOURNAL_SHAPE = shapeOf<{ entries: OutageJournalEntry[]; errors: string[] }>(record({ entries: list(journalEntry), errors: value(isStringList) }, ['errors']));

/** Journal des pannes depuis `sinceMs` (frise et rejeu) ; vide si la route ne répond pas (la frise se rabat sur le journal servi avec l'état). */
export async function fetchOutagesJournal(sinceMs: number): Promise<OutageJournalEntry[]> {
  try {
    const res = await fetch(`/api/outages/journal?since=${Math.round(sinceMs)}`);
    if (!res.ok) return [];
    const json: unknown = await res.json();
    return JOURNAL_SHAPE.is(json) ? json.entries : [];
  } catch {
    return [];
  }
}

export async function fetchOutagesNow(previous: SourceSlot<OutagesNowResponse> | undefined, now: number = Date.now()): Promise<SourceSlot<OutagesNowResponse>> {
  return loadSovereigntySlot(OUTAGES_NOW_URL, TTL_MS, previous, now, SHAPE, 'des pannes en cours');
}

export const NETWORK_LABEL: Readonly<Record<OutageNetwork, string>> = {
  mobile: 'Téléphone mobile', internet: 'Internet', electricite: 'Électricité', cloud: 'Cloud',
  gaz: 'Gaz', eau: 'Eau', urgence: 'Numéros d’urgence', paiement: 'Paiement', tv: 'Télévision',
};
export const RUNG_LABEL: Readonly<Record<OutageRung, string>> = {
  signalee: 'signalée, non confirmée', mesuree: 'mesurée', confirmee: 'confirmée',
};

/** Échelon de confirmation et sources : le bandeau et la salle le disent toujours. */
export function outageProof(o: Pick<OutageNow, 'rung' | 'evidence'>): string {
  const names = [...new Set(o.evidence.map((e) => SOURCE_LABEL[e.source]))];
  return `${RUNG_LABEL[o.rung]} : ${names.join(', ')}`;
}

export const SOURCE_LABEL: Readonly<Record<OutageNow['evidence'][number]['source'], string>> = {
  presse: 'presse', usagers: 'usagers (Bluesky, Mastodon)', arcep: 'ARCEP', ioda: 'IODA', radar: 'Cloudflare Radar', atlas: 'RIPE Atlas', rte: 'RTE', edf: 'EDF', statut: 'page d’état',
};
