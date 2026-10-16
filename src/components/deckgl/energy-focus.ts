// src/components/deckgl/energy-focus.ts
/**
 * energy-focus.ts : survol d'une pastille de couche Énergie (spec 2026-10-16 § 7). Seuls les calques de la couche survolée
 * restent vifs, les autres s'atténuent, et une petite légende de la couche s'affiche sous la pastille.
 */
import {
  LYR_ASNR_RING, LYR_BIOMETHANE_CLUSTERS, LYR_BIOMETHANE_SITES, LYR_BIOMETHANE_SITES_LABEL, LYR_DROM_ENERGY_HTA_LINES,
  LYR_DROM_ENERGY_POINTS, LYR_ENERGY_CHOKE, LYR_ENERGY_CHOKE_LABEL, LYR_ENERGY_FLOW_ANIM, LYR_ENERGY_FLOW_CASE, LYR_ENERGY_FLOW_HEADS,
  LYR_ENERGY_FLOW_LABELS, LYR_ENERGY_FLOW_LINES, LYR_ENERGY_INFRA_CIRCLE, LYR_ENERGY_INFRA_LABEL, LYR_FUEL_TENSION_FILL,
  LYR_FUEL_TENSION_LINE, LYR_GAS_NETWORK_GRT, LYR_GAS_NETWORK_TEREGA, LYR_GAS_STORAGES, LYR_GAS_STORAGES_LABEL, LYR_GAS_TERMINALS,
  LYR_HYDRO_BACKBONE_CIRCLE, LYR_HYDRO_BACKBONE_LABEL, LYR_HYDRO_CLUSTER, LYR_HYDRO_CLUSTER_ICON, LYR_METRO_LOAD_CIRCLE,
  LYR_METRO_LOAD_LABEL, LYR_OIL_DEPOTS, LYR_OIL_DEPOTS_LABEL, LYR_OIL_PIPELINES, LYR_OIL_REFINERIES, LYR_OIL_REFINERIES_LABEL,
  LYR_POWER_REGION_FILL, LYR_POWER_REGION_LINE, LYR_WIND_CLUSTER, LYR_WIND_CLUSTER_ICON, LYR_WIND_PARK_CIRCLE, LYR_WIND_PARK_LABEL,
  LYR_WIND_TURBINE_CIRCLE, LYR_WIND_TURBINE_LABEL, LYR_OUT_POWER_PLANNED, LYR_OUT_POWER_UNPLANNED,
} from './constants.ts';
import { ENERGY_LAYER_KEYS, type EnergyLayerKey } from './energy-map.ts';
import { escapeHtml } from './format-utils.ts';
import { ENERGY_CHOKE_HEX, ENERGY_DISC_STATE_HEX, ENERGY_FLOW_COLORS, ENERGY_SECTOR_HEX, type EnergyFlowKind } from '../../services/energy-state.ts';

/** Disque d'installation et ses compagnons (halo dessous, picto dessus). */
const disc = (id: string): string[] => [`${id}-halo`, id, `${id}-icon`];
const FLOWS = [LYR_ENERGY_FLOW_CASE, LYR_ENERGY_FLOW_LINES, LYR_ENERGY_FLOW_ANIM, LYR_ENERGY_FLOW_HEADS, LYR_ENERGY_FLOW_LABELS];

