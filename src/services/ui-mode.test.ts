import { describe, it, expect } from 'vitest';
import { layerActivationOptions, layerStateStorage, legendStatusLabel, moduleInColumn, opensModulePanel, reopensLayerPanelsOnLoad, shouldRecordIntelSnapshot } from './ui-mode.ts';

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

describe('opensModulePanel (spec 2026-09-29 § 4)', () => {
  it('v1 : tout déclencheur ouvre le panneau, comme avant', () => {
    expect(opensModulePanel(false, undefined)).toBe(true);
    expect(opensModulePanel(false, { explicit: false })).toBe(true);
  });

  it('v2 : seule une demande explicite de l’analyste ouvre le panneau', () => {
    expect(opensModulePanel(true, { explicit: true })).toBe(true);
    expect(opensModulePanel(true, { explicit: false })).toBe(false);
    expect(opensModulePanel(true, undefined)).toBe(false);
    expect(opensModulePanel(true, null)).toBe(false);
    expect(opensModulePanel(true, 'explicit')).toBe(false);
  });
});

describe('layerStateStorage (spec 2026-09-29 § 5)', () => {
  const local = { kind: 'local' } as unknown as Storage;
  const session = { kind: 'session' } as unknown as Storage;

  it('v2 : la session ; v1 : localStorage', () => {
    expect(layerStateStorage(true, { localStorage: local, sessionStorage: session })).toBe(session);
    expect(layerStateStorage(false, { localStorage: local, sessionStorage: session })).toBe(local);
  });

  it('stockage inaccessible (navigation privée) : null, sans exception', () => {
    const win = { localStorage: local } as Pick<Window, 'localStorage' | 'sessionStorage'>;
    Object.defineProperty(win, 'sessionStorage', { get() { throw new Error('SecurityError'); } });
    expect(layerStateStorage(true, win)).toBeNull();
  });
});

describe('legendStatusLabel (spec 2026-09-29 § 8)', () => {
  it('v2 : l’état de récupération, pas une promesse de temps réel', () => {
    expect(['ok', 'stale', 'error'].map((s) => legendStatusLabel(true, s as 'ok' | 'stale' | 'error'))).toEqual(['À JOUR', 'EN RETARD', 'INDISPONIBLE']);
  });
  it('v1 : inchangé', () => {
    expect(legendStatusLabel(false, 'ok')).toBe('TEMPS RÉEL');
    expect(legendStatusLabel(false, 'stale')).toBe('CACHE FIGÉ');
  });
});

describe('moduleInColumn — panneaux à la place de l’État seulement en bureau', () => {
  it('v2 et ≥ 1101 px seulement', () => {
    expect(moduleInColumn(true, 1101)).toBe(true);
    expect(moduleInColumn(true, 1100)).toBe(false);
    expect(moduleInColumn(true, 390)).toBe(false);
    expect(moduleInColumn(false, 1600)).toBe(false);
  });
});
