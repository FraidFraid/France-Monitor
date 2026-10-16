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
import { kmBetween } from './energy-flows.ts';

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

/** Puissance ou capacité : une valeur nulle ou négative est une donnée absente (« n.d. »), jamais « 0 MW ». */
function fmtPos(v: unknown, unit: string, digits = 0): string {
  const x = n(v);
  return x !== null && x > 0 ? fmtNum(x, unit, digits) : 'n.d.';
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
      // Sans mesure RTE, la disponibilité n'est pas connue : « n.d. », jamais la puissance installée présentée comme disponible.
      rows: [['Disponible', stateOf(p) === 'nonSuivi' ? 'n.d.' : `${fmtNum(p.available, 'MW')} sur ${fmtPos(p.power, 'MW')}`], ...shown, ...rest],
      source: 'RTE, EDF' };
  }
  const hex = type === 'hydro' ? H.hydraulique : type.startsWith('gas') ? H.gaz : type === 'refinery' || type === 'oil-depot' ? H.petrole : H.electricite;
  return { sectorHex: hex, title: s(p.name), time: null, state: stateOf(p),
    rows: [['Capacité', fmtPos(p.capacity, s(p.capacityUnit) || 'MW')], ['Opérateur', s(p.operator) || 'n.d.']], source: 'Inventaire' };
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
    rows: [['Opérateur', s(p.operator) || 'n.d.'], ['Capacité', fmtPos(p.capacity, 'Mt/an', 1)]], source: 'Inventaire' };
}

const DEPOT_TYPE: Readonly<Record<string, string>> = { strategic: 'Dépôt stratégique', terminal: 'Terminal pétrolier' };

export function oilDepotCard(p: Props): TooltipCard {
  return { sectorHex: H.petrole, title: s(p.name), time: null, state: null,
    rows: [['Type', DEPOT_TYPE[s(p.role)] ?? 'Dépôt'], ['Capacité', fmtPos(p.capacityM3, 'm³')], ['Opérateur', s(p.operator) || 'n.d.']], source: 'Inventaire' };
}

const DEPOT_ROLE: Readonly<Record<string, string>> = {
  strategic: 'Stock de sécurité (SAGESS) : réserve obligatoire, mobilisable sur décision de l’État en cas de crise d’approvisionnement.',
  terminal: 'Point d’entrée du pétrole importé par la mer : sa fermeture coupe les imports qui y arrivent.',
};

/** Fiche détaillée d'un dépôt (clic) : rôle en clair, capacité, imports arrivant au port, raffineries voisines. */
export function oilDepotDetailCard(p: Props, ctx: {
  imports: ReadonlyArray<{ who: string; value: number | null; unit: string }>; refineries: readonly string[];
}): TooltipCard {
  const base = oilDepotCard(p);
  const imports = [...ctx.imports].sort((x, y) => (n(y.value) ?? 0) - (n(x.value) ?? 0))
    .map((f) => [`Import · ${f.who}`, fmtNum(f.value, f.unit)] as const);
  const refineries = ctx.refineries.length > 0 ? [['Raffineries à moins de 30 km', ctx.refineries.join(', ')] as const] : [];
  return { ...base, rows: [...base.rows, ...imports, ...refineries], source: imports.length > 0 ? 'Inventaire, DGEC (origines)' : 'Inventaire',
    hint: DEPOT_ROLE[s(p.role)] ?? 'Dépôt de distribution : approvisionne les stations de sa zone.' };
}

const HYDRO_TYPE: Readonly<Record<string, string>> = {
  hydro_production: 'Production hydraulique', step_storage: 'STEP (stockage par pompage)', water_regulation: 'Régulation des eaux',
};
const HYDRO_TREND: Readonly<Record<string, string>> = { low: 'retenue basse', normal: 'normale', high: 'retenue haute', stress: 'retenue en stress' };
const HYDRO_SOURCE: Readonly<Record<string, string>> = {
  DERIVED_CONTEXT_ONLY: 'Hub’Eau (contexte, sans station liée)', DERIVED_REAL_MEASURE_SUPPORT: 'Hub’Eau (mesures hydrométriques)',
};

