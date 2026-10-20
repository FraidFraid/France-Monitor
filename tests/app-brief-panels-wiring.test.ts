// tests/app-brief-panels-wiring.test.ts : les En bref (onglets et Environnement) occupent la colonne de droite à la place de la
// fiche, comme tous les panneaux de pastille, jamais flottants (demande de l'utilisateur, 20/10/2026).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');

describe('En bref dans la colonne de droite', () => {
  it('classes des deux En bref dans les trois listes de panneaux (colonne v2, mobile, poignée)', () => {
    for (const cls of ['theme-brief-panel-modal', 'env-brief-panel-modal']) {
      expect(css).toContain(`#app.ui-v2 .${cls},`);
      expect(css).toContain(`  .${cls},\n`);
      expect(css).toContain(`  .${cls}::before,\n`);
    }
  });
});
