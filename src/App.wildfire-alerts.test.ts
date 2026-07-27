// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { ActiveFire, FireIncident, LocatedFireIncident } from './types/index.ts';

const { fetchFiresData, resolveIncidentGeography } = vi.hoisted(() => ({
  fetchFiresData: vi.fn(),
  resolveIncidentGeography: vi.fn(),
}));

vi.mock('./services/fires.ts', () => ({
  fetchFiresData,
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
  });
  return app;
}

describe('App — alertes grands feux', () => {
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

  it('rafraîchit les situations dès que la géo-résolution FIRMS aboutit', async () => {
    const rawIncident = incident({ deptCodes: [], communes: [] }) as FireIncident;
    const locatedIncident = incident();
    fetchFiresData.mockResolvedValue({
      detections: [] as ActiveFire[],
      incidents: [rawIncident],
      sources: ['SNPP', 'NOAA-20', 'NOAA-21'],
      apiKeyUsed: true,
    });
    resolveIncidentGeography.mockResolvedValue([locatedIncident]);

    const app = appForAlerts([]);
    const refreshFranceIntelPanel = vi.fn();
    Object.assign(app, {
      statusPanel: { updateSource: vi.fn() },
      firesPanel: {
        setSourcesInfo: vi.fn(),
        setRawFires: vi.fn(),
        isVisible: vi.fn(() => false),
      },
      refreshFranceIntelPanel,
    });

    await (
      app as unknown as { loadFires: () => Promise<void> }
    ).loadFires();
    await vi.waitFor(() => expect(refreshFranceIntelPanel).toHaveBeenCalledOnce());

    expect(
      (app as unknown as { currentFireIncidents: LocatedFireIncident[] }).currentFireIncidents,
    ).toEqual([locatedIncident]);
  });
});
