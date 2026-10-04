// src/components/layer-panel/chart.ts : graphes des panneaux de couches (éolien, DROM, biométhane, santé, environnement).
// Rendu pur : SVG accessible (role="img"), libellés min et max, bornes de temps, repère « maintenant » ; en option une série de
// comparaison en pointillé (saison précédente) et une valeur de référence en pointillé horizontal (même semaine un an plus tôt).
// Lot Environnement (spec 2026-10-04 E5) : trou de mesure coupé (gapMs), plusieurs séries, frise horaire, points colorés, barres
// empilées par jour. Aucun point inventé ; couleurs passées en jetons CSS (niveau ou catégorie), jamais grises pour une vraie valeur.
import { levelColorVar, type VigilanceLevel } from '../../services/vigilance.ts';
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
  /** Écart (ms) au-delà duquel deux points consécutifs ne sont pas reliés : un trou de mesure reste un trou. */
  gapMs?: number;
}

const W = 384;
const H = 106;
const TOP = 12;
const BOTTOM = 78;
const DASH = 'stroke="var(--text-muted)"';

const finite = (p: ChartPoint): boolean => Number.isFinite(p.at) && Number.isFinite(p.value);

function textAt(tx: number, ty: number, anchor: 'start' | 'middle' | 'end', s: string): string {
  return `<text x="${tx.toFixed(1)}" y="${ty}" text-anchor="${anchor}" font-size="9" fill="var(--text-muted)">${escapeHtml(s)}</text>`;
}

/** Morceaux continus d'une série triée : un écart supérieur à gapMs ouvre un nouveau morceau. */
function runs(pts: readonly ChartPoint[], gapMs: number | undefined): ChartPoint[][] {
  const out: ChartPoint[][] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && (gapMs === undefined || p.at - prev.at <= gapMs)) last.push(p);
    else out.push([p]);
  }
  return out;
}

