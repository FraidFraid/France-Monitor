// @vitest-environment happy-dom
// Manifeste radar Météo-France lu par App.ts (spec 2026-10-04 environnement § 2.3) : image commandée par la couche Radar météo,
// ligne « Radar Météo-France » datée par l'observation, échec nommé sans image inventée.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Radar2dManifest } from './services/radar-2d.ts';

const { fetchRadar2dManifest } = vi.hoisted(() => ({ fetchRadar2dManifest: vi.fn() }));

vi.mock('./services/radar-2d.ts', () => ({ fetchRadar2dManifest }));

import { App } from './App.ts';

const MANIFEST: Radar2dManifest = {
  schemaVersion: 1, source: 'Météo-France DPRadar', observedAt: '2026-10-04T08:05:00Z', generatedAt: '2026-10-04T08:10:25Z',
  bounds: [-9.965, 39.46785, 14.564708, 53.67], imageUrl: 'https://www.francemonitor.com/radar/rasters/radar-20261004T0805Z.webp',
  resolutionMeters: 1000, license: 'Licence Ouverte 2.0',
};

interface RadarFields { radarManifest: unknown; radarError: string | null }

function radarApp(setRadar2dOverlay: () => Promise<void>) {
  const app = Object.create(App.prototype) as App & Record<string, unknown>;
  const updateSource = vi.fn();
  const setEchoTopsOverlay = vi.fn();
  const overlay = vi.fn(setRadar2dOverlay);
  const panelUpdate = vi.fn();
  Object.assign(app, {
    radarManifest: null, radarError: null, radarProfile: null, echoTopsEnabled: true,
    mapContainer: { setRadar2dOverlay: overlay, setEchoTopsOverlay },
    statusPanel: { updateSource, getSources: vi.fn(() => []) },
    weatherRadarPanel: { update: panelUpdate }, firesPanel: null, mapLegend: null,
  });
  const load = (app as unknown as { loadRadarManifest: () => Promise<void> }).loadRadarManifest.bind(app);
  return { app: app as unknown as RadarFields, load, updateSource, setEchoTopsOverlay, overlay, panelUpdate };
}

describe('App : manifeste radar Météo-France', () => {
  beforeEach(() => fetchRadar2dManifest.mockReset());

  it('image installée sans l’ancien interrupteur (la couche Radar la montre), sommets d’écho selon l’option, ligne datée', async () => {
    fetchRadar2dManifest.mockResolvedValue({ configured: true, degraded: false, manifest: MANIFEST });
    const { app, load, updateSource, setEchoTopsOverlay, overlay, panelUpdate } = radarApp(async () => undefined);
    await load();
    expect(fetchRadar2dManifest).toHaveBeenCalledWith(true);
    expect(overlay).toHaveBeenCalledWith(MANIFEST, false);
    expect(setEchoTopsOverlay).toHaveBeenCalledWith(MANIFEST, true);
    expect(updateSource).toHaveBeenCalledWith('Radar Météo-France', expect.objectContaining({ lastUpdate: new Date('2026-10-04T08:05:00Z') }));
    expect(panelUpdate).toHaveBeenCalledWith(expect.objectContaining({ manifest: MANIFEST, echoTops: true, error: null }));
    expect(app.radarError).toBeNull();
  });

  it('installation en échec : échec nommé, aucune image gardée ni inventée, la lecture ne rejette pas', async () => {
    fetchRadar2dManifest.mockResolvedValue({ configured: true, degraded: false, manifest: MANIFEST });
    const { app, load, updateSource } = radarApp(async () => { throw new Error('overlay install failed'); });
    await expect(load()).resolves.toBeUndefined();
    expect(app.radarManifest).toBeNull();
    expect(updateSource).toHaveBeenCalledWith('Radar Météo-France', expect.objectContaining({ status: 'error', error: 'lecture du manifeste radar en échec' }));
  });

  it('worker non configuré : dit tel quel', async () => {
    fetchRadar2dManifest.mockResolvedValue({ configured: false });
    const { load, updateSource, overlay } = radarApp(async () => undefined);
    await load();
    expect(overlay).toHaveBeenCalledWith(null, false);
    expect(updateSource).toHaveBeenCalledWith('Radar Météo-France', expect.objectContaining({ status: 'error', error: 'worker radar non configuré' }));
  });
});
