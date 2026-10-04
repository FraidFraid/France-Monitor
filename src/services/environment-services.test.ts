// src/services/environment-services.test.ts : lecture client de l'environnement (spec 2026-10-04 environnement S1 à S3 ; contrats
// § 3.2, § 3.3) sur les réponses réelles du 04/10 (environment.fixture.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FiresResponse } from '../types/index.ts';
import {
  ENV_FIXTURE_NOW, FIRES_FIXTURE, FIRE_IMPACTS_FIXTURE, FLOODS_FIXTURE, RADAR_MANIFEST_FIXTURE, VIGILANCE_FIXTURE,
} from '../components/layer-panel/environment.fixture.ts';
import { resetTrafficSourceCache } from './traffic-source.ts';
import { environmentSlotStatus, isColorId, isMultiPath, isOneOf } from './environment-source.ts';
import {
  VIGILANCE_TTL_MS, VIGILANCE_URL, bulletinOf, fetchVigilance, isVigilanceResponse, mergeVigilance, vigilanceStatus, vigilanceToMeteoAlerts,
} from './environment-vigilance.ts';
import { FLOODS_TTL_MS, FLOODS_URL, fetchFloods, floodsStatus, floodsToSectionRefs, isFloodsResponse } from './environment-floods.ts';
import {
  FIRES_TTL_MS, FIRES_URL, fetchFireImpacts, fetchFires, firesStatus, isFireImpactsResponse, isFiresResponse, mergeFires, resetFireImpactsCache,
  scoreFireDetections, toActiveFire,
} from './environment-fires.ts';
import { radarStatus } from './environment-radar.ts';

const NOW = ENV_FIXTURE_NOW;
const H = 3_600_000;

type Reply = { status: number; body?: unknown; html?: boolean };
function stubFetch(bodies: Record<string, unknown>, over: Record<string, Reply> = {}) {
  const f = vi.fn(async (url: string) => {
    const o = over[url] ?? over[url.split('?')[0]];
    if (o?.html) return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    if (o) return { ok: o.status >= 200 && o.status < 300, status: o.status, json: async () => o.body ?? {} };
    const path = url.split('?')[0];
    if (!(path in bodies)) throw new Error(`URL inattendue ${url}`);
    return { ok: true, status: 200, json: async () => bodies[path] };
  });
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => { vi.unstubAllGlobals(); resetTrafficSourceCache(); resetFireImpactsCache(); });

describe('socle : prédicats et statut daté', () => {
  it('liste fermée, couleur officielle 1 à 4, chemin [lng, lat]', () => {
    expect(isOneOf('J1', new Set(['J', 'J1']))).toBe(true);
    expect(isOneOf('J2', new Set(['J', 'J1']))).toBe(false);
    expect([isColorId(1), isColorId(4), isColorId(5), isColorId('3')]).toEqual([true, true, false, false]);
    expect(isMultiPath([[[2.37, 42.59], [2.38, 42.6]]])).toBe(true);
    expect(isMultiPath([])).toBe(true);
    expect(isMultiPath([[[2.37, 42.59]]])).toBe(false);
    expect(isMultiPath([[['2.37', 42.59], [2.38, 42.6]]])).toBe(false);
  });
  it('statut : date de la donnée (jamais l’heure de lecture), « (en retard) », erreurs partielles, chargement et panne', () => {
    const slot = { data: { errors: [] as string[] }, error: null, fetchedAt: NOW };
    expect(environmentSlotStatus(slot, 'vigilance', '2026-10-04T08:00:12Z', NOW)).toEqual({ status: 'ok', lastUpdate: new Date('2026-10-04T08:00:12Z'), error: undefined, period: '10:00' });
    expect(environmentSlotStatus(slot, 'radar', '2026-10-04T08:05:00Z', NOW + H).period).toBe('10:05 (en retard)');
    expect(environmentSlotStatus({ ...slot, data: { errors: ['Hub’Eau : HTTP 503'] } }, 'vigicrues', '2026-10-04T08:05:00Z', NOW))
      .toMatchObject({ status: 'stale', error: 'Hub’Eau : HTTP 503' });
    expect(environmentSlotStatus({ data: null, error: null, fetchedAt: null }, 'firms', null, NOW).status).toBe('loading');
    expect(environmentSlotStatus({ data: null, error: 'HTTP 502', fetchedAt: null }, 'firms', null, NOW)).toEqual({ status: 'error', lastUpdate: null, error: 'HTTP 502', period: undefined });
    expect(environmentSlotStatus(slot, 'mdf', '2026-09-30T14:50:00Z', Date.parse('2026-10-15T10:00:00+02:00')))
      .toEqual({ status: 'ok', lastUpdate: new Date('2026-09-30T14:50:00Z'), error: undefined, period: 'hors saison, dernière publication le 30/09' });
  });
});

