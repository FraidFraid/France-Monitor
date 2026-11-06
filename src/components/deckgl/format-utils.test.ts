// src/components/deckgl/format-utils.test.ts
import { describe, expect, it } from 'vitest';
import { withSourceNote } from './format-utils.ts';

describe('withSourceNote : source au pied des infobulles de carte (retour médecin 05/11/2026)', () => {
  const src = { label: 'Vigicrues', token: 'Vigicrues' };

  it('ajoute « Source : … » en texte seul, échappé', () => {
    expect(withSourceNote('<b>x</b>', src)).toBe('<b>x</b><div class="hm-note hm-src">Source : Vigicrues</div>');
    expect(withSourceNote('<b>x</b>', { label: 'A & B', token: 'zz' })).toContain('Source : A &amp; B');
    expect(withSourceNote('<b>x</b>', src)).not.toContain('<a ');
  });

  it('rien en double : ligne « Source » déjà là, ou nom de la source déjà cité (casse ignorée)', () => {
    expect(withSourceNote('<span>Source</span><span>EMSC</span>', src)).toBe('<span>Source</span><span>EMSC</span>');
    expect(withSourceNote('Relevé vigicrues 10:00', src)).toBe('Relevé vigicrues 10:00');
  });

  it('couche sans source attribuée : corps inchangé', () => {
    expect(withSourceNote('<b>x</b>', undefined)).toBe('<b>x</b>');
  });
});
