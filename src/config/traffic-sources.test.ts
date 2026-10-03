// @vitest-environment happy-dom
// Sources Trafics du panneau des sources (spec 2026-10-03 trafics S1, S2) : « Trafic aérien » daté par l'aperçu du panneau et
// jamais remplacé par la relève de la carte ; positions de la carte sur leur propre ligne, datées par les états OpenSky ;
// « AIS maritime » daté par le dernier message, jamais « à jour » sur un message ancien.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { StatusPanel } from '../components/StatusPanel.ts';
import { TRAFFIC_NOW, airStateFixture } from '../components/layer-panel/traffic.fixture.ts';
import { initI18n } from '../services/i18n.ts';
import { airStatus } from '../services/traffic-air.ts';
import { Watchdog } from '../services/watchdog.ts';
import {
  AIR_POSITIONS_SOURCE, TRAFFIC_LAYER_KEYS, TRAFFIC_LAYER_SOURCES, TRAFFIC_SOURCE_NAMES, aisLiveStatus, airPositionsStatus, trafficReportSources,
} from './traffic-sources.ts';

beforeAll(async () => { await initI18n(); });
afterEach(() => { vi.unstubAllGlobals(); });

const MIN = 60_000;

/** Relais Watchdog → panneau des sources, à l'identique d'App.ts (renderShell). */
function relay(panel: StatusPanel): () => void {
  return Watchdog.on('update', (snapshots) => {
    for (const snap of snapshots) panel.updateSource(snap.status.name, snap.status);
  });
}

describe('« Trafic aérien » : daté par l’aperçu du panneau, jamais par la relève de la carte (I1)', () => {
  it('couche éteinte : une ré-émission du Watchdog laisse la ligne à la date de l’aperçu (aucune source Watchdog de ce nom)', async () => {
    await import('../services/air-traffic.ts');
    const panel = new StatusPanel(document.createElement('div'));
    const off = relay(panel);
    try {
      const status = airStatus(airStateFixture(), TRAFFIC_NOW);
      panel.updateSource('Trafic aérien', status);
      Watchdog.report('test-reemission', { type: 'success' });
      const row = panel.getSources().find((s) => s.name === 'Trafic aérien');
      expect(row?.status).toBe(status.status);
      expect(row?.lastUpdate?.getTime()).toBe(Date.parse(airStateFixture().overview.data?.at ?? ''));
      expect(row?.period).toBe(status.period);
      expect(Watchdog.getSnapshot().map((s) => s.status.name)).not.toContain('Trafic aérien');
    } finally {
      off();
    }
  });
  it('couche allumée : la relève de la carte n’écrit ni « Trafic aérien » ni l’heure de lecture ; sa propre ligne porte l’heure des états OpenSky', async () => {
    const statesAt = Date.now() - 3 * MIN;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ source: 'opensky', fetchedAt: statesAt, ttlMs: 120_000, flights: [{ icao24: 'abc' }], errors: [] }),
    })));
    const { fetchAirTrafficSnapshot } = await import('../services/air-traffic.ts');
    const panel = new StatusPanel(document.createElement('div'));
    const off = relay(panel);
    try {
      panel.updateSource('Trafic aérien', airStatus(airStateFixture(), TRAFFIC_NOW));
      const before = { ...panel.getSources().find((s) => s.name === 'Trafic aérien') };
      const snapshot = await fetchAirTrafficSnapshot();
      expect(snapshot.fetchedAt).toBe(statesAt);
      Watchdog.report('test-reemission', { type: 'success' });
      expect(panel.getSources().find((s) => s.name === 'Trafic aérien')).toEqual(before);
      const now = Date.now();
      panel.updateSource(AIR_POSITIONS_SOURCE, airPositionsStatus({ at: snapshot.fetchedAt, errors: [] }, null, now));
      Watchdog.report('test-reemission', { type: 'success' });
      const positions = panel.getSources().find((s) => s.name === AIR_POSITIONS_SOURCE);
      expect(positions?.lastUpdate?.getTime()).toBe(statesAt);
      expect(positions?.status).toBe('ok');
      expect(Watchdog.getSnapshot().map((s) => s.status.name)).not.toContain(AIR_POSITIONS_SOURCE);
    } finally {
      off();
    }
  });
  it('note de situation et historique de qualité : « Trafic aérien » et les positions de la carte lus dans le panneau des sources', () => {
    expect(TRAFFIC_SOURCE_NAMES).toEqual(expect.arrayContaining(['Trafic aérien', AIR_POSITIONS_SOURCE]));
    const air = airStatus(airStateFixture(), TRAFFIC_NOW);
    const rows = trafficReportSources([{ name: 'Trafic aérien', ...air }, { name: 'Sans rapport', status: 'ok', lastUpdate: null }]);
    expect(rows).toEqual([{ sourceId: 'traffic:air-overview', status: { name: 'Trafic aérien', ...air } }]);
  });
});