export function hydroCard(p: Props): TooltipCard {
  // observationTimestamp arrive déjà mis en forme pour la fiche détaillée : l'heure se lit sur la date brute en repli.
  return { sectorHex: H.hydraulique, title: s(p.name), time: fmtTime(p.observationTimestamp) ?? fmtTime(p.lastUpdate), state: stateOf(p),
    rows: [['Type', HYDRO_TYPE[s(p.type)] ?? (s(p.type) || 'n.d.')], ['Puissance', fmtPos(p.capacityMw, 'MW')], ['Tendance', HYDRO_TREND[s(p.hydroTrend)] ?? 'n.d.']],
    source: HYDRO_SOURCE[s(p.signalSource)] ?? 'Hub’Eau' };
}

export function windCard(p: Props): TooltipCard {
  return { sectorHex: H.eolien, title: s(p.name), time: null, state: stateOf(p),
    rows: [['Puissance', fmtPos(p.capacityMw, 'MW', 1)], ['Éoliennes', fmtNum(p.turbineCount, '').trim() || 'n.d.']], source: 'ODRÉ' };
}

export function biomethaneCard(p: Props): TooltipCard {
  return { sectorHex: H.gaz, title: s(p.name), time: null, state: stateOf(p),
    rows: [['Injection', fmtNum(p.capacityGwh, 'GWh/an')], ['Commune', s(p.commune) || 'n.d.']], source: 'ODRÉ' };
}

