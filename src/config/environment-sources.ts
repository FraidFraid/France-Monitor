// src/config/environment-sources.ts : couches et sources Environnement du panneau des sources, hors Watchdog (spec 2026-10-04
// environnement S1 ; contrats § 3.6) : datées par la donnée, jamais par l'heure de lecture. Une seule liste pour App.ts (panneau des
// sources, note de situation, historique de qualité, relèves).
import type { DataSourceStatus, WatchdogSnapshot } from '../types/index.ts';

/** Couches Environnement, un panneau chacune (phase B ajoute 'drought' | 'airQuality' | 'earthquakes'). */
export type EnvironmentLayerKey = 'environmental' | 'floods' | 'weatherRadar' | 'fires';
/** Ordre du tiroir et des panneaux. */
export const ENVIRONMENT_LAYER_KEYS: readonly EnvironmentLayerKey[] = ['environmental', 'floods', 'weatherRadar', 'fires'];

/** Vrai si une couche Environnement est active (dérive le maître `environmentGroup`). */
export function hasActiveEnvironment(layers: Partial<Record<EnvironmentLayerKey, boolean>>): boolean {
  return ENVIRONMENT_LAYER_KEYS.some((key) => layers[key] === true);
}

/** Clé de la source et nom dans le panneau des sources (hors Watchdog, datés par la donnée). */
export const ENVIRONMENT_STATUS_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['vigilance', 'Météo-France'], ['floods', 'Vigicrues'], ['radar', 'Radar Météo-France'], ['firms', 'NASA FIRMS'], ['mdf', 'Météo des forêts'],
];

export const ENVIRONMENT_SOURCE_NAMES: readonly string[] = ENVIRONMENT_STATUS_SOURCES.map(([, name]) => name);

/** Lignes du panneau des sources lues par le service de chaque couche (toutes mises en erreur si le service ne se charge pas). */
export const ENVIRONMENT_LAYER_SOURCES: Readonly<Record<EnvironmentLayerKey, readonly string[]>> = {
  environmental: ['Météo-France'], floods: ['Vigicrues'], weatherRadar: ['Radar Météo-France'], fires: ['NASA FIRMS', 'Météo des forêts'],
};

/** Lignes Environnement de la note de situation : statuts du panneau des sources (période comprise), identifiés « environment:<clé> ». */
export function environmentReportSources(statuses: readonly DataSourceStatus[]): WatchdogSnapshot[] {
  return ENVIRONMENT_STATUS_SOURCES.flatMap(([key, name]) => {
    const status = statuses.find((s) => s.name === name);
    return status ? [{ sourceId: `environment:${key}`, status }] : [];
  });
}

/** Relève (ms) : vigilance 5 min, crues 10 min, radar 5 min, feux 15 min (cadences des collectes du serveur). */
export const ENVIRONMENT_POLL_MS: Readonly<Record<EnvironmentLayerKey, number>> = {
  environmental: 5 * 60_000, floods: 10 * 60_000, weatherRadar: 5 * 60_000, fires: 15 * 60_000,
};

/** Lues au démarrage et relevées sans arrêt (score, situations) ; le radar : couche active ou panneau ouvert seulement. */
export const ENVIRONMENT_ALWAYS_POLLED: ReadonlySet<EnvironmentLayerKey> = new Set<EnvironmentLayerKey>(['environmental', 'floods', 'fires']);
