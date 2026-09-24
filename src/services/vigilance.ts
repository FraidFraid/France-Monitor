// src/services/vigilance.ts — langage commun de gravité (échelle L1 : les quatre couleurs de
// vigilance officielles, celles de Météo-France, Vigicrues et Écowatt). Source unique des
// niveaux, libellés, couleurs et seuils affichés dans le tiroir, les alertes, les listes et
// les fiches. Spec : docs/superpowers/specs/2026-09-24-refonte-ui-poste-de-situation-design.md §4.
//
// Les couches officielles de la carte ne passent PAS par ici : elles gardent leurs couleurs
// d'origine, violet Météo compris.

import type { BriefConfidence, FuelTensionLevel, SituationSeverity, ThreatLevel } from '../types/index.ts';

export type VigilanceLevel = 'vert' | 'jaune' | 'orange' | 'rouge';
export type OfficialColor = 'green' | 'yellow' | 'orange' | 'red' | 'violet';
type Lang = 'fr' | 'en';

export const LEVEL_RANK: Record<VigilanceLevel, number> = { vert: 0, jaune: 1, orange: 2, rouge: 3 };

/** Indice national 0–100. Seuils du score v3 (85/70/55) ; « dégradé » et « critique » fusionnent en rouge. */
export function scoreLevel(score: number): VigilanceLevel {
  // Donnée manquante : jamais « vert », qui rassurerait à tort.
  if (!Number.isFinite(score)) return 'jaune';
  if (score >= 85) return 'vert';
  if (score >= 70) return 'jaune';
  if (score >= 55) return 'orange';
  return 'rouge';
}

export function situationLevel(severity: SituationSeverity): VigilanceLevel {
  if (severity === 'critical') return 'rouge';
  if (severity === 'high') return 'orange';
  return 'jaune';
}

export function eventLevel(level: ThreatLevel): VigilanceLevel {
  if (level === 'critical') return 'rouge';
  if (level === 'high') return 'orange';
  if (level === 'medium') return 'jaune';
  return 'vert';
}

export function officialLevel(color: OfficialColor): VigilanceLevel {
  if (color === 'red' || color === 'violet') return 'rouge';
  if (color === 'orange') return 'orange';
  if (color === 'yellow') return 'jaune';
  return 'vert';
}

/** Tension carburants (moteur énergie) : LOW→vert, MEDIUM→jaune, HIGH→orange, CRITICAL→rouge. */
export function fuelTensionLevel(level: FuelTensionLevel): VigilanceLevel {
  if (level === 'CRITICAL') return 'rouge';
  if (level === 'HIGH') return 'orange';
  if (level === 'MEDIUM') return 'jaune';
  return 'vert';
}

export function infraStatusLevel(status: 'nominal' | 'degraded' | 'critical'): VigilanceLevel {
  if (status === 'critical') return 'rouge';
  if (status === 'degraded') return 'jaune';
  return 'vert';
}

export function maxLevel(levels: readonly VigilanceLevel[]): VigilanceLevel {
  return levels.reduce<VigilanceLevel>((worst, l) => (LEVEL_RANK[l] > LEVEL_RANK[worst] ? l : worst), 'vert');
}

const LABEL: Record<VigilanceLevel, Record<Lang, string>> = {
  vert: { fr: 'Vert', en: 'Green' },
  jaune: { fr: 'Jaune', en: 'Yellow' },
  orange: { fr: 'Orange', en: 'Orange' },
  rouge: { fr: 'Rouge', en: 'Red' },
};

const PHRASE: Record<VigilanceLevel, Record<Lang, string>> = {
  vert: { fr: 'pas de vigilance particulière', en: 'no particular vigilance' },
  jaune: { fr: 'soyez attentif', en: 'be aware' },
  orange: { fr: 'soyez très vigilant', en: 'be very vigilant' },
  rouge: { fr: 'vigilance absolue', en: 'absolute vigilance' },
};

const VIGILANCE_WORD: Record<VigilanceLevel, Record<Lang, string>> = {
  vert: { fr: 'vigilance verte', en: 'green vigilance' },
  jaune: { fr: 'vigilance jaune', en: 'yellow vigilance' },
  orange: { fr: 'vigilance orange', en: 'orange vigilance' },
  rouge: { fr: 'vigilance rouge', en: 'red vigilance' },
};

