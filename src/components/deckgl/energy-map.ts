// src/components/deckgl/energy-map.ts
/**
 * energy-map.ts : partie pure de la carte de l'énergie (spec 2026-10-15). Chaque couche dépose ses objets en
 * entrées {id, état, filière} ; d'ici sortent les pictos d'alerte, les filtres de masquage par état et le
 * modèle de la légende « Lire la carte ».
 */
import type maplibregl from 'maplibre-gl';
import type { IconName } from '../shared/icons.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import {
  ENERGY_SECTOR_ICON, ENERGY_STATE_HEX, ENERGY_STATE_RANK, ENERGY_STATES, isEnergyAlert,
  type EnergySector, type EnergyState,
} from '../../services/energy-state.ts';

export type EnergyLayerKey =
  | 'powerGrid' | 'nuclearFleet' | 'gasNetwork' | 'oilNetwork' | 'outagesElec'
  | 'hydroBackbone' | 'windMonitor' | 'dromEnergy' | 'metroLoad';

export const ENERGY_LAYER_KEYS: readonly EnergyLayerKey[] = [
  'powerGrid', 'nuclearFleet', 'gasNetwork', 'oilNetwork', 'outagesElec', 'hydroBackbone', 'windMonitor', 'dromEnergy', 'metroLoad',
];

export interface EnergyEntry {
  id: string;
  name: string;
  state: EnergyState;
  sector: EnergySector;
  coordinates: [number, number];
}

export interface EnergyFlowCount {
  exports: number;
  imports: number;
}

const STATE_SET = new Set<string>(ENERGY_STATES);

function isEnergyState(value: unknown): value is EnergyState {
  return typeof value === 'string' && STATE_SET.has(value);
}

/** Entrées d'une couche à partir de ses objets GeoJSON (propriétés `energyState`, `id`, `name`). */
export function energyEntriesFrom(features: readonly GeoJSON.Feature[], sector: EnergySector, idPrefix: string): EnergyEntry[] {
  const out: EnergyEntry[] = [];
  features.forEach((f, i) => {
    if (f.geometry.type !== 'Point') return;
    const [lon, lat] = f.geometry.coordinates;
    if (typeof lon !== 'number' || typeof lat !== 'number') return;
    const p = f.properties ?? {};
    const rawId = p.id;
    out.push({
      id: typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : `${idPrefix}-${i}`,
      name: typeof p.name === 'string' ? p.name : '',
      state: isEnergyState(p.energyState) ? p.energyState : 'nonSuivi',
      sector,
      coordinates: [lon, lat],
    });
  });
  return out;
}

export function energyIconImage(name: IconName): string {
  return `energy-icon-${name}`;
}

export const ENERGY_ICON_NAMES: readonly IconName[] = [...new Set(Object.values(ENERGY_SECTOR_ICON))];

export const ENERGY_SHAPE_SQUARE = 'energy-square';
export const ENERGY_SHAPE_DIAMOND = 'energy-diamond';