/** Tous les calques dessinés de chaque couche (ceux de setLayerVisibility, compagnons compris). */
export const ENERGY_FOCUS_LAYERS: Readonly<Record<EnergyLayerKey, readonly string[]>> = {
  powerGrid: [LYR_POWER_REGION_FILL, LYR_POWER_REGION_LINE, ...FLOWS],
  nuclearFleet: [...disc(LYR_ENERGY_INFRA_CIRCLE), LYR_ENERGY_INFRA_LABEL, LYR_ASNR_RING],
  gasNetwork: [
    LYR_GAS_NETWORK_GRT, LYR_GAS_NETWORK_TEREGA, ...disc(LYR_GAS_STORAGES), ...disc(LYR_GAS_TERMINALS), LYR_GAS_STORAGES_LABEL,
    LYR_BIOMETHANE_CLUSTERS, LYR_BIOMETHANE_SITES, LYR_BIOMETHANE_SITES_LABEL, ...FLOWS,
  ],
  oilNetwork: [
    LYR_OIL_PIPELINES, ...disc(LYR_OIL_REFINERIES), LYR_OIL_REFINERIES_LABEL, LYR_OIL_DEPOTS, LYR_OIL_DEPOTS_LABEL,
    LYR_FUEL_TENSION_FILL, LYR_FUEL_TENSION_LINE, ...FLOWS, LYR_ENERGY_CHOKE, LYR_ENERGY_CHOKE_LABEL,
  ],
  // Mêmes calques que OUT_LAYER_KEYS.outagesElec (vérifié par le test), sans charger outages-map dans le paquet principal.
  outagesElec: [...disc(LYR_OUT_POWER_PLANNED), ...disc(LYR_OUT_POWER_UNPLANNED)],
  hydroBackbone: [...disc(LYR_HYDRO_BACKBONE_CIRCLE), LYR_HYDRO_BACKBONE_LABEL, LYR_HYDRO_CLUSTER, LYR_HYDRO_CLUSTER_ICON],
  windMonitor: [
    LYR_WIND_CLUSTER, LYR_WIND_CLUSTER_ICON, LYR_WIND_TURBINE_CIRCLE, LYR_WIND_TURBINE_LABEL, ...disc(LYR_WIND_PARK_CIRCLE), LYR_WIND_PARK_LABEL,
  ],
  dromEnergy: [LYR_DROM_ENERGY_POINTS, LYR_DROM_ENERGY_HTA_LINES],
  metroLoad: [LYR_METRO_LOAD_CIRCLE, LYR_METRO_LOAD_LABEL],
};

const H = ENERGY_SECTOR_HEX;
const D = ENERGY_DISC_STATE_HEX;
const F = ENERGY_FLOW_COLORS;

/** Légende courte de chaque couche : [couleur, libellé]. */
export const ENERGY_FOCUS_KEY: Readonly<Record<EnergyLayerKey, { title: string; rows: ReadonlyArray<readonly [string, string]> }>> = {
  nuclearFleet: { title: 'Parc nucléaire', rows: [[H.nucleaire, 'Réacteur disponible'], [D.reduit, 'Puissance réduite (anneau jaune)'],
    ['#c9ccd6', 'Arrêt annoncé (anneau gris)'], [D.arret, 'À l’arrêt sans préavis (halo)']] },
  hydroBackbone: { title: 'Hydraulique', rows: [[H.hydraulique, 'Barrage, STEP (groupés en vue large)'], [D.tension, 'Retenue sous tension']] },
  windMonitor: { title: 'Éolien', rows: [[H.eolien, 'Parc ou groupe d’éoliennes, taille = nombre'], [D.tension, 'Groupe avec une alerte']] },
  gasNetwork: { title: 'Gaz', rows: [[H.gaz, 'Stockage, terminal, biométhane'], [F.gaz.export, 'Export de gaz'], [F.gaz.import, 'Import de gaz']] },
  oilNetwork: { title: 'Pétrole', rows: [[H.petrole, 'Raffinerie, dépôt'], [F.petrole.export, 'Export de pétrole'],
    [F.petrole.import, 'Import de pétrole, par route maritime jusqu’au port'], [ENERGY_CHOKE_HEX, 'Détroit, point de passage obligé'],
    [D.reduit, 'Département en tension carburants (contour)']] },
  powerGrid: { title: 'Réseau électrique', rows: [[F.elec.export, 'Export d’électricité'], [F.elec.import, 'Import d’électricité'],
    ['#5c6f8f', 'Fond des régions : solde production et consommation']] },
  outagesElec: { title: 'Électricité (unités EDF)', rows: [[D.maintenance, 'Unité en maintenance'], [D.arret, 'À l’arrêt sans préavis']] },
  metroLoad: { title: 'Charge métropolitaine', rows: [['#eef2f7', 'Métropole : surface du cercle proportionnelle à la consommation (MW)']] },
  dromEnergy: { title: 'Énergie DROM', rows: [[H.electricite, 'Poste, pylône, site de production']] },
};

