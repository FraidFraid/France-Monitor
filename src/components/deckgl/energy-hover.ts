// src/components/deckgl/energy-hover.ts
/**
 * energy-hover.ts : bulles de la carte Énergie (spec 2026-10-16 § 6). Gabarit unique : pastille de filière et nom, état en
 * mots et en couleur, deux ou trois valeurs, source et heure. Partie pure, sans carte.
 */
import {
  ENERGY_FLOW_KIND_LABEL, ENERGY_SECTOR_HEX, ENERGY_STATE_HEX, ENERGY_STATE_LABEL, ENERGY_STATES,
  type EnergyFlowKind, type EnergyState,
} from '../../services/energy-state.ts';
import { escapeHtml } from './format-utils.ts';

const NBSP = '\u00a0';
type Props = Readonly<Record<string, unknown>>;

export interface TooltipCard {
  sectorHex: string;
  title: string;
  time: string | null;
  state: EnergyState | null;
  rows: ReadonlyArray<readonly [string, string]>;
  source: string | null;
  hint?: string;
}

const STATES = new Set<string>(ENERGY_STATES);
const stateOf = (p: Props): EnergyState => (typeof p.energyState === 'string' && STATES.has(p.energyState) ? p.energyState as EnergyState : 'nonSuivi');
const s = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const n = (v: unknown): number | null => {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
};

export function fmtNum(v: unknown, unit: string, digits = 0): string {
  const x = n(v);
  if (x === null) return 'n.d.';
  return `${x.toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${NBSP}${unit}`;
}