export function dromCard(p: Props): TooltipCard {
  return { sectorHex: H.electricite, title: s(p.name), time: null, state: stateOf(p),
    rows: [['Type', s(p.typeLabel) || 'n.d.'], ['Puissance', fmtPos(p.capacityMw, 'MW', 1)]], source: s(p.datasetLabel) || 'EDF SEI' };
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

/**
 * Fiche détaillée d'un flux de pétrole importé (clic) : volume sur la période la plus récente (12 mois Eurostat, ou année
 * Insee en repli), dernier mois, part, port d'arrivée, débit, détail par pays.
 */
export function oilFlowDetailCard(p: Props): TooltipCard {
  const share = n(p.originSharePct);
  const volume = n(p.originVolumeMt);
  const pair = (mt: unknown, pct: unknown, digits: number): string => `${fmtNum(mt, 'Mt', digits)} · ${fmtNum(pct, '%', 1)}`;
  const period = s(p.originPeriodLabel) || (n(p.originReferenceYear) !== null ? `année ${s(p.originReferenceYear)}` : '');
  const rows: Array<readonly [string, string]> = [];
  if (s(p.hubName)) rows.push(['Port d’arrivée', s(p.hubName)]);
  if (volume !== null || share !== null) rows.push([period ? `Volume, ${period}` : 'Volume', pair(volume, share, 1)]);
  const lastLabel = s(p.originLastMonthLabel);
  if (lastLabel) rows.push([lastLabel.charAt(0).toUpperCase() + lastLabel.slice(1), pair(p.originLastMonthMt, p.originLastMonthPct, 2)]);
  if (n(p.flowValue) !== null) rows.push(['Débit moyen', fmtNum(p.flowValue, s(p.flowUnit) || 'kb/j')]);
  let breakdown: unknown = p.originBreakdown;
  if (typeof breakdown === 'string') {
    try { breakdown = JSON.parse(breakdown); } catch { breakdown = []; }
  }
  if (Array.isArray(breakdown)) {
    for (const item of breakdown.slice(0, 6)) {
      if (typeof item !== 'object' || item === null) continue;
      const b = item as Record<string, unknown>;
      if (s(b.label)) rows.push([`· ${s(b.label)}`, pair(b.volumeMt, b.sharePct, 1)]);
    }
  }
  const partial = p.originPartialBreakdown === 1 || p.originPartialBreakdown === true || p.originPartialBreakdown === '1';
  const card: TooltipCard = { sectorHex: H.petrole, title: `${s(p.country) || s(p.name)} · pétrole importé`, time: null, state: null, rows,
    source: s(p.originSourceLabel) || 'DGEC (origines)' };
  if (partial) card.hint = 'Détail par pays incomplet pour cette origine.';
  return card;
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
  // Sans mesure (NaN), pas de solde calculé : « n.d. ».
  const soldeText = Number.isFinite(solde) ? `${solde > 0 ? '+' : ''}${fmtNum(solde, 'MW')}` : 'n.d.';
  return { sectorHex: H.electricite, title: input.name, time: fmtTime(input.updatedAt), state: null,
    rows: [['Consommation', fmtNum(input.consumptionMw, 'MW')], ['Production', fmtNum(input.productionMw, 'MW')],
      ['Solde', soldeText]], source: 'RTE éCO2mix' };
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
  /** Position d'un objet ponctuel (absente pour les lignes et surfaces). */
  coordinates?: readonly [number, number];
}

/**
 * Opacité effective d'un calque pour l'arbitre : 1 hors atténuation, quelle que soit sa transparence propre (fond des régions à
 * 0,16) ; le facteur d'atténuation posé par le survol d'une pastille (« * 0,15 ») sinon.
 */
export function effectiveOpacity(current: unknown, original: unknown): number {
  if (Array.isArray(current)) return current[0] === '*' && typeof current[2] === 'number' ? current[2] : 1;
  if (typeof current !== 'number') return 1;
  if (typeof original === 'number' && original > 0) return Math.min(1, current / original);
  return current > 0 ? 1 : 0;
}

/** Une unité EDF placée au même endroit qu'un site nucléaire (moins de 3 km) : c'est le site qui répond, il liste ses unités. */
function siteOfUnit(unit: HoverCandidate, cands: readonly HoverCandidate[]): HoverCandidate | null {
  const at = unit.coordinates;
  if (!at) return null;
  return cands.find((c) => c.layerId === 'energy-infra-circles' && c.properties.type === 'nuclear' && c.opacity >= 0.2 && c.coordinates
    && kmBetween([c.coordinates[0], c.coordinates[1]], [at[0], at[1]]) < 3) ?? null;
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
  if (best.kind === 'powerUnit') {
    const site = siteOfUnit(best, cands);
    if (site) best = { ...site, kind: 'infra', rank: best.rank };
  }
  const out: HoverCandidate & { kind: EnergyHoverKind } = {
    layerId: best.layerId, properties: best.properties, distancePx: best.distancePx, opacity: best.opacity, kind: best.kind,
  };
  if (best.coordinates) out.coordinates = best.coordinates;
  return out;
}

/** Données de contexte d'une bulle, lues par la carte (unités EDF d'un site, bilan d'une région). */
export interface EnergyHoverContext {
  units?: ReadonlyArray<{ name: string; lostMw: number | null; kind: string }>;
  region?: { consumptionMw: number; productionMw: number; deltaPct: number; updatedAt: unknown };
}

const count = (v: unknown): number => n(v) ?? 0;

/** Bulle courte de l'objet retenu par l'arbitre (spec 2026-10-16 § 6.3). */
export function energyCardFor(hit: { kind: EnergyHoverKind; layerId?: string; properties: Props }, ctx: EnergyHoverContext): TooltipCard | null {
  const p = hit.properties;
  switch (hit.kind) {
    case 'infra': return infraCard(p, ctx.units ?? []);
    case 'powerUnit': return powerUnitCard(p);
    case 'gas': return gasCard(p);
    case 'refinery': return refineryCard(p);
    case 'oilDepot': return oilDepotCard(p);
    case 'hydro': return hydroCard(p);
    case 'wind': return windCard(p);
    case 'biomethane': return biomethaneCard(p);
    case 'drom': return dromCard(p);
    case 'hydroCluster': return clusterCard('hydro', count(p.point_count), count(p.alerts));
    case 'windCluster': return clusterCard('wind', count(p.point_count), count(p.alerts));
    case 'biomethaneCluster': return clusterCard('biomethane', count(p.point_count), 0);
    case 'flow': return flowCard(p);
    case 'choke': return chokeCard(p);
    case 'gasPipeline': {
      // La donnée des gazoducs ne porte ni nom ni opérateur : l'opérateur est celui du calque (GRTgaz ou Teréga).
      const card = pipelineCard({ ...p, operator: (hit.layerId ?? '').includes('terega') ? 'Teréga' : 'GRTgaz' }, 'gaz');
      const dep = s(p.nom_du_departement);
      return dep ? { ...card, rows: [...card.rows, ['Département', dep]] } : card;
    }
    case 'oilPipeline': return pipelineCard(p, 'petrole');
    case 'metro': return metroCard(p);
    case 'fuelTension': return fuelTensionCard(p);
    case 'region': {
      const r = ctx.region;
      return regionCard({
        name: s(p.nom) || s(p.name), consumptionMw: r?.consumptionMw ?? Number.NaN, productionMw: r?.productionMw ?? Number.NaN,
        deltaPct: r?.deltaPct ?? Number.NaN, updatedAt: r?.updatedAt ?? null,
      });
    }
    default: return null;
  }
}