const KEYS: ReadonlySet<string> = new Set(ENERGY_LAYER_KEYS);

export function isEnergyLayerKey(id: string): id is EnergyLayerKey {
  return KEYS.has(id);
}

export function energyFocusKeyHtml(key: EnergyLayerKey): string {
  const k = ENERGY_FOCUS_KEY[key];
  const rows = k.rows.map(([c, t]) => `<div class="ef-row"><i class="ef-dot" style="background:${c}"></i><span>${escapeHtml(t)}</span></div>`).join('');
  return `<div class="ef-key"><div class="ef-title">${escapeHtml(k.title)}</div>${rows}</div>`;
}

/** Calques vifs quand plusieurs pastilles sont allumées : union, sans doublon. */
export function energyFocusLayersOf(keys: readonly EnergyLayerKey[]): string[] {
  return [...new Set(keys.flatMap((k) => ENERGY_FOCUS_LAYERS[k]))];
}

/** Légendes courtes cumulées des pastilles allumées, dans leur ordre ; vide sans pastille. */
export function energyFocusKeysHtml(keys: readonly EnergyLayerKey[]): string {
  return keys.map((k) => energyFocusKeyHtml(k)).join('');
}

const FLOW_KIND_OF: ReadonlyArray<readonly [EnergyLayerKey, EnergyFlowKind]> = [['powerGrid', 'elec'], ['gasNetwork', 'gaz'], ['oilNetwork', 'petrole']];

/**
 * Filières dont les flèches sont dessinées : celles des couches allumées ; si des pastilles sont allumées, seulement les leurs
 * (les calques de flèches sont communs, on filtre donc les données).
 */
export function flowKindsShown(layers: Partial<Record<EnergyLayerKey, boolean>>, focus: readonly EnergyLayerKey[]): EnergyFlowKind[] {
  return FLOW_KIND_OF.filter(([k]) => layers[k] === true && (focus.length === 0 || focus.includes(k))).map(([, kind]) => kind);
}

const isZoomCurve = (v: unknown): v is unknown[] => Array.isArray(v) && (v[0] === 'interpolate' || v[0] === 'step')
  && JSON.stringify(v[0] === 'step' ? v[1] : v[2]) === '["zoom"]';

/**
 * Opacité atténuée d'un facteur. MapLibre n'accepte le zoom qu'en tête d'une interpolation : une courbe sur le zoom est
 * atténuée palier par palier, le reste est multiplié.
 */
export function dimOpacity(orig: unknown, factor: number): unknown {
  if (typeof orig === 'number') return orig * factor;
  if (isZoomCurve(orig)) {
    const head = orig[0] === 'step' ? 2 : 3;
    const out: unknown[] = orig.slice(0, head);
    if (orig[0] === 'step') out[2] = ['*', orig[2], factor];
    for (let i = head + (orig[0] === 'step' ? 1 : 0); i < orig.length; i += 2) out.push(orig[i], ['*', orig[i + 1], factor]);
    return out;
  }
  return ['*', orig, factor];
}

/** Pastilles Énergie vertes, dans l'ordre des pastilles : retenues par un clic, ou dont le panneau est ouvert. */
export function energyChipsPressed(ids: readonly string[], selected: ReadonlySet<EnergyLayerKey>, panelOpen: (id: EnergyLayerKey) => boolean): EnergyLayerKey[] {
  return ids.filter((id): id is EnergyLayerKey => isEnergyLayerKey(id) && (selected.has(id) || panelOpen(id)));
}

/**
 * Clic sur une pastille Énergie : verte (retenue ou panneau ouvert) → elle s'éteint ; sinon elle s'allume et son panneau
 * s'ouvre. Les pastilles vertes se cumulent.
 */
export function toggleEnergyChip(selected: ReadonlySet<EnergyLayerKey>, key: EnergyLayerKey, pressed: boolean): { selected: Set<EnergyLayerKey>; open: boolean } {
  const next = new Set(selected);
  if (pressed) {
    next.delete(key);
    return { selected: next, open: false };
  }
  next.add(key);
  return { selected: next, open: true };
}
