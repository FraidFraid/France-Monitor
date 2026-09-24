import { describe, it, expect } from 'vitest';
import { shouldRecordIntelSnapshot } from './ui-mode.ts';

describe('shouldRecordIntelSnapshot (garde : pas d’écriture dans l’historique partagé avec des caches vides)', () => {
  it('v1 : toujours vrai, le tiroir décide seul de sa visibilité', () => {
    expect(shouldRecordIntelSnapshot(false, false)).toBe(true);
    expect(shouldRecordIntelSnapshot(false, true)).toBe(true);
  });

  it('v2 avant le démarrage (couches critiques non chargées, caches vides) : faux', () => {
    expect(shouldRecordIntelSnapshot(true, false)).toBe(false);
  });

  it('v2 après le démarrage (startV2Intel passé) : vrai', () => {
    expect(shouldRecordIntelSnapshot(true, true)).toBe(true);
  });
});
