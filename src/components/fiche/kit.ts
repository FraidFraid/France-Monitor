// src/components/fiche/kit.ts — briques HTML pures du kit de panneau v2 « fmk » (spec 2026-10-01
// § 5) : ligne de mesure, point de niveau, clé · valeur, comptes par niveau, chevron. Tout texte
// reçu est échappé ici ; seuls les paramètres nommés *Html passent tels quels.

import { levelColorVar, levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';

/** Chevron des sections repliables : pointe à droite, pivoté de 90° à l'ouverture (CSS). */
export const CHEVRON_SVG = '<svg class="fmk-chev" viewBox="0 0 16 16" aria-hidden="true" focusable="false">'
  + '<path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function levelDot(level: VigilanceLevel | null): string {
  return `<span class="fmk-dot${level ? ` fmk-dot--${level}` : ''}" aria-hidden="true"></span>`;
}

export interface MeterRow {
  label: string;
  /** 0–100 ; null : indisponible (« n.d. », barre vide). */
  value: number | null;
  level: VigilanceLevel | null;
  /** Barre grise quand aucun niveau ne s'applique (confiance). */
  neutral?: boolean;
  /** Couleur de catégorie de la barre (expression CSS interne, ex. « var(--mix-nuclear) ») ; prime sur level et neutral. */
  color?: string;
  /** Texte de la valeur ; défaut : la valeur, ou « n.d. ». */
  display?: string;
  /** Colonnes supplémentaires (variation, points retirés), texte brut. */
  extra?: readonly string[];
  /** HTML déjà échappé affiché sous la ligne (note, bouton). */
  noteHtml?: string;
}

/** Ligne de mesure unique du kit : libellé · barre · valeur · colonnes en plus · note. */
export function meterRow(row: MeterRow): string {
  const width = row.value === null ? 0 : Math.max(0, Math.min(100, row.value));
  const background = row.color ?? (row.level !== null ? levelColorVar(row.level) : row.neutral ? 'var(--text-secondary)' : null);
  const fill = row.value === null || background === null
    ? ''
    : `<i style="width:${width}%;background:${background}"></i>`;
  const display = escapeHtml(row.display ?? (row.value === null ? 'n.d.' : String(row.value)));
  const extra = (row.extra ?? []).map((x) => `<span class="fmk-meter-x fmk-num">${escapeHtml(x)}</span>`).join('');
  const note = row.noteHtml ? `<div class="fmk-meter-note">${row.noteHtml}</div>` : '';
  return `<div class="fmk-meter"><span class="fmk-meter-label">${escapeHtml(row.label)}</span>`
    + `<span class="fmk-bar">${fill}</span><span class="fmk-meter-v fmk-num">${display}</span>${extra}${note}</div>`;
}

export function kvRow(label: string, valueHtml: string): string {
  return `<div class="fmk-kv"><span class="fmk-kv-k">${escapeHtml(label)}</span><span class="fmk-kv-v fmk-num">${valueHtml}</span></div>`;
}

const LEVEL_ORDER: readonly VigilanceLevel[] = ['rouge', 'orange', 'jaune', 'vert'];

/** « ● 2 ● 1 ● 1 » pour un résumé de section : rouge → vert, niveaux absents omis. */
export function levelCounts(levels: readonly VigilanceLevel[], lang: 'fr' | 'en'): string {
  return LEVEL_ORDER
    .map((level) => ({ level, n: levels.filter((l) => l === level).length }))
    .filter((c) => c.n > 0)
    .map((c) => `<span class="fmk-count">${levelDot(c.level)}<span class="fmk-sr">${levelLabel(c.level, lang)}</span><span class="fmk-num">${c.n}</span></span>`)
    .join(' ');
}

const PARIS = 'Europe/Paris';

/** Heure de Paris : « hh:mm » le jour même, « jj/mm hh:mm » sinon ; withDate force la date. */
export function absoluteTime(ms: number, now: number, lang: 'fr' | 'en', opts: { withDate?: boolean } = {}): string {
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const day = (v: number): string => new Date(v).toLocaleDateString('fr-FR', { timeZone: PARIS });
  const clock = new Date(ms).toLocaleTimeString(locale, { timeZone: PARIS, hour: '2-digit', minute: '2-digit' });
  if (opts.withDate !== true && day(ms) === day(now)) return clock;
  const date = new Date(ms).toLocaleDateString(locale, { timeZone: PARIS, day: '2-digit', month: '2-digit' });
  return `${date} ${clock}`;
}

/** Couleur d'intensité d'un sous-score, part du maximum : ≥ 85 % rouge, ≥ 70 % orange, ≥ 55 % jaune, sinon vert. */
export function intensityLevel(value: number, max: number): VigilanceLevel | null {
  if (!(max > 0) || !Number.isFinite(value)) return null;
  const ratio = value / max;
  if (ratio >= 0.85) return 'rouge';
  if (ratio >= 0.7) return 'orange';
  if (ratio >= 0.55) return 'jaune';
  return 'vert';
}

export interface CurvePoint {
  at: number;
  value: number;
}

const CURVE = { width: 384, height: 84, left: 18, top: 8, base: 60 } as const;

/** Courbe en escalier (corroboration) : tracé neutre, valeurs et heures hors de la zone tracée ; '' sous deux points. */
export function stepCurve(points: readonly CurvePoint[], opts: { label: string; timeLabel: (ms: number) => string }): string {
  if (points.length < 2) return '';
  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map((p) => p.value);
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const tSpan = last.at - first.at || 1;
  const vSpan = vMax - vMin || 1;
  const x = (at: number): string => (CURVE.left + ((at - first.at) / tSpan) * (CURVE.width - CURVE.left)).toFixed(1);
  const y = (v: number): string => (CURVE.base - ((v - vMin) / vSpan) * (CURVE.base - CURVE.top)).toFixed(1);
  const coords: string[] = [`${x(first.at)},${y(first.value)}`];
  for (let i = 1; i < points.length; i += 1) {
    coords.push(`${x(points[i].at)},${y(points[i - 1].value)}`, `${x(points[i].at)},${y(points[i].value)}`);
  }
  const line = coords.join(' ');
  const area = `${line} ${x(last.at)},${CURVE.base.toFixed(1)} ${x(first.at)},${CURVE.base.toFixed(1)}`;
  return `<svg class="fmk-curve" viewBox="0 0 ${CURVE.width} ${CURVE.height}" role="img" aria-label="${escapeHtml(opts.label)}">`
    + `<line class="fmk-curve-grid" x1="${CURVE.left}" y1="${CURVE.base}" x2="${CURVE.width}" y2="${CURVE.base}"/>`
    + `<line class="fmk-curve-grid fmk-curve-grid--top" x1="${CURVE.left}" y1="${CURVE.top}" x2="${CURVE.width}" y2="${CURVE.top}"/>`
    + `<polygon class="fmk-curve-area" points="${area}"/>`
    + `<polyline class="fmk-curve-line" points="${line}"/>`
    + `<g class="fmk-curve-axis" aria-hidden="true">`
    + `<text x="12" y="12" text-anchor="end">${vMax}</text><text x="12" y="63" text-anchor="end">${vMin}</text>`
    + `<text x="${CURVE.left}" y="78">${escapeHtml(opts.timeLabel(first.at))}</text>`
    + `<text x="${CURVE.width}" y="78" text-anchor="end">${escapeHtml(opts.timeLabel(last.at))}</text>`
    + `</g></svg>`;
}
