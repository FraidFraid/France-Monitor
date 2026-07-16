// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchRadar2dManifest, watchdogReport } = vi.hoisted(() => ({
  fetchRadar2dManifest: vi.fn(),
  watchdogReport: vi.fn(),
}));

vi.mock('./services/radar-2d.ts', () => ({
  fetchRadar2dManifest,
}));

vi.mock('./services/watchdog.ts', () => ({
  Watchdog: {
    register: vi.fn(),
    report: watchdogReport,
    on: vi.fn(() => () => undefined),
    getSnapshot: vi.fn(() => []),
  },
}));

import { App } from './App.ts';

describe('App radar 2D', () => {
  beforeEach(() => {
    fetchRadar2dManifest.mockReset();
    watchdogReport.mockReset();
  });

  it('publie runtime et Watchdog en erreur si la première installation échoue', async () => {
    fetchRadar2dManifest.mockResolvedValue({
      configured: true,
      degraded: false,
      manifest: {
        imageUrl: 'https://example.test/radar.png',
        bounds: [-5, 41, 10, 52],
        observedAt: '2026-07-16T13:00:00Z',
        fetchedAt: '2026-07-16T13:01:00Z',
        source: 'Météo-France DPRadar',
      },
    });
    const app = Object.create(App.prototype) as App & Record<string, unknown>;
    Object.assign(app, {
      radar2dRequestInFlight: false,
      latestRadar2dManifest: null,
      radar2dEnabled: true,
      fireObservationRuntime: {
        mtgFrp: { status: 'loading', observedAt: null, fetchedAt: null, source: 'EUMETSAT LSA SAF' },
        radar2d: { status: 'loading', observedAt: null, fetchedAt: null, source: 'Météo-France DPRadar' },
      },
      mapContainer: {
        setRadar2dOverlay: vi.fn(async () => { throw new Error('overlay install failed'); }),
      },
      firesPanel: { setObservationRuntimeState: vi.fn() },
    });

    await expect(
      (app as unknown as { loadRadar2dManifest: () => Promise<void> }).loadRadar2dManifest(),
    ).rejects.toThrow('overlay install failed');

    const runtime = (app as unknown as {
      fireObservationRuntime: { radar2d: { status: string } };
    }).fireObservationRuntime;
    expect(runtime.radar2d.status).toBe('error');
    expect(watchdogReport).toHaveBeenCalledWith(
      'fire-radar-2d',
      expect.objectContaining({ type: 'failure', error: 'overlay install failed' }),
    );
    expect(watchdogReport).not.toHaveBeenCalledWith(
      'fire-radar-2d',
      expect.objectContaining({ type: 'success' }),
    );
  });
});
