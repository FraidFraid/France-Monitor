// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedSituation, FireDetection, FiresResponse, LocatedFireIncident } from './types/index.ts';
import type { FiresState } from './services/environment-fires.ts';
import { PressAlertSource } from './services/press-alert-source.ts';

const { fetchFires, fetchFireImpacts, resolveIncidentGeography, enrichWithLlm } = vi.hoisted(() => ({
  fetchFires: vi.fn(),
  fetchFireImpacts: vi.fn(async () => ({ data: null, error: null })),
  resolveIncidentGeography: vi.fn(),
  enrichWithLlm: vi.fn(async (d: unknown) => d),
}));

vi.mock('./services/environment-fires.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/environment-fires.ts')>()),
  fetchFires,
  fetchFireImpacts,
}));

vi.mock('./services/wildfire-enrich.ts', () => ({ enrichWithLlm }));

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
    currentVigilance: null,
    currentMilitary: null,
    currentCables: null,
    currentSovCyber: null,
    currentAisAnomalies: [],
    currentFireIncidents,
    alertMonitorCache: new Map(),
    pressAlertSource: new PressAlertSource(),
  });
  return app;
}

describe('App : alertes grands feux', () => {
  // Collecte des feux lue le 27/07 à 11 h 30 UTC : l'horloge est posée cinq minutes plus tard (une collecte de plus de 2 jours ne
  // compte plus, environment-inputs.ts).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-07-27T11:35:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publie dans AlertMonitor un incident FIRMS qui franchit la porte grand feu', () => {
    const app = appForAlerts([incident()]);
    Object.assign(app, { currentFires: firesState([]) });

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

  it('collecte de plus de 2 jours, gardée par le client après une erreur : ses incidents ne publient plus d’alerte grand feu', () => {
    const app = appForAlerts([incident()]);
    Object.assign(app, { currentFires: firesState([]) });
    vi.setSystemTime(Date.parse('2026-07-29T11:31:00Z'));

    expect((app as unknown as { buildAlertMonitorSituations: () => unknown[] }).buildAlertMonitorSituations()).toEqual([]);
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
      currentFires: null, forestDangerFill: false, radarManifest: null, mtgFrpFeed: null,
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

    expect((app as unknown as { environmentInputs: () => { activeFires: unknown[] } }).environmentInputs().activeFires).toHaveLength(2);
    expect(resolveIncidentGeography).toHaveBeenCalledWith([expect.objectContaining({ detectionsCount: 2 })]);
    expect(
      (app as unknown as { currentFireIncidents: LocatedFireIncident[] }).currentFireIncidents,
    ).toEqual([locatedIncident]);
    expect(firesUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ incidents: [locatedIncident] }));
  });
});

describe('App : dossier d’un grand feu ouvert depuis une situation (onglet du panneau Feux)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  function dossierApp(incidents: LocatedFireIncident[]) {
    const app = appForAlerts(incidents);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const hideAllFloatingPanels = vi.fn();
    // Couche Feux jamais activée : ni panneau, ni collecte lue (cas par défaut en v2).
    Object.assign(app, {
      floatContainerEl: container, firesPanel: null, firesPanelPromise: null, mapContainer: null, activeLayers: { fires: false },
      currentFires: null, forestDangerFill: false, radarManifest: null, mtgFrpFeed: null, gibsEnabled: false, mtgFrpEnabled: false,
      echoTopsEnabled: false, currentFloatingPanelId: null, hideAllFloatingPanels, refreshFloatingPanelSwitcher: vi.fn(),
    });
    const open = (incidentId: string): boolean => (
      app as unknown as { openAlertDossier: (s: DetectedSituation) => boolean }
    ).openAlertDossier({ type: 'WILDFIRE_ESCALATION', id: `wildfire-${incidentId}` } as DetectedSituation);
    const dossierTab = (): string | null | undefined =>
      container.querySelector('.fires-panel-modal.is-open [data-tab="dossier"]')?.getAttribute('aria-selected');
    return { app, container, hideAllFloatingPanels, open, dossierTab };
  }

  it('couche Feux jamais activée : panneau créé à la demande, état donné d’abord, onglet Dossier ouvert sur l’incident', async () => {
    const { app, hideAllFloatingPanels, open, dossierTab } = dossierApp([incident()]);

    expect(open('gironde-front')).toBe(true);
    await vi.waitFor(() => expect(dossierTab()).toBe('true'));

    expect(hideAllFloatingPanels).toHaveBeenCalledWith('fires');
    expect((app as unknown as { currentFloatingPanelId: string | null }).currentFloatingPanelId).toBe('fires');
    expect(fetchFireImpacts).toHaveBeenCalledWith(44.78, -0.93);
  });

  it('panneau déjà créé couche éteinte, sans état : le dossier s’ouvre aussitôt', async () => {
    const { app, container, open, dossierTab } = dossierApp([incident()]);
    await (app as unknown as { ensureFiresPanel: () => Promise<void> }).ensureFiresPanel();
    expect(container.querySelector('.fires-panel-modal.is-open')).toBeNull();

    expect(open('gironde-front')).toBe(true);
    expect(dossierTab()).toBe('true');
  });

  it('incident inconnu : faux, aucun panneau masqué ni ouvert', async () => {
    const { app, container, hideAllFloatingPanels, open } = dossierApp([incident()]);
    await (app as unknown as { ensureFiresPanel: () => Promise<void> }).ensureFiresPanel();

    expect(open('inconnu')).toBe(false);
    expect(hideAllFloatingPanels).not.toHaveBeenCalled();
    expect(container.querySelector('.fires-panel-modal.is-open')).toBeNull();
  });
});
