import { describe, expect, it, vi } from 'vitest';
import type { Radar2dManifest } from './radar-2d.ts';
import {
  installRadar2dObservation,
  runRadar2dToggleTransition,
} from './radar-2d-orchestration.ts';

const manifest: Radar2dManifest = {
  schemaVersion: 1,
  imageUrl: 'https://example.test/radar.png',
  bounds: [-5, 41, 10, 52],
  observedAt: '2026-07-16T13:00:00Z',
  generatedAt: '2026-07-16T13:01:00Z',
  source: 'Météo-France DPRadar',
  resolutionMeters: 1000,
  license: 'Licence Ouverte 2.0',
};

describe('installRadar2dObservation', () => {
  it('ne rapporte le succès qu’après installation effective de l’overlay', async () => {
    const order: string[] = [];
    await installRadar2dObservation({
      manifest,
      enabled: true,
      installOverlay: async () => { order.push('overlay'); },
      reportSuccess: () => { order.push('success'); },
    });
    expect(order).toEqual(['overlay', 'success']);
  });

  it('ne rapporte aucun succès lorsque l’installation échoue', async () => {
    const reportSuccess = vi.fn();
    await expect(installRadar2dObservation({
      manifest,
      enabled: true,
      installOverlay: async () => { throw new Error('overlay failed'); },
      reportSuccess,
    })).rejects.toThrow('overlay failed');
    expect(reportSuccess).not.toHaveBeenCalled();
  });
});

describe('runRadar2dToggleTransition', () => {
  it('laisse la dernière désactivation gagner sur une activation différée', async () => {
    let resolveInstall!: () => void;
    const installGate = new Promise<void>((resolve) => { resolveInstall = resolve; });
    let generation = 0;
    let overlayVisible = false;
    let buttonEnabled = false;
    const reportSuccess = vi.fn();
    const disableOverlay = vi.fn(async () => { overlayVisible = false; });

    const activationGeneration = ++generation;
    const activation = runRadar2dToggleTransition({
      enabled: true,
      isCurrent: () => activationGeneration === generation,
      loadManifest: async () => {
        await installRadar2dObservation({
          manifest,
          enabled: true,
          isCurrent: () => activationGeneration === generation,
          installOverlay: async (_manifest, enabled) => {
            await installGate;
            overlayVisible = enabled;
          },
          reportSuccess,
        });
      },
      disableOverlay,
      syncEnabled: (enabled) => { buttonEnabled = enabled; },
      onError: vi.fn(),
    });

    const deactivationGeneration = ++generation;
    await runRadar2dToggleTransition({
      enabled: false,
      isCurrent: () => deactivationGeneration === generation,
      loadManifest: vi.fn(),
      disableOverlay,
      syncEnabled: (enabled) => { buttonEnabled = enabled; },
      onError: vi.fn(),
    });

    resolveInstall();
    await activation;

    expect(buttonEnabled).toBe(false);
    expect(overlayVisible).toBe(false);
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(disableOverlay).toHaveBeenCalledTimes(2);
  });

  it('restaure l’état actif quand la désactivation de la carte échoue', async () => {
    const syncEnabled = vi.fn();
    const onError = vi.fn();
    await runRadar2dToggleTransition({
      enabled: false,
      loadManifest: vi.fn(),
      disableOverlay: async () => { throw new Error('disable failed'); },
      syncEnabled,
      onError,
    });
    expect(syncEnabled).toHaveBeenLastCalledWith(true);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disable failed' }));
  });

  it('revient à off et nettoie l’overlay quand l’installation échoue', async () => {
    const syncEnabled = vi.fn();
    const disableOverlay = vi.fn(async () => undefined);
    const onError = vi.fn();
    await runRadar2dToggleTransition({
      enabled: true,
      loadManifest: async () => { throw new Error('install failed'); },
      disableOverlay,
      syncEnabled,
      onError,
    });
    expect(disableOverlay).toHaveBeenCalledOnce();
    expect(syncEnabled).toHaveBeenLastCalledWith(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'install failed' }));
  });

  it('absorbe aussi le rejet du nettoyage sans créer de rejet non géré', async () => {
    const onError = vi.fn();
    await expect(runRadar2dToggleTransition({
      enabled: true,
      loadManifest: async () => { throw new Error('install failed'); },
      disableOverlay: async () => { throw new Error('cleanup failed'); },
      syncEnabled: vi.fn(),
      onError,
    })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
