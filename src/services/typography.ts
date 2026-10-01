// src/services/typography.ts — règle typographique de l'application (spec 2026-10-01 fiches § 7) :
// aucun tiret cadratin affiché. Appliquée aux textes externes à leur arrivée (presse, événements,
// brief IA) ; les textes du code n'en contiennent pas (garde-fou tests/no-em-dash.test.ts).

/** Incise « X — Y » → « X : Y » ; en tête, retiré ; collé entre deux mots, trait d'union. */
export function noEmDash(text: string): string {
  return text
    .replace(/^\s*—\s*/, '')
    .replace(/\s+—\s+/g, ' : ')
    .replace(/\s*—\s*/g, '-');
}