export function lineChart(points: readonly ChartPoint[], o: LineChartOptions): string {
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
  const stroke = escapeHtml(o.stroke);
  const parts: string[] = [];
  if (ref !== null) {
    const ry = y(ref).toFixed(1);
    parts.push(`<line x1="0" x2="${W}" y1="${ry}" y2="${ry}" ${DASH} stroke-width="1" stroke-dasharray="4 3"/>`);
  }
  if (dashed.length >= 2) parts.push(`<polyline points="${line(dashed)}" fill="none" ${DASH} stroke-width="1.5" stroke-dasharray="4 3"/>`);
  for (const run of runs(pts, o.gapMs)) {
    parts.push(run.length >= 2
      ? `<polyline points="${line(run)}" fill="none" stroke="${stroke}" stroke-width="2"/>`
      : `<circle cx="${x(run[0].at).toFixed(1)}" cy="${y(run[0].value).toFixed(1)}" r="1.5" fill="${stroke}"/>`);
  }
  parts.push(
    textAt(2, TOP - 2, 'start', o.value(hi)),
    textAt(2, BOTTOM + 10, 'start', o.value(lo)),
    textAt(0, 102, 'start', o.tick(o.from)),
    textAt(W, 102, 'end', o.tick(o.to)),
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

// ─── Plusieurs séries sur une échelle ───

export interface ChartSeries { points: readonly ChartPoint[]; stroke: string; label: string }

/** Plusieurs séries sur une échelle commune partant de 0 (départements par couleur et par jour, sur 30 jours). */
export function multiLineChart(
  series: readonly ChartSeries[],
  o: { label: string; from: number; to: number; value: (v: number) => string; tick: (ms: number) => string; nowAt?: number | null; gapMs?: number },
): string {
  const kept = series.map((s) => ({ ...s, pts: s.points.filter(finite).sort((a, b) => a.at - b.at) })).filter((s) => s.pts.length > 0);
  if (kept.length === 0 || kept.every((s) => s.pts.length < 2) || !(o.to > o.from)) return '';
  const hi = Math.max(1, ...kept.flatMap((s) => s.pts.map((p) => p.value)));
  const x = (at: number): number => Math.max(0, Math.min(W, ((at - o.from) / (o.to - o.from)) * W));
  const y = (v: number): number => BOTTOM - (Math.max(0, v) / hi) * (BOTTOM - TOP);
  const parts: string[] = [`<line x1="0" x2="${W}" y1="${BOTTOM}" y2="${BOTTOM}" ${DASH} stroke-width="0.5"/>`];
  for (const s of kept) {
    const stroke = escapeHtml(s.stroke);
    for (const run of runs(s.pts, o.gapMs)) {
      parts.push(run.length >= 2
        ? `<polyline points="${run.map((p) => `${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="2"><title>${escapeHtml(s.label)}</title></polyline>`
        : `<circle cx="${x(run[0].at).toFixed(1)}" cy="${y(run[0].value).toFixed(1)}" r="1.5" fill="${stroke}"><title>${escapeHtml(s.label)}</title></circle>`);
    }
  }
  parts.push(textAt(2, TOP - 2, 'start', o.value(hi)), textAt(2, BOTTOM + 10, 'start', o.value(0)),
    textAt(0, 102, 'start', o.tick(o.from)), textAt(W, 102, 'end', o.tick(o.to)));
  if (o.nowAt !== undefined && o.nowAt !== null && o.nowAt >= o.from && o.nowAt <= o.to) {
    const nx = x(o.nowAt).toFixed(1);
    parts.push(`<line x1="${nx}" x2="${nx}" y1="${TOP}" y2="${BOTTOM}" stroke="var(--v2-brand)" stroke-width="1"/>`);
  }
  return `<svg class="lp-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(o.label)}">${parts.join('')}</svg>`;
}

// ─── Frise horaire (vigilance J et J+1) ───

export interface BandRow { label: string; segments: ReadonlyArray<{ from: number; to: number; level: VigilanceLevel }> }

const BAND_LABEL_W = 104;
const BAND_H = 12;
/** Largeur maximale d'une barre empilée : un seul jour ne donne pas une barre pleine largeur. */
const MAX_BAR_W = 40;
const BAND_GAP = 5;

/** Frise horaire : une bande par phénomène, couleur par créneau, repère « maintenant », bornes de l'échéance en heure de Paris. */
export function bandTimeline(
  rows: readonly BandRow[],
  o: { label: string; from: number; to: number; tick: (ms: number) => string; nowAt?: number | null },
): string {
  if (rows.length === 0 || !(o.to > o.from)) return '';
  const inner = W - BAND_LABEL_W;
  const x = (at: number): number => BAND_LABEL_W + Math.max(0, Math.min(inner, ((at - o.from) / (o.to - o.from)) * inner));
  const height = rows.length * (BAND_H + BAND_GAP) + 16;
  const parts: string[] = [];
  rows.forEach((row, i) => {
    const top = i * (BAND_H + BAND_GAP);
    parts.push(textAt(0, top + BAND_H - 2, 'start', row.label));
    parts.push(`<rect x="${BAND_LABEL_W}" y="${top}" width="${inner}" height="${BAND_H}" fill="none" ${DASH} stroke-width="0.5"/>`);
    for (const s of row.segments) {
      const x0 = x(s.from);
      const x1 = x(s.to);
      if (!(x1 > x0)) continue;
      parts.push(`<rect x="${x0.toFixed(1)}" y="${top}" width="${(x1 - x0).toFixed(1)}" height="${BAND_H}" fill="${levelColorVar(s.level)}" data-level="${s.level}"/>`);
    }
  });
  const axisY = height - 4;
  parts.push(textAt(BAND_LABEL_W, axisY, 'start', o.tick(o.from)), textAt(W, axisY, 'end', o.tick(o.to)));
  if (o.nowAt !== undefined && o.nowAt !== null && o.nowAt >= o.from && o.nowAt <= o.to) {
    const nx = x(o.nowAt).toFixed(1);
    parts.push(`<line x1="${nx}" x2="${nx}" y1="0" y2="${height - 14}" stroke="var(--v2-brand)" stroke-width="1"/>`);
  }
  return `<svg class="lp-chart lp-chart--bands" viewBox="0 0 ${W} ${height}" width="100%" role="img" aria-label="${escapeHtml(o.label)}">${parts.join('')}</svg>`;
}

// ─── Points colorés (magnitude selon l'heure) ───

export interface DotPoint { at: number; value: number; color: string; title?: string }

/** Points colorés sur une fenêtre de temps (magnitude selon l'heure sur 7 jours) ; échelle de yMin (défaut : minimum) au maximum. */
export function dotChart(
  points: readonly DotPoint[],
  o: { label: string; from: number; to: number; value: (v: number) => string; tick: (ms: number) => string; yMin?: number; nowAt?: number | null },
): string {
  const pts = points.filter((p) => Number.isFinite(p.at) && Number.isFinite(p.value) && p.at >= o.from && p.at <= o.to);
  if (pts.length === 0 || !(o.to > o.from)) return '';
  // Un point sous yMin étend l'axe vers le bas : jamais écrasé en silence sur l'axe.
  const lo = Math.min(o.yMin ?? Infinity, ...pts.map((p) => p.value));
  const hi = Math.max(lo + 1, ...pts.map((p) => p.value));
  const x = (at: number): number => ((at - o.from) / (o.to - o.from)) * W;
  const y = (v: number): number => BOTTOM - ((Math.max(lo, v) - lo) / (hi - lo)) * (BOTTOM - TOP);
  const parts: string[] = [`<line x1="0" x2="${W}" y1="${BOTTOM}" y2="${BOTTOM}" ${DASH} stroke-width="0.5"/>`];
  for (const p of pts) {
    const title = p.title ? `<title>${escapeHtml(p.title)}</title>` : '';
    parts.push(`<circle cx="${x(p.at).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="${escapeHtml(p.color)}">${title}</circle>`);
  }
  parts.push(textAt(2, TOP - 2, 'start', o.value(hi)), textAt(2, BOTTOM + 10, 'start', o.value(lo)),
    textAt(0, 102, 'start', o.tick(o.from)), textAt(W, 102, 'end', o.tick(o.to)));
  if (o.nowAt !== undefined && o.nowAt !== null && o.nowAt >= o.from && o.nowAt <= o.to) {
    const nx = x(o.nowAt).toFixed(1);
    parts.push(`<line x1="${nx}" x2="${nx}" y1="${TOP}" y2="${BOTTOM}" stroke="var(--v2-brand)" stroke-width="1"/>`);
  }
  return `<svg class="lp-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(o.label)}">${parts.join('')}</svg>`;
}

// ─── Barres empilées par jour ───

export interface DayStack { day: number; parts: ReadonlyArray<{ value: number; color: string; label: string }> }

/** Barres empilées par jour (météo des forêts par niveau, détections par jour, épisodes J à J+2, sécheresse) ; jours dans l'ordre reçu. */
export function stackedDayBars(
  days: readonly DayStack[],
  o: { label: string; value: (v: number) => string; tick: (ms: number) => string; /** Dit dans le titre qu'aucune valeur n'est à tracer (tout à zéro). */ emptyNote?: string },
): string {
  const kept = days.filter((d) => Number.isFinite(d.day));
  if (kept.length === 0) return '';
  const total = (d: DayStack): number => d.parts.reduce((s, p) => s + (Number.isFinite(p.value) && p.value > 0 ? p.value : 0), 0);
  const hi = Math.max(1, ...kept.map(total));
  const slot = W / kept.length;
  const fullW = Math.max(1, slot - (kept.length > 40 ? 0.5 : 2));
  const barW = Math.min(fullW, MAX_BAR_W);
  const inset = barW < fullW ? (slot - barW) / 2 : 0;
  const parts: string[] = [`<line x1="0" x2="${W}" y1="${BOTTOM}" y2="${BOTTOM}" ${DASH} stroke-width="0.5"/>`];
  kept.forEach((d, i) => {
    let base = BOTTOM;
    for (const p of d.parts) {
      if (!(Number.isFinite(p.value) && p.value > 0)) continue;
      const h = (p.value / hi) * (BOTTOM - TOP);
      base -= h;
      parts.push(`<rect x="${(i * slot + inset).toFixed(1)}" y="${base.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${escapeHtml(p.color)}">`
        + `<title>${escapeHtml(`${o.tick(d.day)} · ${p.label} : ${o.value(p.value)}`)}</title></rect>`);
    }
  });
  parts.push(textAt(2, TOP - 2, 'start', o.value(hi)), textAt(2, BOTTOM + 10, 'start', o.value(0)), textAt(0, 102, 'start', o.tick(kept[0].day)),
    textAt(W, 102, 'end', o.tick(kept[kept.length - 1].day)));
  const title = o.emptyNote && kept.every((d) => total(d) === 0) ? `${o.label} : ${o.emptyNote}` : o.label;
  return `<svg class="lp-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(title)}">${parts.join('')}</svg>`;
}
