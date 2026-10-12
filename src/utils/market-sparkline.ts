// src/utils/market-sparkline.ts : petites courbes des marchés et de la stabilité financière (refonte du 12/10/2026).
// Trait fin qui ne se déforme pas quand le SVG s'étire (vector-effect), lissage monotone sans dépassement des vraies valeurs
// (pentes bornées comme d3.curveMonotoneX), aire en dégradé, pastille du dernier point, ligne de référence pointillée, vrais
// trous entre deux observations trop éloignées, infobulle plus bas / plus haut. Couleur neutre ; jaune seulement pour un mouvement
// exceptionnel (spec refonte UI §4.4) ; une couleur de niveau peut être imposée (CISS, écart OAT-Bund).
import type { MarketTone } from '../services/vigilance.ts';
import { frNumber } from '../components/layer-panel/format.ts';

export interface SparklineOptions {
  /** Couleur imposée (ex. couleur du niveau L1) ; sinon neutre, ou jaune pour un mouvement exceptionnel. */
  color?: string;
  /** Ligne pointillée horizontale (ex. clôture de la veille), comprise dans l'échelle. */
  reference?: number | null;
  /** Dates AAAA-MM-JJ parallèles aux valeurs : abscisse par date et trous au-delà de maxGapDays. */
  dates?: readonly string[];
  /** Écart maximal sans trou, en jours (4 : un week-end ne coupe pas la courbe). */
  maxGapDays?: number;
  /** Période nommée dans l'infobulle (« 90 jours », « séance du jour »). */
  label?: string;
  /** Format des valeurs de l'infobulle. */
  format?: (value: number) => string;
}

const W = 120;
const H = 32;
const PAD = 3;
const DAY_MS = 86_400_000;
let gradientSeq = 0;

type Pt = readonly [number, number];

const n2 = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Tracé lissé monotone d'un segment : courbes de Hermite à pentes bornées, points de contrôle dans la plage de chaque intervalle. */
function monotonePath(pts: readonly Pt[]): string {
  const first = pts[0];
  if (!first) return '';
  if (pts.length === 1) return `M${n2(first[0])},${n2(first[1])}`;
  const slopes: number[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i] as Pt;
    const [x1, y1] = pts[i + 1] as Pt;
    slopes.push(x1 === x0 ? 0 : (y1 - y0) / (x1 - x0));
  }
  const tangents = pts.map((_, i) => {
    if (i === 0) return slopes[0] ?? 0;
    if (i === pts.length - 1) return slopes[i - 1] ?? 0;
    const s0 = slopes[i - 1] ?? 0;
    const s1 = slopes[i] ?? 0;
    if (s0 * s1 <= 0) return 0;
    return Math.sign(s0) * Math.min(Math.abs(s0), Math.abs(s1));
  });
  let d = `M${n2(first[0])},${n2(first[1])}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i] as Pt;
    const [x1, y1] = pts[i + 1] as Pt;
    const h = (x1 - x0) / 3;
    const t0 = tangents[i] ?? 0;
    const t1 = tangents[i + 1] ?? 0;
    d += ` C${n2(x0 + h)},${n2(y0 + t0 * h)} ${n2(x1 - h)},${n2(y1 - t1 * h)} ${n2(x1)},${n2(y1)}`;
  }
  return d;
}

/** Abscisses : par date si fournies (et valides), sinon par rang ; segments coupés aux trous. */
function segmentsOf(values: readonly number[], opts: SparklineOptions): Array<Array<{ x: number; v: number }>> {
  const times = opts.dates && opts.dates.length === values.length ? opts.dates.map((d) => Date.parse(`${d}T00:00:00Z`)) : null;
  const usable = times !== null && times.every(Number.isFinite);
  const t0 = usable ? (times[0] ?? 0) : 0;
  const span = usable ? Math.max((times[times.length - 1] ?? 0) - t0, 1) : Math.max(values.length - 1, 1);
  const maxGap = (opts.maxGapDays ?? 4) * DAY_MS;
  const segments: Array<Array<{ x: number; v: number }>> = [];
  let current: Array<{ x: number; v: number }> = [];
  values.forEach((v, i) => {
    const pos = usable ? (times[i] ?? 0) - t0 : i;
    if (usable && i > 0 && (times[i] ?? 0) - (times[i - 1] ?? 0) > maxGap && current.length > 0) {
      segments.push(current);
      current = [];
    }
    current.push({ x: (pos / span) * W, v });
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

/** Courbe SVG ; chaîne vide sous deux valeurs. `tone` garde la règle neutre / jaune quand aucune couleur n'est imposée. */
export function buildMarketSparkline(history: readonly number[] | undefined, tone: MarketTone, opts: SparklineOptions = {}): string {
  const values = (history ?? []).filter((v) => Number.isFinite(v));
  if (values.length < 2) return '';

  const color = opts.color ?? (tone === 'alert' ? 'var(--sev-yellow)' : 'var(--spark-neutral)');
  const ref = typeof opts.reference === 'number' && Number.isFinite(opts.reference) ? opts.reference : null;
  const lo = Math.min(...values, ...(ref !== null ? [ref] : []));
  const hi = Math.max(...values, ...(ref !== null ? [ref] : []));
  const range = hi - lo;
  const y = (v: number): number => (range === 0 ? H / 2 : PAD + (1 - (v - lo) / range) * (H - 2 * PAD));

  const segments = segmentsOf(values, opts).map((seg) => seg.map((p) => [p.x, y(p.v)] as const));
  const line = segments.map(monotonePath).join(' ');
  const area = segments
    .filter((seg) => seg.length >= 2)
    .map((seg) => `${monotonePath(seg)} L${n2(seg[seg.length - 1]?.[0] ?? 0)},${H} L${n2(seg[0]?.[0] ?? 0)},${H} Z`)
    .join(' ');
  const lastSeg = segments[segments.length - 1] ?? [];
  const last = lastSeg[lastSeg.length - 1] ?? [W, H / 2];

  const id = `spk-${(gradientSeq += 1)}`;
  const fmt = opts.format ?? ((v: number) => frNumber(v, 2));
  const title = `${opts.label ? `${opts.label} · ` : ''}plus bas ${fmt(Math.min(...values))} · plus haut ${fmt(Math.max(...values))}`;
  const refLine = ref === null ? '' : `<line class="spark-ref" x1="0" x2="${W}" y1="${n2(y(ref))}" y2="${n2(y(ref))}" stroke="${color}" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>`;

  return `
    <svg class="market-strip__sparkline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}">
      <title>${esc(title)}</title>
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.28"></stop><stop offset="1" stop-color="${color}" stop-opacity="0"></stop></linearGradient></defs>
      ${refLine}
      <path class="spark-area" d="${area}" fill="url(#${id})" stroke="none"></path>
      <path class="spark-line" d="${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
      <path class="spark-dot" d="M${n2(last[0])},${n2(last[1])} h0" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
    </svg>
  `;
}
