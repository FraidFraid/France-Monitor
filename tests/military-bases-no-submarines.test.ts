// O11 : aucun SNLE ni SNA visible dans les sites de défense (nom, description, unités) ; l'Île Longue reste un site au même point.
import { describe, expect, it } from 'vitest';
import { INSTALLATIONS_BY_ID, ALL_MILITARY_INSTALLATIONS } from '../src/config/military-bases-db.ts';

describe('sites de défense et sous-marins (O11)', () => {
  it('l’Île Longue est « Île Longue (base navale) », même point, sans SNLE ni SNA', () => {
    const site = INSTALLATIONS_BY_ID.get('BN-ILE-LONGUE');
    expect(site?.name).toBe('Île Longue (base navale)');
    expect(site?.coordinates).toEqual([-4.5636, 48.3253]);
  });
  it('aucun nom, description ni unité ne cite SNLE ou SNA', () => {
    for (const s of ALL_MILITARY_INSTALLATIONS) {
      const text = [s.name, s.description ?? '', ...(s.units ?? [])].join(' ');
      expect(text, s.id).not.toMatch(/\bSNLE\b|\bSNA\b/);
    }
  });
});
