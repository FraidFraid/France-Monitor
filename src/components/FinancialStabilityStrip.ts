// src/components/FinancialStabilityStrip.ts : bloc « Stabilité financière » sous la carte (spec 2026-10-12), à la place du
// « Flux boursier » : CISS France et zone euro, écart OAT-Bund, taux directeurs, €STR, EUR/USD (BCE) et CAC 40 en repère.
// Uniquement des valeurs réelles : une courbe n'est tracée que sur des observations publiées ou relevées. Le HTML est produit
// par une fonction pure (testée sous Node) ; la classe ne fait que l'insérer.
import type { EcbSeries, FinancialPoint, FinancialStabilityResponse, MarketData, OatBundSpread, PolicyRate } from '../types/index.ts';
import { buildMarketSparkline } from '../utils/market-sparkline.ts';
import { NBSP, frNumber } from './layer-panel/format.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import { finTableRowHTML, type FinTableRow } from './shared/fin-table.ts';
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
function curveHTML(points: readonly FinancialPoint[] | undefined, label: string, format: (v: number) => string, color?: string): string {
  if (!points || points.length < 2) return '';
  return buildMarketSparkline(points.map((p) => p.value), 'neutral', {
    dates: points.map((p) => p.date), label, format, ...(color ? { color } : {}),
  });
}

const SERIES_NAME: Record<EcbSeries['id'], string> = {
  cissFr: 'CISS France', cissEa: 'CISS zone euro', estr: '€STR', eurusd: 'EUR/USD',
};
const SERIES_UNIT: Partial<Record<EcbSeries['id'], string>> = { eurusd: 'réf. BCE' };

/** Valeur d'une série à la française, unité insécable (CISS sans unité). */
const SERIES_FORMAT: Record<EcbSeries['id'], (v: number) => string> = {
  cissFr: (v) => frNumber(v, 3),
  cissEa: (v) => frNumber(v, 3),
  estr: (v) => `${frNumber(v, 3)}${NBSP}%`,
  eurusd: (v) => `${frNumber(v, 4)}${NBSP}$`,
};

function seriesRow(s: EcbSeries | undefined, id: EcbSeries['id']): FinTableRow {
  const name = SERIES_NAME[id];
  const unit = SERIES_UNIT[id];
  const format = SERIES_FORMAT[id];
  const base = { id, name, ...(unit ? { unit } : {}) };
  if (!s || s.value === null) return { ...base, value: ND, meta: 'BCE indisponible', curve: curveHTML(s?.history, '90 jours', format) };
  const date = s.date ? `au ${frDate(s.date)}` : ND;
  const meta = s.status === 'stale' ? `${date} · en retard` : date;
  if (id !== 'cissFr' && id !== 'cissEa') return { ...base, value: format(s.value), meta, curve: curveHTML(s.history, '90 jours', format) };
  const band: LevelBand = bandOf(s.value, CISS_BANDS);
  return {
    ...base, value: format(s.value), meta, level: band.level,
    note: { text: band.word, level: band.level },
    curve: curveHTML(s.history, '90 jours', format, levelColorVar(band.level)),
    help: `${CISS_HELP} ${thresholdsText(CISS_BANDS, 2, '')}`,
  };
}

/** Les deux taux directeurs sur une ligne ; la note donne le sens et la date du dernier changement du taux de dépôt. */
function ratesRow(depot: PolicyRate | undefined, refi: PolicyRate | undefined): FinTableRow {
  const pct = (r: PolicyRate | undefined): string => (r && r.value !== null ? frNumber(r.value, 2) : ND);
  const base = { id: 'rates', name: 'Taux BCE', unit: 'dépôt · refi', curve: '' };
  if ((!depot || depot.value === null) && (!refi || refi.value === null)) return { ...base, value: ND, meta: 'BCE indisponible' };
  const value = `${pct(depot)} · ${pct(refi)}${NBSP}%`;
  const ref = depot && depot.value !== null ? depot : refi;
  if (!ref || ref.since === null) return { ...base, value };
  const up = ref.previous !== null && ref.value !== null && ref.previous < ref.value;
  const down = ref.previous !== null && ref.value !== null && ref.previous > ref.value;
  const arrow = up ? '↑' : down ? '↓' : '';
  const sense = up ? 'hausse' : down ? 'baisse' : 'changement';
  return {
    ...base, value,
    note: { text: `${arrow ? `${arrow}${NBSP}` : ''}${frDate(ref.since)}`, tone: up ? 'up' : down ? 'down' : 'flat' },
    ...(ref.status === 'stale' ? { meta: 'en retard' } : {}),
    help: `Taux de dépôt et de refinancement de la BCE : ${sense} le ${frDate(ref.since, true)}.`,
  };
}

