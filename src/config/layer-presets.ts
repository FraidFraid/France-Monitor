/**
 * layer-presets.ts — Vues prédéfinies de couches (chantier simplification UI, audit 2026-09).
 *
 * Remplace le choix « 35 cases à cocher réparties en 7 groupes » par 5 vues
 * nommées, sélectionnables en un clic depuis `LayerPanel`. L'arbre complet
 * des couches reste accessible derrière « Personnaliser les couches ».
 *
 * `layers` ne liste que des clés ENFANTS (celles qui ont une checkbox propre
 * dans `LayerPanel`, cf. `LAYER_DEFS`) — jamais une clé de groupe
 * (`newsGroup`, `energySystems`, `health`, `traffic`, `sovereignty`,
 * `outages`, `environmentGroup`). L'état des groupes est dérivé par
 * l'orchestrateur (`App.ts`, `syncTrafficGroupState()` / `getEffectiveLayers()`)
 * à partir de l'état de leurs enfants — pas la responsabilité de ce module.
 */

import type { MapLayers } from '../types/index.ts';
import type { IconName } from '../components/shared/icons.ts';

export type LayerPresetId = 'general' | 'energy' | 'security' | 'health' | 'environment';

export interface LayerPreset {
  id: LayerPresetId;
  label: string;
  icon: IconName;
  description: string;
  layers: ReadonlyArray<keyof MapLayers>;
}

/**
 * Toutes les clés ENFANTS exposées par `LayerPanel` (hors clés de groupe).
 * Sert de référentiel à `layersForPreset()` pour remettre à `false` tout ce
 * qu'une vue n'active pas explicitement. Tenue à jour avec `LAYER_DEFS`
 * (`src/components/LayerPanel.ts`) — un enfant qui y est ajouté doit aussi
 * apparaître ici pour être correctement désactivé par les autres vues.
 */
export const ALL_PRESETABLE_LAYER_KEYS: ReadonlyArray<keyof MapLayers> = [
  'news',
  'stability',
  'dromEnergy',
  'powerGrid',
  'nuclearFleet',
  'gasNetwork',
  'hydroBackbone',
  'oilNetwork',
  'windMonitor',
  'metroLoad',
  'health',
  'healthOscour',
  'healthApl',
  'hospitals',
  'trafficRoad',
  'trafficMaritime',
  'trafficAir',
  'trafficRail',
  'environmental',
  'weatherRadar',
  'fires',
  'dayNight',
  'military',
  'subseaCables',
  'cyber',
  'outagesElec',
  'outagesTelecom',
  'outagesInternet',
  'outagesCloud',
];

export const LAYER_PRESETS: ReadonlyArray<LayerPreset> = [
  {
    id: 'general',
    label: 'Vue générale',
    icon: 'compass',
    description: 'Actualités, réseau électrique et météo/crues — le socle par défaut.',
    layers: ['news', 'powerGrid', 'environmental'],
  },
  {
    id: 'energy',
    label: 'Énergie',
    icon: 'zap',
    description: 'Réseau électrique, nucléaire, gaz, pétrole, éolien, stress hydraulique et pannes élec.',
    layers: ['powerGrid', 'nuclearFleet', 'gasNetwork', 'oilNetwork', 'windMonitor', 'hydroBackbone', 'outagesElec'],
  },
  {
    id: 'security',
    label: 'Sécurité & défense',
    icon: 'shield',
    description: 'Actualités, défense, cyber, câbles sous-marins et pannes télécom/Internet.',
    layers: ['news', 'military', 'cyber', 'subseaCables', 'outagesTelecom', 'outagesInternet'],
  },
  {
    id: 'health',
    label: 'Santé',
    icon: 'stethoscope',
    description: 'Épidémiologie, urgences OSCOUR/SOS Médecins, déserts médicaux et hôpitaux.',
    layers: ['health', 'healthOscour', 'healthApl', 'hospitals'],
  },
  {
    id: 'environment',
    label: 'Environnement & transports',
    icon: 'leaf',
    description: 'Météo/crues, radar précipitations, feux de forêt, trafic routier et ferroviaire.',
    layers: ['environmental', 'weatherRadar', 'fires', 'trafficRoad', 'trafficRail'],
  },
];

export const DEFAULT_PRESET_ID: LayerPresetId = 'general';

/**
 * Calcule l'état de couches enfants correspondant à une vue : tout à `false`
 * sauf les couches de la vue, à `true`. Pure (aucun accès DOM/réseau) —
 * testable indépendamment de `LayerPanel`/`App`.
 */
export function layersForPreset(id: LayerPresetId): Partial<MapLayers> {
  const preset = LAYER_PRESETS.find((p) => p.id === id);
  const active = new Set<keyof MapLayers>(preset?.layers ?? []);
  const result: Partial<MapLayers> = {};
  for (const key of ALL_PRESETABLE_LAYER_KEYS) {
    result[key] = active.has(key);
  }
  return result;
}
