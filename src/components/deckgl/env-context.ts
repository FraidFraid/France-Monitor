// src/components/deckgl/env-context.ts : carte de l'onglet Environnement, « l'anormal d'abord » (20/10/2026). Pur.
// Même grammaire que les cartes Énergie et Sécurité : sans pastille allumée ou survolée, la carte ne montre que ce qui demande
// attention (vigilances, tronçons en crue, stations en hausse, foyers confirmés, séismes notables en France, catastrophes sur le
// territoire, sites exposés) ; le contexte (radar, remplissages départementaux, détections isolées, monde, webcams, tous les sites
// Seveso) apparaît quand sa pastille est survolée ou allumée. Le calque reste affiché par sa couche : seul son filtre change.
import type { FilterSpecification } from 'maplibre-gl';
import {
  LYR_AIR_FILL, LYR_AIR_LINE, LYR_DISASTERS, LYR_DISASTER_LABEL, LYR_DISASTER_PULSE, LYR_DROUGHT_FILL, LYR_DROUGHT_LINE, LYR_FIRES_ABROAD,
  LYR_FIRES_POINTS, LYR_FLOOD_STATIONS, LYR_FOREST_DANGER_FILL, LYR_FOREST_DANGER_LINE, LYR_QUAKES, LYR_QUAKE_LABEL, LYR_QUAKE_PULSE,
  LYR_TIDE_GAUGES, LYR_WEBCAMS, LYR_WEBCAM_CLUSTER, LYR_WEBCAM_CLUSTER_COUNT,
} from './constants.ts';
import { LYR_POLLEN_FILL, LYR_POLLEN_LINE } from './pollen-map.ts';

/** Filtre qui ne garde rien : calque de contexte masqué sans toucher à sa visibilité (gérée par sa couche). */
export const NOTHING: FilterSpecification = ['all', false];

/** Règle d'un calque : pastille qui révèle tout ; sans elle, `keep` (filtre de l'anormal) ou rien. */
export interface EnvContextRule { key: string; keep: FilterSpecification | null }

export const ENV_CONTEXT_RULES: Readonly<Record<string, EnvContextRule>> = {
  [LYR_FLOOD_STATIONS]: { key: 'floods', keep: ['==', ['get', 'rising'], true] },
  [LYR_TIDE_GAUGES]: { key: 'environmental', keep: ['==', ['get', 'alert'], true] },
  [LYR_FIRES_POINTS]: { key: 'fires', keep: ['==', ['get', 'glow'], true] },
  [LYR_FIRES_ABROAD]: { key: 'fires', keep: null },
  [LYR_FOREST_DANGER_FILL]: { key: 'fires', keep: null },
  [LYR_FOREST_DANGER_LINE]: { key: 'fires', keep: null },
  [LYR_QUAKES]: { key: 'earthquakes', keep: ['==', ['get', 'notable'], true] },
  [LYR_QUAKE_LABEL]: { key: 'earthquakes', keep: ['==', ['get', 'notable'], true] },
  [LYR_QUAKE_PULSE]: { key: 'earthquakes', keep: ['==', ['get', 'notable'], true] },
  [LYR_DISASTERS]: { key: 'disasters', keep: ['==', ['get', 'french'], true] },
  [LYR_DISASTER_LABEL]: { key: 'disasters', keep: ['==', ['get', 'french'], true] },
  [LYR_DISASTER_PULSE]: { key: 'disasters', keep: ['==', ['get', 'french'], true] },
  [LYR_AIR_FILL]: { key: 'airQuality', keep: null },
  [LYR_AIR_LINE]: { key: 'airQuality', keep: null },
  [LYR_DROUGHT_FILL]: { key: 'drought', keep: null },
  [LYR_DROUGHT_LINE]: { key: 'drought', keep: null },
  [LYR_POLLEN_FILL]: { key: 'pollens', keep: null },
  [LYR_POLLEN_LINE]: { key: 'pollens', keep: null },
  [LYR_WEBCAMS]: { key: 'webcams', keep: null },
  [LYR_WEBCAM_CLUSTER]: { key: 'webcams', keep: null },
  [LYR_WEBCAM_CLUSTER_COUNT]: { key: 'webcams', keep: null },
};

/** Pastilles dont le contexte n'est pas un filtre de calque : image radar (visibilité) et sites Seveso (données). */
export const RADAR_CONTEXT_KEY = 'weatherRadar';
export const SEVESO_CONTEXT_KEY = 'seveso';

/**
 * Filtre d'un calque : mode « anormal d'abord » éteint ou pastille révélée → filtre d'origine ; sinon le filtre de l'anormal combiné
 * à celui d'origine, ou rien.
 */
export function envContextFilter(layerId: string, base: FilterSpecification | null, active: boolean, revealed: ReadonlySet<string>): FilterSpecification | null {
  const rule = ENV_CONTEXT_RULES[layerId];
  if (!rule || !active || revealed.has(rule.key)) return base;
  if (rule.keep === null) return NOTHING;
  return base ? ['all', base, rule.keep] as FilterSpecification : rule.keep;
}

/** Contexte révélé pour une pastille sans règle de filtre (radar, Seveso). */
export function envContextRevealed(key: string, active: boolean, revealed: ReadonlySet<string>): boolean {
  return !active || revealed.has(key);
}
