// src/components/layer-panel/grid.ts : vue pure du panneau « Réseau électrique » (spec 2026-10-02).
// Construit l'en-tête et les sections du kit ; la coquille DOM est dans frame.ts. Aucun accès réseau ni DOM.
import type { EcowattHourValue, EcowattOfficialDay, EcowattResponse, GridSnapshot, InterconnectionFlow } from '../../types/index.ts';
import {
  ecowattLastPublished, ecowattToday, ecowattUpcoming, parisDate,
} from '../../services/ecowatt-official.ts';
import type { SpaceWeatherData } from '../../services/space-weather.ts';
import { levelColorVar, officialLevel, type VigilanceLevel } from '../../services/vigilance.ts';
import { noEmDash } from '../../services/typography.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import { absoluteTime, kvRow, meterRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { ECO2MIX_LATE_PERIOD_MS, emptyLine, freshnessSegment, loadingBody, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';
import { formatGw, formatPct, NBSP } from './format.ts';

export { formatGw };

export interface GridViewInput {
  data: EcowattResponse | null;
  space: SpaceWeatherData | null;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
  /** Séries des 7 derniers jours par frontière (MW, positif = import), clés « FR-GB », « FR-ES »… */
  borderHistory?: ReadonlyMap<string, readonly number[]> | null;
}

const PARIS = 'Europe/Paris';
const MINUS = '−';

// ── Formats ───────────────────────────────────────────────────────────────────

/** Niveau de l'indice Kp (spec lot 2 § 1.1) : ≤ 3 vert, 4 jaune, 5 à 6 orange, ≥ 7 rouge ; tiers NOAA arrondis. */
export function kpLevel(kp: number): VigilanceLevel {
  const k = Math.round(kp);
  if (k >= 7) return 'rouge';
  if (k >= 5) return 'orange';
  if (k >= 4) return 'jaune';
  return 'vert';
}

