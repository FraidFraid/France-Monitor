// tests/finance-ecb.test.ts
// Séries BCE du bloc « Stabilité financière » (spec 2026-10-12) : CSV lu par nom de colonne, valeurs vides écartées, retard
// au-delà de 4 jours calendaires, séries indépendantes, cache servi en retard, taux directeurs (date et précédent).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { ECB_BASE, ecbUrl, isEcbLate, loadEcbRates, loadEcbSeries, parseEcbCsv } from '../api/_lib/ecb.js';
import type { EcbSeries, PolicyRate } from '../src/types/index.ts';
import { respond, stubFetch } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');
const HEAD = 'KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE';
const csv = (key: string, rows: Array<[string, string]>): string =>
  [HEAD, ...rows.map(([d, v]) => `${key},D,FR,Z0Z,4F,EC,SS_CIN,IDX,${d},${v}`)].join('\n');
const CISS_FR = csv('CISS.D.FR.Z0Z.4F.EC.SS_CIN.IDX', [['2026-10-07', '0.0446'], ['2026-10-08', '0.0511'], ['2026-10-09', '0.0507']]);
const OTHER = csv('X', [['2026-10-08', '2.439'], ['2026-10-09', '2.437']]);
const DFR = [
  'KEY,FREQ,REF_AREA,CURRENCY,PROVIDER_FM,INSTRUMENT_FM,PROVIDER_FM_ID,DATA_TYPE_FM,TIME_PERIOD,OBS_VALUE',
  'FM.B.U2.EUR.4F.KR.DFR.LEV,B,U2,EUR,4F,KR,DFR,LEV,2026-06-17,2.25',
  'FM.B.U2.EUR.4F.KR.DFR.LEV,B,U2,EUR,4F,KR,DFR,LEV,2026-09-16,2.5',
].join('\n');

beforeEach(() => { __resetSwrCacheForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('lecture CSV', () => {
  it('URL : 90 observations, données seules, CSV', () => {
    expect(ecbUrl('CISS/D.FR.Z0Z.4F.EC.SS_CIN.IDX', 90))
      .toBe(`${ECB_BASE}/CISS/D.FR.Z0Z.4F.EC.SS_CIN.IDX?lastNObservations=90&detail=dataonly&format=csvdata`);
  });
  it('colonnes lues par nom, ordre chronologique', () => {
    const swapped = 'OBS_VALUE,TIME_PERIOD,KEY\n0.2,2026-10-09,K\n0.1,2026-10-08,K';
    expect(parseEcbCsv(swapped)).toEqual([{ date: '2026-10-08', value: 0.1 }, { date: '2026-10-09', value: 0.2 }]);
  });
  it('valeur vide ou non numérique écartée, jamais remplacée par zéro', () => {
    const text = `${HEAD}\nK,D,FR,Z0Z,4F,EC,SS_CIN,IDX,2026-10-08,\nK,D,FR,Z0Z,4F,EC,SS_CIN,IDX,2026-10-09,NaN\nK,D,FR,Z0Z,4F,EC,SS_CIN,IDX,2026-10-07,0.04`;
    expect(parseEcbCsv(text)).toEqual([{ date: '2026-10-07', value: 0.04 }]);
  });
  it('colonnes absentes : erreur nommée', () => {
    expect(() => parseEcbCsv('A,B\n1,2')).toThrow(/TIME_PERIOD/);
  });
});

describe('retard', () => {
  it('lundi 12/10 : valeur du vendredi 09/10 (3 jours) à jour ; du 08/10 (4 jours) à jour ; du 07/10 (5 jours) en retard', () => {
    expect(isEcbLate('2026-10-09', NOW)).toBe(false);
    expect(isEcbLate('2026-10-08', NOW)).toBe(false);
    expect(isEcbLate('2026-10-07', NOW)).toBe(true);
  });
});

describe('séries quotidiennes', () => {
  it('quatre séries lues, dernière valeur et historique', async () => {
    stubFetch((url) => respond(url.includes('CISS/D.FR') ? CISS_FR : OTHER));
    const series: EcbSeries[] = await loadEcbSeries(NOW);
    expect(series.map((s) => s.id)).toEqual(['cissFr', 'cissEa', 'estr', 'eurusd']);
    expect(series[0]).toEqual({
      id: 'cissFr', value: 0.0507, date: '2026-10-09', status: 'ok', error: null,
      history: [{ date: '2026-10-07', value: 0.0446 }, { date: '2026-10-08', value: 0.0511 }, { date: '2026-10-09', value: 0.0507 }],
    });
  });
  it('une série en panne (HTTP 404) : « unavailable » pour elle seule, les autres lues', async () => {
    stubFetch((url) => (url.includes('EXR/') ? respond('No results found', 404) : respond(OTHER)));
    const series = await loadEcbSeries(NOW);
    expect(series.find((s) => s.id === 'eurusd')).toMatchObject({ value: null, date: null, history: [], status: 'unavailable' });
    expect(series.find((s) => s.id === 'eurusd')?.error).toMatch(/^BCE EUR\/USD : HTTP 404/);
    expect(series.filter((s) => s.status === 'ok')).toHaveLength(3);
  });
  it('valeur de plus de 4 jours : « stale » avec sa date nommée', async () => {
    stubFetch(() => respond(csv('K', [['2026-10-06', '0.05']])));
    const [first] = await loadEcbSeries(NOW);
    expect(first).toMatchObject({ value: 0.05, status: 'stale', error: 'BCE CISS France : dernière valeur au 06/10' });
  });
  it('BCE muette après une lecture réussie : relevé précédent servi, « stale », panne nommée', async () => {
    stubFetch(() => respond(OTHER));
    await loadEcbSeries(NOW);
    vi.setSystemTime(NOW + 2 * 3_600_000);
    stubFetch(() => respond('erreur', 503));
    const series = await loadEcbSeries(NOW + 2 * 3_600_000);
    expect(series[0]).toMatchObject({ value: 2.437, status: 'stale' });
    expect(series[0]?.error).toMatch(/HTTP 503/);
  });
});

describe('taux directeurs', () => {
  it('taux, date d’effet du dernier changement et taux précédent', async () => {
    stubFetch(() => respond(DFR));
    const rates: PolicyRate[] = await loadEcbRates();
    expect(rates.map((r) => r.id)).toEqual(['depot', 'refi']);
    expect(rates[0]).toEqual({ id: 'depot', value: 2.5, since: '2026-09-16', previous: 2.25, status: 'ok', error: null });
  });
  it('une seule observation : pas de taux précédent, aucune erreur', async () => {
    stubFetch(() => respond(DFR.split('\n').filter((_, i) => i !== 1).join('\n')));
    const [depot] = await loadEcbRates();
    expect(depot).toMatchObject({ value: 2.5, since: '2026-09-16', previous: null, status: 'ok', error: null });
  });
  it('taux directeur ancien : jamais « stale » par sa date', async () => {
    stubFetch(() => respond(DFR));
    const [depot] = await loadEcbRates();
    expect(depot?.status).toBe('ok');
  });
});
