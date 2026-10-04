// src/services/environment-services-b.test.ts
// Services clients de la phase B (contrats § 3.3) : garde stricte par élément, jamais de rejet, fusion à l'écriture, panneau des
// sources daté par la donnée (S1) avec « (en retard) » selon S2 ; lignes du panneau des sources (contrats § 3.6).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AIR_FIXTURE, DROUGHT_FIXTURE, ENV_FIXTURE_NOW, QUAKES_FIXTURE, SEA_LEVELS_FIXTURE, airQualityStateFixture, droughtStateFixture, quakesStateFixture,
  seaLevelsStateFixture,
} from '../components/layer-panel/environment.fixture.ts';
import { ENVIRONMENT_SOURCE_NAMES, ENVIRONMENT_STATUS_SOURCES, environmentReportSources } from '../config/environment-sources.ts';
import { resetTrafficSourceCache } from './traffic-source.ts';
import { DROUGHT_TTL_MS, DROUGHT_URL, droughtStatus, fetchDrought, isDroughtResponse, mergeDrought } from './environment-drought.ts';
import { AIR_QUALITY_URL, airLatestUpdate, airQualityStatus, fetchAirQuality, isAirQualityResponse } from './environment-air.ts';
import { EARTHQUAKES_URL, earthquakesStatus, fetchEarthquakes, isEarthquakesResponse } from './environment-earthquakes.ts';
import { SEA_LEVELS_URL, fetchSeaLevels, isSeaLevelsResponse, latestGaugeAt, seaLevelsStatus } from './environment-sea-levels.ts';

const wire = <T>(v: T): unknown => JSON.parse(JSON.stringify(v)) as unknown;
const BODIES: Record<string, unknown> = {
  [DROUGHT_URL]: DROUGHT_FIXTURE, [AIR_QUALITY_URL]: AIR_FIXTURE, [EARTHQUAKES_URL]: QUAKES_FIXTURE, [SEA_LEVELS_URL]: SEA_LEVELS_FIXTURE,
};

