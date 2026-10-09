// tests/mobile-overflow-css.test.ts : débordement horizontal du téléphone (contrôle à l'écran du 09/10/2026, E2). À 390 px, le libellé
// `.visually-hidden` (position absolue) des boutons de thème sortait de la barre défilante et élargissait la page à 446 px ; le menu
// Sources, ancré au bord droit de son bouton, débordait de 27 px à gauche.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');

/** Corps de la première règle dont le sélecteur est exactement `selector`, après `from` (index dans la feuille). */
function ruleBody(selector: string, from = 0): string {
  const at = css.indexOf(`\n${selector} {`, from);
  if (at === -1) return '';
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}
/** Blocs d'une requête média (chacun de son ouverture à la requête suivante), mis bout à bout. */
function mediaBlock(query: string): string {
  const blocks: string[] = [];
  for (let at = css.indexOf(`@media ${query} {`); at !== -1; at = css.indexOf(`@media ${query} {`, at + 1)) {
    const next = css.indexOf('@media', at + 1);
    blocks.push(css.slice(at, next === -1 ? undefined : next));
  }
  return blocks.join('\n');
}

describe('téléphone : aucune largeur au-delà de l’écran (E2)', () => {
  it('un bouton de thème contient son libellé caché (position relative) : il ne sort plus de la barre défilante', () => {
    expect(ruleBody('.tb-theme')).toMatch(/position:\s*relative/);
  });
  it('le libellé caché reste découpé à 1 px (clip et clip-path), sans largeur propre', () => {
    const body = ruleBody('.visually-hidden');
    for (const decl of [/position:\s*absolute/, /width:\s*1px/, /height:\s*1px/, /overflow:\s*hidden/, /clip:\s*rect\(0,\s*0,\s*0,\s*0\)/, /clip-path:\s*inset\(50%\)/]) {
      expect(body).toMatch(decl);
    }
  });
  it('jusqu’à 768 px, le menu Sources s’ancre au bloc d’état (aligné à droite de l’en-tête), pas à son bouton', () => {
    const block = mediaBlock('(max-width: 768px)');
    expect(block).not.toBe('');
    expect(block).toMatch(/\.status-menu\s*\{\s*position:\s*static;/);
  });
});
