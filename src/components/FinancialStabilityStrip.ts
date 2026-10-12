// src/components/FinancialStabilityStrip.ts : bloc « Stabilité financière » sous la carte (spec 2026-10-12), à la place du
// « Flux boursier » : CISS France et zone euro, écart OAT-Bund, taux directeurs, €STR, EUR/USD (BCE) et CAC 40 en repère.
// Uniquement des valeurs réelles : une courbe n'est tracée que sur des observations publiées ou relevées. Le HTML est produit
// par une fonction pure (testée sous Node) ; la classe ne fait que l'insérer.
import type { EcbSeries, FinancialPoint, FinancialStabilityResponse, MarketData, OatBundSpread, PolicyRate } from '../types/index.ts';
import { buildMarketSparkline } from '../utils/market-sparkline.ts';
import { NBSP, frNumber } from './layer-panel/format.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import { levelColorVar, levelLabel, type VigilanceLevel } from '../services/vigilance.ts';
import {
  CISS_BANDS, CISS_HELP, SPREAD_BANDS, SPREAD_HELP, bandOf, blockLevel, thresholdsText, type LevelBand,
} from '../services/financial-stability-levels.ts';

export interface FinancialStabilityView {
  data: FinancialStabilityResponse | null;
  error: string | null;
  cac: MarketData | null;
}

const ND = 'n.d.';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** « 09/10 » ; avec l'année : « 16/09/2026 ». */
function frDate(date: string, withYear = false): string {
  const d = `${date.slice(8, 10)}/${date.slice(5, 7)}`;
  return withYear ? `${d}/${date.slice(0, 4)}` : d;
}

/** Courbe d'une ligne : observations datées (trous au-delà de 4 jours), couleur du niveau éventuelle, format de l'infobulle. */
interface Curve {
  points: readonly FinancialPoint[];
  label: string;
  format: (v: number) => string;
  color?: string;
}

const curveOf = (points: readonly FinancialPoint[] | undefined, label: string, format: (v: number) => string, color?: string): Curve =>
  ({ points: points ?? [], label, format, color });

interface Row {
  id: string;
  name: string;
  value: string;
  meta: string;
  word?: { text: string; level: VigilanceLevel };
  curve?: Curve;
  help?: string;
}

function rowHTML(r: Row): string {
  const word = r.word
    ? `<span class="fin-stab__word" style="--fin-lvl:${levelColorVar(r.word.level)}">${esc(r.word.text)}</span>`
    : '';
  const c = r.curve;
  const curve = c && c.points.length >= 2
    ? buildMarketSparkline(c.points.map((p) => p.value), 'neutral', {
      dates: c.points.map((p) => p.date), label: c.label, format: c.format, ...(c.color ? { color: c.color } : {}),
    })
    : '';
  const title = r.help ? ` title="${esc(r.help)}"` : '';
  return `<div class="fin-stab__row" data-id="${r.id}"${title}>
    <div class="fin-stab__line"><span class="fin-stab__name">${esc(r.name)}</span><span class="fin-stab__value">${esc(r.value)}</span>${word}</div>
    <div class="fin-stab__meta">${esc(r.meta)}</div>${curve}
  </div>`;
}

const SERIES_NAME: Record<EcbSeries['id'], string> = {
  cissFr: 'CISS France', cissEa: 'CISS zone euro', estr: '€STR', eurusd: 'EUR/USD (référence BCE)',
};

/** Valeur d'une série à la française, unité insécable (CISS sans unité). */
const SERIES_FORMAT: Record<EcbSeries['id'], (v: number) => string> = {
  cissFr: (v) => frNumber(v, 3),
  cissEa: (v) => frNumber(v, 3),
  estr: (v) => `${frNumber(v, 3)}${NBSP}%`,
  eurusd: (v) => `${frNumber(v, 4)}${NBSP}$`,
};

function seriesRow(s: EcbSeries | undefined, id: EcbSeries['id']): Row {
  const name = SERIES_NAME[id];
  const format = SERIES_FORMAT[id];
  if (!s || s.value === null) return { id, name, value: ND, meta: 'BCE indisponible', curve: curveOf(s?.history, '90 jours', format) };
  const date = s.date ? `au ${frDate(s.date)}` : ND;
  const meta = s.status === 'stale' ? `${date} · en retard` : date;
  if (id !== 'cissFr' && id !== 'cissEa') return { id, name, value: format(s.value), meta, curve: curveOf(s.history, '90 jours', format) };
  const band: LevelBand = bandOf(s.value, CISS_BANDS);
  return {
    id, name, value: format(s.value), meta,
    curve: curveOf(s.history, '90 jours', format, levelColorVar(band.level)),
    word: { text: band.word, level: band.level }, help: `${CISS_HELP} ${thresholdsText(CISS_BANDS, 2, '')}`,
  };
}

const RATE_NAME: Record<PolicyRate['id'], string> = { depot: 'Taux de dépôt BCE', refi: 'Taux de refinancement BCE' };

function rateRow(r: PolicyRate | undefined, id: PolicyRate['id']): Row {
  const name = RATE_NAME[id];
  if (!r || r.value === null) return { id, name, value: ND, meta: 'BCE indisponible' };
  const sense = r.previous === null || r.previous === r.value ? '' : r.previous < r.value ? ' (hausse)' : ' (baisse)';
  const meta = r.since ? `depuis le ${frDate(r.since, true)}${sense}` : ND;
  return { id, name, value: `${frNumber(r.value, 2)}${NBSP}%`, meta };
}

