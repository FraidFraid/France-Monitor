import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');

describe('panneau « Pression par département » : placement (12/10/2026)', () => {
  it('posé comme les autres panneaux de couche : colonne de droite en v2, feuille du bas sur mobile', () => {
    expect(css).toContain('#app.ui-v2 .pressure-panel-modal,');
    expect(css).toContain('  .pressure-panel-modal,\n');
    expect(css).toContain('  .pressure-panel-modal::before,\n');
  });
});