describe('positions de la carte : heure des états OpenSky, jamais l’heure de lecture', () => {
  const at = TRAFFIC_NOW - 2 * MIN;
  it('à jour, en retard au-delà de 10 min, incident de lecture, échec gardant la date, aucune lecture', () => {
    const ok = airPositionsStatus({ at, errors: [] }, null, TRAFFIC_NOW);
    expect(ok.status).toBe('ok');
    expect(ok.lastUpdate?.getTime()).toBe(at);
    expect(ok.period).not.toContain('en retard');
    const late = airPositionsStatus({ at, errors: [] }, null, at + 11 * MIN);
    expect(late.status).toBe('stale');
    expect(late.period).toContain('(en retard)');
    expect(airPositionsStatus({ at, errors: ['crédits OpenSky épuisés'] }, null, TRAFFIC_NOW)).toMatchObject({ status: 'stale', error: 'crédits OpenSky épuisés' });
    const failed = airPositionsStatus({ at, errors: [] }, 'HTTP 503', TRAFFIC_NOW);
    expect(failed).toMatchObject({ status: 'stale', error: 'HTTP 503' });
    expect(failed.lastUpdate?.getTime()).toBe(at);
    expect(airPositionsStatus(null, 'HTTP 503', TRAFFIC_NOW)).toEqual({ status: 'error', lastUpdate: null, error: 'HTTP 503', period: undefined });
    expect(airPositionsStatus(null, null, TRAFFIC_NOW).status).toBe('loading');
    expect(airPositionsStatus({ at: null, errors: [] }, null, TRAFFIC_NOW)).toMatchObject({ status: 'stale', lastUpdate: null, period: 'n.d.' });
  });
});

describe('« AIS maritime » : daté par le dernier message ; connecté ne veut jamais dire à jour (m1)', () => {
  it('à jour, message ancien sur un relais connecté, relais déconnecté, aucun message', () => {
    const last = TRAFFIC_NOW - MIN;
    const fresh = aisLiveStatus({ connected: true, shipCount: 900, lastMessageAt: last }, TRAFFIC_NOW);
    expect(fresh).toMatchObject({ status: 'ok', error: undefined });
    expect(fresh.lastUpdate?.getTime()).toBe(last);
    expect(fresh.period).not.toContain('en retard');
    const old = aisLiveStatus({ connected: true, shipCount: 900, lastMessageAt: TRAFFIC_NOW - 60 * MIN }, TRAFFIC_NOW);
    expect(old.status).toBe('stale');
    expect(old.period).toContain('(en retard)');
    const down = aisLiveStatus({ connected: false, shipCount: 0, lastMessageAt: last }, TRAFFIC_NOW);
    expect(down).toMatchObject({ status: 'error', error: 'relais déconnecté' });
    expect(down.lastUpdate?.getTime()).toBe(last);
    expect(aisLiveStatus({ connected: true, shipCount: 0, lastMessageAt: null }, TRAFFIC_NOW)).toMatchObject({ status: 'loading', lastUpdate: null });
    expect(aisLiveStatus({ connected: false, shipCount: 0, lastMessageAt: null }, TRAFFIC_NOW)).toMatchObject({ status: 'error', lastUpdate: null });
  });
});

describe('lignes par couche (m2)', () => {
  it('chaque couche nomme toutes ses lignes, agglomérations TomTom et SIRI SX comprises ; toutes sont des sources Trafics', () => {
    expect(TRAFFIC_LAYER_SOURCES.trafficRoad).toEqual(['Trafic', 'TomTom agglomérations']);
    expect(TRAFFIC_LAYER_SOURCES.trafficRail).toEqual(['SNCF', 'SIRI SX']);
    for (const key of TRAFFIC_LAYER_KEYS) for (const name of TRAFFIC_LAYER_SOURCES[key]) expect(TRAFFIC_SOURCE_NAMES).toContain(name);
  });
});
