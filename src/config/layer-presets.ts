/**
 * layer-presets.ts — Vues prédéfinies de couches (chantier simplification UI, audit 2026-09).
 *
 * Remplace le choix « 35 cases à cocher réparties en 7 groupes » par 6 vues
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

export type LayerPresetId = 'general' | 'energy' | 'security' | 'health' | 'environment' | 'transport';

export interface LayerPreset {
  id: LayerPresetId;
  label: string;
  icon: IconName;
  description: string;
  /** Couches enfants cochées par la vue : le noyau du thème, pas tout le thème (décision du 12/10/2026). */
  layers: ReadonlyArray<keyof MapLayers>;
  /** v2 : la vue coche ou décoche aussi « Événements en cours » (couche absente de la v1). */
  events: boolean;
}

/**
 * Toutes les clés ENFANTS exposées par `LayerPanel` (hors clés de groupe et hors `events`, propre à la
 * v2). Sert de référentiel à `layersForPreset()` pour remettre à `false` tout ce qu'une vue n'active pas
 * explicitement. Tenue à jour avec `LAYER_DEFS` (`src/components/LayerPanel.ts`) — un enfant qui y est
 * ajouté doit aussi apparaître ici ET dans `THEME_LAYERS`.
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
  'floods',
  'weatherRadar',
  'fires',
  'drought',
  'airQuality',
  'earthquakes',
  'military',
  'subseaCables',
  'cyber',
  'outagesElec',
  'outagesTelecom',
  'outagesInternet',
  'outagesCloud',
];

/**
 * Appartenance de chaque couche à un thème : chaque couche de `ALL_PRESETABLE_LAYER_KEYS` est dans
 * exactement un thème (vérifié par test). La vue d'un thème n'en coche qu'un noyau ; les autres restent
 * cochables à la main dans « Personnaliser les couches ».
 */
export const THEME_LAYERS: Readonly<Record<Exclude<LayerPresetId, 'general'>, ReadonlyArray<keyof MapLayers>>> = {
  energy: ['powerGrid', 'nuclearFleet', 'gasNetwork', 'oilNetwork', 'outagesElec', 'hydroBackbone', 'windMonitor', 'dromEnergy', 'metroLoad'],
  security: ['military', 'cyber', 'outagesTelecom', 'outagesInternet', 'outagesCloud', 'subseaCables', 'news', 'stability'],
  health: ['health', 'healthOscour', 'hospitals', 'healthApl'],
  environment: ['environmental', 'floods', 'weatherRadar', 'fires', 'airQuality', 'drought', 'earthquakes'],
  transport: ['trafficRoad', 'trafficRail', 'trafficMaritime', 'trafficAir'],
};

/**
 * Vues (décision du 12/10/2026, revient sur celle du 25/09) : chaque thème coche son noyau essentiel ;
 * « Vue générale » ne coche que des couches vides quand tout va bien (signaux qui ne s'allument qu'en
 * cas de problème), jamais une couche d'infrastructure toujours affichée.
 */
export const LAYER_PRESETS: ReadonlyArray<LayerPreset> = [
  {
    id: 'general',
    label: 'Vue générale',
    icon: 'compass',
    description: 'Ce qui se passe en France : événements en cours, vigilance météo, crues, feux de forêt et pannes Internet.',
    layers: ['environmental', 'floods', 'fires', 'outagesInternet'],
    events: true,
  },
  {
    id: 'energy',
    label: 'Énergie',
    icon: 'zap',
    description: 'L’essentiel de l’énergie : réseau électrique, parc nucléaire, gaz, pétrole et pannes d’électricité.',
    layers: ['powerGrid', 'nuclearFleet', 'gasNetwork', 'oilNetwork', 'outagesElec'],
    events: false,
  },
  {
    id: 'security',
    label: 'Sécurité & défense',
    icon: 'shield',
    description: 'L’essentiel de la sécurité et de la défense : événements en cours, défense, vigilance cyber, pannes télécoms et Internet.',
    layers: ['military', 'cyber', 'outagesTelecom', 'outagesInternet'],
    events: true,
  },
  {
    id: 'health',
    label: 'Santé',
    icon: 'stethoscope',
    description: 'L’essentiel de la santé : veille sanitaire, urgences et SOS Médecins, hôpitaux.',
    layers: ['health', 'healthOscour', 'hospitals'],
    events: false,
  },
  {
    id: 'environment',
    label: 'Environnement',
    icon: 'leaf',
    description: 'L’essentiel de l’environnement : vigilance météo, crues, radar météo, feux de forêt et qualité de l’air.',
    layers: ['environmental', 'floods', 'weatherRadar', 'fires', 'airQuality'],
    events: false,
  },
  {
    id: 'transport',
    label: 'Transports',
    icon: 'train-front',
    description: 'Les transports : trafics routier, ferroviaire, maritime et aérien.',
    layers: ['trafficRoad', 'trafficRail', 'trafficMaritime', 'trafficAir'],
    events: false,
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

/** v2 (spec 2026-09-29 § 5) : couches d'une nouvelle visite, celles de « Vue générale » (thème de départ). */
export function v2StartupLayers(): Partial<MapLayers> {
  return Object.fromEntries(Object.entries(themeLayers(true, 'general')).filter(([, on]) => on)) as Partial<MapLayers>;
}

/** Couches d'un thème : la vue, plus « Événements en cours » en v2 (la v1 n'a pas cette couche). */
export function themeLayers(uiV2: boolean, id: LayerPresetId): Partial<MapLayers> {
  const layers = layersForPreset(id);
  if (!uiV2) return layers;
  return { ...layers, events: LAYER_PRESETS.find((p) => p.id === id)?.events ?? false };
}

/**
 * Migration de l'état de couches mémorisé (spec 2026-10-04 environnement § 2.2 et § 2.5 ; amendement 9) : la couche
 * `environmental` (« Météo / crues ») a été scindée ; un état ancien sans clé `floods` reçoit `floods = environmental`, pour que
 * les tronçons Vigicrues restent visibles. La couche Jour / Nuit est retirée : sa clé `dayNight` est supprimée. Pure.
 */
export function migrateStoredLayers(parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed };
  if (!('floods' in out) && typeof out.environmental === 'boolean') out.floods = out.environmental;
  delete out.dayNight;
  return out;
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