export function fmtTime(v: unknown): string | null {
  const t = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Date.parse(v) : Number.NaN;
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** « FR_MAREGES_G3 » → « Marèges G3 » ; un nom déjà lisible est rendu tel quel. */
const READABLE: Readonly<Record<string, string>> = { MAREGES: 'Marèges' };
function readableName(raw: string): string {
  const m = /^FR_([A-Z]+)_(.+)$/.exec(raw);
  if (!m) return raw;
  const base = READABLE[m[1]] ?? m[1].charAt(0) + m[1].slice(1).toLowerCase();
  return `${base} ${m[2]}`;
}

export function tooltipCardHtml(c: TooltipCard): string {
  const state = c.state === null ? '' : `<div class="et-state" style="color:${c.state === 'nonSuivi' ? '#c7c7cc' : ENERGY_STATE_HEX[c.state]}">`
    + `${escapeHtml(ENERGY_STATE_LABEL[c.state])}${c.state === 'nonSuivi' ? ' · pas de mesure en direct' : ''}</div>`;
  const rows = c.rows.map(([k, v]) => `<div class="et-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('');
  const source = `Source : ${escapeHtml(c.source ?? 'n.d.')}${c.time ? ` · ${escapeHtml(c.time)}` : ''}`;
  return `<div class="et-card"><div class="et-head"><i class="et-dot" style="background:${c.sectorHex}"></i>`
    + `<strong>${escapeHtml(c.title)}</strong></div>${state}${rows}`
    + (c.hint ? `<div class="et-hint">${escapeHtml(c.hint)}</div>` : '')
    + `<div class="et-src">${source}</div></div>`;
}

const H = ENERGY_SECTOR_HEX;

export function infraCard(p: Props, units: ReadonlyArray<{ name: string; lostMw: number | null; kind: string }>): TooltipCard {
  const type = s(p.type);
  if (type === 'nuclear') {
    const shown = units.slice(0, 3).map((u) => [readableName(u.name), `${fmtNum(u.lostMw, 'MW')} · ${u.kind === 'imprevue' ? 'arrêt imprévu' : 'maintenance'}`] as const);
    const rest = units.length > 3 ? [['Autres unités', String(units.length - 3)] as const] : [];
    return { sectorHex: H.nucleaire, title: s(p.name), time: null, state: stateOf(p),
      rows: [['Disponible', `${fmtNum(p.available, 'MW')} sur ${fmtNum(p.power, 'MW')}`], ...shown, ...rest], source: 'RTE, EDF' };
  }
  const hex = type === 'hydro' ? H.hydraulique : type.startsWith('gas') ? H.gaz : type === 'refinery' || type === 'oil-depot' ? H.petrole : H.electricite;
  return { sectorHex: hex, title: s(p.name), time: null, state: stateOf(p),
    rows: [['Capacité', fmtNum(p.capacity, s(p.capacityUnit) || 'MW')], ['Opérateur', s(p.operator) || 'n.d.']], source: 'Inventaire' };
}

export function powerUnitCard(p: Props): TooltipCard {
  return { sectorHex: H.electricite, title: readableName(s(p.name)), time: null, state: stateOf(p),
    rows: [['Filière', s(p.sector) || 'n.d.'], ['Indisponible', fmtNum(p.lostMw, 'MW')], ['Nature', s(p.kind) === 'imprevue' ? 'arrêt imprévu' : 'maintenance']],
    source: 'EDF (indisponibilités)' };
}

export function gasCard(p: Props): TooltipCard {
  if (s(p.type) === 'storage') {
    return { sectorHex: H.gaz, title: s(p.name), time: fmtTime(p.dataDate), state: stateOf(p),
      rows: [['Remplissage', fmtNum(p.fillLevel, '%')], ['Capacité', fmtNum(p.capacity, 'TWh', 1)]], source: 'ODRÉ, AGSI' };
  }
  return { sectorHex: H.gaz, title: s(p.name), time: fmtTime(p.dataDate), state: stateOf(p),
    rows: [['Opérateur', s(p.operator) || 'n.d.'], ['Utilisation', fmtNum(p.utilizationPct, '%')]], source: 'ALSI' };
}

export function refineryCard(p: Props): TooltipCard {
  return { sectorHex: H.petrole, title: s(p.name), time: null, state: stateOf(p),
    rows: [['Opérateur', s(p.operator) || 'n.d.'], ['Capacité', fmtNum(p.capacity, 'Mt/an', 1)]], source: 'Inventaire' };
}

export function oilDepotCard(p: Props): TooltipCard {
  const role = s(p.role);
  return { sectorHex: H.petrole, title: s(p.name), time: null, state: null,
    rows: [['Type', role === 'strategic' ? 'Dépôt stratégique' : role === 'terminal' ? 'Terminal pétrolier' : 'Dépôt']], source: 'Inventaire' };
}

export function hydroCard(p: Props): TooltipCard {
  const trend = s(p.hydroTrend);
  const label = trend === 'stress' ? 'retenue en stress' : trend === 'high' ? 'retenue haute' : trend ? 'normale' : 'n.d.';
  return { sectorHex: H.hydraulique, title: s(p.name), time: fmtTime(p.observationTimestamp ?? p.lastUpdate), state: stateOf(p),
    rows: [['Type', s(p.type) || 'n.d.'], ['Puissance', fmtNum(p.capacityMw, 'MW')], ['Tendance', label]], source: s(p.signalSource) || 'Hub’Eau' };
}

export function windCard(p: Props): TooltipCard {
  return { sectorHex: H.eolien, title: s(p.name), time: null, state: stateOf(p),
    rows: [['Puissance', fmtNum(p.capacityMw, 'MW', 1)], ['Éoliennes', fmtNum(p.turbineCount, '').trim() || 'n.d.']], source: 'ODRÉ' };
}

export function biomethaneCard(p: Props): TooltipCard {
  return { sectorHex: H.gaz, title: s(p.name), time: null, state: stateOf(p),
    rows: [['Injection', fmtNum(p.capacityGwh, 'GWh/an')], ['Commune', s(p.commune) || 'n.d.']], source: 'ODRÉ' };
}

export function dromCard(p: Props): TooltipCard {
  return { sectorHex: H.electricite, title: s(p.name), time: null, state: stateOf(p),
    rows: [['Type', s(p.typeLabel) || 'n.d.'], ['Puissance', fmtNum(p.capacityMw, 'MW', 1)]], source: s(p.datasetLabel) || 'EDF SEI' };
}

const CLUSTER_NOUN: Readonly<Record<'hydro' | 'wind' | 'biomethane', [string, string]>> = {
  hydro: ['barrages', H.hydraulique], wind: ['éoliennes', H.eolien], biomethane: ['sites de biométhane', H.gaz],
};
export function clusterCard(kind: 'hydro' | 'wind' | 'biomethane', count: number, alerts: number): TooltipCard {
  const [noun, hex] = CLUSTER_NOUN[kind];
  return { sectorHex: hex, title: `${count.toLocaleString('fr-FR')} ${noun}`, time: null, state: null,
    rows: kind === 'biomethane' ? [] : [['Dont en alerte', String(alerts)]], source: null, hint: 'Zoomer pour le détail' };
}

export function flowCard(p: Props): TooltipCard {
  const kind = (s(p.kind) || 'elec') as EnergyFlowKind;
  const imp = p.isImport === true || p.isImport === 'true';
  const value = fmtNum(p.flowValue, s(p.flowUnit));
  const rows: Array<readonly [string, string]> = [['Sens', imp ? 'import' : 'export'], ['Volume', value]];
  if (kind === 'petrole' && s(p.hubName)) rows.push(['Port d’arrivée', s(p.hubName)]);
  const sourceOf: Readonly<Record<EnergyFlowKind, string>> = { elec: 'RTE', gaz: 'GRTgaz, Teréga', petrole: 'DGEC (origines)' };
  return { sectorHex: kind === 'elec' ? H.electricite : kind === 'gaz' ? H.gaz : H.petrole, title: `${s(p.who)} · ${ENERGY_FLOW_KIND_LABEL[kind]}`,
    time: null, state: null, rows, source: sourceOf[kind], hint: 'Cliquer pour le détail' };
}

export function chokeCard(p: Props): TooltipCard {
  let flows: Array<{ who: string; value: number | null; unit: string }> = [];
  try { const parsed: unknown = JSON.parse(s(p.flows) || '[]'); if (Array.isArray(parsed)) flows = parsed as typeof flows; } catch { flows = []; }
  const unit = flows[0]?.unit ?? 'kb/j';
  const total = flows.reduce((t, f) => t + (n(f.value) ?? 0), 0);
  return { sectorHex: H.petrole, title: s(p.name), time: null, state: null,
    rows: [...flows.map((f) => [f.who, fmtNum(f.value, f.unit)] as const), ['Total', fmtNum(total, unit)]],
    source: 'Routes simplifiées', hint: 'Point de passage obligé : sa fermeture coupe ces flux' };
}

export function pipelineCard(p: Props, kind: 'gaz' | 'petrole'): TooltipCard {
  const nature = kind === 'gaz' ? 'Gazoduc' : s(p.kind) === 'products' ? 'Oléoduc (produits raffinés)' : 'Oléoduc (pétrole brut)';
  return { sectorHex: kind === 'gaz' ? H.gaz : H.petrole, title: s(p.name) || nature, time: null, state: null,
    rows: [['Nature', nature], ['Opérateur', s(p.operator) || 'n.d.']], source: kind === 'gaz' ? 'GRTgaz, Teréga' : 'Inventaire' };
}

export function metroCard(p: Props): TooltipCard {
  const d = n(p.deltaVsJ1Pct);
  return { sectorHex: H.electricite, title: s(p.name), time: fmtTime(p.updatedAt), state: null,
    rows: [['Consommation', s(p.mwLabel) || 'n.d.'], ['Vs veille', d === null ? 'n.d.' : `${d > 0 ? '+' : ''}${fmtNum(d, '%', 1)}`]], source: 'RTE' };
}

const FUEL_LABEL: Readonly<Record<string, string>> = { CRITICAL: 'critique', HIGH: 'forte', MEDIUM: 'moyenne', LOW: 'faible' };
export function fuelTensionCard(p: Props): TooltipCard {
  const share = n(p.anomalyShare);
  return { sectorHex: H.petrole, title: s(p.nom), time: null, state: null,
    rows: [['Tension carburants', FUEL_LABEL[s(p.tensionLevel)] ?? 'n.d.'], ['Stations en rupture', share === null ? 'n.d.' : fmtNum(share, '%', 1)],
      ['Stations suivies', fmtNum(p.stationCount, '').trim() || 'n.d.']], source: 'prix-carburants.gouv.fr' };
}

export function regionCard(input: { name: string; consumptionMw: number; productionMw: number; deltaPct: number; updatedAt: unknown }): TooltipCard {
  const solde = input.productionMw - input.consumptionMw;
  return { sectorHex: H.electricite, title: input.name, time: fmtTime(input.updatedAt), state: null,
    rows: [['Consommation', fmtNum(input.consumptionMw, 'MW')], ['Production', fmtNum(input.productionMw, 'MW')],
      ['Solde', `${solde > 0 ? '+' : ''}${fmtNum(solde, 'MW')}`]], source: 'RTE éCO2mix' };
}

export type EnergyHoverKind =
  | 'infra' | 'powerUnit' | 'gas' | 'refinery' | 'oilDepot' | 'hydro' | 'wind' | 'biomethane' | 'drom'
  | 'hydroCluster' | 'windCluster' | 'biomethaneCluster' | 'flow' | 'choke' | 'gasPipeline' | 'oilPipeline' | 'metro' | 'fuelTension' | 'region';

const L = (kind: EnergyHoverKind, rank: number) => ({ kind, rank });
export const ENERGY_HOVER_LAYERS: Readonly<Record<string, { kind: EnergyHoverKind; rank: number }>> = {
  'energy-infra-circles': L('infra', 2), 'out-power-unplanned': L('powerUnit', 2), 'out-power-planned': L('powerUnit', 2),
  'gas-storages': L('gas', 2), 'gas-terminals': L('gas', 2), 'oil-refineries': L('refinery', 2), 'oil-depots': L('oilDepot', 2),
  'hydro-backbone-circles': L('hydro', 2), 'wind-park-circles': L('wind', 2), 'wind-turbine-circles': L('wind', 2),
  'biomethane-sites': L('biomethane', 2), 'drom-energy-points': L('drom', 2),
  'hydro-cluster': L('hydroCluster', 3), 'wind-cluster': L('windCluster', 3), 'biomethane-clusters': L('biomethaneCluster', 3),
  'energy-flow-lines': L('flow', 4), 'energy-flow-heads': L('flow', 4), 'energy-choke': L('choke', 4),
  'gas-network-grt-line': L('gasPipeline', 5), 'gas-network-terega-line': L('gasPipeline', 5), 'oil-pipelines': L('oilPipeline', 5),
  'metro-load-circles': L('metro', 6), 'fuel-tension-fill': L('fuelTension', 7), 'power-region-fill': L('region', 8),
};
export const ENERGY_HOVER_LAYER_IDS: readonly string[] = Object.keys(ENERGY_HOVER_LAYERS);

export interface HoverCandidate {
  layerId: string;
  properties: Readonly<Record<string, unknown>>;
  distancePx: number;
  /** Opacité effective du calque : sous 0,2 (éteint ou atténué par le survol d'une pastille), il ne répond pas. */
  opacity: number;
}

/** Un seul objet répond : le plus prioritaire, puis le plus proche du curseur (spec § 6.2). */
export function pickEnergyHover(cands: readonly HoverCandidate[]): (HoverCandidate & { kind: EnergyHoverKind }) | null {
  let best: (HoverCandidate & { kind: EnergyHoverKind; rank: number }) | null = null;
  for (const c of cands) {
    const def = ENERGY_HOVER_LAYERS[c.layerId];
    if (!def || c.opacity < 0.2) continue;
    const st = c.properties.energyState;
    const rank = def.rank === 2 && (st === 'arret' || st === 'tension') ? 1 : def.rank;
    if (best === null || rank < best.rank || (rank === best.rank && c.distancePx < best.distancePx)) best = { ...c, kind: def.kind, rank };
  }
  if (best === null) return null;
  return { layerId: best.layerId, properties: best.properties, distancePx: best.distancePx, opacity: best.opacity, kind: best.kind };
}
