// src/services/environment-vigilance.ts : lecture client de la vigilance Météo-France (spec 2026-10-04 environnement § 2.1 ;
// contrats § 3.3). Garde stricte par élément, lecture qui ne rejette jamais, fusion à l'écriture, statut daté par update_time (S1)
// et adaptateur vers MeteoAlert pour le score, la note de situation, la file de travail, le stress hydro et le poste v2.
import type {
  MeteoAlert, MeteoRiskType, VigilanceBulletin, VigilanceEcheance, VigilancePhenomenonId, VigilanceResponse,
} from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';
import {
  environmentSlotStatus, isColorId, isNum, isOneOf, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, type EnvironmentStatus, type SourceSlot,
} from './environment-source.ts';
import { vigilancePeriodOf } from './environment-levels.ts';

export const VIGILANCE_URL = '/api/environment/vigilance';
/** Cache client : 4 min, sous la relève de 5 min (App.ts). */
export const VIGILANCE_TTL_MS = 4 * 60_000;

export interface VigilanceState { vigilance: SourceSlot<VigilanceResponse> }

const PHENOMENA: ReadonlySet<VigilancePhenomenonId> = new Set<VigilancePhenomenonId>(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
const ECHEANCES: ReadonlySet<VigilanceEcheance> = new Set<VigilanceEcheance>(['J', 'J1']);
const SCOPES: ReadonlySet<string> = new Set(['national', 'zonal', 'departemental']);
const KINDS: ReadonlySet<string> = new Set(['situation', 'suivi']);

const isSlot = (e: Record<string, unknown>): boolean => isStr(e.from) && isStr(e.to) && isColorId(e.color);
const isPhenomenon = (e: Record<string, unknown>): boolean => isOneOf(e.id, PHENOMENA) && isColorId(e.color) && listOf(e.slots, isSlot);
const isDepartment = (e: Record<string, unknown>): boolean => isStr(e.code) && isStr(e.name) && isColorId(e.color) && listOf(e.phenomena, isPhenomenon);
const isCoast = (e: Record<string, unknown>): boolean => isStr(e.code) && isStr(e.departement) && isStr(e.name) && isColorId(e.color) && listOf(e.slots, isSlot);
const isColorCount = (e: Record<string, unknown>): boolean => (e.color === 2 || e.color === 3 || e.color === 4) && isNum(e.count);
const isPhenomenonCount = (e: Record<string, unknown>): boolean => isOneOf(e.id, PHENOMENA) && isNum(e.anyColor) && listOf(e.counts, isColorCount);
const isPeriod = (e: Record<string, unknown>): boolean => isOneOf(e.echeance, ECHEANCES) && isStr(e.begin) && isStr(e.end) && isColorId(e.maxColor)
  && isStrOrNull(e.comment) && listOf(e.departments, isDepartment) && isNum(e.greenDepartments) && listOf(e.coast, isCoast)
  && listOf(e.counts, isColorCount) && listOf(e.perPhenomenon, isPhenomenonCount);
const isParagraph = (e: Record<string, unknown>): boolean => isStr(e.heading) && isStringArray(e.text);
const isBulletinItem = (e: Record<string, unknown>): boolean => isOneOf(e.kind, KINDS) && (e.phenomenon === null || isOneOf(e.phenomenon, PHENOMENA))
  && isStr(e.hazard) && isOneOf(e.echeance, ECHEANCES) && isColorId(e.color) && listOf(e.paragraphs, isParagraph);
const isBulletin = (e: Record<string, unknown>): boolean => isOneOf(e.scope, SCOPES) && isStr(e.domainId) && isStr(e.domainName)
  && listOf(e.items, isBulletinItem);
const isDayCount = (e: Record<string, unknown>): boolean => isStr(e.date) && isNum(e.jaune) && isNum(e.orange) && isNum(e.rouge) && isNum(e.publications)
  && (e.partial === undefined || typeof e.partial === 'boolean');

export function isVigilanceResponse(v: unknown): v is VigilanceResponse {
  return isRecord(v) && isStrOrNull(v.updateTime) && isStrOrNull(v.textsUpdateTime) && listOf(v.periods, isPeriod) && listOf(v.bulletins, isBulletin)
    && isRecord(v.history) && listOf(v.history.days, isDayCount) && isStrOrNull(v.history.since) && isStrOrNull(v.readAt) && isStringArray(v.errors);
}

/** Ne rejette jamais : une lecture en échec porte `error` et garde les dernières données. */
export async function fetchVigilance(previous: VigilanceState | null, now: number = Date.now()): Promise<VigilanceState> {
  return { vigilance: await loadSlot(VIGILANCE_URL, VIGILANCE_TTL_MS, previous?.vigilance, now, isVigilanceResponse, 'de Météo-France') };
}

/** Fusion à l'écriture (S3) : une lecture en échec garde les données actuellement en mémoire. */
export function mergeVigilance(current: VigilanceState | null, incoming: VigilanceState): VigilanceState {
  return { vigilance: mergeSlot(current?.vigilance, incoming.vigilance) };
}

/** Panneau des sources : « Météo-France », daté par update_time de la carte (S1). */
export function vigilanceStatus(state: VigilanceState, now: number): EnvironmentStatus {
  return environmentSlotStatus(state.vigilance, 'vigilance', state.vigilance.data?.updateTime ?? null, now);
}

const RISK: Readonly<Record<VigilancePhenomenonId, MeteoRiskType>> = {
  1: 'wind', 2: 'rain-flood', 3: 'thunderstorm', 4: 'flood', 5: 'snow-ice', 6: 'heat', 7: 'cold', 8: 'avalanche', 9: 'wave-surge',
};
const LEVEL: Readonly<Record<2 | 3 | 4, MeteoAlert['level']>> = { 2: 'yellow', 3: 'orange', 4: 'red' };

/**
 * Adaptateur des consommateurs historiques (contrats, arbitrage 3) : un MeteoAlert par département en jaune ou plus de l'échéance,
 * niveau = couleur maximale, risques = phénomènes jaune et plus (du plus fort au plus faible), dates = validité de l'échéance.
 * Les domaines littoraux ne sont pas des départements : ils restent dans le panneau et sur la carte, pas dans ce compte.
 */
export function vigilanceToMeteoAlerts(v: VigilanceResponse | null, echeance: VigilanceEcheance = 'J'): MeteoAlert[] {
  const period = v ? vigilancePeriodOf(v, echeance) : null;
  if (!period) return [];
  return period.departments.flatMap((d): MeteoAlert[] => (d.color === 1 ? [] : [{
    department: d.name, departmentCode: d.code, level: LEVEL[d.color], risks: d.phenomena.map((p) => RISK[p.id]),
    startDate: new Date(period.begin), endDate: new Date(period.end),
  }]));
}

/** Bulletin d'une portée et d'un domaine (« national » / « FRA », « zonal » / « ZDF_SUD », « departemental » / « 66 »). */
export function bulletinOf(v: VigilanceResponse | null, scope: VigilanceBulletin['scope'], domainId: string): VigilanceBulletin | null {
  return v?.bulletins.find((b) => b.scope === scope && b.domainId === domainId) ?? null;
}
