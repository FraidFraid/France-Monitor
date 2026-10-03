// Tâche 7, correctifs du tour 1 : un train sans axe reste compté, une circulation n'est comptée qu'une fois,
// zéro train n'est pas une panne, heure de réponse de l'API, troncatures nommées, mémoire des échecs,
// fenêtre de jour à Paris, périodes de validité SIRI, bruit sur le titre seulement, refiltrage à l'heure courante.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetSncfStateForTests, buildRailOverview, disruptionsUrl, toRailTrain } from '../api/_lib/sncf-rail.js';
import { isNoise, parseSiriSx, parseSiriSxEntries, situationsAt } from '../api/_lib/siri-sx.js';
import overviewHandler from '../api/_handlers/transport/rail-overview.js';
import situationsHandler from '../api/_handlers/transport/rail-situations.js';
import { SIRI_SX_URL } from '../api/_lib/siri-sx.js';
import type { RailOverviewResponse, RailSituationsResponse } from '../src/types/index.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

interface Impacted { pt_object: { id: string; name?: string; trip?: { name: string }; embedded_type: string }; impacted_stops?: unknown[] }
interface Disruption { id: string; status: string; updated_at: string; severity: { effect: string }; impacted_objects: Impacted[] }

const tripId = (n: number, kind = 'LongDistanceTrain'): string => `SNCF:2026-10-03:${n}:1187:${kind}`;
function disruption(id: string, n: number, effect: string, updatedAt: string, extra: Partial<Disruption> = {}, kind = 'LongDistanceTrain'): Disruption {
  return {
    id, status: 'active', updated_at: updatedAt, severity: { effect },
    impacted_objects: [{ pt_object: { id: tripId(n, kind), trip: { name: String(n) }, embedded_type: 'trip' }, impacted_stops: [] }],
    ...extra,
  };
}
const stopsOf = (names: string[], delay: number) => names.map((name) => ({
  stop_point: { name, coord: { lat: '48.85', lon: '2.37' } }, base_arrival_time: '120000', amended_arrival_time: `12${String(delay).padStart(2, '0')}00`,
}));
const withStops = (d: Disruption, names: string[], delay: number): Disruption => ({ ...d, impacted_objects: [{ ...d.impacted_objects[0], impacted_stops: stopsOf(names, delay) }] });

describe('train sans axe : toujours compté (I1)', () => {
  it('grandes lignes sans arrêt : groupe « Non rattaché » en huitième, somme des axes = trains en cours', () => {
    const o = buildRailOverview([
      withStops(disruption('a', 1, 'SIGNIFICANT_DELAYS', '20261003T150000'), ['Paris - Gare de Lyon', 'Lyon Part-Dieu'], 20),
      disruption('b', 2, 'NO_SERVICE', '20261003T150000'),
    ]);
    expect(o.axes).toHaveLength(8);
    expect(o.axes[7]).toMatchObject({ key: 'non-rattache', label: 'Non rattaché', trains: 1, cancelled: 1 });
    expect(o.axes.reduce((s, a) => s + a.trains, 0)).toBe(o.longDistance.active);
    expect(o.trains.find((t) => t.number === '2')?.axis).toBeNull();
  });
  it('tous les trains rattachés : sept axes seulement', () => {
    expect(buildRailOverview([]).axes).toHaveLength(7);
  });
});

describe('une circulation, un train (I2)', () => {
  const delay = withStops(disruption('d1', 7, 'SIGNIFICANT_DELAYS', '20261003T140000'), ['Paris - Gare de Lyon', 'Lyon Part-Dieu'], 30);
  const cancel = withStops(disruption('d2', 7, 'NO_SERVICE', '20261003T150000'), ['Paris - Gare de Lyon', 'Lyon Part-Dieu'], 0);
  it.each([[[delay, cancel]], [[cancel, delay]]])('doublon compté une fois, la perturbation la plus récente l’emporte', (list) => {
    const o = buildRailOverview(list);
    expect(o.trains).toHaveLength(1);
    expect(o.trains[0]).toMatchObject({ effect: 'supprime', id: 'd2' });
    expect(o.longDistance.active).toBe(1);
    expect(o.axes[0]).toMatchObject({ key: 'sud-est', trains: 1, cancelled: 1 });
  });
  it('doublon TER : une fois dans la région', () => {
    const a = withStops(disruption('t1', 9, 'SIGNIFICANT_DELAYS', '20261003T140000', {}, 'Train'), ['Lille Flandres', 'Dunkerque'], 10);
    const b = withStops(disruption('t2', 9, 'NO_SERVICE', '20261003T141000', {}, 'Train'), ['Lille Flandres', 'Dunkerque'], 0);
    const o = buildRailOverview([a, b]);
    expect(o.regions.reduce((s, r) => s + r.trains, 0)).toBe(1);
    expect(o.regions[0].cancelled).toBe(1);
  });
  it('tous les objets circulation d’une perturbation sont lus, les autres types ignorés', () => {
    const d = disruption('m', 11, 'SIGNIFICANT_DELAYS', '20261003T150000');
    d.impacted_objects.push({ pt_object: { id: tripId(12), trip: { name: '12' }, embedded_type: 'trip' }, impacted_stops: [] });
    d.impacted_objects.push({ pt_object: { id: 'stop_area:x', embedded_type: 'stop_area' }, impacted_stops: [] });
    expect(buildRailOverview([d]).trains.map((t) => t.number).sort()).toEqual(['11', '12']);
  });
  it('effet inconnu hérité d’Object (« constructor ») : ignoré', () => {
    expect(toRailTrain(disruption('x', 1, 'constructor', '20261003T150000'))).toBeNull();
    expect(toRailTrain(disruption('x', 1, 'toString', '20261003T150000'))).toBeNull();
  });
  it('heure de réponse de l’API prioritaire sur la dernière perturbation', () => {
    expect(buildRailOverview([delay], new Map(), '2026-10-03T16:00:00.000Z').updatedAt).toBe('2026-10-03T16:00:00.000Z');
    expect(buildRailOverview([delay]).updatedAt).toBe('2026-10-03T12:00:00.000Z');
  });
});

