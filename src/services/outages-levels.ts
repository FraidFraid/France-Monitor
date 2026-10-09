// src/services/outages-levels.ts : module pur des panneaux Pannes réseau (spec 2026-10-08 panneaux pannes § 1, § 2) : sources et
// retards (S2), seuils partagés avec la situation « Perturbation télécom », niveaux des panneaux. Aucun accès réseau ni DOM.
import type { EcowattSignal, PowerOutagesResponse, TelecomOutagesResponse } from '../types/index.ts';
import { parisDayOf } from './environment-levels.ts';
import { fleetLevel } from './nuclear-fleet.ts';
import { parisHour } from './traffic-levels.ts';
import { LEVEL_RANK, type VigilanceLevel } from './vigilance.ts';

/** Sources des panneaux Pannes réseau (clé de retard et du panneau des sources). */
export type OutagesSource = 'arcep' | 'edf' | 'iip' | 'sei' | 'ioda' | 'radar' | 'cloud';

const MINUTE_MS = 60_000;

/** Retard (min) au-delà duquel la donnée d'une source est « en retard » ; ARCEP a sa règle propre (isArcepFileLate). */
export const OUTAGES_LATE_AFTER_MIN: Readonly<Record<OutagesSource, number>> = {
  arcep: 0, edf: 120, iip: 60, sei: 26 * 60, ioda: 60, radar: 60, cloud: 120,
};

/** Date absente ou illisible : en retard. */
export function isOutagesDataLate(source: OutagesSource, dataDate: string | null, now: number): boolean {
  if (dataDate === null) return true;
  const t = Date.parse(dataDate);
  if (!Number.isFinite(t)) return true;
  return t + OUTAGES_LATE_AFTER_MIN[source] * MINUTE_MS < now;
}

/** Jour de Paris précédent « AAAA-MM-JJ ». */
function previousDay(day: string): string {
  const t = Date.parse(`${day}T12:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Fichier ARCEP en retard : le fichier du jour (publié vers 11 h à Paris) manque encore après 15 h, ou le fichier servi est plus vieux
 * que la veille. Avant 15 h, le fichier de la veille est normal (spec § 1).
 */
export function isArcepFileLate(fileDay: string | null, now: number): boolean {
  if (fileDay === null) return true;
  const day = parisDayOf(now);
  if (fileDay === day) return false;
  if (fileDay === previousDay(day)) return parisHour(now) >= 15;
  return true;
}

/** Seuils de la situation « Perturbation télécom » (situation-engine.ts) et de la pastille Télécoms : une seule source. */
export const TELECOM_DISRUPTION_THRESHOLDS = {
  deptMedium: 20, deptHigh: 50, deptCritical: 100, nationalHigh: 300, nationalCritical: 600,
} as const;

/** Pastille Télécoms sur les pannes imprévues récentes ; null sans fichier lu. */
export function telecomLevel(r: Pick<TelecomOutagesResponse, 'summary' | 'byDept'>): VigilanceLevel | null {
  if (r.summary === null) return null;
  const t = TELECOM_DISRUPTION_THRESHOLDS;
  const top = Math.max(0, ...r.byDept.filter((d) => d.dept !== null).map((d) => d.recent));
  const national = r.summary.recent;
  if (top >= t.deptCritical || national >= t.nationalCritical) return 'rouge';
  if (top >= t.deptHigh || national >= t.nationalHigh) return 'orange';
  if (top >= t.deptMedium) return 'jaune';
  return 'vert';
}

/**
 * Fichier ARCEP à verser au score, aux situations, à l'indice de stabilité et au brief : null s'il est en retard (isArcepFileLate), car son
 * `summary.recent` se compte par rapport à sa publication et ne dit plus rien du moment. Même chemin « non évalué » que la source muette.
 */
export function telecomIfFresh<T extends Pick<TelecomOutagesResponse, 'file'>>(t: T | null, now: number): T | null {
  return t !== null && t.file !== null && isArcepFileLate(t.file.day, now) ? null : t;
}

/** MW de production perdus en arrêts imprévus en cours (gros chiffre Électricité). */
export function powerUnplannedMw(r: Pick<PowerOutagesResponse, 'unplanned'>): number {
  return Math.round(r.unplanned.reduce((sum, u) => sum + u.lostMw, 0));
}

const ECOWATT_LEVEL: Readonly<Record<EcowattSignal, VigilanceLevel>> = { green: 'vert', orange: 'orange', red: 'rouge' };

/** Pastille Électricité : paliers du parc nucléaire (fleetLevel) sur les arrêts imprévus, relevée par Écowatt s'il est plus grave. */
export function powerLevel(r: Pick<PowerOutagesResponse, 'unplanned'>, ecowatt: EcowattSignal | null): VigilanceLevel {
  const own = fleetLevel(powerUnplannedMw(r));
  const signal = ecowatt === null ? 'vert' : ECOWATT_LEVEL[ecowatt];
  return LEVEL_RANK[signal] > LEVEL_RANK[own] ? signal : own;
}
