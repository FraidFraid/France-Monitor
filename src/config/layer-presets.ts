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

/**
 * Chaque thème active TOUTES ses couches (décision utilisateur du 25/09/2026 : les vues courtes de
 * l'audit laissaient des couches du thème de côté). Les quatre thèmes couvrent à eux seuls toutes
 * les couches de `ALL_PRESETABLE_LAYER_KEYS` (vérifié par test) ; « Vue générale » prend une couche
 * phare par thème.
 */
export const LAYER_PRESETS: ReadonlyArray<LayerPreset> = [
  {
    id: 'general',
    label: 'Vue générale',
    icon: 'compass',
    description: 'Une couche phare par thème : actualités, réseau électrique, défense, santé, météo/crues.',
    layers: ['news', 'powerGrid', 'military', 'health', 'environmental'],
  },
  {
    id: 'energy',
    label: 'Énergie',
    icon: 'zap',
    description: 'Tout le thème énergie : réseau électrique, nucléaire, gaz, pétrole, éolien, hydraulique, DROM, charge métropolitaine et pannes élec.',
    layers: ['dromEnergy', 'powerGrid', 'nuclearFleet', 'gasNetwork', 'hydroBackbone', 'oilNetwork', 'windMonitor', 'metroLoad', 'outagesElec'],
  },
  {
    id: 'security',
    label: 'Sécurité & défense',
    icon: 'shield',
    description: 'Tout le thème sécurité & défense : actualités, indice de stabilité, défense, cyber, câbles sous-marins et pannes télécom/Internet/cloud.',
    layers: ['news', 'stability', 'military', 'cyber', 'subseaCables', 'outagesTelecom', 'outagesInternet', 'outagesCloud'],
  },
  {
    id: 'health',
    label: 'Santé',
    icon: 'stethoscope',
    description: 'Tout le thème santé : épidémiologie, urgences OSCOUR/SOS Médecins, déserts médicaux et hôpitaux.',
    layers: ['health', 'healthOscour', 'healthApl', 'hospitals'],
  },
  {
    id: 'environment',
    label: 'Environnement & transports',
    icon: 'leaf',
    description: 'Tout le thème environnement & transports : météo/crues, radar, feux, jour/nuit, trafics routier, ferroviaire, maritime et aérien.',
    layers: ['environmental', 'weatherRadar', 'fires', 'dayNight', 'trafficRoad', 'trafficMaritime', 'trafficAir', 'trafficRail'],
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

/** v2 (spec 2026-09-29 § 5) : couches d'une nouvelle visite — les événements et les vigilances. */
export function v2StartupLayers(): Partial<MapLayers> {
  return { events: true, environmental: true };
}

/**
 * Couches d'un thème. v2 : « Vue générale » revient aux vigilances seules (la couche Événements,
 * hors des vues, n'est pas touchée) ; les autres thèmes gardent toutes leurs couches (décision du
 * 25/09/2026). v1 : les vues ci-dessus.
 */
export function themeLayers(uiV2: boolean, id: LayerPresetId): Partial<MapLayers> {
  if (!uiV2 || id !== 'general') return layersForPreset(id);
  const off = Object.fromEntries(ALL_PRESETABLE_LAYER_KEYS.map((key) => [key, false])) as Partial<MapLayers>;
  return { ...off, environmental: true };
}

/**
 * Vrai si l'état de couches persisté (URL ou stockage) contient au moins une couche enfant active.
 * Un état « tout éteint » est traité comme un premier chargement. La couche Événements, hors des
 * vues, compte aussi : une carte réduite à elle seule se conserve au rechargement (spec 2026-09-29 § 5).
 */
export function hasPersistedLayers(persisted: Partial<MapLayers> | null): boolean {
  if (!persisted) return false;
  return Boolean(persisted.events) || ALL_PRESETABLE_LAYER_KEYS.some((key) => persisted[key]);
}
