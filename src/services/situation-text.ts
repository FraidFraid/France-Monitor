// src/services/situation-text.ts — sépare, dans les textes du moteur de situations, les sous-scores
// chiffrés (« Score cyber consolidé : 63/100 », « Ransomware : 25/25 ») du reste. Dans la fiche
// situation, les premiers rejoignent « Pourquoi ce niveau ? » (spec §4.3 : le nombre seulement
// dans ce volet ; arbitrage A7). Pur.

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
