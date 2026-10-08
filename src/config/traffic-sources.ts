// src/config/traffic-sources.ts : sources Trafics du panneau des sources hors Watchdog (spec 2026-10-03 trafics S1) : datées par la
// donnée, jamais par l'heure de lecture. Une seule liste pour App.ts (panneau des sources, note de situation, historique de qualité).
import type { DataSourceStatus, WatchdogSnapshot } from '../types/index.ts';
import { isTrafficDataLate, type TrafficSource } from '../services/traffic-levels.ts';
import { absoluteTime } from '../components/fiche/kit.ts';

/** Couches Trafics, un panneau chacune (spec 2026-10-03 trafics § 3). */
export type TrafficLayerKey = 'trafficRoad' | 'trafficAir' | 'trafficRail' | 'trafficMaritime';
export const TRAFFIC_LAYER_KEYS: readonly TrafficLayerKey[] = ['trafficRoad', 'trafficAir', 'trafficRail', 'trafficMaritime'];

/**
 * Ligne des positions de la carte (/api/traffic/air, 12 s), datée par les états OpenSky servis : distincte de « Trafic aérien »,
 * datée par l'aperçu du panneau, qu'elle ne remplace jamais.
 */
export const AIR_POSITIONS_SOURCE = 'Positions aériennes (carte)';

/** Clé de la source et nom dans le panneau des sources. */
export const TRAFFIC_STATUS_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['road-national', 'Trafic'], ['road-urban', 'TomTom agglomérations'], ['air-overview', 'Trafic aérien'], ['air-positions', AIR_POSITIONS_SOURCE],
  ['rail-overview', 'SNCF'], ['rail-situations', 'SIRI SX'], ['maritime-snapshot', 'AIS instantané'],
];

export const TRAFFIC_SOURCE_NAMES: readonly string[] = TRAFFIC_STATUS_SOURCES.map(([, name]) => name);

/** Lignes du panneau des sources lues par le service de chaque couche (toutes mises en erreur si le service ne se charge pas). */
export const TRAFFIC_LAYER_SOURCES: Readonly<Record<TrafficLayerKey, readonly string[]>> = {
  trafficRoad: ['Trafic', 'TomTom agglomérations'], trafficAir: ['Trafic aérien'], trafficRail: ['SNCF', 'SIRI SX'], trafficMaritime: ['AIS instantané'],
};

/** Lignes Trafics de la note de situation : statuts du panneau des sources (période comprise), identifiés « traffic:<source> ». */
export function trafficReportSources(statuses: readonly DataSourceStatus[]): WatchdogSnapshot[] {
  return TRAFFIC_STATUS_SOURCES.flatMap(([key, name]) => {
    const status = statuses.find((s) => s.name === name);
    return status ? [{ sourceId: `traffic:${key}`, status }] : [];
  });
}

export type DatedSourceStatus = Pick<DataSourceStatus, 'status' | 'lastUpdate' | 'error' | 'period'>;

/** Date de la donnée (S1) et « (en retard) » selon le rythme de la source (S2) ; date absente : « n.d. », en retard. */
function dated(ms: number | null, source: TrafficSource, now: number): { lastUpdate: Date | null; period: string; late: boolean } {
  const late = isTrafficDataLate(source, ms === null ? null : new Date(ms).toISOString(), now);
  return {
    lastUpdate: ms === null ? null : new Date(ms),
    period: ms === null ? 'n.d.' : `${absoluteTime(ms, now, 'fr')}${late ? ' (en retard)' : ''}`,
    late,
  };
}

/**
 * Ligne « Positions aériennes (carte) » : heure des états OpenSky de la dernière lecture réussie (jamais l'heure de lecture) ;
 * un échec garde cette date et passe la ligne « stale » ; sans lecture réussie, « error » après un échec, « loading » avant.
 */
export function airPositionsStatus(read: { at: number | null; errors: readonly string[] } | null, failure: string | null, now: number): DatedSourceStatus {
  if (read === null) return { status: failure !== null ? 'error' : 'loading', lastUpdate: null, error: failure ?? undefined, period: undefined };
  const d = dated(read.at, 'opensky', now);
  const problems = [...(failure !== null ? [failure] : []), ...read.errors];
  return {
    status: problems.length > 0 || d.late ? 'stale' : 'ok', lastUpdate: d.lastUpdate, period: d.period,
    error: problems.length > 0 ? problems.join(' ; ') : undefined,
  };
}

/**
 * Ligne « AIS maritime » (WebSocket du relais) : datée par le dernier message reçu ; connecté ne veut jamais dire à jour (dernier
 * message trop ancien : « stale », « (en retard) ») ; relais déconnecté : « error », la date du dernier message reste affichée.
 */
export function aisLiveStatus(ais: { connected: boolean; shipCount: number; lastMessageAt: number | null }, now: number): DatedSourceStatus {
  if (ais.lastMessageAt === null) {
    return { status: ais.connected ? 'loading' : 'error', lastUpdate: null, period: undefined, error: ais.connected ? undefined : 'relais déconnecté' };
  }
  const d = dated(ais.lastMessageAt, 'ais', now);
  if (!ais.connected) return { status: 'error', lastUpdate: d.lastUpdate, period: d.period, error: 'relais déconnecté' };
  return {
    status: d.late ? 'stale' : ais.shipCount > 0 ? 'ok' : 'loading', lastUpdate: d.lastUpdate, period: d.period,
    error: d.late ? 'aucun message AIS récent' : undefined,
  };
}