const COLOR_VAR: Record<VigilanceLevel, string> = {
  vert: 'var(--sev-green)',
  jaune: 'var(--sev-yellow)',
  orange: 'var(--sev-orange)',
  rouge: 'var(--sev-red)',
};

// Mêmes teintes que les jetons --sev-* ; pour les attributs SVG et le canvas, qui n'acceptent pas var().
const HEX: Record<VigilanceLevel, string> = {
  vert: '#34c759',
  jaune: '#ffcc00',
  orange: '#ff9500',
  rouge: '#ff3b30',
};

export function levelLabel(level: VigilanceLevel, lang: Lang = 'fr'): string {
  return LABEL[level][lang];
}

export function levelPhrase(level: VigilanceLevel, lang: Lang = 'fr'): string {
  return PHRASE[level][lang];
}

export function levelVigilanceWord(level: VigilanceLevel, lang: Lang = 'fr'): string {
  return VIGILANCE_WORD[level][lang];
}

export function levelColorVar(level: VigilanceLevel): string {
  return COLOR_VAR[level];
}

export function levelHex(level: VigilanceLevel): string {
  return HEX[level];
}

/** Confiance 0–1 → bande, seuils 0,75 et 0,55 (ceux du brief). */
export function confidenceBand(confidence: number): BriefConfidence {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.55) return 'moderate';
  return 'low';
}

const CONFIDENCE: Record<BriefConfidence, Record<Lang, string>> = {
  high: { fr: 'confiance élevée', en: 'high confidence' },
  moderate: { fr: 'confiance moyenne', en: 'moderate confidence' },
  low: { fr: 'confiance faible', en: 'low confidence' },
};

export function briefConfidenceLabel(c: BriefConfidence, lang: Lang = 'fr'): string {
  return CONFIDENCE[c][lang];
}

export function confidenceLabel(confidence: number, lang: Lang = 'fr'): string {
  return briefConfidenceLabel(confidenceBand(confidence), lang);
}

// ─── Marchés (spec §4.4) : neutres, jaune seulement au-delà d'un seuil exceptionnel ─────────

export type MarketKind = 'index' | 'energy' | 'other';
export type MarketTone = 'neutral' | 'alert';

export const MARKET_ALERT_THRESHOLD: Record<Exclude<MarketKind, 'other'>, number> = { index: 3, energy: 5 };

export function marketTone(changePercent: number, kind: MarketKind): MarketTone {
  if (kind === 'other' || !Number.isFinite(changePercent)) return 'neutral';
  return Math.abs(changePercent) >= MARKET_ALERT_THRESHOLD[kind] ? 'alert' : 'neutral';
}

export interface MarketMove {
  name: string;
  changePercent: number;
  kind: MarketKind;
}

/** Variation signée à la française (« −3,42 % », « +6,10 % ») ; partagée avec la liste « À traiter ». */
export function formatSignedPct(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(2).replace('.', ',')} %`;
}

/** Ligne de synthèse des marchés : le plus fort mouvement exceptionnel, sinon la variation moyenne. */
export function marketBarometer(moves: readonly MarketMove[]): { tone: MarketTone; text: string } {
  const alerts = moves
    .filter((m) => marketTone(m.changePercent, m.kind) === 'alert')
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  if (alerts.length > 0) {
    const top = alerts[0];
    const more = alerts.length > 1 ? ` (+${alerts.length - 1})` : '';
    return { tone: 'alert', text: `Mouvement exceptionnel : ${top.name} ${formatSignedPct(top.changePercent)}${more}` };
  }
  const finite = moves.filter((m) => Number.isFinite(m.changePercent));
  if (finite.length === 0) return { tone: 'neutral', text: 'Marchés : données indisponibles' };
  const avg = finite.reduce((sum, m) => sum + m.changePercent, 0) / finite.length;
  return { tone: 'neutral', text: `Variation moyenne : ${formatSignedPct(avg)}` };
}
