import { describe, it, expect } from 'vitest';
import { noEmDash } from './typography.ts';

const DASH = '—';

describe('aucun tiret cadratin (spec 2026-10-01 fiches § 7)', () => {
  it('incise entre espaces → deux-points', () => {
    expect(noEmDash(`Grève ${DASH} la SNCF annonce un trafic perturbé`)).toBe('Grève : la SNCF annonce un trafic perturbé');
  });
  it('en tête de texte : retiré', () => {
    expect(noEmDash(`${DASH} Mise à jour`)).toBe('Mise à jour');
  });
  it('collé entre deux mots : trait d’union', () => {
    expect(noEmDash(`2025${DASH}2026`)).toBe('2025-2026');
  });
  it('texte sans tiret inchangé', () => {
    expect(noEmDash('Rien à signaler')).toBe('Rien à signaler');
  });
});
