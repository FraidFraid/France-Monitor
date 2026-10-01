// src/services/situation-text.ts — sépare, dans les textes du moteur de situations, les sous-scores
// chiffrés (« Score cyber consolidé : 63/100 », « Ransomware : 25/25 ») du reste. Dans la fiche
// situation, les premiers alimentent la section « Indicateurs » (spec 2026-10-01 fiches § 4.2). Pur.

const SCORE_PATTERN = /\d+(?:[.,]\d+)?\s*\/\s*\d+/;

export function isScoreText(text: string): boolean {
  return SCORE_PATTERN.test(text);
}

export function splitScoreLines(lines: readonly string[]): { plain: string[]; scored: string[] } {
  return {
    plain: lines.filter((line) => !isScoreText(line)),
    scored: lines.filter((line) => isScoreText(line)),
  };
}

/** Coupe un résumé en phrases ; les phrases chiffrées rejoignent « Pourquoi ce niveau ? ». */
export function splitScoreSentences(text: string): { plain: string[]; scored: string[] } {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  return splitScoreLines(sentences);
}

/** « Seine-Saint-Denis (72/100) » : nom de zone suivi de son sous-score entre parenthèses. */
const ZONE_SCORE_PATTERN = /^(.*?)\s*\((\d+(?:[.,]\d+)?\s*\/\s*\d+)\)\s*$/;

/**
 * Sépare une zone du moteur « Nom (n/m) » (SOCIAL_ESCALATION) en nom et sous-score (relecture
 * finale I4) : la v2 n'affiche que le nom dans la ligne et la partie « Zones » ; le score rejoint
 * « Pourquoi ce niveau ? ». Une zone sans sous-score reste telle quelle.
 */
export function splitZoneScore(zone: string): { name: string; score: string | null } {
  const match = ZONE_SCORE_PATTERN.exec(zone);
  if (!match || match[1].trim() === '') return { name: zone, score: null };
  return { name: match[1].trim(), score: match[2] };
}

const FRACTION = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+)/;

/**
 * « Libellé : n/m (note) » → barre d'indicateur (fiche situation, spec 2026-10-01 fiches § 4.2) ;
 * null pour une phrase sans « libellé : » ni fraction, qui reste une note texte.
 */
export function parseScoreLine(line: string): { label: string; value: number; max: number; display: string; note: string | null } | null {
  const sep = line.indexOf(' : ');
  if (sep <= 0) return null;
  const label = line.slice(0, sep).trim();
  const rest = line.slice(sep + 3);
  const match = FRACTION.exec(rest);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  const max = Number(match[2]);
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null;
  const note = rest.replace(match[0], '').replace(/\bscore\b/i, '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  return { label, value, max, display: `${match[1]}/${match[2]}`, note: note === '' ? null : note };
}
