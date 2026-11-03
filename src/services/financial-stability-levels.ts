// src/services/financial-stability-levels.ts : niveaux du bloc « Stabilité financière » (spec 2026-10-12 § 2). Seuils France
// Monitor (ni BCE ni AFT) sur l'échelle L1 ; la borne basse d'un palier appartient à ce palier. Module pur.
import type { FinancialStabilityResponse, OfficialSpread } from '../types/index.ts';
import { frNumber } from '../components/layer-panel/format.ts';
import { LEVEL_RANK, maxLevel, type VigilanceLevel } from './vigilance.ts';

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
    if ((s.id === 'cissFr' || s.id === 'cissEa') && Number.isFinite(s.value) && s.value !== null && s.status !== 'unavailable') levels.push(bandOf(s.value, CISS_BANDS).level);
  }
  if (data.spread.value !== null && Number.isFinite(data.spread.value) && data.spread.status !== 'unavailable') levels.push(spreadLevel(data));
  return levels.length > 0 ? maxLevel(levels) : null;
}

/**
 * Niveau retenu pour l'écart OAT-Bund (03/11/2026, règle de corroboration) : c'est un prix de marché relevé sur TradingView, source
 * non officielle. Quand le repère officiel de la BCE (moyenne mensuelle des taux à 10 ans) est connu et le contredit (pas dans la
 * zone rouge), le rouge de marché est retenu à orange. Sans repère officiel, le niveau de marché reste tel quel (calibration du
 * score inchangée). Le CISS de la BCE, officiel, n'est jamais plafonné.
 */
export function spreadLevel(data: Pick<FinancialStabilityResponse, 'spread' | 'officialSpread'>): VigilanceLevel {
  const market = bandOf(data.spread.value as number, SPREAD_BANDS).level;
  if (market !== 'rouge' || !data.officialSpread) return market;
  return bandOf(data.officialSpread.value, SPREAD_BANDS).level === 'rouge' ? 'rouge' : 'orange';
}

/** Vrai quand l'écart de marché est dans la zone rouge mais retenu à orange faute de corroboration officielle. */
export function spreadCapped(data: Pick<FinancialStabilityResponse, 'spread' | 'officialSpread'> | null): boolean {
  if (!data || data.spread.value === null || data.spread.status === 'unavailable') return false;
  return bandOf(data.spread.value, SPREAD_BANDS).level === 'rouge' && spreadLevel(data) === 'orange';
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « septembre 2026 » pour « 2026-09 ». */
export function frMonth(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/** « Repère officiel BCE (septembre 2026) : 0,97 pt, élevé. » ; null sans repère. */
export function officialSpreadText(o: OfficialSpread | null | undefined): string | null {
  if (!o) return null;
  return `Repère officiel BCE (moyenne de ${frMonth(o.month)}) : ${frNumber(o.value, 2)}\u00a0pt, ${bandOf(o.value, SPREAD_BANDS).word}.`;
}

/**
 * Pourquoi le titre a ce niveau (03/11/2026, « Stabilité financière : ROUGE » à côté d'un CISS « calme ») : quand l'écart OAT-Bund
 * (prix de marché, non officiel) place le bloc au-dessus du stress mesuré par la BCE, la phrase le dit et explique la différence.
 * null quand le CISS fait lui-même le niveau, ou sans données.
 */
export function levelDriverText(data: FinancialStabilityResponse | null): { short: string; text: string } | null {
  if (!data) return null;
  const level = blockLevel(data);
  const sp = data.spread;
  if (level === null || sp.value === null || sp.status === 'unavailable') return null;
  const marketBand = bandOf(sp.value, SPREAD_BANDS);
  const retained = spreadLevel(data);
  const ciss = data.series.filter((x) => (x.id === 'cissFr' || x.id === 'cissEa') && x.value !== null && x.status !== 'unavailable');
  const cissLevels = ciss.map((x) => bandOf(x.value as number, CISS_BANDS).level);
  const cissTop = cissLevels.length > 0 ? maxLevel(cissLevels) : null;
  if (retained !== level || (cissTop !== null && LEVEL_RANK[cissTop] >= LEVEL_RANK[level])) return null;
  const cissWord = cissTop === null ? null : bandOf(Math.max(...ciss.map((x) => x.value as number)), CISS_BANDS).word;
  // Trois décimales, comme les lignes CISS du tableau (0,085 et non 0,09).
  const cissValues = ciss.map((x) => `${x.id === 'cissFr' ? 'France' : 'zone euro'} ${frNumber(x.value as number, 3)}`).join(' ; ');
  const market = `${frNumber(sp.value, 2)}\u00a0pt, ${marketBand.word}`;
  const first = spreadCapped(data)
    ? `Niveau tiré par l’écart OAT-Bund : ${market} sur le marché (TradingView, source non officielle), retenu à orange car le repère officiel de la BCE ne le confirme pas.`
    : `Niveau tiré par l’écart OAT-Bund (${market}) : un prix de marché relevé sur TradingView, pas une publication officielle.`;
  const parts = [
    first,
    cissWord ? `Le stress mesuré par la BCE reste ${cissWord} (CISS ${cissValues}).` : null,
    'Les deux ne mesurent pas la même chose : le CISS suit les tensions du système financier, l’écart la prime de risque demandée à l’État français.',
    officialSpreadText(data.officialSpread),
  ].filter((x): x is string => x !== null);
  return { short: 'écart OAT-Bund', text: parts.join(' ') };
}
