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
  /** 0–100 ; null : indisponible (« — », barre vide). */
  value: number | null;
  level: VigilanceLevel | null;
  /** Texte de la valeur ; défaut : la valeur, ou « — ». */
  display?: string;
  /** Colonnes supplémentaires (variation, points retirés), texte brut. */
  extra?: readonly string[];
  /** HTML déjà échappé affiché sous la ligne (note, bouton). */
  noteHtml?: string;
}

/** Ligne de mesure unique du kit : libellé · barre · valeur · colonnes en plus · note. */
export function meterRow(row: MeterRow): string {
  const width = row.value === null ? 0 : Math.max(0, Math.min(100, row.value));
  const fill = row.value === null || row.level === null
    ? ''
    : `<i style="width:${width}%;background:${levelColorVar(row.level)}"></i>`;
  const display = escapeHtml(row.display ?? (row.value === null ? '—' : String(row.value)));
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
