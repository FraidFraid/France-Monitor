// src/services/sovereignty-gnss.ts : lecture client de la grille GNSS et de la météo spatiale (spec 2026-10-04 souveraineté § 3.1 ;
// contrats § 3.3 ; amendement 7, O15 à O17). Garde de forme exacte élément par élément (un champ en trop ou absent refuse la réponse,
// nommé par son chemin), lecture qui ne rejette jamais, fusion à l'écriture. Deux lignes du panneau des sources datées par leur
// donnée : « Grille GNSS » (dernière collecte complète, en retard après 40 min) et « NOAA SWPC » (heure des échelles, en retard
// après 3 h). Une partie jamais lue alors que la réponse est là est une erreur nommée, période « n.d. ».
import type { GnssResponse } from '../types/index.ts';
import {
  isBool, isCount, isCountOrNull, isDate, isDateOrNull, isDay, isDayOrNull, isNum, isNumOrNull, isOneOf, isStr, isStringList, list,
  isNamedBy, loadSovereigntySlot, mergeSlot, nullable, record, refine, shapeOf, sovereigntySlotStatus, value, type SourceSlot, type SovereigntyStatus,
} from './sovereignty-source.ts';

export const GNSS_URL = '/api/sovereignty/gnss';
/** Cache client : 8 min, sous la cadence de 10 min de la grille. */
export const GNSS_TTL_MS = 8 * 60_000;

export interface GnssState { gnss: SourceSlot<GnssResponse> }
export type GnssPart = 'adsb-gnss' | 'noaa';

const CELL_LEVELS: ReadonlySet<string> = new Set(['vert', 'jaune', 'orange', 'peu']);

const num = value(isNum);
const numOrNull = value(isNumOrNull);
const bool = value(isBool);
const count = value(isCount);
const date = value(isDate);
const dateOrNull = value(isDateOrNull);
const day = value(isDay);
const dayOrNull = value(isDayOrNull);
const str = value(isStr);

/** Maille de 0,5° : « peu » (moins de 5 aéronefs) n'a pas de part ; toute autre en a une. */
const cell = refine(record({
  lat: num, lon: num, good: count, degraded: count, unknown: count, pct: numOrNull, level: value((v) => isOneOf(v, CELL_LEVELS)), inFrance: bool,
}), (v) => (v.level === 'peu') === (v.pct === null), 'part nulle seulement pour « peu »');
const gnssDay = record({ date: day, jaune: count, orange: count, general: bool });
const scaleDay = record({
  date: day, observed: bool, r: numOrNull, s: numOrNull, g: numOrNull, rMinorProb: numOrNull, rMajorProb: numOrNull, sProb: numOrNull,
});
const kpPoint = record({ at: date, kp: num });
const alert = record({ productId: str, issuedAt: date, title: str, gScale: numOrNull });
/** Deux derniers jours UTC complets, veille d'abord ; null : jour non couvert. */
const previousDays = value((v) => Array.isArray(v) && v.length === 2 && v.every(isCountOrNull));

const GNSS_SHAPE = shapeOf<GnssResponse>(record({
  readAt: dateOrNull, windowStart: dateOrNull, reads: count, aircraft: count, cells: list(cell), cellsDay: dayOrNull, frenchCells: count,
  generalDegradation: bool, degraded: record({ rolling24h: count, previousUtcDays: previousDays }),
  days: record({ days: list(gnssDay), since: dayOrNull }),
  spaceWeather: record({
    readAt: dateOrNull, scalesAt: dateOrNull, today: nullable(scaleDay), forecast: list(scaleDay), kp: list(kpPoint), lastAlert: nullable(alert),
  }),
  errors: value(isStringList),
}));

/** Écarts à la forme de /api/sovereignty/gnss, nommés un par un ; liste vide : conforme. */
export function gnssResponseProblems(v: unknown): string[] {
  return GNSS_SHAPE.problems(v);
}

export function isGnssResponse(v: unknown): v is GnssResponse {
  return GNSS_SHAPE.is(v);
}

/** Ne rejette jamais : une lecture en échec porte `error` et garde les dernières données. */
export async function fetchGnss(previous: GnssState | null, now: number = Date.now()): Promise<GnssState> {
  return { gnss: await loadSovereigntySlot(GNSS_URL, GNSS_TTL_MS, previous?.gnss, now, GNSS_SHAPE, 'de la grille GNSS') };
}

/** Fusion à l'écriture (S3) : une lecture en échec garde les données actuellement en mémoire. */
export function mergeGnss(current: GnssState | null, incoming: GnssState): GnssState {
  return { gnss: mergeSlot(current?.gnss, incoming.gnss) };
}

const NOAA_PREFIX = 'NOAA SWPC';

/**
 * La même réponse ne garde que les erreurs d'une des deux lignes (note de collecte adsb.lol : grille ; « NOAA SWPC, … » : météo).
 * Sans réponse (panne de lecture entière : 502 nu, réseau, forme refusée), la panne vaut pour les deux lignes.
 */
function restrictedTo(slot: SourceSlot<GnssResponse>, keep: (error: string) => boolean): SourceSlot<GnssResponse> {
  if (slot.data === null) return slot;
  // Une panne de lecture qui ne nomme aucune des deux sources (« HTTP 502 », « source injoignable ») vaut pour les deux lignes.
  const bare = (e: string): boolean => !isNamedBy(e, NOAA_PREFIX) && !isNamedBy(e, 'Grille GNSS') && !isNamedBy(e, 'adsb.lol');
  const error = slot.error === null ? null : slot.error.split(' ; ').filter((e) => keep(e) || bare(e)).join(' ; ') || null;
  return { data: { ...slot.data, errors: slot.data.errors.filter(keep) }, error, fetchedAt: slot.fetchedAt };
}

/**
 * Panneau des sources : « Grille GNSS » (readAt, collecte complète) ou « NOAA SWPC » (scalesAt, heure des échelles). Chaque ligne ne
 * garde que ses erreurs ; une partie jamais lue alors que la réponse est là donne « error », période « n.d. » (sovereigntySlotStatus,
 * tâche A9). « Grille GNSS : référence en construction » et « adsb.lol : collecte en cours » sont des notes, jamais des pannes.
 */
export function gnssStatus(state: GnssState, part: GnssPart, now: number): SovereigntyStatus {
  const data = state.gnss.data;
  if (part === 'noaa') {
    return sovereigntySlotStatus(restrictedTo(state.gnss, (e) => isNamedBy(e, NOAA_PREFIX)), 'noaa', data?.spaceWeather.scalesAt ?? null, now);
  }
  return sovereigntySlotStatus(restrictedTo(state.gnss, (e) => !isNamedBy(e, NOAA_PREFIX)), 'adsb-gnss', data?.readAt ?? null, now);
}
