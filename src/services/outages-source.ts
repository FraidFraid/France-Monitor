// src/services/outages-source.ts : statut d'une source des panneaux Pannes réseau dans le panneau des sources (spec 2026-10-08 § 1, S1
// à S3) : date de la donnée, jamais l'heure de lecture ; « stale » en retard ou quand une partie a échoué ; « error » sans donnée.
import type { DataSourceStatus } from '../types/index.ts';
import { absoluteTime } from '../components/fiche/kit.ts';
import { isOutagesDataLate, type OutagesSource } from './outages-levels.ts';
import { dataMs, type SourceSlot } from './traffic-source.ts';

export type OutagesStatus = Pick<DataSourceStatus, 'status' | 'lastUpdate' | 'error' | 'period'>;

/**
 * Corps commun des lignes du panneau des sources : `late` est décidé par l'appelant (règle de la source), `withDate` force la date
 * devant l'heure (fichier ARCEP publié la veille).
 */
export function outagesStatusOf<T extends { errors: string[] }>(
  slot: SourceSlot<T>, dataDate: string | null, late: boolean, now: number, withDate = false,
): OutagesStatus {
  if (slot.data === null) {
    return { status: slot.error !== null ? 'error' : 'loading', lastUpdate: null, error: slot.error ?? undefined, period: undefined };
  }
  const errors = [...(slot.error !== null ? [slot.error] : []), ...slot.data.errors];
  const error = errors.length > 0 ? errors.join(' ; ') : undefined;
  const ms = dataMs(dataDate);
  if (ms === null) return { status: 'error', lastUpdate: null, error: error ?? 'source jamais lue', period: 'n.d.' };
  return {
    status: errors.length > 0 || late ? 'stale' : 'ok', lastUpdate: new Date(ms), error,
    period: `${absoluteTime(ms, now, 'fr', { withDate })}${late ? ' (en retard)' : ''}`,
  };
}

/**
 * `dataDate` : date de la donnée, affichée. `lateDate` : date sur laquelle le retard se mesure quand elle diffère (EDF : dernière
 * lecture réussie, R20) ; par défaut `dataDate`. Jamais pour ARCEP (sa règle est isArcepFileLate, R30).
 */
export function outagesSlotStatus<T extends { errors: string[] }>(
  slot: SourceSlot<T>, source: OutagesSource, dataDate: string | null, now: number, lateDate: string | null = dataDate,
): OutagesStatus {
  return outagesStatusOf(slot, dataDate, isOutagesDataLate(source, lateDate, now), now);
}
