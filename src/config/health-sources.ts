// src/config/health-sources.ts : sources santé du panneau des sources (spec 2026-10-03 S1). Hors Watchdog : datées par la
// donnée (semaine, millésime), jamais par l'heure de lecture ni passées « en cache figé » au bout de 10 min. Une seule liste
// pour App.ts (panneau des sources, note de situation, historique de qualité) et le tableau de qualité des sources.
import type { DataSourceStatus, WatchdogSnapshot } from '../types/index.ts';
import type { HealthSurveillanceKey } from '../services/health-surveillance.ts';

/** Veille sanitaire : source et nom dans le panneau des sources. */
export const HEALTH_STATUS_SOURCES: ReadonlyArray<readonly [HealthSurveillanceKey, string]> = [
  ['syndromic', 'Santé publique France'], ['alerts', 'Odissé alertes'], ['sentinelles', 'Sentinelles'], ['wastewater', 'SUM’eau'],
  ['international', 'OMS / ECDC'], ['ministry', 'DGS-Urgent (PEPS)'], ['drugs', 'ANSM Médicaments'], ['recalls', 'RappelConso'],
];

/** Offre de soins (fichiers annuels) : source et nom dans le panneau des sources. */
export const HEALTH_OFFER_SOURCES: ReadonlyArray<readonly ['apl' | 'hospitals', string]> = [['apl', 'DREES APL'], ['hospitals', 'DREES SAE / FINESS']];

/** Sources des quatre entrées du niveau national de santé (fiche thème Santé de la v2, spec 2026-10-03 § 3.5). */
export const HEALTH_NATIONAL_KEYS: readonly HealthSurveillanceKey[] = ['syndromic', 'alerts', 'sentinelles', 'wastewater'];

/** Les dix sources santé, dans l'ordre du panneau. */
export const HEALTH_SOURCE_NAMES: readonly string[] = [...HEALTH_STATUS_SOURCES, ...HEALTH_OFFER_SOURCES].map(([, name]) => name);

/** Lignes santé de la note de situation : statuts du panneau des sources (période comprise), identifiés « health:<source> ». */
export function healthReportSources(statuses: readonly DataSourceStatus[]): WatchdogSnapshot[] {
  return [...HEALTH_STATUS_SOURCES, ...HEALTH_OFFER_SOURCES].flatMap(([key, name]) => {
    const status = statuses.find((s) => s.name === name);
    return status ? [{ sourceId: `health:${key}`, status }] : [];
  });
}
