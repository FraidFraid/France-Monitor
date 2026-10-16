// src/components/deckgl/energy-map.ts
/**
 * energy-map.ts : partie pure de la carte de l'énergie (spec 2026-10-15). Chaque couche dépose ses objets en
 * entrées {id, état, filière} ; d'ici sortent les expressions de style des disques, les filtres de masquage par état et le
 * modèle de la légende « Lire la carte ».
 */
import type maplibregl from 'maplibre-gl';
import type { ExpressionSpecification } from 'maplibre-gl';
import type { IconName } from '../shared/icons.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import type { HydraulicTrend } from '../../types/index.ts';
import {
  ENERGY_DISC_STATE_HEX, ENERGY_SECTOR_HEX, ENERGY_SECTOR_ICON, type EnergyFlowKind, ENERGY_STATE_HEX, ENERGY_STATES, gasStorageState, hydroState,
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

export type StyleExpr = ExpressionSpecification;

const STATE: StyleExpr = ['coalesce', ['get', 'energyState'], 'nonSuivi'];

/** Arrêt ou tension : seuls états qui portent un halo. */
export const ENERGY_ALERT_FILTER = ['in', STATE, ['literal', ['arret', 'tension']]] as maplibregl.FilterSpecification;

/** Disque d'une installation : couleur de l'état anormal, sinon teinte de la filière (le vert n'est plus dessiné). */
export function discColorExpr(base: string | StyleExpr): StyleExpr {
  const d = ENERGY_DISC_STATE_HEX;
  return ['match', STATE, 'arret', d.arret, 'tension', d.tension, 'reduit', d.reduit, 'maintenance', d.maintenance, base];
}

export function glyphColorExpr(dark: boolean): StyleExpr {
  return ['match', STATE, 'reduit', '#1a1a1a', 'maintenance', '#d0d3da', dark ? '#14161c' : '#ffffff'];
}

/** Nucléaire (choix validé 16/10) : le violet reste sauf arrêt et tension ; réduit et maintenance passent par l'anneau. */
export function nuclearDiscColorExpr(): StyleExpr {
  const d = ENERGY_DISC_STATE_HEX;
  return ['match', STATE, 'arret', d.arret, 'tension', d.tension, ENERGY_SECTOR_HEX.nucleaire];
}
export function nuclearRingColorExpr(): StyleExpr {
  return ['match', STATE, 'reduit', ENERGY_DISC_STATE_HEX.reduit, 'maintenance', '#c9ccd6', '#05060a'];
}
export function nuclearRingWidthExpr(): StyleExpr {
  return ['match', STATE, 'reduit', 3.5, 'maintenance', 3.5, 1.5];
}
export function nuclearOpacityExpr(): StyleExpr {
  return ['match', STATE, 'maintenance', 0.55, 1];
}

/** `infra-src` mélange les types : la teinte et le picto suivent la propriété `type`. */
export function infraSectorHexExpr(): StyleExpr {
  const h = ENERGY_SECTOR_HEX;
  return ['match', ['get', 'type'], 'nuclear', h.nucleaire, 'hydro', h.hydraulique, 'gas-terminal', h.gaz, 'gas-storage', h.gaz,
    'refinery', h.petrole, 'oil-depot', h.petrole, h.electricite];
}
export function infraGlyphImageExpr(): StyleExpr {
  return ['match', ['get', 'type'], 'nuclear', energyIconImage('atom'), 'hydro', energyIconImage('droplet'),
    'gas-terminal', energyIconImage('flame'), 'gas-storage', energyIconImage('flame'), 'refinery', energyIconImage('fuel'),
    'oil-depot', energyIconImage('fuel'), energyIconImage('zap')];
}

export const ENERGY_DISC_RADIUS: Readonly<Record<'nuclear' | 'gas' | 'refinery' | 'windPark' | 'powerUnit' | 'hydro' | 'other', number>> = {
  nuclear: 11, gas: 9, refinery: 13, windPark: 9, powerUnit: 8, hydro: 7, other: 8,
};

/** Charge métropolitaine : rayon (zoom 6) d'un cercle dont la surface est proportionnelle à la consommation ; 4 px au moins. */
export function metroRadiusPx(mw: number): number {
  return Math.max(4, 0.47 * Math.sqrt(Math.max(0, mw)));
}

/** Même rayon en expression MapLibre (propriété `loadMw`), un peu plus petit en vue large et plus grand en zoom. */
const METRO_R: StyleExpr = ['max', 4, ['*', 0.47, ['sqrt', ['max', 0, ['coalesce', ['get', 'loadMw'], 0]]]]];
/** Facteur du rayon selon le zoom : un peu plus petit en vue large, plus grand en zoom. */
const METRO_ZOOM: ReadonlyArray<readonly [number, number]> = [[4, 0.75], [6, 1], [9, 1.6]];
/** Taille de l'étiquette selon le zoom (px). */
const METRO_FONT: Readonly<Record<number, number>> = { 4: 11, 6: 11, 9: 13 };

export function metroRadiusExpr(): StyleExpr {
  return ['interpolate', ['linear'], ['zoom'], ...METRO_ZOOM.flatMap(([z, k]) => [z, ['*', METRO_R, k]])] as StyleExpr;
}

/** Décalage (em) de l'étiquette sous le cercle : rayon / taille de police, plus un petit jour. */
export function metroLabelOffsetExpr(): StyleExpr {
  return ['interpolate', ['linear'], ['zoom'], ...METRO_ZOOM.flatMap(([z, k]) => [z, ['+', 0.3, ['/', ['*', METRO_R, k], METRO_FONT[z]]]])] as StyleExpr;
}

/** Taille de l'étiquette des métropoles, accordée au décalage. */
export const METRO_LABEL_SIZE: StyleExpr = ['interpolate', ['linear'], ['zoom'], 4, METRO_FONT[4], 6, METRO_FONT[6], 9, METRO_FONT[9]];

/** Dépôts pétroliers : stratégiques et terminaux plus gros (7 px), simples dépôts 5 px (16/10/2026 : trop petits pour être vus). */
export function oilDepotRadiusExpr(): StyleExpr {
  return ['match', ['get', 'role'], ['strategic', 'terminal'], 7, 5];
}
/** Cerclage blanc des dépôts stratégiques et terminaux, sombre pour les autres. */
export function oilDepotStrokeExpr(): StyleExpr {
  return ['match', ['get', 'role'], ['strategic', 'terminal'], ENERGY_SECTOR_HEX.electricite, '#05060a'];
}

/** Les pictos SDF sont dessinés pour un disque de rayon 19 px. */
export function discIconSize(radius: number): number {
  return radius / 19;
}

/** Filtres des compagnons d'un disque : le picto suit le disque, le halo ne garde que l'arrêt et la tension. */
export function companionFilters(disc: maplibregl.FilterSpecification | null): {
  halo: maplibregl.FilterSpecification; icon: maplibregl.FilterSpecification | null;
} {
  return { halo: disc ? ['all', disc, ENERGY_ALERT_FILTER] as maplibregl.FilterSpecification : ENERGY_ALERT_FILTER, icon: disc };
}

export interface DiscCompanionInput {
  id: string;
  source: string;
  filter: maplibregl.FilterSpecification | null;
  radius: number | StyleExpr;
  color: string | StyleExpr;
  icon: string | StyleExpr;
  iconColor: string | StyleExpr;
}

/**
 * Calques compagnons d'un disque d'installation (spec 2026-10-16 § 2.2) : `<id>-halo` (à poser sous le disque) et
 * `<id>-icon` (au-dessus). Ils suivent le disque partout : visibilité, masquage par état, atténuation.
 */
export function discCompanionLayers(d: DiscCompanionInput): [maplibregl.CircleLayerSpecification, maplibregl.SymbolLayerSpecification] {
  const f = companionFilters(d.filter);
  const haloRadius: number | StyleExpr = typeof d.radius === 'number' ? d.radius + 7 : ['+', d.radius, 7];
  const iconSize: number | StyleExpr = typeof d.radius === 'number' ? discIconSize(d.radius) : ['/', d.radius, 19];
  const halo: maplibregl.CircleLayerSpecification = {
    id: `${d.id}-halo`, type: 'circle', source: d.source, filter: f.halo, layout: { visibility: 'none' },
    paint: {
      'circle-radius': haloRadius, 'circle-color': d.color, 'circle-opacity': 0.28,
      'circle-stroke-width': 1.5, 'circle-stroke-color': d.color, 'circle-stroke-opacity': 0.8,
    },
  };
  const icon: maplibregl.SymbolLayerSpecification = {
    id: `${d.id}-icon`, type: 'symbol', source: d.source,
    layout: { visibility: 'none', 'icon-image': d.icon, 'icon-size': iconSize, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': d.iconColor },
  };
  if (f.icon) icon.filter = f.icon;
  return [halo, icon];
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
  /** Filières présentes dans les couches allumées, dans l'ordre de la légende. */
  sectors: readonly EnergySector[];
  /** Barrages ou éoliennes groupés à petite échelle. */
  clusters: boolean;
  networks: { gas: boolean; oil: boolean; drom: boolean };
  /** Échanges par filière des couches allumées. */
  flowKinds: ReadonlyArray<{ kind: EnergyFlowKind; exports: number; imports: number }>;
  /** Détroits dessinés : pétrole allumé et importé. */
  chokes: boolean;
  inventory: { biomethane: boolean; depots: boolean };
  regions: boolean;
  metro: boolean;
  fuelTension: { rouge: number; orange: number; jaune: number } | null;
}

const SECTOR_ORDER: readonly EnergySector[] = ['nucleaire', 'hydraulique', 'eolien', 'gaz', 'petrole', 'electricite'];
const FLOW_LAYERS: ReadonlyArray<readonly [EnergyLayerKey, EnergyFlowKind]> = [['powerGrid', 'elec'], ['gasNetwork', 'gaz'], ['oilNetwork', 'petrole']];

export function buildEnergyKeyModel(input: EnergyKeyInput): EnergyKeyModel {
  const on = (k: EnergyLayerKey): boolean => input.layers[k] === true;
  const counts: Record<EnergyState, number> = { arret: 0, tension: 0, reduit: 0, maintenance: 0, normal: 0, nonSuivi: 0 };
  const present = new Set<EnergySector>();
  for (const k of ENERGY_LAYER_KEYS) {
    if (!on(k)) continue;
    for (const x of input.entries.get(k) ?? []) {
      counts[x.state] += 1;
      present.add(x.sector);
    }
  }
  const flowKinds = FLOW_LAYERS.filter(([k]) => on(k)).map(([k, kind]) => ({ kind, exports: input.flows.get(k)?.exports ?? 0, imports: input.flows.get(k)?.imports ?? 0 }))
    .filter((f) => f.exports + f.imports > 0);
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
    sectors: SECTOR_ORDER.filter((x) => present.has(x)),
    clusters: on('windMonitor') || on('hydroBackbone'),
    networks: { gas: on('gasNetwork'), oil: on('oilNetwork'), drom: on('dromEnergy') },
    flowKinds,
    chokes: on('oilNetwork') && (input.flows.get('oilNetwork')?.imports ?? 0) > 0,
    inventory: { biomethane: on('gasNetwork'), depots: on('oilNetwork') },
    regions: on('powerGrid'),
    metro: on('metroLoad'),
    fuelTension: fuel,
  };
}

/** Stockage de gaz : couleur de l'état de son remplissage (contour de tendance saisonnière retiré). */
export function gasStorageStyle(fillPct: number | null): { energyState: EnergyState; color: string } {
  const energyState = gasStorageState(fillPct);
  return { energyState, color: ENERGY_STATE_HEX[energyState] };
}

/**
 * Retenue hydraulique : couleur de l'état de sa tendance (même lecture que le panneau). Sans mesure fraîche
 * (contexte seul, donnée en retard), aucun état : ni vert ni alerte.
 */
export function hydroStyle(trend: HydraulicTrend, measured = true): { energyState: EnergyState; color: string } {
  const energyState: EnergyState = measured ? hydroState(trend) : 'nonSuivi';
  return { energyState, color: ENERGY_STATE_HEX[energyState] };
}