describe('journée de Paris (since et until)', () => {
  const day = (iso: string): string | null => new URL(disruptionsUrl(Date.parse(iso), 0)).searchParams.get('since');
  it('heure d’été : 21 h 59 UTC encore la veille, 22 h 00 UTC le lendemain', () => {
    expect([day('2026-06-30T21:59:59Z'), day('2026-06-30T22:00:00Z')]).toEqual(['20260630T000000', '20260701T000000']);
  });
  it('heure d’hiver : 22 h 59 UTC encore la veille, 23 h 00 UTC le lendemain', () => {
    expect([day('2026-12-31T22:59:59Z'), day('2026-12-31T23:00:00Z')]).toEqual(['20261231T000000', '20270101T000000']);
  });
});

describe('/api/transport/rail-overview : réponse de l’API, pages, plafonds, échecs mémorisés', () => {
  const NOW = Date.parse('2026-10-03T15:10:00+02:00');
  beforeEach(() => {
    __resetSwrCacheForTests();
    __resetSncfStateForTests();
    vi.stubEnv('SNCF_API_KEY', 'cle-de-test');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('aucun train suivi : 200, trains vides, aucune erreur, heure de lecture', async () => {
    stubFetch(() => respond({ disruptions: [], pagination: { total_result: 0 } }));
    const { status, body } = await callHandler<RailOverviewResponse>(overviewHandler);
    expect([status, body.trains, body.errors, body.updatedAt, body.longDistance]).toEqual([200, [], [], new Date(NOW).toISOString(), { active: 0, delayed15: 0 }]);
  });
  it('heure de réponse de l’API (context.current_datetime, heure de Paris) en ISO UTC', async () => {
    stubFetch(() => respond({ disruptions: [withStops(disruption('a', 1, 'SIGNIFICANT_DELAYS', '20261003T100000'), ['Paris - Gare de Lyon', 'Lyon'], 5)], pagination: { total_result: 1 }, context: { current_datetime: '20261003T151029', timezone: 'Europe/Paris' } }));
    const { body } = await callHandler<RailOverviewResponse>(overviewHandler);
    expect(body.updatedAt).toBe('2026-10-03T13:10:29.000Z');
  });
  it('deuxième page lue selon total_result ; au-delà de deux pages : troncature nommée', async () => {
    const page = (n: number) => ({ disruptions: Array.from({ length: 2 }, (_v, i) => disruption(`p${n}-${i}`, n * 10 + i, 'SIGNIFICANT_DELAYS', '20261003T150000')), pagination: { total_result: 3 } });
    const log = stubFetch((url) => respond(page(Number(new URL(url).searchParams.get('start_page')))));
    const ok = await callHandler<RailOverviewResponse>(overviewHandler);
    expect(log.urls).toHaveLength(2);
    expect(ok.body.trains).toHaveLength(4);
    expect(ok.body.errors).toEqual([]);
    __resetSwrCacheForTests();
    stubFetch((url) => respond({ ...page(Number(new URL(url).searchParams.get('start_page'))), pagination: { total_result: 5000 } }));
    const cut = await callHandler<RailOverviewResponse>(overviewHandler);
    expect(cut.body.errors).toEqual(['SNCF : perturbations tronquées (4 lues sur 5000)']);
  });
  it('plus de 40 trains supprimés sans arrêt : les excédents sont nommés ; échecs mémorisés, pas relus', async () => {
    const list = Array.from({ length: 45 }, (_v, i) => disruption(`c${i}`, 100 + i, 'NO_SERVICE', '20261003T150000'));
    const log = stubFetch((url) => (url.includes('/disruptions?') ? respond({ disruptions: list, pagination: { total_result: 45 } }) : respond('{"error":"x"}', 404)));
    const first = await callHandler<RailOverviewResponse>(overviewHandler);
    expect(first.body.errors).toEqual(['SNCF, itinéraires des trains supprimés : 40 non lus', 'SNCF, itinéraires des trains supprimés : 5 au-delà de la limite de lecture']);
    expect(log.urls.filter((u) => u.includes('/trips/'))).toHaveLength(40);
    expect(first.body.longDistance.active).toBe(45);
    expect(first.body.axes.reduce((s, a) => s + a.trains, 0)).toBe(45);
    __resetSwrCacheForTests();
    vi.setSystemTime(NOW + 6 * 60_000);
    await callHandler<RailOverviewResponse>(overviewHandler);
    expect(log.urls.filter((u) => u.includes('/trips/'))).toHaveLength(40);
  });
});

describe('SIRI SX : validité, heures sans fuseau, bruit sur le titre, refiltrage', () => {
  const NOW = Date.parse('2026-10-03T13:10:28Z');
  const element = (id: string, summary: string, periods: string, description = '') =>
    `<PtSituationElement><SituationNumber>${id}</SituationNumber><ParticipantRef>NOR</ParticipantRef>${periods}<Summary xml:lang="FR">${summary}</Summary><Description xml:lang="FR">${description}</Description></PtSituationElement>`;
  const period = (start: string | null, end: string | null) => `<ValidityPeriod>${start ? `<StartTime>${start}</StartTime>` : ''}${end ? `<EndTime>${end}</EndTime>` : ''}</ValidityPeriod>`;
  const feed = (elements: string[], stamp = '<ResponseTimestamp>2026-10-03T13:10:28Z</ResponseTimestamp>') =>
    `<Siri><ServiceDelivery>${stamp}<SituationExchangeDelivery><Situations>${elements.join('')}</Situations></SituationExchangeDelivery></ServiceDelivery></Siri>`;
  const ids = (xml: string, now = NOW) => parseSiriSx(xml, now).situations.map((s) => s.id);

  it('en vigueur si une période quelconque contient l’instant', () => {
    const xml = feed([element('multi', 'Ralentissement', period('2026-10-01T08:00:00+02:00', '2026-10-02T08:00:00+02:00') + period('2026-10-03T08:00:00+02:00', '2026-10-04T08:00:00+02:00'))]);
    expect(ids(xml)).toEqual(['multi']);
    expect(ids(xml, Date.parse('2026-10-02T12:00:00Z'))).toEqual([]);
  });
  it('heure sans fuseau lue à Paris', () => {
    const xml = feed([element('local', 'Travaux', period('2026-10-03T15:00:00', '2026-10-03T15:30:00'))]);
    expect(ids(xml, Date.parse('2026-10-03T13:10:00Z'))).toEqual(['local']);
    expect(ids(xml, Date.parse('2026-10-03T13:40:00Z'))).toEqual([]);
    expect(ids(xml, Date.parse('2026-10-03T12:50:00Z'))).toEqual([]);
  });
  it('début absent : en vigueur depuis une date inconnue (conservée, début vide)', () => {
    const xml = feed([element('nostart', 'Travaux', period(null, '2026-10-04T00:00:00+02:00')), element('noperiod', 'Retards', '')]);
    const r = parseSiriSx(xml, NOW);
    expect(r.situations.map((s) => [s.id, s.start])).toEqual([['nostart', ''], ['noperiod', '']]);
  });
  it('ResponseTimestamp absent : heure de lecture, pas d’échec', () => {
    expect(parseSiriSx(feed([element('x', 'Retards', '')], ''), NOW).at).toBe('2026-10-03T13:10:28.000Z');
  });
  it('bruit reconnu sur le titre ; une vraie perturbation qui cite « affluence » ou « guichets » est gardée', () => {
    expect(isNoise('Affluence en gare de Lyon')).toBe(true);
    expect(isNoise('Train supprimé')).toBe(false);
    const xml = feed([element('real', 'Trafic interrompu', period('2026-10-03T00:00:00Z', null), 'Forte affluence aux guichets et distributeurs.'), element('noise', 'Guichet fermé', period('2026-10-03T00:00:00Z', null))]);
    expect(ids(xml)).toEqual(['real']);
  });
  it('flux en cache : une situation échue depuis la lecture disparaît au filtre suivant', () => {
    const { entries } = parseSiriSxEntries(feed([element('s', 'Retards', period('2026-10-03T12:00:00Z', '2026-10-03T14:00:00Z'))]), NOW);
    expect(situationsAt(entries, NOW).map((s) => s.id)).toEqual(['s']);
    expect(situationsAt(entries, NOW + 3_600_000)).toEqual([]);
  });
  it('/api/transport/rail-situations : la valeur servie du cache est refiltrée à l’instant courant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    __resetSwrCacheForTests();
    const xml = feed([element('s', 'Retards', period('2026-10-03T12:00:00Z', '2026-10-03T14:00:00Z'))]);
    const log = stubFetch((url) => (url === SIRI_SX_URL ? respond(`<?xml version="1.0" encoding="UTF-8"?>${xml}`) : respond('', 404)));
    const first = await callHandler<RailSituationsResponse>(situationsHandler);
    expect(first.body.situations.map((s) => s.id)).toEqual(['s']);
    vi.setSystemTime(NOW + 3_600_000);
    const second = await callHandler<RailSituationsResponse>(situationsHandler);
    expect(second.body.situations).toEqual([]);
    expect(log.urls.length).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