function stub(over: Record<string, number> = {}) {
  const f = vi.fn(async (url: string) => {
    const status = over[url];
    if (status !== undefined) return { ok: false, status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => wire(BODIES[url]) };
  });
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => { resetTrafficSourceCache(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('gardes strictes (réponses du serveur, après JSON)', () => {
  it('jeux d’essai du 04/10 acceptés', () => {
    expect(isDroughtResponse(wire(DROUGHT_FIXTURE))).toBe(true);
    expect(isAirQualityResponse(wire(AIR_FIXTURE))).toBe(true);
    expect(isEarthquakesResponse(wire(QUAKES_FIXTURE))).toBe(true);
    expect(isSeaLevelsResponse(wire(SEA_LEVELS_FIXTURE))).toBe(true);
  });
  it('un élément mal formé suffit à refuser la réponse', () => {
    const d = structuredClone(DROUGHT_FIXTURE);
    d.departments[3] = { ...d.departments[3], max: 'renforcee' as never };
    expect(isDroughtResponse(wire(d))).toBe(false);
    const noFlag = wire(DROUGHT_FIXTURE) as { departments: Array<Record<string, unknown>> };
    delete noFlag.departments[0].available;
    expect(isDroughtResponse(noFlag)).toBe(false);
    const a = structuredClone(AIR_FIXTURE);
    a.episodes = [{ zoneCode: '13', zone: 'BOUCHES-DU-RHONE', pollutantCode: 'O3', pollutant: 'ozone', date: '2026-10-05', state: 'grave' as never, stateRaw: 'X', updatedAt: null }];
    expect(isAirQualityResponse(wire(a))).toBe(false);
    const q = wire(QUAKES_FIXTURE) as { quakes: Array<Record<string, unknown>> };
    delete q.quakes[0]['inFrance'];
    expect(isEarthquakesResponse(q)).toBe(false);
    expect(isSeaLevelsResponse({ ...SEA_LEVELS_FIXTURE, predictionAvailable: true })).toBe(false);
    const s = wire(SEA_LEVELS_FIXTURE) as { gauges: Array<{ series: Array<Record<string, unknown>> }> };
    s.gauges[0].series[0]['value'] = '4,639';
    expect(isSeaLevelsResponse(s)).toBe(false);
  });
  it('réponses dégradées (502 du serveur, rien de lu) : même forme, acceptées', () => {
    expect(isDroughtResponse({ asOf: null, departments: [], counts: { vigilance: 0, alerte: 0, alerte_renforcee: 0, crise: 0, aucun: 0 }, history: { days: [], since: null }, readAt: null, errors: ['VigiEau : HTTP 503'] })).toBe(true);
    expect(isEarthquakesResponse({ readAt: null, source: null, quakes: [], nonSeismic: 0, errors: ['BCSF-RéNaSS : HTTP 500'] })).toBe(true);
  });
});

describe('lecture : jamais de rejet, cache sous la relève, fusion à l’écriture', () => {
  it('sécheresse lue puis servie du cache pendant 50 min ; panne : données gardées avec leur date et le message', async () => {
    const f = stub();
    const first = await fetchDrought(null, ENV_FIXTURE_NOW);
    expect(first.drought).toEqual({ data: DROUGHT_FIXTURE, error: null, fetchedAt: ENV_FIXTURE_NOW });
    await fetchDrought(first, ENV_FIXTURE_NOW + DROUGHT_TTL_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    stub({ [DROUGHT_URL]: 502 });
    const failed = await fetchDrought(first, ENV_FIXTURE_NOW + DROUGHT_TTL_MS + 1);
    expect(failed.drought.error).toBe('HTTP 502');
    expect(mergeDrought(first, failed).drought).toEqual({ data: DROUGHT_FIXTURE, error: 'HTTP 502', fetchedAt: ENV_FIXTURE_NOW });
  });
  it('les quatre services lisent leur route sans rejeter', async () => {
    stub({ [SEA_LEVELS_URL]: 503 });
    expect((await fetchAirQuality(null, ENV_FIXTURE_NOW)).air.data?.index.communes).toBe(26_663);
    expect((await fetchEarthquakes(null, ENV_FIXTURE_NOW)).quakes.data?.quakes).toHaveLength(8);
    expect(await fetchSeaLevels(null, ENV_FIXTURE_NOW)).toEqual({ seaLevels: { data: null, error: 'HTTP 503', fetchedAt: null } });
  });
});

describe('panneau des sources : date de la donnée (S1), retard (S2)', () => {
  it('VigiEau daté par les arrêtés (02:43), Atmo par la mise à jour la plus récente (03/10 20:05), BCSF par le relevé, SHOM par la dernière mesure', () => {
    expect(droughtStatus(droughtStateFixture(), ENV_FIXTURE_NOW)).toEqual({
      status: 'ok', lastUpdate: new Date('2026-10-04T00:43:59.771Z'), error: undefined, period: '02:43',
    });
    expect(airLatestUpdate(AIR_FIXTURE)).toBe('2026-10-03T18:05:06.763Z');
    expect(airQualityStatus(airQualityStateFixture(), ENV_FIXTURE_NOW)).toMatchObject({ status: 'ok', period: '03/10 20:05' });
    expect(earthquakesStatus(quakesStateFixture(), ENV_FIXTURE_NOW)).toMatchObject({ status: 'ok', period: '10:05' });
    expect(latestGaugeAt(SEA_LEVELS_FIXTURE)).toBe('2026-10-04T08:10:00.000Z');
    expect(seaLevelsStatus(seaLevelsStateFixture(), ENV_FIXTURE_NOW)).toMatchObject({ status: 'ok', period: '10:10' });
  });
  it('en retard : « stale » et « (en retard) » ; partie en panne : « stale », message', () => {
    expect(droughtStatus(droughtStateFixture(), Date.parse('2026-10-05T13:00:00Z'))).toMatchObject({ status: 'stale', period: '04/10 02:43 (en retard)' });
    expect(earthquakesStatus(quakesStateFixture(), Date.parse('2026-10-04T08:40:00Z'))).toMatchObject({ status: 'stale', period: '10:05 (en retard)' });
    const partial = quakesStateFixture();
    if (partial.quakes.data) partial.quakes.data.errors = ['BCSF-RéNaSS : HTTP 500'];
    expect(earthquakesStatus(partial, ENV_FIXTURE_NOW)).toMatchObject({ status: 'stale', error: 'BCSF-RéNaSS : HTTP 500' });
  });
  it('marégraphes : retard jugé par marégraphe, sans erreur propre au marégraphe périmé', () => {
    const mixed = seaLevelsStateFixture();
    if (mixed.seaLevels.data) mixed.seaLevels.data.gauges[0].lastAt = '2026-10-04T06:00:00.000Z';   // Brest périmé, Marseille à jour
    const status = seaLevelsStatus(mixed, ENV_FIXTURE_NOW);
    expect(status).toMatchObject({ status: 'stale', error: undefined });
    expect(status.period).toContain('(en retard)');
    expect(status.lastUpdate).toEqual(new Date('2026-10-04T06:00:00.000Z'));
    const noMeasure = seaLevelsStateFixture();
    if (noMeasure.seaLevels.data) noMeasure.seaLevels.data.gauges[1].lastAt = null;
    expect(seaLevelsStatus(noMeasure, ENV_FIXTURE_NOW).status).toBe('stale');
    expect(seaLevelsStatus(seaLevelsStateFixture(), Date.parse('2026-10-04T08:41:00Z'))).toMatchObject({ status: 'stale' });
    expect(seaLevelsStatus({ seaLevels: { data: null, error: 'HTTP 503', fetchedAt: null } }, ENV_FIXTURE_NOW)).toMatchObject({ status: 'error', error: 'HTTP 503' });
  });
  it('séismes : repli EMSC accepté, la panne BCSF nommée dans errors', () => {
    const q = wire(QUAKES_FIXTURE) as { source: string; errors: string[]; quakes: Array<Record<string, unknown>> };
    q.source = 'EMSC';
    q.errors = ['BCSF-RéNaSS : HTTP 500'];
    q.quakes[0]['source'] = 'EMSC';
    expect(isEarthquakesResponse(q)).toBe(true);
    q.source = 'USGS';
    expect(isEarthquakesResponse(q)).toBe(false);
  });
  it('lignes de la phase B dans le panneau des sources et la note de situation', () => {
    for (const row of [['vigieau', 'VigiEau'], ['atmo', 'Atmo France'], ['seismes', 'BCSF-RéNaSS'], ['refmar', 'Marégraphes SHOM']] as const) {
      expect(ENVIRONMENT_STATUS_SOURCES).toContainEqual(row);
      expect(ENVIRONMENT_SOURCE_NAMES).toContain(row[1]);
    }
    const now = new Date(ENV_FIXTURE_NOW);
    expect(environmentReportSources([{ name: 'VigiEau', status: 'ok', lastUpdate: now }]).map((s) => s.sourceId)).toEqual(['environment:vigieau']);
  });
});
