import { describe, it, expect } from 'vitest';
import { SECTIONS_STORAGE_KEY, loadSectionState, saveSectionState, sectionsOf, type SectionStorage } from './fiche-sections-store.ts';

function memory(initial: string | null = null): SectionStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key: string) { return key === SECTIONS_STORAGE_KEY ? this.value : null; },
    setItem(key: string, value: string) { if (key === SECTIONS_STORAGE_KEY) this.value = value; },
  };
}

const throwing: SectionStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

describe('mémoire des sections (spec 2026-10-01 § 3.3)', () => {
  it('aller-retour', () => {
    const store = memory();
    saveSectionState(store, new Map([['france:infra', true], ['france:note', false]]));
    expect(loadSectionState(store)).toEqual(new Map([['france:infra', true], ['france:note', false]]));
  });

  it('vide, absent, JSON invalide, valeurs non booléennes, stockage refusé : jamais d’exception', () => {
    expect(loadSectionState(null)).toEqual(new Map());
    expect(loadSectionState(memory())).toEqual(new Map());
    expect(loadSectionState(memory('{pas du json'))).toEqual(new Map());
    expect(loadSectionState(memory('[1,2]'))).toEqual(new Map());
    expect(loadSectionState(memory('{"france:infra":"oui","france:note":true}'))).toEqual(new Map([['france:note', true]]));
    expect(loadSectionState(throwing)).toEqual(new Map());
    expect(() => saveSectionState(throwing, new Map([['france:infra', true]]))).not.toThrow();
    expect(() => saveSectionState(null, new Map())).not.toThrow();
  });

  it('sections d’une fiche, clés sans préfixe', () => {
    const state = new Map([['france:infra', true], ['theme:energy:x', false], ['france:note', false]]);
    expect(sectionsOf(state, 'france')).toEqual(new Map([['infra', true], ['note', false]]));
  });
});
