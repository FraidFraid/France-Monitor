// tests/protests-gilets-jaunes.test.ts : préférence d'affichage des annonces de la carte des gilets jaunes (26/10/2026).
import { describe, expect, it } from 'vitest';
import type { ProtestsResponse } from '../src/types/index.ts';
import { GILETS_JAUNES_PREF_KEY, readGiletsJaunesPref, withGiletsJaunes, writeGiletsJaunesPref } from '../src/services/protests.ts';

const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const r = { readAt: 'x', items: [{ id: 'a', source: 'demosphere' }, { id: 'b', source: 'giletsjaunes' }] } as unknown as ProtestsResponse;

describe('préférence gilets jaunes', () => {
  it('décochée par défaut ; choix gardé ; stockage absent ou refusé : décochée', () => {
    const s = store();
    expect(readGiletsJaunesPref(s)).toBe(false);
    writeGiletsJaunesPref(s, true);
    expect([s.getItem(GILETS_JAUNES_PREF_KEY), readGiletsJaunesPref(s)]).toEqual(['1', true]);
    expect(readGiletsJaunesPref(null)).toBe(false);
    expect(readGiletsJaunesPref({ getItem: () => { throw new Error('refusé'); } })).toBe(false);
  });
  it('filtre : masquées → sans gilets jaunes ; affichées ou réponse absente → inchangé', () => {
    expect(withGiletsJaunes(r, false)?.items.map((x) => x.id)).toEqual(['a']);
    expect(withGiletsJaunes(r, true)).toBe(r);
    expect(withGiletsJaunes(null, false)).toBeNull();
  });
});