function kpText(kp: number): string {
  return `Kp ${kp.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' });
}

function hh(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

function weekdayOf(date: string, style: 'long' | 'short'): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { weekday: style, timeZone: 'UTC' });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Production et synthèse ───────────────────────────────────────────────────

const MIX_KEYS = [
  { key: 'nuclear', label: 'Nucléaire', color: 'var(--mix-nuclear)', lowCarbon: true },
  { key: 'hydro', label: 'Hydraulique', color: 'var(--mix-hydro)', lowCarbon: true },
  { key: 'wind', label: 'Éolien', color: 'var(--mix-wind)', lowCarbon: true },
  { key: 'solar', label: 'Solaire', color: 'var(--mix-solar)', lowCarbon: true },
  { key: 'thermal', label: 'Thermique', color: 'var(--mix-thermal)', lowCarbon: false },
  { key: 'bio', label: 'Bioénergies', color: 'var(--mix-bio)', lowCarbon: true },
] as const;

function mixTotals(g: GridSnapshot): { total: number; lowCarbonPct: number | null } {
  let total = 0;
  let low = 0;
  for (const m of MIX_KEYS) {
    const v = g.mix[m.key];
    if (v === null || !Number.isFinite(v)) continue;
    total += v;
    if (m.lowCarbon) low += v;
  }
  return { total, lowCarbonPct: total > 0 ? Math.round((low / total) * 100) : null };
}

/** Espace insécable entre un nombre et son unité (GW, MW, %, g CO₂/kWh) : la valeur tient sur une ligne. */
export function keepValuesTogether(text: string): string {
  return text.replace(/(\d) (GW|MW|%|g CO₂\/kWh)/g, (_m, d: string, unit: string) => `${d}\u00a0${unit.replace(' ', '\u00a0')}`);
}

/** Comparaison de la consommation à la prévision RTE du jour ; seuil sur l'écart brut (2,9 % reste « conforme »). */
function forecastComparison(conso: number, forecast: number | null): string {
  if (forecast === null || !Number.isFinite(forecast) || forecast === 0) return '';
  const rawGap = ((conso - forecast) / forecast) * 100;
  const gap = Math.abs(Math.round(rawGap));
  if (Math.abs(rawGap) < 3) return 'conforme à la prévision';
  return rawGap > 0 ? `supérieure de ${gap} % à la prévision` : `inférieure de ${gap} % à la prévision`;
}

/** Gros chiffre du panneau : la consommation et son unité ; la comparaison à la prévision passe dessous. */
export function consumptionFigure(g: GridSnapshot): { value: string; caption: string } {
  const conso = g.consumptionMw;
  if (conso === null || !Number.isFinite(conso)) return { value: 'n.d.', caption: 'consommation' };
  const cmp = forecastComparison(conso, g.forecastMw);
  const caption = cmp && g.forecastMw !== null ? `consommation · ${cmp} (${formatGw(g.forecastMw)})` : 'consommation';
  return { value: keepValuesTogether(formatGw(conso)), caption: keepValuesTogether(caption) };
}

export function gridLead(g: GridSnapshot): string {
  const parts: string[] = [];
  const { total, lowCarbonPct } = mixTotals(g);
  if (total > 0 && lowCarbonPct !== null) {
    const co2 = g.co2gPerKwh !== null && Number.isFinite(g.co2gPerKwh) ? `, ${Math.round(g.co2gPerKwh)}${NBSP}g${NBSP}CO₂/kWh` : '';
    parts.push(`Production de ${formatGw(total)}, ${formatPct(lowCarbonPct)} bas-carbone${co2}.`);
  }
  const net = g.netImportMw;
  if (net !== null && Number.isFinite(net) && net !== 0) {
    parts.push(net < 0 ? `La France exporte ${formatGw(-net)}.` : `La France importe ${formatGw(net)}.`);
  }
  // R1 : une valeur et son unité ne se séparent jamais (espace insécable).
  return keepValuesTogether(parts.join(' '));
}

// ── Écowatt ──────────────────────────────────────────────────────────────────

export function hourLevel(v: EcowattHourValue): 'vert' | 'orange' | 'rouge' {
  return v >= 3 ? 'rouge' : v === 2 ? 'orange' : 'vert';
}

export interface RiskWindow {
  /** Plages contiguës d'heures à risque (orange ou rouge), « to » exclu. */
  ranges: Array<{ from: number; to: number }>;
  /** Niveau maximal rencontré : orange = système tendu, rouge = coupures possibles. */
  level: 'orange' | 'rouge';
}

export function riskWindow(hours: readonly EcowattHourValue[]): RiskWindow | null {
  const ranges: RiskWindow['ranges'] = [];
  let max = 0;
  hours.forEach((h, i) => {
    if (h < 2) return;
    max = Math.max(max, h);
    const last = ranges[ranges.length - 1];
    if (last && last.to === i) last.to = i + 1;
    else ranges.push({ from: i, to: i + 1 });
  });
  return ranges.length === 0 ? null : { ranges, level: max >= 3 ? 'rouge' : 'orange' };
}

/** « de 08:00 à 10:00 et de 12:00 à 13:00 » */
export function rangesText(ranges: RiskWindow['ranges']): string {
  const parts = ranges.map((r) => `de ${hh(r.from)} à ${hh(r.to)}`);
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
}

/** Libellé RTE du niveau : orange = système tendu, rouge = coupures possibles. */
function riskWords(level: RiskWindow['level']): string {
  return level === 'rouge' ? 'coupures possibles' : 'système tendu';
}

/** Couleur de l'indice de dépendance aux imports (sur 20) : vert jusqu'à 5, jaune jusqu'à 10, orange jusqu'à 15, rouge au-delà. */
export function importDependencyLevel(index: number): VigilanceLevel {
  if (index <= 5) return 'vert';
  if (index <= 10) return 'jaune';
  if (index <= 15) return 'orange';
  return 'rouge';
}

export function importDependencyIndex(flows: readonly InterconnectionFlow[]): number {
  const imports = flows.reduce((sum, f) => sum + Math.max(0, f.flowMW), 0);
  return Math.min(20, Math.round((imports / 10_000) * 20));
}

const LEVEL_WORD: Record<EcowattOfficialDay['level'], string> = { green: 'pas d’alerte', orange: 'système tendu', red: 'coupures possibles' };

function hoursAria(hours: readonly EcowattHourValue[]): string {
  const ranges: string[] = [];
  let start = 0;
  for (let i = 1; i <= hours.length; i++) {
    if (i < hours.length && hourLevel(hours[i]) === hourLevel(hours[start])) continue;
    ranges.push(`${hourLevel(hours[start])} de ${hh(start)} à ${hh(i)}`);
    start = i;
  }
  return `Écowatt heure par heure : ${ranges.join(', ')}`;
}

function ecowattSection(input: GridViewInput, todayDay: EcowattOfficialDay | null, upcoming: EcowattOfficialDay[], lastDay: EcowattOfficialDay | null): FicheSection {
  const base = { id: 'ecowatt', title: 'Écowatt', collapsible: true, open: input.open('ecowatt', true) };
  if (!input.data?.official || (!todayDay && upcoming.length === 0 && !lastDay)) {
    return { ...base, html: emptyLine('Signal Écowatt indisponible.') };
  }
  const win = todayDay ? riskWindow(todayDay.hours) : null;
  const later = upcoming.filter((d) => d.date > parisDate(input.now));
  const risky = later.find((d) => d.level === 'red') ?? later.find((d) => d.level !== 'green');
  const lastShown = later.length > 0 ? later[later.length - 1] : todayDay ?? lastDay;
  let summary: string;
  if (!todayDay) summary = 'signal du jour non publié';
  else if (win) summary = `${riskWords(win.level)} aujourd’hui ${rangesText(win.ranges)}`;
  else if (todayDay.level !== 'green') summary = `${LEVEL_WORD[todayDay.level]} aujourd’hui`;
  else if (risky) summary = `${LEVEL_WORD[risky.level]} ${weekdayOf(risky.date, 'long')}`;
  else summary = lastShown ? `aucune coupure envisagée d’ici ${weekdayOf(lastShown.date, 'long')}` : '';

  let html = '';
  if (todayDay) {
    const cells = todayDay.hours.map((h) => `<i class="lp-hour" style="background:${levelColorVar(hourLevel(h))}"></i>`).join('');
    html += `<h4 class="fmk-eyebrow">Aujourd’hui, heure par heure</h4>`
      + `<div class="lp-hours" role="img" aria-label="${escapeHtml(hoursAria(todayDay.hours))}">${cells}</div>`
      + `<div class="lp-hlab fmk-num" aria-hidden="true"><span>0${NBSP}h</span><span>6${NBSP}h</span><span>12${NBSP}h</span><span>18${NBSP}h</span><span>24${NBSP}h</span></div>`;
  } else {
    html += emptyLine('Heures du jour non publiées.');
  }
  const days = later.slice(0, 3);
  if (days.length > 0) {
    html += '<div class="lp-days">' + days.map((d) => {
      const dd = d.date.slice(8, 10);
      const mm = d.date.slice(5, 7);
      return `<div><span class="fmk-num">${escapeHtml(capitalize(weekdayOf(d.date, 'short')))} ${dd}/${mm}</span>${renderVigilancePill(officialLevel(d.level))}</div>`;
    }).join('') + '</div>';
  }
  return { ...base, summary: escapeHtml(summary), html };
}

// ── Consommation ─────────────────────────────────────────────────────────────

function parisOffset(ms: number): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: PARIS, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const n = (t: string): number => Number(p.find((x) => x.type === t)?.value ?? 0);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(ms / 1000) * 1000;
}

/** Minuit de Paris du jour (de Paris) contenant ms. */
function parisMidnight(ms: number): number {
  const guess = Date.parse(`${parisDate(ms)}T00:00:00Z`);
  const t0 = guess - parisOffset(guess);
  return guess - parisOffset(t0);
}

function consumptionSection(input: GridViewInput, g: GridSnapshot | null): FicheSection {
  const base = { id: 'consumption', title: 'Consommation', collapsible: true, open: input.open('consumption', true) };
  if (!g) return { ...base, summary: 'n.d.', html: emptyLine('Courbe du jour indisponible.') };
  // Seuls les points du jour de Paris courant (pas de l'UTC) : la série peut chevaucher deux jours.
  const start = parisMidnight(input.now);
  const end = parisMidnight(start + 36 * 3_600_000);
  const points = g.day.filter((p) => Number.isFinite(p.at) && p.at >= start && p.at < end);
  let peak: { at: number; mw: number } | null = null;
  for (const p of points) {
    if (p.forecastMw !== null && (peak === null || p.forecastMw > peak.mw)) peak = { at: p.at, mw: p.forecastMw };
  }
  const summary = peak ? `${formatGw(g.consumptionMw)} · pic prévu ${formatGw(peak.mw)} à ${absoluteTime(peak.at, input.now, 'fr')}` : formatGw(g.consumptionMw);

  let chart: string;
  const values = points.flatMap((p) => [p.consumptionMw, p.forecastMw]).filter((v): v is number => v !== null && Number.isFinite(v));
  if (points.length === 0 || values.length === 0) {
    chart = emptyLine('Courbe du jour indisponible.');
  } else {
    const W = 384; const top = 12; const bottom = 78;
    const lo = Math.min(...values); const hi = Math.max(...values);
    const pad = (hi - lo || hi || 1) * 0.05;
    const yMin = lo - pad; const yMax = hi + pad;
    const x = (at: number): number => Math.max(0, Math.min(W, ((at - start) / (end - start)) * W));
    const y = (mw: number): number => bottom - ((mw - yMin) / (yMax - yMin)) * (bottom - top);
    const line = (pick: (p: typeof points[number]) => number | null): string => points
      .map((p) => { const v = pick(p); return v === null ? null : `${x(p.at).toFixed(1)},${y(v).toFixed(1)}`; })
      .filter((s): s is string => s !== null).join(' ');
    const nowX = x(g.dataTime);
    const txt = (tx: number, ty: number, anchor: string, s: string): string =>
      `<text x="${tx.toFixed(1)}" y="${ty}" text-anchor="${anchor}" font-size="9" fill="var(--text-muted)">${escapeHtml(s)}</text>`;
    const labels = [txt(0, 102, 'start', `0${NBSP}h`), txt(W, 102, 'end', `24${NBSP}h`), txt(nowX, 102, 'middle', clock(g.dataTime))];
    if (peak && Math.abs(x(peak.at) - nowX) > 40) labels.push(txt(x(peak.at), 102, 'middle', clock(peak.at)));
    labels.push(txt(2, top - 2, 'start', `${Math.round(hi / 1000)}${NBSP}GW`), txt(2, bottom + 10, 'start', `${Math.round(lo / 1000)}${NBSP}GW`));
    const aria = `Consommation du jour : réalisée jusqu’à ${clock(g.dataTime)}, prévue ensuite`
      + (peak ? `, pic ${formatGw(peak.mw)} à ${clock(peak.at)}` : '');
    chart = `<svg viewBox="0 0 ${W} 106" width="100%" role="img" aria-label="${escapeHtml(aria)}">`
      + `<polyline points="${line((p) => p.forecastMw)}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4 3"/>`
      + `<polyline points="${line((p) => p.consumptionMw)}" fill="none" stroke="var(--text-primary)" stroke-width="2"/>`
      + `<line x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="${top}" y2="${bottom}" stroke="var(--v2-brand)" stroke-width="1"/>`
      + (peak ? `<circle cx="${x(peak.at).toFixed(1)}" cy="${y(peak.mw).toFixed(1)}" r="3" fill="var(--text-primary)"/>` : '')
      + labels.join('') + '</svg>';
  }

  let gap = 'n.d.';
  if (g.forecastMw !== null && g.forecastMw !== 0) {
    const text = g.consumptionMw !== null
      ? ` (écart ${(((g.consumptionMw - g.forecastMw) / g.forecastMw) * 100).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }).replace('-', MINUS)}${NBSP}%)`
      : '';
    gap = `${formatGw(g.forecastMw)}${text}`;
  }
  const html = chart
    + kvRow(`Réalisée à ${absoluteTime(g.dataTime, input.now, 'fr')}`, escapeHtml(formatGw(g.consumptionMw)))
    + kvRow('Prévision RTE du jour', escapeHtml(gap))
    + kvRow('Pic prévu', escapeHtml(peak ? `${formatGw(peak.mw)} à ${absoluteTime(peak.at, input.now, 'fr')}` : 'n.d.'));
  return { ...base, summary: escapeHtml(summary), html };
}

// ── Production ───────────────────────────────────────────────────────────────

function productionSection(input: GridViewInput, g: GridSnapshot | null): FicheSection {
  const base = { id: 'production', title: 'Production', collapsible: true, open: input.open('production', true) };
  const totals = g ? mixTotals(g) : null;
  if (!g || !totals || totals.total <= 0) return { ...base, summary: 'n.d.', html: emptyLine('Production nationale indisponible.') };
  const bar = MIX_KEYS.map((m) => ({ m, v: g.mix[m.key] })).filter((e): e is { m: typeof MIX_KEYS[number]; v: number } => e.v !== null && e.v > 0)
    .map((e) => `<i style="width:${((e.v / totals.total) * 100).toFixed(1)}%;background:${e.m.color}"></i>`).join('');
  const legend = MIX_KEYS.map((m) => `<div><span class="lp-swatch" style="background:${m.color}"></span><span>${escapeHtml(m.label)}</span><b class="fmk-num">${escapeHtml(formatGw(g.mix[m.key]))}</b></div>`).join('');
  const co2 = g.co2gPerKwh !== null && Number.isFinite(g.co2gPerKwh) ? `${Math.round(g.co2gPerKwh)}${NBSP}g CO₂/kWh` : 'n.d.';
  const html = `<div class="lp-mix">${bar}</div><div class="lp-leg">${legend}</div>`
    + `<h4 class="fmk-eyebrow">Bilan</h4>`
    + kvRow('Intensité carbone', escapeHtml(co2))
    + kvRow('Part bas-carbone', escapeHtml(totals.lowCarbonPct !== null ? formatPct(totals.lowCarbonPct) : 'n.d.'));
  return { ...base, summary: escapeHtml(`${formatGw(totals.total)} · ${totals.lowCarbonPct !== null ? formatPct(totals.lowCarbonPct) : 'n.d.'} bas-carbone`), html };
}

// ── Échanges ─────────────────────────────────────────────────────────────────

function flowText(mw: number): string {
  if (!Number.isFinite(mw) || mw === 0) return 'équilibre';
  return mw > 0 ? `import ${formatGw(mw)}` : `export ${formatGw(-mw)}`;
}

/** Import en rouge, export en vert, valeur insécable. */
function flowHtml(mw: number, text: string): string {
  const cls = !Number.isFinite(mw) || mw === 0 ? 'lp-val' : mw > 0 ? 'lp-imp' : 'lp-exp';
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

const BORDER_ID: Readonly<Record<string, string>> = {
  'Royaume-Uni': 'FR-GB', Espagne: 'FR-ES', Italie: 'FR-IT', Suisse: 'FR-CH', 'All./Bel.': 'FR-DE/BE',
};
const TREND_MIN_POINTS = 24;
const TREND_THRESHOLD_MW = 200;

/**
 * Flèche d'évolution d'un échange par rapport à sa moyenne sur 7 jours : ▲ si le flux affiché
 * (import ou export) grandit, ▼ s'il diminue ; rouge quand la position de la France se dégrade
 * (plus d'import ou moins d'export), vert sinon. Rien sous 200 MW d'écart ou sans historique.
 */
function trendHtml(current: number, history: readonly number[] | undefined): string {
  const values = (history ?? []).filter((v) => Number.isFinite(v));
  if (!Number.isFinite(current) || current === 0 || values.length < TREND_MIN_POINTS) return '';
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const delta = current - mean; // > 0 : plus d'import ou moins d'export
  if (Math.abs(delta) < TREND_THRESHOLD_MW) return '';
  const change = current > 0 ? delta : -delta; // variation du flux affiché
  const arrow = change > 0 ? '▲' : '▼';
  const tone = delta > 0 ? 'bad' : 'good';
  const title = `${change > 0 ? 'en hausse' : 'en baisse'} par rapport à la moyenne sur 7 jours (${change > 0 ? '+' : MINUS}${formatGw(Math.abs(change))})`;
  return `<span class="lp-trend lp-trend--${tone}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${arrow}</span>`;
}

