import { describe, it, expect } from 'vitest';
import { layerActivationOptions, reopensLayerPanelsOnLoad, shouldRecordIntelSnapshot } from './ui-mode.ts';

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

describe('panneaux flottants et colonne fiche (relecture finale I1)', () => {
  it('v2 : une couche activée par le poste n’ouvre pas son panneau flottant', () => {
    expect(layerActivationOptions(true)).toEqual({ suppressPanel: true });
  });

  it('v1 : options vides, le panneau s’ouvre comme avant', () => {
    expect(layerActivationOptions(false)).toEqual({});
  });

  it('au chargement, les panneaux des couches persistées ne se rouvrent qu’en v1', () => {
    expect(reopensLayerPanelsOnLoad(false)).toBe(true);
    expect(reopensLayerPanelsOnLoad(true)).toBe(false);
  });
});
