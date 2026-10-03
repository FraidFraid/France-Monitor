// src/config/traffic-sources.ts : sources Trafics du panneau des sources hors Watchdog (spec 2026-10-03 trafics S1) : datées par la
// donnée, jamais par l'heure de lecture. Une seule liste pour App.ts (panneau des sources, note de situation, historique de qualité).
import type { DataSourceStatus, WatchdogSnapshot } from '../types/index.ts';

/** Clé de la source et nom dans le panneau des sources. « Trafic aérien » reste au Watchdog (positions de la carte). */
export const TRAFFIC_STATUS_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['road-national', 'Trafic'], ['road-urban', 'TomTom agglomérations'], ['rail-overview', 'SNCF'], ['rail-situations', 'SIRI SX'],
  ['maritime-snapshot', 'AIS instantané'],
];

export const TRAFFIC_SOURCE_NAMES: readonly string[] = TRAFFIC_STATUS_SOURCES.map(([, name]) => name);

/** Lignes Trafics de la note de situation : statuts du panneau des sources (période comprise), identifiés « traffic:<source> ». */
export function trafficReportSources(statuses: readonly DataSourceStatus[]): WatchdogSnapshot[] {
  return TRAFFIC_STATUS_SOURCES.flatMap(([key, name]) => {
    const status = statuses.find((s) => s.name === name);
    return status ? [{ sourceId: `traffic:${key}`, status }] : [];
  });
}
