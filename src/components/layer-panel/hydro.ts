// src/components/layer-panel/hydro.ts : vue pure du panneau Stress hydro (spec lot 2 § 3.2) ; aucun accès réseau ni DOM.
import type { EcowattResponse, GridSnapshot, HydraulicBackboneAsset, HydraulicTrend } from '../../types/index.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { formatGw, formatMw } from './format.ts';
import { barRow, emptyLine, listRow, loadingBody, sourceLinkHtml, type LayerView } from './frame.ts';

export interface HydroViewInput {
  assets: HydraulicBackboneAsset[];
  ecowatt: EcowattResponse | null;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

const THEME = 'Énergie';
const TITLE = 'Stress hydro';
const VISIBLE_ROWS = 8;
const STEP_ROWS = 6;
const OVERSEAS = ['Corse', 'Guyane', 'La Réunion', 'Martinique', 'Guadeloupe', 'Mayotte'];
const FRESHNESS_WORD = { fresh: 'fraîche', aging: 'à confirmer', stale: 'ancienne', unavailable: 'sans mesure' } as const;
const TREND_RANK: Record<HydraulicTrend, number> = { stress: 3, high: 2, normal: 1, low: 0 };
const WATCH_ROWS = 14;
const SUPPORT_WORD = { strong: 'mesures fortes', partial: 'mesures partielles', none: 'dérivé seul' } as const;

/** Stress orange, pression jaune, sinon vert. */
export function trendLevel(t: HydraulicTrend): VigilanceLevel {
  return t === 'stress' ? 'orange' : t === 'high' ? 'jaune' : 'vert';
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return n > 1 ? many : one;
}

/** Stress d'abord, puis criticité, puis puissance, décroissantes. */
function byConstraint(a: HydraulicBackboneAsset, b: HydraulicBackboneAsset): number {
  const rank = (x: HydraulicBackboneAsset): number => (x.signals.hydro_trend === 'stress' ? 1 : 0);
  return rank(b) - rank(a) || b.criticality_score - a.criticality_score || (b.capacity_mw ?? 0) - (a.capacity_mw ?? 0);
}

function counts(assets: readonly HydraulicBackboneAsset[]): { stress: number; high: number; normal: number } {
  const stress = assets.filter((a) => a.signals.hydro_trend === 'stress').length;
  const high = assets.filter((a) => a.signals.hydro_trend === 'high').length;
  return { stress, high, normal: assets.length - stress - high };
}

/** Cause la plus fréquente parmi les ouvrages en stress ; à égalité, celle du premier dans l'ordre de tri. */
function mainCause(assets: readonly HydraulicBackboneAsset[]): string | null {
  const stressed = assets.filter((a) => a.signals.hydro_trend === 'stress').sort(byConstraint);
  const tally = new Map<string, number>();
  for (const a of stressed) {
    const c = a.signals.cause;
    if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [cause, n] of tally) {
    if (n > bestN) { best = cause; bestN = n; }
  }
  return best;
}

export function hydroLead(assets: readonly HydraulicBackboneAsset[], grid: GridSnapshot | null): string {
  const { stress, high } = counts(assets);
  const cause = mainCause(assets);
  const start = stress > 0 ? `${stress} ${plural(stress, 'ouvrage')} en stress${cause ? ` (${cause})` : ''}`
    : high > 0 ? `Aucun ouvrage en stress, ${high} sous pression` : 'Aucun ouvrage sous contrainte';
  const hydro = grid?.mix.hydro ?? null;
  if (hydro === null) return `${start} ; production hydraulique nationale indisponible.`;
  const step = grid?.hydroDetail.stepTurbine ?? null;
  return `${start} ; production hydraulique ${formatGw(hydro)}${step !== null ? `, dont ${formatGw(step)} de turbinage STEP` : ''}.`;
}

function lastObservation(assets: readonly HydraulicBackboneAsset[]): number | null {
  const times = assets.map((a) => (a.signals.observationTimestamp ? Date.parse(a.signals.observationTimestamp) : NaN)).filter(Number.isFinite);
  return times.length === 0 ? null : Math.max(...times);
}

function constrainedSection(assets: readonly HydraulicBackboneAsset[], now: number, open: HydroViewInput['open']): FicheSection {
  const { stress, high } = counts(assets);
  const rows = assets.filter((a) => a.signals.hydro_trend === 'stress' || a.signals.hydro_trend === 'high').sort(byConstraint);
  const row = (a: HydraulicBackboneAsset): string => {
    const obs = a.signals.observationTimestamp ? Date.parse(a.signals.observationTimestamp) : NaN;
    return listRow({
      text: `${a.name} · ${a.signals.hydro_trend === 'stress' ? 'stress' : 'sous pression'}`,
      value: formatMw(a.capacity_mw),
      level: trendLevel(a.signals.hydro_trend),
      note: [a.river ?? a.location.region, a.signals.cause ?? 'contexte régional',
        Number.isFinite(obs) ? `mesure Hub’Eau ${absoluteTime(obs, now, 'fr')}` : 'sans mesure directe',
        `mesure ${FRESHNESS_WORD[a.signals.dataFreshness]}`, `criticité ${a.criticality_score}`].join(' · '),
      title: a.signals.sourceDetail,
      data: { 'hydraulic-asset': a.id },
      link: true,
    });
  };
  let html = rows.slice(0, VISIBLE_ROWS).map(row).join('');
  const rest = rows.slice(VISIBLE_ROWS);
  if (rest.length > 0) html += `<details class="lp-more"><summary>${rest.length} ${plural(rest.length, 'autre')} ${plural(rest.length, 'ouvrage')}</summary>${rest.map(row).join('')}</details>`;
  if (rows.length === 0) html = emptyLine('Aucun ouvrage sous contrainte.');
  return {
    id: 'constrained', title: 'Ouvrages sous contrainte', collapsible: true, open: open('constrained', true),
    summary: rows.length === 0 ? 'aucun' : `${stress} en stress · ${high} sous pression`, html,
  };
}

function productionSection(grid: GridSnapshot | null, open: HydroViewInput['open']): FicheSection {
  const base = { id: 'production', title: 'Production hydraulique', collapsible: true, open: open('production', true) };
  const hydro = grid?.mix.hydro ?? null;
  if (!grid || hydro === null) return { ...base, summary: 'n.d.', html: emptyLine('Production hydraulique nationale indisponible.') };
  const d = grid.hydroDetail;
  const pumping = d.pumping === null ? null : Math.abs(d.pumping);
  const pct = (v: number | null): number | null => (v === null || hydro <= 0 ? null : (v / hydro) * 100);
  const line = (label: string, v: number | null, color: string): string =>
    barRow({ label, pct: pct(v), value: formatGw(v), color, dot: false });
  const html = line('Lacs', d.lakes, 'var(--mix-hydro)')
    + line('Fil de l’eau', d.runOfRiver, 'var(--mix-hydro)')
    + line('Turbinage STEP', d.stepTurbine, 'var(--mix-hydro)')
    + line('Pompage STEP', pumping, 'color-mix(in srgb, var(--mix-hydro) 45%, transparent)');
  return { ...base, summary: escapeHtml(`${formatGw(hydro)} · pompage ${formatGw(pumping)}`), html };
}

function stepSection(assets: readonly HydraulicBackboneAsset[], open: HydroViewInput['open']): FicheSection {
  const steps = assets.filter((a) => a.type === 'step_storage').sort((a, b) => (b.capacity_mw ?? 0) - (a.capacity_mw ?? 0));
  const constrained = steps.filter((a) => a.signals.hydro_trend === 'stress' || a.signals.hydro_trend === 'high').length;
  const summary = steps.length === 0 ? 'aucune'
    : `${steps.length} ${plural(steps.length, 'station')} · ${constrained > 0 ? `${constrained} sous contrainte` : 'toutes sans contrainte'}`;
  const html = steps.length === 0 ? emptyLine('Aucune STEP dans la sélection.')
    : steps.slice(0, STEP_ROWS).map((a) => listRow({
      text: a.name, value: formatMw(a.capacity_mw), level: trendLevel(a.signals.hydro_trend),
      note: `${a.location.region} · ${SUPPORT_WORD[a.signals.measuredSupportLevel]}`,
      data: { 'hydraulic-asset': a.id }, link: true,
    })).join('');
  return { id: 'step', title: 'STEP', collapsible: true, open: open('step', false), summary: escapeHtml(summary), html };
}

function watchSection(assets: readonly HydraulicBackboneAsset[], open: HydroViewInput['open']): FicheSection {
  const top = [...assets].sort((a, b) => TREND_RANK[b.signals.hydro_trend] - TREND_RANK[a.signals.hydro_trend]
    || b.criticality_score - a.criticality_score || (b.capacity_mw ?? 0) - (a.capacity_mw ?? 0)).slice(0, WATCH_ROWS);
  const html = top.map((a) => listRow({
    text: a.name, value: formatMw(a.capacity_mw), level: trendLevel(a.signals.hydro_trend),
    note: `${a.location.region} · criticité ${a.criticality_score} · mesure ${FRESHNESS_WORD[a.signals.dataFreshness]}`,
    title: a.signals.sourceDetail, data: { 'hydraulic-asset': a.id }, link: true,
  })).join('');
  return { id: 'watch', title: 'Ouvrages suivis', collapsible: true, open: open('watch', false), summary: `${top.length} sur ${assets.length}`, html };
}

function methodSection(assets: readonly HydraulicBackboneAsset[], open: HydroViewInput['open']): FicheSection {
  const c = counts(assets);
  const supported = assets.filter((a) => a.signals.signalSource === 'DERIVED_REAL_MEASURE_SUPPORT').length;
  const verified = assets.filter((a) => a.verification_sources?.some((s) => s.includes('RTE/ODRE'))).length;
  const sited = assets.filter((a) => a.location_accuracy === 'site').length;
  const overseas = assets.filter((a) => OVERSEAS.includes(a.location.region)).length;
  const totalMw = assets.reduce((sum, a) => sum + (a.capacity_mw ?? 0), 0);
  const strong = assets.filter((a) => a.signals.measuredSupportLevel === 'strong').length;
  const regulation = assets.filter((a) => a.type === 'water_regulation').length;
  const manual = assets.length - verified;
  const source = (linkHtml: string, role: string): string =>
    `<div class="fmk-kv"><span class="fmk-kv-k">${linkHtml}</span><span class="fmk-kv-v">${escapeHtml(role)}</span></div>`;
  const html = '<p class="fmk-note">Niveau dérivé : orange si au moins un ouvrage est en stress, jaune s’il n’y a que des ouvrages sous pression, vert sinon. '
    + 'Signal dérivé, appuyé sur des mesures réelles (Hub’Eau) là où elles existent : ce n’est pas une télémesure des barrages.</p>'
    + kvRow('Normal', String(c.normal)) + kvRow('Sous pression', String(c.high)) + kvRow('Stress', String(c.stress))
    + kvRow('Vérifiés RTE ou ODRÉ', String(verified)) + kvRow('Géolocalisés au site', String(sited))
    + kvRow('DROM et Corse', String(overseas)) + kvRow('Appuyés par Hub’Eau', String(supported))
    + kvRow('Appui fort', String(strong)) + kvRow('Ouvrages de régulation', String(regulation))
    + kvRow('Référentiel manuel', String(manual)) + kvRow('Puissance installée suivie', formatMw(totalMw))
    + kvRow('Puissance moyenne par ouvrage', formatMw(totalMw / Math.max(assets.length, 1)))
    + source(sourceLinkHtml('Hub’Eau hydrométrie', 'https://hubeau.eaufrance.fr/page/api-hydrometrie'), 'débits mesurés')
    + source(sourceLinkHtml('Vigicrues', 'https://www.vigicrues.gouv.fr/'), 'vigilance crues')
    + source(sourceLinkHtml('Météo-France', 'https://vigilance.meteofrance.fr/'), 'vigilance pluie-inondation')
    + source(sourceLinkHtml('ODRÉ éCO2mix', 'https://odre.opendatasoft.com/explore/dataset/eco2mix-national-tr/'), 'production nationale')
    + source('Référentiel', 'RTE/ODRÉ (30/09/2025), géocodage BAN');
  return {
    id: 'method', title: 'Méthode et couverture', collapsible: true, open: open('method', false), tone: 'reference',
    summary: `${assets.length} ${plural(assets.length, 'ouvrage')} · ${supported} avec mesure`, html,
  };
}

export function buildHydroView(input: HydroViewInput): LayerView {
  const { assets, ecowatt, now, open } = input;
  if (assets.length === 0) {
    return { head: { theme: THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const { stress, high } = counts(assets);
  const grid = ecowatt?.grid ?? null;
  const hydro = grid?.mix.hydro ?? null;
  const last = lastObservation(assets);
  return {
    head: {
      theme: THEME, title: TITLE,
      level: stress > 0 ? 'orange' : high > 0 ? 'jaune' : 'vert',
      figure: { value: formatGw(hydro), caption: grid ? `production hydraulique · éCO2mix ${absoluteTime(grid.dataTime, now, 'fr')}` : 'production hydraulique' },
      status: [
        stress > 0 ? `${stress} ${plural(stress, 'ouvrage')} en stress` : 'aucun ouvrage en stress',
        high > 0 ? `${high} sous pression` : 'aucun ouvrage sous pression',
        last !== null ? `Hub’Eau ${absoluteTime(last, now, 'fr')}` : 'Hub’Eau : aucune mesure',
      ],
      lead: hydroLead(assets, grid),
    },
    sections: [constrainedSection(assets, now, open), productionSection(grid, open), stepSection(assets, open), watchSection(assets, open), methodSection(assets, open)],
  };
}