describe('vigilance', () => {
  it('lit la route, garde 4 min (sous la relève de 5 min), puis relit ; statut daté par update_time', async () => {
    const f = stubFetch({ [VIGILANCE_URL]: VIGILANCE_FIXTURE() });
    const s = await fetchVigilance(null, NOW);
    expect(s.vigilance).toEqual({ data: VIGILANCE_FIXTURE(), error: null, fetchedAt: NOW });
    await fetchVigilance(s, NOW + VIGILANCE_TTL_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    await fetchVigilance(s, NOW + VIGILANCE_TTL_MS);
    expect(f).toHaveBeenCalledTimes(2);
    expect(VIGILANCE_TTL_MS).toBeLessThan(5 * 60_000);
    expect(vigilanceStatus(s, NOW)).toMatchObject({ status: 'ok', period: '10:00' });
  });
  it('panne (502, page HTML, forme inattendue) : jamais de rejet, dernières données gardées, message porté', async () => {
    stubFetch({}, { [VIGILANCE_URL]: { status: 502 } });
    const failed = await fetchVigilance(null, NOW);
    expect([failed.vigilance.data, failed.vigilance.error]).toEqual([null, 'HTTP 502']);
    expect(vigilanceStatus(failed, NOW).status).toBe('error');
    stubFetch({ [VIGILANCE_URL]: VIGILANCE_FIXTURE() });
    const ok = await fetchVigilance(null, NOW);
    resetTrafficSourceCache();
    stubFetch({ [VIGILANCE_URL]: { ...VIGILANCE_FIXTURE(), periods: [{ echeance: 'J2' }] } });
    const bad = await fetchVigilance(ok, NOW + 5 * 60_000);
    expect(bad.vigilance.error).toBe('réponse de Météo-France mal formée');
    expect(mergeVigilance(ok, bad).vigilance.data?.updateTime).toBe('2026-10-04T08:00:12Z');
  });
  it('garde stricte : couleur hors 1 à 4, phénomène inconnu ou échéance J2 refusés', () => {
    const v = VIGILANCE_FIXTURE();
    expect(isVigilanceResponse(v)).toBe(true);
    const badColor = VIGILANCE_FIXTURE();
    (badColor.periods[0].departments[0] as { color: number }).color = 5;
    expect(isVigilanceResponse(badColor)).toBe(false);
    const badPhen = VIGILANCE_FIXTURE();
    (badPhen.periods[0].departments[0].phenomena[0] as { id: string }).id = '10';
    expect(isVigilanceResponse(badPhen)).toBe(false);
  });
  it('adaptateur du score : départements jaune et plus de J, risques, validité ; J1 ; aucune carte : liste vide', () => {
    const j = vigilanceToMeteoAlerts(VIGILANCE_FIXTURE());
    expect(j.map((a) => [a.departmentCode, a.level])).toEqual([
      ['11', 'orange'], ['66', 'orange'], ['13', 'yellow'], ['30', 'yellow'], ['65', 'yellow'], ['34', 'yellow'], ['64', 'yellow'],
    ]);
    expect(j[1]).toMatchObject({ department: 'Pyrénées-Orientales', risks: ['rain-flood', 'thunderstorm', 'flood'] });
    expect(j[0].startDate?.toISOString()).toBe('2026-10-04T08:00:00.000Z');
    expect(vigilanceToMeteoAlerts(VIGILANCE_FIXTURE(), 'J1').map((a) => a.departmentCode)).toEqual(['11', '13', '2A', '30', '2B', '66']);
    expect(vigilanceToMeteoAlerts(null)).toEqual([]);
  });
  it('bulletins : national, zone Sud, Pyrénées-Orientales', () => {
    const v = VIGILANCE_FIXTURE();
    expect(bulletinOf(v, 'national', 'FRA')?.items[0].paragraphs[0]).toEqual({ heading: 'Faits nouveaux', text: ['Néant.'] });
    expect(bulletinOf(v, 'zonal', 'ZDF_SUD')?.items).toHaveLength(2);
    expect(bulletinOf(v, 'zonal', 'ZDF_NORD')?.items).toEqual([]);
    expect(bulletinOf(v, 'departemental', '66')?.domainName).toBe('Pyrénées-Orientales');
    expect(bulletinOf(v, 'departemental', '75')).toBeNull();
  });
});

describe('champs optionnels des corrections', () => {
  it('jour d’historique partiel et date de débit : acceptés absents ou typés, refusés mal typés', () => {
    const v = VIGILANCE_FIXTURE();
    v.history.days.push({ date: '2026-10-04', jaune: 1, orange: 0, rouge: 0, publications: 2, partial: true });
    expect(isVigilanceResponse(v)).toBe(true);
    (v.history.days[v.history.days.length - 1] as { partial: unknown }).partial = 'oui';
    expect(isVigilanceResponse(v)).toBe(false);
    const f = FLOODS_FIXTURE();
    f.sections[0].stations[0].flowAt = '2026-10-04T07:30:00Z';
    expect(isFloodsResponse(f)).toBe(true);
    f.sections[0].stations[0].flowAt = null;
    expect(isFloodsResponse(f)).toBe(true);
    (f.sections[0].stations[0] as { flowAt: unknown }).flowAt = 5;
    expect(isFloodsResponse(f)).toBe(false);
  });
});

describe('crues', () => {
  it('lit la route, garde 8 min (sous la relève de 10 min) ; statut daté par le relevé du serveur', async () => {
    const f = stubFetch({ [FLOODS_URL]: FLOODS_FIXTURE() });
    const s = await fetchFloods(null, NOW);
    await fetchFloods(s, NOW + FLOODS_TTL_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    expect(FLOODS_TTL_MS).toBeLessThan(10 * 60_000);
    expect(floodsStatus(s, NOW)).toMatchObject({ status: 'ok', period: '10:05' });
    expect(floodsStatus(s, NOW + H).period).toBe('10:05 (en retard)');
  });
  it('garde : tronçon au niveau illisible refusé ; références du score : quatre tronçons jaunes, tracé MultiLineString publié', () => {
    expect(isFloodsResponse(FLOODS_FIXTURE())).toBe(true);
    const bad = FLOODS_FIXTURE();
    (bad.sections[0] as { level: number }).level = 0;
    expect(isFloodsResponse(bad)).toBe(false);
    const refs = floodsToSectionRefs(FLOODS_FIXTURE());
    expect(refs.map((r) => [r.id, r.name, r.level])).toEqual([['MO12', 'Têt', 'yellow'], ['MO11', 'Agly', 'yellow'], ['MO16', 'Réart', 'yellow'], ['MO17', 'Tech', 'yellow']]);
    expect(refs[0].geometry).toEqual({ type: 'MultiLineString', coordinates: FLOODS_FIXTURE().sections[0].path });
    expect(floodsToSectionRefs(null)).toEqual([]);
  });
});

describe('feux', () => {
  it('lit la route, garde 12 min (sous la relève de 15 min) ; deux lignes datées : dernière acquisition et publication', async () => {
    const f = stubFetch({ [FIRES_URL]: FIRES_FIXTURE() });
    const s = await fetchFires(null, NOW);
    await fetchFires(s, NOW + FIRES_TTL_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    expect(FIRES_TTL_MS).toBeLessThan(15 * 60_000);
    expect(firesStatus(s, 'firms', NOW)).toMatchObject({ status: 'ok', period: '05:34', lastUpdate: new Date('2026-10-04T03:34:00.000Z') });
    expect(firesStatus(s, 'mdf', NOW)).toMatchObject({ status: 'ok', period: '03/10 16:50' });
  });
  it('panne de la météo des forêts : seule sa ligne en erreur, FIRMS reste à l’heure', () => {
    const data: FiresResponse = { ...FIRES_FIXTURE(), forestDanger: null, errors: ['Météo des forêts : HTTP 503'] };
    const state = { fires: { data, error: null, fetchedAt: NOW } };
    expect(firesStatus(state, 'mdf', NOW)).toEqual({ status: 'error', lastUpdate: null, period: undefined, error: 'Météo des forêts : HTTP 503' });
    expect(firesStatus(state, 'firms', NOW).status).toBe('ok');
  });
  it('lecture en échec : dernières données gardées par la fusion à l’écriture', async () => {
    stubFetch({ [FIRES_URL]: FIRES_FIXTURE() });
    const ok = await fetchFires(null, NOW);
    resetTrafficSourceCache();
    stubFetch({}, { [FIRES_URL]: { status: 502 } });
    const failed = await fetchFires(null, NOW + FIRES_TTL_MS);
    expect(mergeFires(ok, failed).fires).toMatchObject({ error: 'HTTP 502', data: FIRES_FIXTURE() });
  });
  it('garde : satellite inconnu refusé ; entrée du score : détections en France non récurrentes, converties pour le regroupement', () => {
    expect(isFiresResponse(FIRES_FIXTURE())).toBe(true);
    const bad = FIRES_FIXTURE();
    (bad.detections[0] as { satellite: string }).satellite = 'N20';
    expect(isFiresResponse(bad)).toBe(false);
    const f = FIRES_FIXTURE();
    const scored = scoreFireDetections(f);
    expect(scored.length).toBe(f.detections.filter((d) => !d.recurrent).length);
    expect(scored.some((d) => d.dept === '59')).toBe(false); // aciérie de Dunkerque : récurrente, hors du score
    const first = toActiveFire(scored[0]);
    expect([first.latitude, first.acq_date, first.acq_time.length, first.confidence]).toEqual([scored[0].lat, scored[0].acquiredAt.slice(0, 10), 4, 'nominal']);
    expect(scoreFireDetections(null)).toEqual([]);
  });
  it('communes autour d’un foyer : lues une fois par point arrondi, jamais de rejet, échec jamais gardé', async () => {
    const f = stubFetch({ '/api/fires/impacts': FIRE_IMPACTS_FIXTURE() });
    const r = await fetchFireImpacts(44.88, -1.12, NOW);
    expect(r).toEqual({ data: FIRE_IMPACTS_FIXTURE(), error: null });
    expect(f.mock.calls[0][0]).toBe('/api/fires/impacts?lat=44.8800&lon=-1.1200');
    await fetchFireImpacts(44.8801, -1.1201, NOW + 60_000);
    expect(f).toHaveBeenCalledTimes(1);
    expect(isFireImpactsResponse(FIRE_IMPACTS_FIXTURE())).toBe(true);
    stubFetch({}, { '/api/fires/impacts': { status: 400, body: { error: 'lat/lon invalides ou hors métropole' } } });
    expect(await fetchFireImpacts(30, 30, NOW)).toEqual({ data: null, error: 'HTTP 400' });
  });
});

describe('radar', () => {
  const manifest = RADAR_MANIFEST_FIXTURE();
  it('daté par l’observation de l’image ; en retard après 15 min ; dégradé et non configuré dits', () => {
    expect(radarStatus({ configured: true, manifest, degraded: false }, null, NOW)).toEqual({ status: 'ok', lastUpdate: new Date('2026-10-04T08:05:00Z'), period: '10:05', error: undefined });
    expect(radarStatus({ configured: true, manifest, degraded: false }, null, NOW + 11 * 60_000)).toMatchObject({ status: 'stale', period: '10:05 (en retard)' });
    expect(radarStatus({ configured: true, manifest, degraded: true }, null, NOW)).toMatchObject({ status: 'stale', error: 'dernière image gardée (lecture en échec)' });
    expect(radarStatus({ configured: false }, null, NOW)).toEqual({ status: 'error', lastUpdate: null, period: undefined, error: 'worker radar non configuré' });
    expect(radarStatus(null, 'HTTP 502', NOW)).toEqual({ status: 'error', lastUpdate: null, period: undefined, error: 'HTTP 502' });
    expect(radarStatus(null, null, NOW).status).toBe('loading');
  });
});
