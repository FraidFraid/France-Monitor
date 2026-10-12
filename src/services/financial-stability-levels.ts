// src/services/financial-stability-levels.ts : niveaux du bloc « Stabilité financière » (spec 2026-10-12 § 2). Seuils France
// Monitor (ni BCE ni AFT) sur l'échelle L1 ; la borne basse d'un palier appartient à ce palier. Module pur.
import type { FinancialStabilityResponse } from '../types/index.ts';
import { frNumber } from '../components/layer-panel/format.ts';
import { maxLevel, type VigilanceLevel } from './vigilance.ts';

export interface LevelBand { from: number; level: VigilanceLevel; word: string }

/** Du plus grave au plus calme ; le dernier palier n'a pas de plancher. */
export const CISS_BANDS: readonly LevelBand[] = [
  { from: 0.5, level: 'rouge', word: 'crise systémique' },
  { from: 0.3, level: 'orange', word: 'stress élevé' },
  { from: 0.15, level: 'jaune', word: 'tension' },
  { from: Number.NEGATIVE_INFINITY, level: 'vert', word: 'calme' },
];

export const SPREAD_BANDS: readonly LevelBand[] = [
  { from: 1.3, level: 'rouge', word: 'critique' },
  { from: 0.9, level: 'orange', word: 'élevé' },
  { from: 0.6, level: 'jaune', word: 'tension' },
  { from: Number.NEGATIVE_INFINITY, level: 'vert', word: 'normal' },
];

export const CISS_HELP =
  'Indicateur composite de stress systémique de la BCE (0 : calme, 1 : crise) : marchés monétaires, obligataires, actions, change et intermédiaires financiers.';
export const SPREAD_HELP =
  'Écart entre les taux d’emprunt à 10 ans de la France (OAT) et de l’Allemagne (Bund) : la prime de risque demandée à l’État français.';

export function bandOf(value: number, bands: readonly LevelBand[]): LevelBand {
  const band = bands.find((b) => value >= b.from);
  if (!band) throw new RangeError('paliers sans plancher');
  return band;
}

/** « Seuils France Monitor : tension dès 0,15 ; … . » (paliers au-dessus du vert, du plus bas au plus haut). */
export function thresholdsText(bands: readonly LevelBand[], digits: number, unit: string): string {
  const steps = bands.filter((b) => Number.isFinite(b.from)).reverse();
  return `Seuils France Monitor : ${steps.map((b) => `${b.word} dès ${frNumber(b.from, digits)}${unit}`).join(' ; ')}.`;
}

/** Niveau du titre : le plus haut de CISS France, CISS zone euro et écart OAT-Bund disponibles ; aucun : null. */
export function blockLevel(data: FinancialStabilityResponse | null): VigilanceLevel | null {
  if (!data) return null;
  const levels: VigilanceLevel[] = [];
  for (const s of data.series) {
    if ((s.id === 'cissFr' || s.id === 'cissEa') && s.value !== null && s.status !== 'unavailable') levels.push(bandOf(s.value, CISS_BANDS).level);
  }
  if (data.spread.value !== null && data.spread.status !== 'unavailable') levels.push(bandOf(data.spread.value, SPREAD_BANDS).level);
  return levels.length > 0 ? maxLevel(levels) : null;
}