/** Samedi ou dimanche à Paris : TradingView rend la clôture du vendredi (revue finale I4). */
function isParisWeekend(iso: string): boolean {
  const day = new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/Paris', weekday: 'short' });
  return day === 'Sat' || day === 'Sun';
}

/** Courbe de l'écart pas encore tracée : un seul relevé enregistré (un point par jour de semaine). */
const PENDING_CURVE = '<span class="fin-row__pending">en constitution</span>';

/** Ce que mesure le bloc (26/10/2026) : sans elle, les sigles (CISS, €STR, OAT) ne disaient rien. */
const FIN_INTRO = '<p class="fin-table__intro">Tensions sur les marchés : stress mesuré par la BCE (CISS, 0 calme, 1 crise), '
  + 'écart de taux France-Allemagne, taux de la BCE, euro et CAC 40. Survoler une ligne pour le détail.</p>';

function spreadRow(sp: OatBundSpread | undefined): FinTableRow {
  const base = { id: 'spread', name: 'Écart OAT-Bund' };
  const spreadFormat = (v: number): string => `${frNumber(v, 2)}${NBSP}pt`;
  const first = sp?.history[0];
  const label = first ? `depuis le ${frDate(first.date)}` : 'relevés quotidiens';
  const help = `${SPREAD_HELP} ${thresholdsText(SPREAD_BANDS, 1, `${NBSP}pt`)} Source : marché (TradingView), courbe relevée un point par jour.`;
  if (!sp || sp.value === null) return { ...base, value: ND, meta: 'TradingView indisponible', curve: curveHTML(sp?.history, label, spreadFormat), help };
  const band = bandOf(sp.value, SPREAD_BANDS);
  const when = sp.status === 'stale' ? 'en retard' : sp.readAt !== null && isParisWeekend(sp.readAt) ? 'clôture du vendredi' : 'en direct';
  return {
    ...base, value: spreadFormat(sp.value), meta: `${when} · TradingView`, level: band.level,
    note: { text: band.word, level: band.level },
    curve: sp.history.length >= 2 ? curveHTML(sp.history, label, spreadFormat, levelColorVar(band.level)) : PENDING_CURVE, help,
  };
}

function cacRow(cac: MarketData | null): FinTableRow {
  const base = { id: 'cac', name: 'CAC 40', curve: '' };
  if (!cac) return { ...base, value: ND, meta: 'TradingView indisponible' };
  const tone = cac.changePercent > 0 ? 'up' : cac.changePercent < 0 ? 'down' : 'flat';
  return { ...base, value: frNumber(cac.price, 0), meta: 'en direct', note: { text: `${frNumber(cac.changePercent, 2, true)}${NBSP}%`, tone } };
}

export function buildFinancialStabilityHTML(view: FinancialStabilityView): { level: VigilanceLevel | null; stamp: string; html: string } {
  const { data } = view;
  // Rien lu (502 sans relevé gardé) : mêmes lignes en « n.d. », le CAC 40 (source indépendante) reste (revue finale I3).
  const byId = <T extends { id: string }>(list: T[] | undefined, id: string): T | undefined => list?.find((x) => x.id === id);
  const rows: FinTableRow[] = [
    seriesRow(byId(data?.series, 'cissFr'), 'cissFr'),
    seriesRow(byId(data?.series, 'cissEa'), 'cissEa'),
    spreadRow(data?.spread),
    ratesRow(byId(data?.rates, 'depot'), byId(data?.rates, 'refi')),
    seriesRow(byId(data?.series, 'estr'), 'estr'),
    seriesRow(byId(data?.series, 'eurusd'), 'eurusd'),
    cacRow(view.cac),
  ];
  const table = `${FIN_INTRO}<div class="fin-table">${rows.map(finTableRowHTML).join('')}</div>`;
  if (!data) {
    const cause = view.error ? `<div class="fin-table__cause">Stabilité financière indisponible : ${esc(view.error)}</div>` : '';
    return { level: null, stamp: 'Source indisponible', html: `${cause}${table}` };
  }
  const time = new Date(data.readAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  return { level: blockLevel(data), stamp: `MàJ ${time}`, html: table };
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
