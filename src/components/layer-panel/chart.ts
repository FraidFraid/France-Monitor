// src/components/layer-panel/chart.ts : courbe simple des panneaux de couches (éolien, DROM, biométhane, santé).
// Rendu pur : SVG accessible (role="img"), libellés min et max, bornes de temps, repère « maintenant » ; en option une série de
// comparaison en pointillé (saison précédente) et une valeur de référence en pointillé horizontal (même semaine un an plus tôt).
import { escapeHtml } from '../france-intel-events.ts';

export interface ChartPoint { at: number; value: number }
export interface LineChartOptions {
  /** Libellé accessible, texte brut. */
  label: string;
  /** Fenêtre de temps (ms). */
  from: number;
  to: number;
  /** Couleur CSS du tracé : jeton de niveau ou de catégorie. */
  stroke: string;
  /** Repère « maintenant », vert de marque, s'il tombe dans la fenêtre. */
  nowAt?: number | null;
  /** Point sur le maximum. */
  markPeak?: boolean;
  /** Libellés des valeurs min et max (texte brut, R1). */
  value: (v: number) => string;
  /** Libellés des bornes de temps (texte brut). */
  tick: (ms: number) => string;
  /** Série de comparaison en pointillé, même échelle (ex. saison précédente décalée d'un an). */
  dashed?: readonly ChartPoint[];
  /** Valeur de référence en pointillé horizontal, comprise dans l'échelle (ex. même semaine un an plus tôt). */
  refValue?: number | null;
}

const W = 384;
const H = 106;
const TOP = 12;
const BOTTOM = 78;
const DASH = 'stroke="var(--text-muted)"';

export function lineChart(points: readonly ChartPoint[], o: LineChartOptions): string {
  const finite = (p: ChartPoint): boolean => Number.isFinite(p.at) && Number.isFinite(p.value);
  const pts = points.filter(finite).sort((a, b) => a.at - b.at);
  if (pts.length < 2 || !(o.to > o.from)) return '';
  const dashed = (o.dashed ?? []).filter(finite).sort((a, b) => a.at - b.at);
  const ref = o.refValue !== undefined && o.refValue !== null && Number.isFinite(o.refValue) ? o.refValue : null;
  const values = [...pts, ...dashed].map((p) => p.value).concat(ref === null ? [] : [ref]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.05;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (at: number): number => Math.max(0, Math.min(W, ((at - o.from) / (o.to - o.from)) * W));
  const y = (v: number): number => BOTTOM - ((v - yMin) / (yMax - yMin)) * (BOTTOM - TOP);
  const line = (list: readonly ChartPoint[]): string => list.map((p) => `${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const text = (tx: number, ty: number, anchor: 'start' | 'middle' | 'end', s: string): string =>
    `<text x="${tx.toFixed(1)}" y="${ty}" text-anchor="${anchor}" font-size="9" fill="var(--text-muted)">${escapeHtml(s)}</text>`;
  const stroke = escapeHtml(o.stroke);
  const parts: string[] = [];
  if (ref !== null) {
    const ry = y(ref).toFixed(1);
    parts.push(`<line x1="0" x2="${W}" y1="${ry}" y2="${ry}" ${DASH} stroke-width="1" stroke-dasharray="4 3"/>`);
  }
  if (dashed.length >= 2) parts.push(`<polyline points="${line(dashed)}" fill="none" ${DASH} stroke-width="1.5" stroke-dasharray="4 3"/>`);
  parts.push(
    `<polyline points="${line(pts)}" fill="none" stroke="${stroke}" stroke-width="2"/>`,
    text(2, TOP - 2, 'start', o.value(hi)),
    text(2, BOTTOM + 10, 'start', o.value(lo)),
    text(0, 102, 'start', o.tick(o.from)),
    text(W, 102, 'end', o.tick(o.to)),
  );
  if (o.nowAt !== undefined && o.nowAt !== null && o.nowAt >= o.from && o.nowAt <= o.to) {
    const nx = x(o.nowAt).toFixed(1);
    parts.push(`<line x1="${nx}" x2="${nx}" y1="${TOP}" y2="${BOTTOM}" stroke="var(--v2-brand)" stroke-width="1"/>`);
  }
  if (o.markPeak) {
    const peak = pts.reduce((best, p) => (p.value > best.value ? p : best), pts[0]);
    parts.push(`<circle cx="${x(peak.at).toFixed(1)}" cy="${y(peak.value).toFixed(1)}" r="3" fill="${stroke}"/>`);
  }
  return `<svg class="lp-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(o.label)}">${parts.join('')}</svg>`;
}
