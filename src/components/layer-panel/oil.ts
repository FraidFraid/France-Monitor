// src/components/layer-panel/oil.ts : vue pure du panneau Pétrole (spec lot 2) ; aucun accès réseau ni DOM.
import type {
  FuelPriceSeries, FuelPriceSeriesKey, FuelTensionBadge, FuelTensionDashboard, FuelTensionDepartmentSummary, FuelTensionLevel,
  FuelType, OilDashboard, OilFreshnessInfo, OilFreshnessLevel, OilVigilanceStatus,
} from '../../types/index.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { FUEL_TENSION_THRESHOLDS } from '../../services/fuel-tension.ts';
import {
  filterFuelPriceSeries, renderFuelPriceChartSvg, type FuelPriceChartRange,
} from '../../utils/fuelPriceChart.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import {
  NBSP, formatCents, formatDays, formatEuro, formatMtYear, formatPct, formatSignedPct, formatTons, frNumber,
} from './format.ts';
import { barRow, emptyLine, listRow, loadingBody, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';

export type OilTab = 'overview' | 'departments' | 'supply';
export const OIL_TABS: readonly OilTab[] = ['overview', 'departments', 'supply'];

export interface OilViewInput {
  data: OilDashboard | null;
  tension: FuelTensionDashboard | null;
  enabled: boolean;
  tab: OilTab;
  range: FuelPriceChartRange;
  search: string;
  mapVisible: boolean;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

const THEME = 'Énergie';
const TITLE = 'Pétrole';
const STOCK_BAR_DAYS = 120;
const STOCK_THRESHOLD_DAYS = 30;

const OIL_PANEL_DESCRIPTION = 'Deux lectures complémentaires : une référence France structurale, et une vue harmonisée plus fraîche mais provisoire.';
const OIL_PANEL_SOURCES_TEXT = 'Référence France : SDES, INSEE, CPDP/UFIP, data.gouv';
const OIL_PANEL_COMPLEMENT_TEXT = 'Complément de fraîcheur : JODI Oil, JODI Gas, UFIP mensuel';
const OIL_PANEL_DAILY_TEXT = 'Vue quotidienne : prix et ruptures carburants, pas volumes livrés';
const OIL_PANEL_FRESHNESS_TEXT = 'Vue JODI/UFIP : plus fraîche pour 2025–2026, mais méthodologie mixte et provisoire.';
const OIL_PANEL_DISCLAIMER_TEXT = 'Limite : pas de télémesure en direct du raffinage, des oléoducs ni des livraisons en station.';
const STOCKS_METHOD_TEXT = 'Jours de stock : stocks physiques en France rapportés à la consommation moyenne (méthode France Monitor) ; la méthode de l’AIE rapporte les stocks aux importations nettes.';
const STRUCTURAL_TEXT = 'Vue France structurale (SDES, CPDP) : référence pour les stocks, les flux, les origines, les capacités et le raffinage.';
const HARMONIZED_TEXT = 'Séries JODI et UFIP, plus récentes que la vue France mais de méthodologie mixte : à lire comme un signal provisoire.';

/** Produits JODI en français. */
const PRODUCT_FR: Readonly<Record<string, string>> = {
  gasoline: 'Essence', diesel: 'Gazole', 'jet fuel': 'Kérosène', kerosene: 'Kérosène', lpg: 'GPL',
  'fuel oil': 'Fioul lourd', naphtha: 'Naphta', 'gas/diesel oil': 'Gazole',
};
function productFr(name: string): string {
  return PRODUCT_FR[name.trim().toLowerCase()] ?? name;
}

const TENSION_LEVEL: Record<FuelTensionLevel, VigilanceLevel> = { LOW: 'vert', MEDIUM: 'jaune', HIGH: 'orange', CRITICAL: 'rouge' };
const TENSION_WORD: Record<FuelTensionLevel, string> = { LOW: 'faible', MEDIUM: 'modérée', HIGH: 'forte', CRITICAL: 'critique' };
const TENSION_RANK: Record<FuelTensionLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const FRESHNESS_WORD: Record<OilFreshnessLevel, string> = {
  HYBRID: 'mixte', MONTHLY: 'mensuel', STRUCTURAL: 'structurel', DAILY: 'quotidien', PROVISIONAL: 'provisoire',
};
const BADGE_WORD: Record<FuelTensionBadge, string> = { LIVE: 'en direct', 'QUASI-LIVE': 'quasi direct', NO_DATA: 'sans données' };
const REFINERY_WORD = { active: 'en activité', maintenance: 'en maintenance', offline: 'à l’arrêt' } as const;
const FUEL_WORD: Record<FuelType, string> = { gazole: 'gazole', sp95: 'SP95', sp98: 'SP98', e10: 'E10' };
const VIGILANCE_WORD: Record<OilVigilanceStatus, { word: string; level: VigilanceLevel | null }> = {
  normal: { word: 'normale', level: 'vert' }, tense: { word: 'sous tension', level: 'orange' },
  critical: { word: 'critique', level: 'rouge' }, unknown: { word: 'n.d.', level: null },
};

export function tensionLevel(level: FuelTensionLevel): VigilanceLevel {
  return TENSION_LEVEL[level];
}

export function stockLevel(days: number): VigilanceLevel {
  return days < 30 ? 'rouge' : days <= 40 ? 'jaune' : 'vert';
}

export function priceDeltaLevel(cents: number | null): VigilanceLevel | null {
  if (cents === null || !Number.isFinite(cents)) return null;
  return cents >= 0.5 ? 'orange' : cents <= -0.5 ? 'vert' : null;
}

export function fuelCatVar(fuel: FuelPriceSeriesKey): string {
  return `var(--cat-${fuel})`;
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return n > 1 ? many : one;
}

/** Âge d'un relevé : minutes, heures ou jours (une décimale), valeur et unité insécables. */
function formatAge(min: number | null): string {
  if (min === null || !Number.isFinite(min)) return 'n.d.';
  if (min < 60) return `${Math.round(min)}${NBSP}min`;
  if (min < 1440) return `${frNumber(min / 60, 1)}${NBSP}h`;
  return `${frNumber(min / 1440, 1)}${NBSP}j`;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Instants de tous les points, triés et sans doublon. */
function timeline(series: readonly FuelPriceSeries[]): number[] {
  const set = new Set<number>();
  for (const s of series) for (const p of s.points) {
    const t = Date.parse(p.timestamp);
    if (Number.isFinite(t)) set.add(t);
  }
  return [...set].sort((a, b) => a - b);
}

/** Instant du point le plus proche de la position `ratio` (0 à 1) de l'axe du temps ; null sans point. */
export function nearestTimestamp(series: readonly FuelPriceSeries[], ratio: number): number | null {
  const times = timeline(series);
  if (times.length === 0) return null;
  const first = times[0];
  const target = first + Math.max(0, Math.min(1, ratio)) * (times[times.length - 1] - first);
  return times.reduce((best, t) => (Math.abs(t - target) < Math.abs(best - target) ? t : best), first);
}

export function fuelTooltipHtml(series: readonly FuelPriceSeries[], at: number): string {
  const date = new Date(at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' });
  const rows = series.map((s) => {
    const point = s.points.find((p) => Date.parse(p.timestamp) === at);
    return `<div><span class="lp-swatch" style="background:${fuelCatVar(s.fuelType)}"></span>${escapeHtml(s.label)} ${valueHtml(point ? formatEuro(point.price) : 'n.d.')}</div>`;
  }).join('');
  return `<b class="fmk-num">${escapeHtml(date)}</b>${rows}`;
}

/** « 2025-12 » → « décembre 2025 », « 2026-09-30 » → « 30/09/2026 », « en août 2026 » tel quel : jamais de date brute ni « au en ». */
function asOfWords(asOf: string): string {
  return asOf.split(' · ').map((part) => {
    const t = part.trim();
    const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (day) return `${day[3]}/${day[2]}/${day[1]}`;
    return /^\d{4}-\d{2}$/.test(t) ? (monthLabel(t) ?? t) : t;
  }).filter((t) => t.length > 0).join(' · ');
}

/** Texte des sources en français (« live » → « en direct »). */
function frenchDetail(text: string): string {
  return text.replace(/\blive\b/gi, 'en direct').replace(/\bbackbone\b/gi, 'socle')
    .replace(/\bVue STRUCTURAL\b/g, 'Vue structurelle').replace(/\bVue DAILY\b/g, 'Vue quotidienne');
}

function freshnessText(info: OilFreshnessInfo): string {
  return `${FRESHNESS_WORD[info.level]} · ${frenchDetail(info.detail)}${info.asOf ? ` · ${asOfWords(info.asOf)}` : ''}`;
}

/** Note de fraîcheur courte sous une section (cadence et dernière date) ; le texte détaillé est dans « Méthode et sources ». */
function freshnessNote(info: OilFreshnessInfo): string {
  return `<p class="fmk-note">${escapeHtml(`Fraîcheur : ${shortFreshness(info)}`)}</p>`;
}

function note(text: string): string {
  return `<p class="fmk-note">${escapeHtml(text)}</p>`;
}

/**
 * Prix du gazole : moyenne nationale de la tension carburants quand ses relevés sont récents, sinon dernier prix de
 * l'historique (plus récent) ; `at` = date du point d'historique utilisé, pour la légende (null : relevé du jour).
 */
function gasolePrice(data: OilDashboard, tension: FuelTensionDashboard | null, now: number): { price: number | null; delta: number | null; at: number | null } {
  const gazole = data.fuelPriceHistory?.series.find((s) => s.fuelType === 'gazole');
  const delta = gazole?.delta7dCents ?? null;
  const fresh = tension !== null && !tensionStale(tension, now) ? tension.national.avgPrices.gazole ?? null : null;
  if (fresh !== null) return { price: fresh, delta, at: null };
  const last = gazole?.points.at(-1);
  const at = last ? Date.parse(last.timestamp) : NaN;
  const price = gazole?.latestPrice ?? tension?.national.avgPrices.gazole ?? null;
  // Repli sur la moyenne de relevés anciens : on la date par l'heure de ces relevés.
  const staleAt = gazole?.latestPrice == null && tension !== null && price !== null ? tensionDataTime(tension) : NaN;
  return { price, delta, at: Number.isFinite(at) ? at : Number.isFinite(staleAt) ? staleAt : null };
}

function activeRefineries(data: OilDashboard): number {
  return data.refineries.filter((r) => r.status === 'active').length;
}

/** Au-delà de 24 h sans aucun relevé de station dans le flux, la tension n'est plus évaluable (un prix stable n'est pas un relevé ancien). */
const STALE_TENSION_MS = 24 * 3_600_000;

/** Heure des données de tension : fraîcheur du flux (dernier relevé de station), sinon l'heure de lecture. */
function tensionDataTime(tension: FuelTensionDashboard): number {
  const latest = tension.national.latestUpdateAt ? Date.parse(tension.national.latestUpdateAt) : NaN;
  return Number.isFinite(latest) ? latest : Date.parse(tension.generatedAt);
}

function tensionStale(tension: FuelTensionDashboard, now: number): boolean {
  const t = tensionDataTime(tension);
  return Number.isFinite(t) && now - t > STALE_TENSION_MS;
}

/** Relevés anciens : une note en tête de section, aucune couleur de niveau ni mot de tension. */
function staleNote(tension: FuelTensionDashboard, now: number): string {
  return note(`Relevés des stations du ${absoluteTime(tensionDataTime(tension), now, 'fr', { withDate: true })} : tension non évaluée.`);
}

function tensionSentence(tension: FuelTensionDashboard | null, now: number): string | null {
  if (!tension) return null;
  if (tension.degraded) return 'Signal carburants en mode dégradé.';
  if (tensionStale(tension, now)) {
    return `Relevés des stations anciens (${absoluteTime(tensionDataTime(tension), now, 'fr')}) : la tension n’est pas évaluée.`;
  }
  const { tensionLevel: level, anomalyShare } = tension.national;
  if (level === 'LOW') return 'Pas de tension d’approvisionnement.';
  return `Tension ${TENSION_WORD[level]} sur les carburants : ${formatPct(anomalyShare, 1)} de stations en anomalie.`;
}

function leadOf(data: OilDashboard, tension: FuelTensionDashboard | null, now: number): string {
  const active = activeRefineries(data);
  return [
    tensionSentence(tension, now),
    `Stocks stratégiques : ${frNumber(data.stocks.nationalStocksDays, Number.isInteger(data.stocks.nationalStocksDays) ? 0 : 1)}${NBSP}jours.`,
    `${active} ${plural(active, 'raffinerie')} sur ${data.refineries.length} en activité.`,
  ].filter((s): s is string => s !== null).join(' ');
}

function statusOf(tension: FuelTensionDashboard | null, now: number): string[] {
  if (!tension) return ['tension carburants : chargement…', 'prix-carburants'];
  if (tensionStale(tension, now)) {
    return ['tension non évaluée : relevés anciens', `données de ${absoluteTime(tensionDataTime(tension), now, 'fr')} (en retard)`, 'prix-carburants'];
  }
  const time = `données de ${absoluteTime(tensionDataTime(tension), now, 'fr')}`;
  return [`${formatPct(tension.national.anomalyShare, 1)} de stations en anomalie`, time, 'prix-carburants'];
}

function headOf(data: OilDashboard, tension: FuelTensionDashboard | null, now: number): LayerView['head'] {
  const { price, delta, at } = gasolePrice(data, tension, now);
  const day = at === null ? null : new Date(at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });
  const today = new Date(now).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });
  const caption = day !== null && day !== today ? `gazole, moyenne nationale du ${day}` : 'gazole, moyenne nationale';
  const level = tension === null ? null : tension.degraded || tensionStale(tension, now) ? 'nd' : tensionLevel(tension.national.tensionLevel);
  return {
    theme: THEME,
    title: TITLE,
    figure: {
      value: formatEuro(price),
      caption,
      ...(delta === null ? {} : { captionHtml: `${caption} · ${valueHtml(`${formatCents(delta)} en 7${NBSP}j`, priceDeltaLevel(delta))}` }),
    },
    level,
    status: statusOf(tension, now),
    lead: leadOf(data, tension, now),
  };
}

function bodyCallouts(data: OilDashboard, tension: FuelTensionDashboard | null): string {
  let html = '';
  if (data.meta.partialData) html += '<p class="fmk-callout">Une ou plusieurs sources pétrolières ont basculé sur des valeurs de repli consolidées.</p>';
  if (tension?.degraded) {
    html += `<p class="fmk-callout">Tension carburants en mode dégradé : ${escapeHtml(tension.errorMessage ?? 'données indisponibles sur ce cycle')}.</p>`;
  }
  return html;
}

// ─── Vue d'ensemble ───────────────────────────────────────────────────────

function priceDeltas(s: FuelPriceSeries): string {
  const d7 = valueHtml(`${formatCents(s.delta7dCents)} en 7${NBSP}j`, priceDeltaLevel(s.delta7dCents));
  const d30 = valueHtml(`${formatCents(s.delta30dCents)} en 30${NBSP}j`, priceDeltaLevel(s.delta30dCents));
  return `${d7} · ${d30}`;
}

function pricesSection(input: OilViewInput, data: OilDashboard): FicheSection {
  const { tension, range, open } = input;
  const { price } = gasolePrice(data, tension, input.now);
  const history = data.fuelPriceHistory;
  const base = { id: 'prices', title: 'Prix à la pompe', summary: escapeHtml(`gazole ${formatEuro(price)}`), collapsible: true, open: open('prices', true) };
  if (!history || history.series.length === 0) {
    const state = data.sourceStatus.fuelPrices === 'error' ? 'erreur amont' : 'données indisponibles';
    const averages = tension ? (['gazole', 'sp95', 'sp98', 'e10'] as const)
      .map((f) => [f, tension.national.avgPrices[f]] as const)
      .filter((e): e is readonly [FuelType, number] => e[1] !== undefined)
      .map(([f, v]) => kvRow(f === 'gazole' ? 'Gazole' : FUEL_WORD[f], valueHtml(formatEuro(v)))).join('') : '';
    const html = emptyLine('Historique des prix indisponible sur ce cycle.')
      + note('L’historique journalier n’a pas pu être reconstruit, mais les niveaux de prix et de ruptures restent visibles. Ce bloc ne mesure pas des volumes livrés.')
      + averages
      + note(`Source prix carburants : ${state} · signal de prix et de ruptures uniquement.`)
      + freshnessNote(data.meta.freshness.fuelPrices);
    return { ...base, html };
  }
  const series = filterFuelPriceSeries(history, range).map((s) => ({ ...s, color: fuelCatVar(s.fuelType) }));
  const toggle = (value: FuelPriceChartRange, label: string): string =>
    `<button type="button" class="lp-toggle" data-oil-range="${value}" aria-pressed="${range === value}">${label}</button>`;
  const svg = renderFuelPriceChartSvg(series, { width: 384, height: 170, showAxes: true });
  const chart = svg ? `<div class="lp-fuel-chart">${svg}<div class="lp-tip" hidden></div></div>` : emptyLine('Historique carburants indisponible.');
  const legend = series.map((s) => listRow({
    text: s.label, color: fuelCatVar(s.fuelType), value: formatEuro(s.latestPrice), noteHtml: priceDeltas(s),
  })).join('');
  const html = `<div class="lp-seg" role="group" aria-label="Période">${toggle('1m', '1 mois')}${toggle('1y', '1 an')}</div>`
    + chart + legend
    + note(`${history.sourceLabel} · vue ${range === '1m' ? '1 mois' : '1 an'} · prix et disponibilité, pas volumes livrés.`)
    + freshnessNote(data.meta.freshness.fuelPrices);
  return { ...base, html };
}

/** Écart de prix en centimes : seul le nombre est coloré (≥ 0,5 c orange, ≤ −0,5 c vert). */
function deltaAtom(cents: number | null, neutral = false): string {
  return valueHtml(formatCents(cents), neutral ? null : priceDeltaLevel(cents));
}

function rankedSummaries(list: readonly FuelTensionDepartmentSummary[], stale = false): FuelTensionDepartmentSummary[] {
  return [...list].sort((a, b) => (stale ? 0 : TENSION_RANK[a.tensionLevel] - TENSION_RANK[b.tensionLevel]) || b.anomalyShare - a.anomalyShare);
}

function tensionSection(input: OilViewInput): FicheSection {
  const { tension, open, now } = input;
  const stale = tension !== null && tensionStale(tension, now);
  const base = { id: 'tension', title: 'Tension carburants', collapsible: true, open: open('tension', true) };
  if (!tension) return { ...base, summary: 'chargement…', html: emptyLine('Signal carburants en cours de lecture…') };
  const n = tension.national;
  const rows = rankedSummaries(n.topDepartments, stale).slice(0, 5).map((d) => listRow({
    text: `${d.departmentName} (${d.departmentCode})`, value: formatPct(d.anomalyShare, 1), level: stale ? 'gris' : tensionLevel(d.tensionLevel),
    noteHtml: `${escapeHtml(`${stale ? '' : `tension ${TENSION_WORD[d.tensionLevel]} · `}écart 7${NBSP}j :`)} ${deltaAtom(d.deltaPrice7d, stale)}`,
  })).join('');
  const averages = input.data?.fuelPriceHistory && input.data.fuelPriceHistory.series.length > 0
    ? (['gazole', 'sp95', 'sp98', 'e10'] as const)
      .map((f) => [f, n.avgPrices[f]] as const)
      .filter((e): e is readonly [FuelType, number] => e[1] !== undefined)
      .map(([f, v]) => kvRow(`Prix moyen ${FUEL_WORD[f]}`, valueHtml(formatEuro(v)))).join('')
    : '';
  const html = (stale ? staleNote(tension, now) : '')
    + kvRow('Anomalies nationales', valueHtml(formatPct(n.anomalyShare, 1), !stale && n.anomalyShare >= FUEL_TENSION_THRESHOLDS.highAnomalyShare ? 'orange' : null))
    + kvRow('Dernier changement de prix', escapeHtml(`moyenne ${formatAge(n.avgUpdateAgeMinutes)} · médiane ${formatAge(n.medianUpdateAgeMinutes)}`))
    + averages
    + `<h4 class="fmk-eyebrow">${stale ? 'Départements (relevés anciens)' : 'Départements les plus tendus'}</h4>` + rows
    + '<p class="fmk-note">Liste complète dans l’onglet Départements.</p>'
    + note(`${tension.sourceLabel} · ${tension.coverageLabel} · relevé lu à ${absoluteTime(Date.parse(tension.generatedAt), now, 'fr')}`);
  return { ...base, summary: escapeHtml(`${n.stationCount.toLocaleString('fr-FR')} stations · ${n.departmentCount} départements`), html };
}

const TREND_WORD = { up: 'en hausse', down: 'en baisse', stable: 'stable' } as const;

function stocksSection(input: OilViewInput, data: OilDashboard): FicheSection {
  const { stocks, meta } = data;
  const days = stocks.nationalStocksDays;
  const vigilance = VIGILANCE_WORD[meta.status];
  const rows = stocks.byProduct.map((p) => barRow({
    label: p.product, pct: (p.daysCover / STOCK_BAR_DAYS) * 100, value: formatDays(p.daysCover), level: stockLevel(p.daysCover),
    noteHtml: `${escapeHtml(formatTons(p.stocksTons))} · ${valueHtml(TREND_WORD[p.trend], p.trend === 'up' ? 'vert' : p.trend === 'down' ? 'orange' : null)}`,
  })).join('');
  const html = rows
    + kvRow('Total', escapeHtml(`${formatDays(days)} · ${formatTons(stocks.totalStocksTons)}`))
    + kvRow('Indice de vigilance', valueHtml(`${meta.vigilanceScore} sur 100 · ${vigilance.word}`, vigilance.level))
    + note(`Barre sur ${STOCK_BAR_DAYS} jours ; rouge sous ${STOCK_THRESHOLD_DAYS} jours, jaune de 30 à 40.`)
    + freshnessNote(meta.freshness.dashboard);
  return {
    id: 'stocks', title: 'Stocks stratégiques', summary: escapeHtml(`${formatDays(days)} · seuil ${formatDays(STOCK_THRESHOLD_DAYS)}`),
    collapsible: true, open: input.open('stocks', true), html,
  };
}

function refineriesSection(input: OilViewInput, data: OilDashboard): FicheSection {
  const list = data.refineries;
  const total = list.reduce((sum, r) => sum + r.capacityMtPerYear, 0);
  const html = list.map((r) => listRow({
    text: r.name, value: formatMtYear(r.capacityMtPerYear),
    level: r.status === 'active' ? 'vert' : r.status === 'maintenance' ? 'jaune' : 'gris',
    note: `${r.operator} · ${r.region} · ${REFINERY_WORD[r.status]}`,
  })).join('') + freshnessNote(data.meta.freshness.infrastructure);
  return {
    id: 'refineries', title: 'Raffineries', summary: escapeHtml(`${activeRefineries(data)} sur ${list.length} en activité · ${formatMtYear(total)}`),
    collapsible: true, open: input.open('refineries', false), html,
  };
}

/** Fraîcheur courte : cadence et dernière date seulement (« mensuel · août 2026 »), le détail reste dans les détails repliés. */
function shortFreshness(info: OilFreshnessInfo): string {
  const parts = info.asOf ? asOfWords(info.asOf).split(' · ') : [];
  const last = parts.length > 0 ? parts[parts.length - 1].replace(/^en\s+/, '') : '';
  return `${FRESHNESS_WORD[info.level]}${last ? ` · ${last}` : ''}`;
}

const METHOD_TEXT = 'Tension carburants : part des stations en rupture temporaire sur un carburant principal (gazole, SP95, E10, SP98), par département ; '
  + 'une rupture définitive (carburant non vendu) n’est pas comptée. '
  + `Non évaluée quand le dernier relevé du flux a plus de 24${NBSP}h. Stocks en jours de consommation, seuil 30${NBSP}jours. `
  + 'Vue harmonisée JODI et UFIP : signal provisoire.';

function methodSection(input: OilViewInput, data: OilDashboard): FicheSection {
  const f = data.meta.freshness;
  const t = input.tension;
  const now = input.now;
  // Une ligne par source, comme les autres panneaux : lien, cadence, date.
  const sourceRow = (label: string, source: string, text: string): string => kvRow(label, `${source} · ${escapeHtml(text)}`);
  const rows = sourceRow('Prix et stations', sourceLinkHtml('prix-carburants', 'https://www.prix-carburants.gouv.fr'),
    t ? `relevé lu à ${absoluteTime(Date.parse(t.generatedAt), now, 'fr')}` : 'n.d.')
    + kvRow('Historique des prix', escapeHtml(shortFreshness(f.fuelPrices)))
    + sourceRow('Stocks, flux, origines', sourceLinkHtml('SDES', 'https://www.statistiques.developpement-durable.gouv.fr'), shortFreshness(f.dashboard))
    + sourceRow('Livraisons', sourceLinkHtml('UFIP', 'https://www.ufip.fr'), shortFreshness(f.deliveries))
    + sourceRow('Raffineries', escapeHtml('SDES'), shortFreshness(f.infrastructure))
    + sourceRow('Vue harmonisée', sourceLinkHtml('JODI', 'https://www.jodidata.org'), shortFreshness(f.harmonized))
    + kvRow('Données pétrole lues à', valueHtml(absoluteTime(Date.parse(data.meta.lastUpdate), now, 'fr')));
  // Rien ne disparaît : les textes méthodologiques complets restent consultables, repliés.
  const fresh = (label: string, info: OilFreshnessInfo): string => kvRow(label, escapeHtml(freshnessText(info)));
  const details = [OIL_PANEL_DESCRIPTION, STRUCTURAL_TEXT, HARMONIZED_TEXT, OIL_PANEL_SOURCES_TEXT, OIL_PANEL_COMPLEMENT_TEXT, OIL_PANEL_DAILY_TEXT, OIL_PANEL_FRESHNESS_TEXT, STOCKS_METHOD_TEXT].map(note).join('')
    + fresh('Stocks, flux et origines', f.dashboard) + fresh('Livraisons', f.deliveries) + fresh('Raffineries', f.infrastructure)
    + fresh('Vue harmonisée', f.harmonized) + fresh('Prix', f.fuelPrices)
    + note('Heure des données : dernier relevé du flux. L’âge du dernier changement de prix de chaque station est une information, pas une anomalie.')
    + (data.fuelPriceHistory?.sourceLabel ? note(`Historique des prix : ${data.fuelPriceHistory.sourceLabel}.`) : '')
    + (data.harmonized?.caveat ? note(data.harmonized.caveat) : '')
    + (t ? note(t.disclaimerFr) : '')
    + note(OIL_PANEL_DISCLAIMER_TEXT)
    + (t ? note(`${t.sourceLabel} · ${t.coverageLabel}`) : '');
  const html = `<p class="fmk-note">${escapeHtml(METHOD_TEXT)}</p>` + rows
    + `<details class="lp-more"><summary>Détails méthodologiques</summary>${details}</details>`;
  return {
    id: 'method', title: 'Méthode et sources', summary: '6 sources',
    collapsible: true, open: input.open('method', false), tone: 'reference', html,
  };
}

// ─── Départements ─────────────────────────────────────────────────────────

function departmentsSections(input: OilViewInput): FicheSection[] {
  const { tension, search, mapVisible, now } = input;
  const toolbar = `<div class="lp-toolbar"><input type="search" class="lp-search" data-oil-search value="${escapeHtml(search)}" placeholder="Rechercher un département" aria-label="Rechercher un département">`
    + `<button type="button" class="lp-toggle" data-oil-map aria-pressed="${mapVisible}">${mapVisible ? 'Masquer de la carte' : 'Afficher sur la carte'}</button></div>`;
  const base = { id: 'departments', title: 'Départements', collapsible: false };
  if (!tension) return [{ ...base, summary: 'chargement…', html: toolbar + emptyLine('Signal carburants en cours de lecture…') }];
  const stale = tensionStale(tension, now);
  const query = fold(search.trim());
  const shown = rankedSummaries(tension.summaries.filter((d) => query === '' || fold(d.departmentName).includes(query) || fold(d.departmentCode).includes(query)), stale);
  const rows = shown.map((d) => {
    const prices = d.fuelSignals.filter((s) => s.avgPrice !== null).map((s) => `${FUEL_WORD[s.fuelType]} ${formatEuro(s.avgPrice)}`);
    const before = [...(stale ? [] : [`tension ${TENSION_WORD[d.tensionLevel]}`]), `${d.stationCount} stations`].join(' · ');
    const after = [
      `dernier changement de prix il y a ${formatAge(d.avgUpdateAgeMinutes)}`, ...(prices.length > 0 ? prices : ['prix indisponibles']), `signal ${BADGE_WORD[d.freshness.badge]}`,
    ].join(' · ');
    return listRow({
      text: `${d.departmentName} (${d.departmentCode})`, value: formatPct(d.anomalyShare, 1), level: stale ? 'gris' : tensionLevel(d.tensionLevel),
      noteHtml: `${escapeHtml(`${before} · écart 7${NBSP}j`)} ${deltaAtom(d.deltaPrice7d, stale)}${escapeHtml(` · ${after}`)}`,
    });
  }).join('');
  const html = toolbar + (stale ? staleNote(tension, now) : '') + (rows || emptyLine('Aucun département ne correspond à la recherche.'))
    + note(`Tri : ${stale ? 'part d’anomalies décroissante' : 'niveau de tension, puis part d’anomalies décroissante'}. La carte peut être masquée sans couper la synthèse nationale.`);
  return [{ ...base, summary: `${shown.length} sur ${tension.summaries.length}`, html }];
}

// ─── Approvisionnement ────────────────────────────────────────────────────

function flowsSection(input: OilViewInput, data: OilDashboard): FicheSection {
  const f = data.flows;
  const net = f.netImportTonsPerDay;
  const balance = net >= 0 ? `import net ${formatTons(net)}/j` : `export net ${formatTons(-net)}/j`;
  const tone = (text: string, cls: 'lp-imp' | 'lp-exp'): string => `<span class="${cls}">${escapeHtml(text)}</span>`;
  const html = kvRow('Import', tone(`${formatTons(f.importTonsPerDay)}/j`, 'lp-imp'))
    + kvRow('Export', tone(`${formatTons(f.exportTonsPerDay)}/j`, 'lp-exp'))
    + kvRow('Solde', tone(balance, net >= 0 ? 'lp-imp' : 'lp-exp'))
    + kvRow('Tendance', valueHtml(TREND_WORD[f.trend], f.trend === 'up' ? 'orange' : f.trend === 'down' ? 'vert' : null))
    + note('Flux estimés à partir d’un bilan annuel et de signaux mensuels, pas de flux mesurés en direct.')
    + freshnessNote(data.meta.freshness.dashboard);
  return { id: 'flows', title: 'Flux', summary: tone(balance, net >= 0 ? 'lp-imp' : 'lp-exp'), collapsible: true, open: input.open('flows', true), html };
}

function originsSection(input: OilViewInput, data: OilDashboard): FicheSection {
  const top = data.origins.slice(0, 4);
  const base = { id: 'origins', title: 'Origine du brut', collapsible: true, open: input.open('origins', true) };
  if (top.length === 0) return { ...base, summary: 'n.d.', html: emptyLine('Origines du brut non publiées.') };
  const html = top.map((o) => barRow({
    label: o.label, pct: o.sharePct, value: formatPct(o.sharePct, 1), color: 'var(--cat-crude)', dot: false, note: o.sourceLabel ?? null,
  })).join('') + freshnessNote(data.meta.freshness.dashboard);
  return { ...base, summary: escapeHtml(`${top[0].label} ${formatPct(top[0].sharePct, 1)}`), html };
}

function deliveriesSection(input: OilViewInput, data: OilDashboard): FicheSection {
  const d = data.deliveries[0];
  const base = { id: 'deliveries', title: 'Livraisons mensuelles', collapsible: true, open: input.open('deliveries', true) };
  if (!d) return { ...base, summary: 'n.d.', html: emptyLine('Livraisons UFIP non publiées.') };
  const period = d.periodLabel.replace(/^en\s+/i, '').trim() || d.periodLabel;
  const withYoy = (volume: string, yoy: number | null): string => {
    if (yoy === null) return escapeHtml(volume);
    const level: VigilanceLevel | null = yoy >= 0.5 ? 'orange' : yoy <= -0.5 ? 'vert' : null;
    return `${escapeHtml(volume)} · ${valueHtml(`${formatSignedPct(yoy, 1)} sur un an`, level)}`;
  };
  const total = d.totalProductsMillionTons === null ? 'n.d.' : `${frNumber(d.totalProductsMillionTons, 2)}${NBSP}Mt`;
  const road = d.roadFuelMillionM3 === null ? 'n.d.' : `${frNumber(d.roadFuelMillionM3, 3)}${NBSP}Mm³`;
  const html = kvRow('Mois', escapeHtml(period))
    + kvRow('Produits énergétiques', withYoy(total, d.totalProductsYoYPct))
    + kvRow('Carburants routiers', withYoy(road, d.roadFuelYoYPct))
    + kvRow('Publication', escapeHtml(d.publicationDate ?? 'n.d.'))
    + note(`UFIP mensuel : livraisons CPDP de produits pétroliers. ${d.sourceLabel ?? data.meta.freshness.deliveries.detail}`)
    + freshnessNote(data.meta.freshness.deliveries);
  return { ...base, summary: escapeHtml(period), html };
}

function monthLabel(month: string | null): string | null {
  if (!month) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function kbd(v: number | null): string {
  return v === null || !Number.isFinite(v) ? 'n.d.' : `${frNumber(v, 1)}${NBSP}kb/j`;
}

function harmonizedSection(input: OilViewInput, data: OilDashboard): FicheSection {
  const h = data.harmonized;
  const base = { id: 'harmonized', title: 'Vue harmonisée', collapsible: true, open: input.open('harmonized', false) };
  if (!h?.available) {
    return { ...base, summary: 'indisponible', html: emptyLine('Vue harmonisée indisponible sur ce cycle.') + note('La vue France structurale reste la référence.') };
  }
  // Mois couverts, dits une seule fois (« UFIP en août 2026 » → « UFIP août 2026 »).
  const months = [
    monthLabel(h.oilDataMonth) && `pétrole ${monthLabel(h.oilDataMonth)}`,
    monthLabel(h.gasDataMonth) && `gaz ${monthLabel(h.gasDataMonth)}`,
    h.latestUfipPeriodLabel && `UFIP ${h.latestUfipPeriodLabel.replace(/^en\s+/, '')}`,
  ].filter((s): s is string => Boolean(s));
  const products = h.oilProducts.filter((p) => p.demandKbd !== null || p.importsKbd !== null)
    .map((p) => kvRow(productFr(p.product), `demande ${valueHtml(kbd(p.demandKbd))} · imports ${valueHtml(kbd(p.importsKbd))}`)).join('');
  const lng = h.gasLngSharePct;
  const html = (months.length > 0 ? `<div class="fmk-sub">${escapeHtml(months.join(' · '))}</div>` : '')
    + products
    + (h.crudeImportsKbd !== null ? kvRow('Brut importé', valueHtml(kbd(h.crudeImportsKbd))) : '')
    + (h.gasTotalDemandTj !== null ? kvRow(`Gaz${monthLabel(h.gasDataMonth) ? ` (${monthLabel(h.gasDataMonth)})` : ''}`, valueHtml(`${frNumber(h.gasTotalDemandTj / 36_000, 1)}${NBSP}Gm³/mois`)) : '')
    + (lng !== null
      ? '<div class="fmk-sub">Importations de gaz</div>'
        + barRow({ label: 'Part du GNL', pct: lng, value: formatPct(lng), color: 'var(--cat-lng)', dot: true })
        + barRow({ label: 'Part des gazoducs', pct: Math.max(0, 100 - lng), value: formatPct(Math.max(0, 100 - lng)), color: 'color-mix(in srgb, var(--cat-lng) 45%, transparent)', dot: true })
      : '')
    // Une seule note ici ; la mise en garde complète et la fraîcheur détaillée restent dans « Méthode et sources ».
    + note(HARMONIZED_TEXT);
  return { ...base, summary: escapeHtml(`JODI et UFIP${h.provisional ? ' · provisoire' : ''}`), html };
}

// ─── Vue ──────────────────────────────────────────────────────────────────

export function buildOilView(input: OilViewInput): LayerView {
  if (!input.enabled) {
    return { head: { theme: THEME, title: TITLE, status: [] }, sections: [], bodyHtml: emptyLine('Couche désactivée sur cette instance.') };
  }
  const { data, tension, tab, now } = input;
  if (!data) return { head: { theme: THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  const tabs = [
    { id: 'overview', label: 'Vue d’ensemble' },
    { id: 'departments', label: 'Départements', count: tension?.summaries.length ?? null },
    { id: 'supply', label: 'Approvisionnement' },
  ];
  const head = headOf(data, tension, now);
  if (tab === 'departments') return { head, tabs, activeTab: tab, sections: departmentsSections(input) };
  if (tab === 'supply') {
    return {
      head, tabs, activeTab: tab,
      sections: [flowsSection(input, data), originsSection(input, data), deliveriesSection(input, data), harmonizedSection(input, data)],
    };
  }
  return {
    head, tabs, activeTab: 'overview', bodyHtml: bodyCallouts(data, tension),
    sections: [pricesSection(input, data), tensionSection(input), stocksSection(input, data), refineriesSection(input, data), methodSection(input, data)],
  };
}