/** Samedi ou dimanche à Paris : TradingView rend la clôture du vendredi (revue finale I4). */
function isParisWeekend(iso: string): boolean {
  const day = new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/Paris', weekday: 'short' });
  return day === 'Sat' || day === 'Sun';
}

function spreadRow(sp: OatBundSpread | undefined): Row {
  const name = 'Écart OAT-Bund 10 ans';
  const spreadFormat = (v: number): string => `${frNumber(v, 2)}${NBSP}pt`;
  const first = sp?.history[0];
  const label = first ? `depuis le ${frDate(first.date)}` : 'relevés quotidiens';
  const curve = curveOf(sp?.history, label, spreadFormat, sp && sp.value !== null ? levelColorVar(bandOf(sp.value, SPREAD_BANDS).level) : undefined);
  const help = `${SPREAD_HELP} ${thresholdsText(SPREAD_BANDS, 1, `${NBSP}pt`)} Source : marché (TradingView), courbe relevée un point par jour.`;
  if (!sp || sp.value === null) return { id: 'spread', name, value: ND, meta: 'TradingView indisponible', curve, help };
  const band = bandOf(sp.value, SPREAD_BANDS);
  const when = sp.status === 'stale' ? 'en retard' : sp.readAt !== null && isParisWeekend(sp.readAt) ? 'clôture du vendredi' : 'en direct';
  const meta = `${when} · source : marché (TradingView)`;
  return { id: 'spread', name, value: `${frNumber(sp.value, 2)}${NBSP}pt`, meta, curve, word: { text: band.word, level: band.level }, help };
}

function cacRow(cac: MarketData | null): Row {
  if (!cac) return { id: 'cac', name: 'CAC 40', value: ND, meta: 'TradingView indisponible' };
  return { id: 'cac', name: 'CAC 40', value: frNumber(cac.price, 0), meta: `${frNumber(cac.changePercent, 2, true)}${NBSP}% sur la journée · en direct` };
}

export function buildFinancialStabilityHTML(view: FinancialStabilityView): { level: VigilanceLevel | null; stamp: string; html: string } {
  const { data } = view;
  // Rien lu (502 sans relevé gardé) : mêmes lignes en « n.d. », le CAC 40 (source indépendante) reste (revue finale I3).
  const byId = <T extends { id: string }>(list: T[] | undefined, id: string): T | undefined => list?.find((x) => x.id === id);
  const rows: Row[] = [
    seriesRow(byId(data?.series, 'cissFr'), 'cissFr'),
    seriesRow(byId(data?.series, 'cissEa'), 'cissEa'),
    spreadRow(data?.spread),
    rateRow(byId(data?.rates, 'depot'), 'depot'),
    rateRow(byId(data?.rates, 'refi'), 'refi'),
    seriesRow(byId(data?.series, 'estr'), 'estr'),
    seriesRow(byId(data?.series, 'eurusd'), 'eurusd'),
    cacRow(view.cac),
  ];
  if (!data) {
    const cause = view.error ? `<div class="fin-stab__cause">Stabilité financière indisponible : ${esc(view.error)}</div>` : '';
    return { level: null, stamp: 'Source indisponible', html: `${cause}<div class="fin-stab">${rows.map(rowHTML).join('')}</div>` };
  }
  const time = new Date(data.readAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  return { level: blockLevel(data), stamp: `MàJ ${time}`, html: `<div class="fin-stab">${rows.map(rowHTML).join('')}</div>` };
}

export class FinancialStabilityStrip {
  private readonly container: HTMLElement;
  private bodyEl: HTMLElement | null = null;
  private stampEl: HTMLElement | null = null;
  private levelEl: HTMLElement | null = null;
  private lastRenderKey: string | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const root = document.createElement('section');
    root.className = 'under-map-card under-map-card--markets under-map-card--fin-stab';
    root.innerHTML = `
      <div class="under-map-card__header">
        <div class="fin-stab__title-wrap">
          <div class="under-map-card__title">Stabilité financière</div>
          <span class="fin-stab__level">${ND}</span>
        </div>
        <div class="under-map-card__meta">Chargement…</div>
      </div>
      <div class="under-map-card__body"></div>
    `;
    this.container.appendChild(root);
    this.bodyEl = root.querySelector('.under-map-card__body');
    this.stampEl = root.querySelector('.under-map-card__meta');
    this.levelEl = root.querySelector('.fin-stab__level');
    if (this.bodyEl) this.bodyEl.innerHTML = fmLoaderHTML({ text: 'Chargement des indicateurs financiers…', variant: 'inline' });
  }

  update(view: FinancialStabilityView): void {
    if (!this.bodyEl || !this.stampEl || !this.levelEl) return;
    const key = JSON.stringify(view);
    if (key === this.lastRenderKey) return;
    this.lastRenderKey = key;
    const { level, stamp, html } = buildFinancialStabilityHTML(view);
    this.bodyEl.innerHTML = html;
    this.stampEl.textContent = stamp;
    this.levelEl.textContent = level ? levelLabel(level) : ND;
    this.levelEl.style.setProperty('--fin-lvl', level ? levelColorVar(level) : 'var(--text-muted)');
  }
}
