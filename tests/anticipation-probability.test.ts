// tests/anticipation-probability.test.ts : échelle de probabilité, origines indépendantes et plancher des grilles (04/11/2026).
import { describe, expect, it } from 'vitest';
import { WORDS, V1_WORDS, WORD_LABEL, WORD_RANGE, applyFloor, countOrigins, wordWhy } from '../api/_lib/anticipation/probability.js';

type Evidence = Parameters<typeof applyFloor>[1];
type Signal = Parameters<typeof countOrigins>[0][number];

const none: Evidence = { origins: 0, hasOfficial: false, hasPublishedDeadline: false, officialLevel: null, basculeHit: false, precedentDay: null };

describe('échelle', () => {
  it('expose sept mots, quatre en v1, libellés et fourchettes exacts', () => {
    expect(WORDS).toHaveLength(7);
    expect(V1_WORDS).toEqual(['peu_probable', 'possibilite_reelle', 'probable', 'tres_probable']);
    expect(WORD_LABEL.chance_infime).toBe('chance infime');
    expect(WORD_LABEL.quasi_certain).toBe('quasi certain');
    expect(WORD_RANGE.probable).toBe('55\u00a0à\u00a075\u00a0%');
    expect(WORD_RANGE.chance_infime).toBe('≤\u00a05\u00a0%');
    expect(WORD_RANGE.quasi_certain).toBe('≥\u00a095\u00a0%');
  });
});

describe('plancher', () => {
  it('floor: one origin, no precedent caps at peu_probable', () => {
    expect(applyFloor('tres_probable', { origins: 1, hasOfficial: true, hasPublishedDeadline: false, officialLevel: 'rouge', basculeHit: true, precedentDay: null })).toBe('peu_probable');
  });
  it('floor: probable needs 2 origins incl. official or deadline', () => {
    expect(applyFloor('probable', { ...none, origins: 2 })).toBe('possibilite_reelle');
    expect(applyFloor('probable', { ...none, origins: 2, hasOfficial: true })).toBe('probable');
    expect(applyFloor('probable', { ...none, origins: 2, hasPublishedDeadline: true })).toBe('probable');
  });
  it('floor: tres_probable needs orange/red official, bascule or precedent', () => {
    const base: Evidence = { origins: 3, hasOfficial: true, hasPublishedDeadline: true, officialLevel: 'jaune', basculeHit: false, precedentDay: null };
    expect(applyFloor('tres_probable', base)).toBe('probable');
    expect(applyFloor('tres_probable', { ...base, precedentDay: '2026-10-12' })).toBe('tres_probable');
    expect(applyFloor('tres_probable', { ...base, officialLevel: 'orange' })).toBe('tres_probable');
    expect(applyFloor('tres_probable', { ...base, basculeHit: true })).toBe('tres_probable');
  });
  it('un précédent lève le plafond d une seule origine', () => {
    expect(applyFloor('possibilite_reelle', { ...none, origins: 1, precedentDay: '2026-10-12' })).toBe('possibilite_reelle');
  });
  it('le plancher ne relève jamais un mot', () => {
    expect(applyFloor('peu_probable', { ...none, origins: 5, hasOfficial: true, officialLevel: 'rouge' })).toBe('peu_probable');
  });
  it('v1 clamps extreme words', () => {
    const strong: Evidence = { origins: 5, hasOfficial: true, hasPublishedDeadline: true, officialLevel: 'rouge', basculeHit: true, precedentDay: '2026-10-12' };
    expect(applyFloor('quasi_certain', strong)).toBe('tres_probable');
    expect(applyFloor('chance_infime', strong)).toBe('peu_probable');
    expect(applyFloor('tres_peu_probable', strong)).toBe('peu_probable');
  });
});

describe('origines', () => {
  it('same press event counts once', () => {
    const s = (origin: string) => ({ origin }) as Signal;
    expect(countOrigins([s('presse:event:42'), s('presse:event:42'), s('demosphere'), s('cgt')])).toBe(3);
  });
  it('ignore les origines vides', () => {
    expect(countOrigins([{ origin: '' } as Signal, { origin: 'cgt' } as Signal])).toBe(1);
    expect(countOrigins([])).toBe(0);
  });
});

describe('wordWhy', () => {
  it('wordWhy names origins and precedent', () => {
    expect(wordWhy({ ...none, origins: 3, hasOfficial: true, precedentDay: '2026-10-12' })).toBe('3 sources indépendantes, précédent du 12/10');
  });
  it('accorde le singulier et nomme échéance et bascule', () => {
    expect(wordWhy({ ...none, origins: 1 })).toBe('1 source');
    expect(wordWhy(none)).toBe('aucune source indépendante');
    expect(wordWhy({ ...none, origins: 2, hasPublishedDeadline: true, officialLevel: 'orange', basculeHit: true }))
      .toBe('2 sources indépendantes, échéance publiée, niveau officiel orange, bascule atteinte');
  });
});