function exchangesSection(input: GridViewInput, g: GridSnapshot | null): FicheSection {
  const base = { id: 'exchanges', title: 'Échanges aux frontières', collapsible: true, open: input.open('exchanges', false) };
  const flows = input.data?.interconnections ?? [];
  const net = g?.netImportMw ?? (flows.length > 0 ? flows.reduce((s, f) => s + f.flowMW, 0) : null);
  const balanceWord = g?.netImportMw != null ? 'solde physique' : 'solde commercial';
  const balance = net === null ? 'n.d.' : net < 0 ? `export net ${formatGw(-net)}` : net > 0 ? `import net ${formatGw(net)}` : 'équilibre';
  // Solde : signe opposé au flux (export net = net négatif) ; couleur comme les lignes.
  const balanceHtml = net === null ? escapeHtml('n.d.') : flowHtml(net, balance);
  // Résumé visuel : le solde seul, coloré (le libellé « solde physique » est dans la section).
  const summary = balanceHtml;
  if (flows.length === 0) return { ...base, summary, html: emptyLine('Échanges indisponibles.') };
  const history = input.borderHistory ?? null;
  const index = importDependencyIndex(flows);
  const html = '<div class="fmk-sub">Par frontière, échanges commerciaux</div>'
    + flows.map((f) => {
      const id = BORDER_ID[f.country];
      return kvRow(f.country, flowHtml(f.flowMW, flowText(f.flowMW)) + trendHtml(f.flowMW, id ? history?.get(id) : undefined));
    }).join('')
    + kvRow(capitalize(balanceWord), balanceHtml)
    + `<div class="lp-index">${meterRow({ label: 'Dépendance aux imports', value: (index / 20) * 100, level: importDependencyLevel(index), display: `${index}/20` })}</div>`;
  return { ...base, summary, html };
}

