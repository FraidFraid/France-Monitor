// O11 : aucun SNLE ni SNA visible dans les sites de défense ; l'Île Longue reste un site au même point. Depuis la tâche A17 (O13), un site
// ne porte plus ni description ni unités : seul son nom reste à vérifier.
import { describe, expect, it } from 'vitest';
import { INSTALLATIONS_BY_ID, ALL_MILITARY_INSTALLATIONS } from '../src/config/military-bases-db.ts';

describe('sites de défense et sous-marins (O11)', () => {
  it('l’Île Longue est « Île Longue (base navale) », même point, sans SNLE ni SNA', () => {
    const site = INSTALLATIONS_BY_ID.get('BN-ILE-LONGUE');
    expect(site?.name).toBe('Île Longue (base navale)');
    expect(site?.coordinates).toEqual([-4.5636, 48.3253]);
  });
  it('aucun nom ne cite SNLE ou SNA', () => {
    for (const s of ALL_MILITARY_INSTALLATIONS) expect(s.name, s.id).not.toMatch(/\bSNLE\b|\bSNA\b/);
  });
});
