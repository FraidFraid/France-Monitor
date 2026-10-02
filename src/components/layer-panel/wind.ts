// src/components/layer-panel/wind.ts : vue pure du panneau Éolien (spec lot 2 § 3.4) ; aucun accès réseau ni DOM.
import type { GridSnapshot } from '../../types/index.ts';
import type { EolienAlertLevel, EolienLive, EolienParkSummary } from '../../services/eolien/types.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import { escapeHtml } from '../france-intel-events.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, formatGw, formatMw, formatPct, zoneMidnight } from './format.ts';
import { lineChart, type ChartPoint } from './chart.ts';
import { barRow, emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';

export interface WindViewInput {
  live: EolienLive | null;
  parks: EolienParkSummary[];
  grid: GridSnapshot | null;
  error: string | null;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

const THEME = 'Énergie';
const TITLE = 'Éolien';
const PARIS = 'Europe/Paris';
const DAY_MS = 24 * 3_600_000;
const TOP_PARKS = 12;
/** Cadence de l'éCO2mix suivi : au-delà de deux périodes, la donnée est dite en retard. */
const LIVE_PERIOD_MS = 30 * 60_000;
const STATUS_WORD: Partial<Record<EolienParkSummary['status'], string>> = {
  construction: 'en construction', authorized: 'autorisé', project: 'en projet', inactive: 'inactif',
};
const WIND_LEVEL: Record<EolienAlertLevel, VigilanceLevel> = { 'low-production': 'orange', watch: 'jaune', normal: 'vert' };

export function windWord(level: EolienAlertLevel): 'faible' | 'modéré' | 'soutenu' {
  return level === 'low-production' ? 'faible' : level === 'watch' ? 'modéré' : 'soutenu';
}

interface Split { onshore: number; offshore: number; measured: boolean }

/** Mesurée par éCO2mix (MW) quand les deux valeurs existent, sinon estimée du suivi (GW × 1000). */
function splitOf(live: EolienLive, grid: GridSnapshot | null): Split | null {
  const on = grid?.windDetail.onshore ?? null;
  const off = grid?.windDetail.offshore ?? null;
  if (on !== null && off !== null) return { onshore: on, offshore: off, measured: true };
  const s = live.terre_mer_split;
  return s ? { onshore: s.terre * 1000, offshore: s.mer * 1000, measured: false } : null;
}

function isLate(live: EolienLive, now: number): boolean {
  return now - live.timestamp.getTime() > 2 * LIVE_PERIOD_MS;
}

function daySection(grid: GridSnapshot | null, now: number, open: WindViewInput['open']): FicheSection {
  const base = { id: 'day', title: 'Production du jour', collapsible: true, open: open('day', true) };
  const from = zoneMidnight(now, PARIS);
  const to = from + DAY_MS;
  const points: ChartPoint[] = (grid?.day ?? [])
    .filter((p): p is typeof p & { windMw: number } => p.windMw !== null && p.at >= from && p.at < to)
    .map((p) => ({ at: p.at, value: p.windMw }));
  if (!grid || points.length < 2) return { ...base, summary: 'n.d.', html: emptyLine('Courbe du jour indisponible.') };
  const min = points.reduce((b, p) => (p.value < b.value ? p : b), points[0]);
  const max = points.reduce((b, p) => (p.value > b.value ? p : b), points[0]);
  const chart = lineChart(points, {
    label: 'Production éolienne du jour, éCO2mix', from, to, stroke: 'var(--mix-wind)', nowAt: grid.dataTime, markPeak: true,
    value: formatGw, tick: (ms) => (ms === from ? `0${NBSP}h` : `24${NBSP}h`),
  });
  // Résumé court (une ligne) ; les heures du minimum et du maximum restent sous la courbe.
  return {
    ...base,
    summary: escapeHtml(`min ${formatGw(min.value)} · max ${formatGw(max.value)}`),
    html: chart
      + kvRow('Minimum', valueHtml(`${formatGw(min.value)} à ${absoluteTime(min.at, now, 'fr')}`))
      + kvRow('Maximum', valueHtml(`${formatGw(max.value)} à ${absoluteTime(max.at, now, 'fr')}`)),
  };
}

function splitSection(live: EolienLive, parks: readonly EolienParkSummary[], split: Split | null, now: number, open: WindViewInput['open']): FicheSection {
  const fc = live.facteur_charge * 100;
  const late = isLate(live, now);
  const onshoreCount = parks.filter((p) => p.kind === 'onshore').length;
  const offshoreCount = parks.filter((p) => p.kind === 'offshore').length;
  let html = listRow({
    text: `Vent ${windWord(live.alertLevel)}`, level: late ? 'gris' : WIND_LEVEL[live.alertLevel],
    note: `alerte nationale sous 3${NBSP}GW${late ? ` · donnée en retard (${absoluteTime(live.timestamp.getTime(), now, 'fr')})` : ''}`,
  });
  html += barRow({ label: 'Facteur de charge', pct: fc, value: formatPct(fc), color: 'var(--mix-wind)', dot: false });
  if (split) {
    const total = split.onshore + split.offshore;
    const pct = (v: number): number | null => (total > 0 ? (v / total) * 100 : null);
    html += barRow({ label: 'Terrestre', pct: pct(split.onshore), value: formatGw(split.onshore), color: 'var(--cat-onshore)' })
      + barRow({ label: 'En mer', pct: pct(split.offshore), value: formatGw(split.offshore), color: 'var(--cat-offshore)' })
      + `<p class="fmk-note">${split.measured ? 'Répartition mesurée (éCO2mix).' : 'Répartition estimée à partir du référentiel des parcs.'}</p>`;
  }
  html += kvRow('Parcs actifs', String(live.parcs_actifs)) + kvRow('Parcs terrestres', String(onshoreCount)) + kvRow('Parcs en mer', String(offshoreCount));
  return { id: 'split', title: 'Terre et mer', collapsible: true, open: open('split', true), summary: `${parks.length} parcs`, html };
}

function parksSection(parks: readonly EolienParkSummary[], open: WindViewInput['open']): FicheSection {
  const top = [...parks].sort((a, b) => (b.capacityMw ?? 0) - (a.capacityMw ?? 0)).slice(0, TOP_PARKS);
  const html = top.length === 0 ? emptyLine('Référentiel des parcs non chargé.') : top.map((p) => listRow({
    text: p.name, value: formatMw(p.capacityMw),
    color: p.kind === 'offshore' ? 'var(--cat-offshore)' : p.kind === 'onshore' ? 'var(--cat-onshore)' : null,
    level: p.kind === 'unknown' ? 'gris' : null,
    note: [p.region ?? 'France', p.commune, p.kind === 'offshore' ? 'mer' : p.kind === 'onshore' ? 'terre' : 'type non précisé',
      STATUS_WORD[p.status], p.estimatedProductionMw != null ? `≈ ${formatMw(p.estimatedProductionMw)} estimés` : null].filter(Boolean).join(' · '),
    data: { 'eolien-park': p.id }, link: true,
  })).join('') + (top.length > 0 ? '<p class="fmk-note">Clic sur un parc : recentrer la carte.</p>' : '');
  return { id: 'parks', title: 'Parcs', collapsible: true, open: open('parks', false), summary: `${TOP_PARKS} plus grands · production estimée`, html };
}

function sourcesSection(live: EolienLive | null, now: number, open: WindViewInput['open']): FicheSection {
  const source = (linkHtml: string, role: string): string =>
    `<div class="fmk-kv"><span class="fmk-kv-k">${linkHtml}</span><span class="fmk-kv-v">${role}</span></div>`;
  const stamp = live ? absoluteTime(live.timestamp.getTime(), now, 'fr') : null;
  const late = live !== null && isLate(live, now);
  const odre = stamp ? `données de ${stamp}${late ? ' (en retard)' : ''}` : 'aucune donnée reçue';
  const html = `<p class="fmk-note">Production estimée par parc : production nationale répartie au prorata de la puissance installée, terre et mer séparément ; ce n’est pas une mesure. `
    + `État du vent : faible sous 3${NBSP}GW, modéré sous 18${NBSP}% de facteur de charge, soutenu au-delà.</p>`
    + source(sourceLinkHtml('ODRÉ éCO2mix', 'https://odre.opendatasoft.com/explore/dataset/eco2mix-national-tr/'), odre)
    + source(sourceLinkHtml('BRGM Géorisques', 'https://www.georisques.gouv.fr'), 'parcs terrestres')
    + source('Parcs en mer', 'référentiel local');
  return { id: 'sources', title: 'Méthode et sources', collapsible: true, open: open('sources', false), tone: 'reference', summary: 'ODRÉ éCO2mix · BRGM', html };
}

export function buildWindView(input: WindViewInput): LayerView {
  const { live, parks, grid, error, now, open } = input;
  if (!live) {
    const sources = sourcesSection(null, now, open);
    return error
      ? { head: { theme: THEME, title: TITLE, status: ['Source injoignable'] }, sections: [sources], bodyHtml: sourceErrorCallout(null, now) }
      : { head: { theme: THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const word = windWord(live.alertLevel);
  const late = isLate(live, now);
  const split = splitOf(live, grid);
  const fc = formatPct(live.facteur_charge * 100);
  const stamp = absoluteTime(live.timestamp.getTime(), now, 'fr');
  return {
    head: {
      theme: THEME, title: TITLE,
      // Le chiffre prend la couleur de l'état du vent (vent faible : orange), sauf donnée en retard.
      figure: {
        value: formatGw(live.production_gw * 1000),
        level: late ? null : WIND_LEVEL[live.alertLevel],
        caption: `${fc} des ${formatGw(live.puissance_installee * 1000)} installés · éCO2mix ${stamp}${late ? ' (en retard)' : ''}`,
        captionHtml: `${valueHtml(fc, late ? null : WIND_LEVEL[live.alertLevel])} ${escapeHtml(`des ${formatGw(live.puissance_installee * 1000)} installés · éCO2mix ${stamp}${late ? ' (en retard)' : ''}`)}`,
      },
      status: [`vent ${word}${late ? ' (en retard)' : ''}`, split ? `terre ${formatGw(split.onshore)} · mer ${formatGw(split.offshore)}` : '', 'ODRÉ'],
      lead: `Vent ${word} : ${formatGw(live.production_gw * 1000)}, soit ${fc} de la puissance installée.${late ? ` Donnée en retard, relevée à ${stamp}.` : ''}`,
    },
    sections: [daySection(grid, now, open), splitSection(live, parks, split, now, open), parksSection(parks, open), sourcesSection(live, now, open)],
  };
}