// ── Météo spatiale et sources ────────────────────────────────────────────────

function spaceSection(input: GridViewInput): FicheSection {
  const base = { id: 'space', title: 'Météo spatiale', collapsible: true, open: input.open('space', false) };
  const s = input.space;
  if (!s) return { ...base, summary: 'n.d.', html: emptyLine('Météo spatiale indisponible.') };
  const level = kpLevel(s.kpIndex);
  return {
    ...base,
    summary: `${valueHtml(kpText(s.kpIndex), level)} · ${escapeHtml(s.levelLabel.toLowerCase())}`,
    html: kvRow('Indice planétaire', `${valueHtml(kpText(s.kpIndex), level)} · ${escapeHtml(s.levelLabel.toLowerCase())}`)
      + `<p>${escapeHtml(s.riskFrance)}</p><p class="fmk-note">${escapeHtml(`NOAA SWPC · lu à ${absoluteTime(s.fetchedAt.getTime(), input.now, 'fr')}`)}</p>`,
  };
}

function sourceLine(linkHtml: string, text: string): string {
  return `<div class="fmk-kv"><span class="fmk-kv-k">${linkHtml}</span><span class="fmk-kv-v">${escapeHtml(text)}</span></div>`;
}

function sourcesSection(input: GridViewInput, g: GridSnapshot | null): FicheSection {
  const gen = input.data?.official?.generatedAt ? Date.parse(input.data.official.generatedAt) : NaN;
  const published = Number.isFinite(gen) ? absoluteTime(gen, input.now, 'fr') : 'n.d.';
  const html = sourceLine(sourceLinkHtml('RTE Écowatt', 'https://www.monecowatt.fr'), `signal officiel, publié à ${published}`)
    + sourceLine(sourceLinkHtml('ODRÉ éCO2mix temps réel', 'https://odre.opendatasoft.com/explore/dataset/eco2mix-national-tr/'),
      `pas de 15${NBSP}min, données de ${g ? absoluteTime(g.dataTime, input.now, 'fr') : 'n.d.'}`)
    + sourceLine(sourceLinkHtml('NOAA SWPC', 'https://www.swpc.noaa.gov/'), input.space ? `lu à ${absoluteTime(input.space.fetchedAt.getTime(), input.now, 'fr')}` : 'n.d.')
    + '<p class="fmk-note">Échanges : import en rouge, export en vert ; flèche : écart à la moyenne des 7 derniers jours, rouge si la position de la France se dégrade. '
    + 'Dépendance aux imports : imports bruts aux frontières rapportés à 10\u00A0GW, sur 20 (indicatif) ; vert jusqu’à 5, jaune jusqu’à 10, orange jusqu’à 15, rouge au-delà.</p>';
  return {
    id: 'sources', title: 'Sources', collapsible: true, open: input.open('sources', false), tone: 'reference',
    summary: 'RTE Écowatt · ODRÉ éCO2mix · NOAA', html,
  };
}