/** Forme blanche (teintée en SDF par `icon-color`) : carré pour le gaz, losange pour l'hydraulique. */
export function shapeIconSvg(shape: 'square' | 'diamond', size: number): string {
  const m = Math.round(size * 0.12);
  const body = shape === 'square'
    ? `<rect x="${m}" y="${m}" width="${size - 2 * m}" height="${size - 2 * m}" fill="white"/>`
    : `<polygon points="${size / 2},${m} ${size - m},${size / 2} ${size / 2},${size - m} ${m},${size / 2}" fill="white"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

/** Pictos des objets à l'arrêt ou sous tension, triés pour que le plus grave soit dessiné en dernier. */
export function energyAlertFeatures(entries: readonly EnergyEntry[]): GeoJSON.FeatureCollection {
  const alerts = entries.filter((x) => isEnergyAlert(x.state))
    .sort((a, b) => ENERGY_STATE_RANK[a.state] - ENERGY_STATE_RANK[b.state]);
  return {
    type: 'FeatureCollection',
    features: alerts.map((x) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: x.coordinates },
      properties: {
        id: x.id, name: x.name, energyState: x.state, color: ENERGY_STATE_HEX[x.state],
        icon: energyIconImage(ENERGY_SECTOR_ICON[x.sector]),
      },
    })),
  };
}

/** Filtre de masquage par état, ajouté au filtre propre du calque (null = aucun filtre). */
export function energyStateFilter(
  base: maplibregl.FilterSpecification | null,
  hidden: ReadonlySet<EnergyState>,
): maplibregl.FilterSpecification | null {
  if (hidden.size === 0) return base;
  const list = ENERGY_STATES.filter((s) => hidden.has(s));
  const hide = ['!', ['in', ['coalesce', ['get', 'energyState'], 'nonSuivi'], ['literal', list]]] as maplibregl.FilterSpecification;
  return base === null ? hide : (['all', base, hide] as maplibregl.FilterSpecification);
}

export interface EnergyKeyInput {
  layers: Partial<Record<EnergyLayerKey, boolean>>;
  entries: ReadonlyMap<EnergyLayerKey, readonly EnergyEntry[]>;
  flows: ReadonlyMap<EnergyLayerKey, EnergyFlowCount>;
  /** Niveau de tension carburants de chaque département dessiné (couche Pétrole). */
  fuelTension: readonly VigilanceLevel[];
  hiddenStates: ReadonlySet<EnergyState>;
}

export interface EnergyKeyModel {
  visible: boolean;
  counts: Record<EnergyState, number>;
  hiddenStates: ReadonlySet<EnergyState>;
  /** Pire état par filière, parmi les alertes, du plus grave au moins grave. */
  alertSectors: ReadonlyArray<readonly [EnergySector, EnergyState]>;
  shapes: { reactor: boolean; refinery: boolean; storage: boolean; hydro: boolean };
  windClusters: boolean;
  networks: { gas: boolean; oil: boolean; drom: boolean };
  flows: EnergyFlowCount;
  regions: boolean;
  metro: boolean;
  fuelTension: { rouge: number; orange: number; jaune: number } | null;
}

export function buildEnergyKeyModel(input: EnergyKeyInput): EnergyKeyModel {
  const on = (k: EnergyLayerKey): boolean => input.layers[k] === true;
  const counts: Record<EnergyState, number> = { arret: 0, tension: 0, reduit: 0, maintenance: 0, normal: 0, nonSuivi: 0 };
  const worst = new Map<EnergySector, EnergyState>();
  const flows: EnergyFlowCount = { exports: 0, imports: 0 };
  for (const k of ENERGY_LAYER_KEYS) {
    if (!on(k)) continue;
    for (const x of input.entries.get(k) ?? []) {
      counts[x.state] += 1;
      if (!isEnergyAlert(x.state)) continue;
      const prev = worst.get(x.sector);
      if (prev === undefined || ENERGY_STATE_RANK[x.state] > ENERGY_STATE_RANK[prev]) worst.set(x.sector, x.state);
    }
    const f = input.flows.get(k);
    if (f) { flows.exports += f.exports; flows.imports += f.imports; }
  }
  const alertSectors = [...worst].sort((a, b) => ENERGY_STATE_RANK[b[1]] - ENERGY_STATE_RANK[a[1]]);
  const fuel = on('oilNetwork') && input.fuelTension.length > 0
    ? {
        rouge: input.fuelTension.filter((l) => l === 'rouge').length,
        orange: input.fuelTension.filter((l) => l === 'orange').length,
        jaune: input.fuelTension.filter((l) => l === 'jaune').length,
      }
    : null;
  return {
    visible: ENERGY_LAYER_KEYS.some(on),
    counts,
    hiddenStates: input.hiddenStates,
    alertSectors,
    shapes: { reactor: on('nuclearFleet') || on('outagesElec'), refinery: on('oilNetwork'), storage: on('gasNetwork'), hydro: on('hydroBackbone') },
    windClusters: on('windMonitor'),
    networks: { gas: on('gasNetwork'), oil: on('oilNetwork'), drom: on('dromEnergy') },
    flows,
    regions: on('powerGrid'),
    metro: on('metroLoad'),
    fuelTension: fuel,
  };
}
