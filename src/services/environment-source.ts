// src/services/environment-source.ts : socle des services clients Environnement (spec 2026-10-04 environnement § 1, S1 à S3 ;
// contrats § 3.2). Réutilise sans copie la lecture stricte des Trafics (cache par URL sous la relève d'App.ts, jamais de rejet,
// fusion à l'écriture) et n'ajoute que le statut du panneau des sources lié aux retards de l'environnement (tableau S2).
import type { DataSourceStatus, OfficialColorId } from '../types/index.ts';
import { absoluteTime } from '../components/fiche/kit.ts';
import { forestDangerSeason, isEnvironmentDataLate, type EnvironmentSource } from './environment-levels.ts';
import { dataMs, isNum, type SourceSlot } from './traffic-source.ts';

export {
  dataMs, emptySlot, isBool, isNum, isNumOrNull, isPoint, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, type SourceSlot,
} from './traffic-source.ts';

export type EnvironmentStatus = Pick<DataSourceStatus, 'status' | 'lastUpdate' | 'error' | 'period'>;

const PARIS = 'Europe/Paris';

/**
 * Notes d'avancement du serveur : ce ne sont pas des pannes (la source se remplit), elles ne dégradent pas le statut.
 * Phrases exactes : api/_lib/vigicrues.js (HUBEAU_PENDING_ERROR) et api/_lib/vigilance-archive.js (CONSTITUTION_ERROR).
 */
export const PROGRESS_NOTES: readonly string[] = [
  "Hub'Eau : lecture en cours, hauteurs à la prochaine relève",
  'historique de la vigilance en cours de constitution',
];
/** Fin de « <libellé> : relevé précédent servi (lecture en cours) » (api/_lib/vigicrues.js) ; « (lecture en échec) » reste une panne. */
const PROGRESS_SUFFIX = ' : relevé précédent servi (lecture en cours)';

/** Vrai pour une note d'avancement du serveur (jamais pour « lecture en échec » ni une autre erreur). */
export function isProgressNote(text: string): boolean {
  return PROGRESS_NOTES.includes(text) || text.endsWith(PROGRESS_SUFFIX) || text === PROGRESS_SUFFIX.slice(3);
}

/** Début des erreurs de la météo des forêts nommées par le serveur (api/_lib/forest-danger.js : « Météo des forêts : … »). */
export const MDF_ERROR_PREFIX = 'Météo des forêts';

/**
 * Panneau des sources (S1, S2) : comme trafficSlotStatus, avec isEnvironmentDataLate ; date de la donnée, jamais l'heure de lecture ;
 * « stale » en retard ou quand une partie a échoué (messages réunis) ; « error » sans donnée ; « loading » avant la première lecture.
 * 'mdf' hors saison : statut 'ok', période « hors saison, dernière publication le 03/10 », jamais « (en retard) ».
 */
export function environmentSlotStatus<T extends { errors: string[] }>(
  slot: SourceSlot<T>, source: EnvironmentSource, dataDate: string | null, now: number,
): EnvironmentStatus {
  if (slot.data === null) {
    return { status: slot.error !== null ? 'error' : 'loading', lastUpdate: null, error: slot.error ?? undefined, period: undefined };
  }
  const ms = dataMs(dataDate);
  const all = [...(slot.error !== null ? [slot.error] : []), ...slot.data.errors];
  const errors = all.filter((e) => !isProgressNote(e));
  const notes = all.filter(isProgressNote);
  const withNotes = (period: string): string => (notes.length > 0 ? `${period} · ${notes.join(' ; ')}` : period);
  const error = errors.length > 0 ? errors.join(' ; ') : undefined;
  const lastUpdate = ms === null ? null : new Date(ms);
  if (source === 'mdf' && forestDangerSeason(dataDate, now) === 'hors-saison') {
    const day = ms === null ? 'n.d.' : new Date(ms).toLocaleDateString('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit' });
    return { status: errors.length > 0 ? 'stale' : 'ok', lastUpdate, error, period: withNotes(`hors saison, dernière publication le ${day}`) };
  }
  const late = isEnvironmentDataLate(source, dataDate, now);
  return {
    status: errors.length > 0 || late ? 'stale' : 'ok', lastUpdate, error,
    period: withNotes(ms === null ? 'n.d.' : `${absoluteTime(ms, now, 'fr')}${late ? ' (en retard)' : ''}`),
  };
}

/** Valeur d'une liste fermée. */
export function isOneOf<T extends string | number>(v: unknown, allowed: ReadonlySet<T>): v is T {
  return (typeof v === 'string' || typeof v === 'number') && allowed.has(v as T);
}

const COLOR_IDS: ReadonlySet<OfficialColorId> = new Set<OfficialColorId>([1, 2, 3, 4]);
/** Couleur officielle 1 à 4 (Météo-France, NivInfViCr de Vigicrues). */
export const isColorId = (v: unknown): v is OfficialColorId => isOneOf(v, COLOR_IDS);

/** Chemin MultiLineString [lng, lat] : lignes d'au moins deux points (liste vide acceptée : tronçon publié sans tracé). */
export const isMultiPath = (v: unknown): boolean => Array.isArray(v)
  && v.every((line: unknown) => Array.isArray(line) && line.length >= 2
    && line.every((p: unknown) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1])));