// ── Vue ──────────────────────────────────────────────────────────────────────

export function buildGridView(input: GridViewInput): LayerView {
  const { data, now } = input;
  if (data === null) {
    return { head: { theme: 'Énergie', title: 'Réseau électrique', status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const g = data.grid;
  const official = data.official;
  const upcoming = ecowattUpcoming(official, now);
  const todayDay = official && official.source !== 'odre' && ecowattToday(official, now) !== null
    ? upcoming.find((d) => d.date === parisDate(now)) ?? null : null;
  const lastDay = ecowattLastPublished(official, now);

  let level: VigilanceLevel | 'nd' = 'nd';
  let first: string;
  if (todayDay) {
    level = officialLevel(todayDay.level);
    first = `Écowatt : ${LEVEL_WORD[todayDay.level]}`;
  } else if (lastDay) {
    first = 'Écowatt : signal différé J-1 (ODRÉ)';
  } else {
    first = 'Écowatt : signal indisponible';
  }
  const status = [first];
  // éCO2mix : pas de 15 min publié ~20 min après ; « en retard » au-delà de 45 min (2 × 22,5 min).
  if (g) status.push(freshnessSegment(g.dataTime, now, ECO2MIX_LATE_PERIOD_MS));
  status.push('RTE, ODRÉ');

  let lead: string | null = null;
  if (todayDay && todayDay.level !== 'green') {
    const win = riskWindow(todayDay.hours);
    const risk = win ? ` ${capitalize(riskWords(win.level))} ${rangesText(win.ranges)}.` : '';
    lead = `${noEmDash(todayDay.message).trim()}${risk}`;
  } else if (g) {
    lead = gridLead(g) || null;
  }

  return {
    head: { theme: 'Énergie', title: 'Réseau électrique', figure: g ? consumptionFigure(g) : null, level, status, lead },
    sections: [
      ecowattSection(input, todayDay, upcoming, lastDay),
      consumptionSection(input, g),
      productionSection(input, g),
      exchangesSection(input, g),
      spaceSection(input),
      sourcesSection(input, g),
    ],
  };
}
