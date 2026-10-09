import { describe, it, expect } from 'vitest';
import { isUiV2, layerActivationOptions, layerStateStorage, legendStatusLabel, moduleInColumn, reopensLayerPanelsOnLoad, shouldRecordIntelSnapshot, shouldRenderLanding } from './ui-mode.ts';

describe('isUiV2 (spec 2026-09-29 § 10)', () => {
  it('la v2 par défaut ; l’ancienne interface par ?ui=v1', () => {
    expect(isUiV2('')).toBe(true);
    expect(isUiV2('?view=app')).toBe(true);
    expect(isUiV2('?ui=v2')).toBe(true);
    expect(isUiV2('?ui=v1')).toBe(false);
    expect(isUiV2('?view=app&ui=v1')).toBe(false);
  });
});

describe('shouldRenderLanding (la v2 par défaut ne doit pas supprimer la page d’accueil)', () => {
  it('« / » sans paramètre ni ancre : page d’accueil', () => {
    expect(shouldRenderLanding('/', '', '')).toBe(true);
  });

  it('?view=app ou ?ui=v2 explicite : tableau de bord', () => {
    expect(shouldRenderLanding('/', '?view=app', '#live')).toBe(false);
    expect(shouldRenderLanding('/', '?view=app&ui=v1', '')).toBe(false);
    expect(shouldRenderLanding('/', '?ui=v2', '')).toBe(false);
  });

  it('une ancre ou un autre chemin : pas de page d’accueil', () => {
    expect(shouldRenderLanding('/', '', '#live')).toBe(false);
    expect(shouldRenderLanding('/sources-quality', '', '')).toBe(false);
  });
});

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
