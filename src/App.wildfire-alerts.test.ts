// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { FireDetection, FiresResponse, LocatedFireIncident } from './types/index.ts';
import type { FiresState } from './services/environment-fires.ts';
import { PressAlertSource } from './services/press-alert-source.ts';

const { fetchFires, resolveIncidentGeography } = vi.hoisted(() => ({
  fetchFires: vi.fn(),
  resolveIncidentGeography: vi.fn(),
}));

vi.mock('./services/environment-fires.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/environment-fires.ts')>()),
  fetchFires,
}));

vi.mock('./services/incident-geography.ts', () => ({
  resolveIncidentGeography,
}));

import { App } from './App.ts';

function incident(over: Partial<LocatedFireIncident> = {}): LocatedFireIncident {
  return {
    id: 'gironde-front',
    centroidLat: 44.78,
    centroidLon: -0.93,
    bboxMinLat: 44.7,
    bboxMaxLat: 44.9,
    bboxMinLon: -1,
    bboxMaxLon: -0.8,
    detectionsCount: 58,
    frpMean: 17,
    frpMax: 220,
    frpTotal: 1025,
    confidenceMax: 'high',
    startDatetime: '2026-07-26T14:01:00Z',
    endDatetime: '2026-07-27T11:19:00Z',
    durationMinutes: 1278,
    satellites: ['SNPP', 'NOAA-20', 'NOAA-21'],
    hasNightDetection: true,
    nearUrban: true,
    clusterMethod: 'dbscan',
    epsKm: 3,
    minPoints: 2,
    score: { severityScore: 48, impactScore: 60, labels: [] },
    detectionIds: [],
    deptCodes: ['33'],
    communes: ['Cestas'],
    ...over,
  };
}

function detection(id: string, lat: number, lon: number, recurrent = false): FireDetection {
  return {
    id, lat, lon, acquiredAt: '2026-07-27T11:19:00Z', satellite: 'NOAA-21', sensor: 'VIIRS', confidence: 'nominale', confidenceRaw: 'n',
    frpMw: 42, daynight: 'D', dept: '33', recurrent, foyerId: 'a',
  };
}

function firesState(detections: FireDetection[]): FiresState {
  const data: FiresResponse = {
    readAt: '2026-07-27T11:30:00Z', lastAcquisitionAt: '2026-07-27T11:19:00Z', sources: [], detections, abroadCount: 0, abroad: [], foyers: [],
    daily: { days: [], since: null }, nextPasses: [], forestDanger: null, errors: [],
  };
  return { fires: { data, error: null, fetchedAt: Date.parse('2026-07-27T11:30:00Z') } };
}

function appForAlerts(currentFireIncidents: LocatedFireIncident[]): App & Record<string, unknown> {
  const app = Object.create(App.prototype) as App & Record<string, unknown>;
  Object.assign(app, {
    newsItems: [],
    currentMilitarySurges: [],
    currentMeteoAlerts: [],
    currentDefenseAlerts: [],
    currentJammingSignals: [],
    currentAisAnomalies: [],
    currentFireIncidents,
    alertMonitorCache: new Map(),
    pressAlertSource: new PressAlertSource(),
  });
  return app;
}

describe('App : alertes grands feux', () => {
  it('publie dans AlertMonitor un incident FIRMS qui franchit la porte grand feu', () => {
    const app = appForAlerts([incident()]);

    const alerts = (
      app as unknown as { buildAlertMonitorSituations: () => Array<{ type: string; title: string }> }
    ).buildAlertMonitorSituations();

    expect(alerts).toEqual([
      expect.objectContaining({
        type: 'WILDFIRE_ESCALATION',
        title: 'Incendie majeur en cours',
      }),
    ]);
  });

  it('regroupe les seules détections non récurrentes puis rafraîchit les situations dès que la géo-résolution aboutit', async () => {
    fetchFires.mockResolvedValue(firesState([
      detection('d1', 44.78, -0.93), detection('d2', 44.79, -0.92), detection('torchere', 43.3, 5.4, true),
    ]));
    const locatedIncident = incident();
    resolveIncidentGeography.mockResolvedValue([locatedIncident]);

    const app = appForAlerts([]);
    const refreshFranceIntelPanel = vi.fn();
    const firesUpdate = vi.fn();
    Object.assign(app, {
      currentFires: null, currentActiveFires: [], forestDangerFill: false, radarManifest: null, mtgFrpFeed: null,
      gibsEnabled: false, mtgFrpEnabled: false, echoTopsEnabled: false, mapLegend: null,
      statusPanel: { updateSource: vi.fn(), getSources: vi.fn(() => []) },
      mapContainer: { updateFiresLayer: vi.fn() },
      firesPanel: { update: firesUpdate },
      refreshFranceIntelPanel,
    });

    await (
      app as unknown as { loadFires: () => Promise<void> }
    ).loadFires();
    await vi.waitFor(() => expect(refreshFranceIntelPanel).toHaveBeenCalledTimes(2));

    expect((app as unknown as { currentActiveFires: unknown[] }).currentActiveFires).toHaveLength(2);
    expect(resolveIncidentGeography).toHaveBeenCalledWith([expect.objectContaining({ detectionsCount: 2 })]);
    expect(
      (app as unknown as { currentFireIncidents: LocatedFireIncident[] }).currentFireIncidents,
    ).toEqual([locatedIncident]);
    expect(firesUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ incidents: [locatedIncident] }));
  });
});
