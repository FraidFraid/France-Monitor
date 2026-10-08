// tests/environment-floods-api.test.ts : route /api/environment/floods (spec 2026-10-04 environnement § 2.2) sur les réponses
// réelles du 04/10/2026 (InfoVigiCru réduit, territoires, stations de la Têt et de l'Agly, Hub'Eau H et Q sur 48 h).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { HUBEAU_OBSERVATIONS_URL } from '../api/_lib/hubeau-stations.js';
import { HUBEAU_WAIT_MS, INFOVIGICRU_URL, MAX_STATIONS, TERRITORIES_URL, loadFloods, sectionStationsUrl } from '../api/_lib/vigicrues.js';
import handler, { CACHE_CONTROL, PENDING_CACHE_CONTROL } from '../api/_handlers/environment/floods.js';
import type { FloodsResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const fxJson = <T>(name: string): T => JSON.parse(fx(name)) as T;

const NOW = Date.parse('2026-10-04T10:10:00+02:00');
const HUBEAU = fxJson<{ H: object; Q: object }>('hubeau-observations-code-entite.json');
type Info = { type: string; features: Array<{ properties: Record<string, unknown> }> };

/** Sources réelles ; `override` force une réponse pour une URL (panne, page HTML…). */
function sources(override: (url: string) => FakeResponse | null = () => null, info: Info = fxJson('vigicrues-infovigicru-reduit.geojson')) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    if (url === INFOVIGICRU_URL) return respond(info);
    if (url === TERRITORIES_URL) return respond(fx('vigicrues-terent.json'));
    if (url === sectionStationsUrl('MO12')) return respond(fx('vigicrues-tronent-MO12.json'));
    if (url === sectionStationsUrl('MO11')) return respond(fx('vigicrues-tronent-MO11.json'));
    if (url.startsWith(HUBEAU_OBSERVATIONS_URL)) return respond(url.includes('grandeur_hydro=Q') ? HUBEAU.Q : HUBEAU.H);
    return respond('introuvable', 404);
  });
}

beforeEach(() => {
  __resetSwrCacheForTests();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('/api/environment/floods', () => {
  it('réponse complète : comptes sur 4 tronçons, Têt et Agly en jaune (Méditerranée Ouest), stations et hauteurs', async () => {
    const log = sources();
    const { status, body, cache } = await callHandler<FloodsResponse>(handler);
    expect([status, cache, body.errors]).toEqual([200, CACHE_CONTROL, []]);
    expect([body.readAt, body.total, body.counts]).toEqual(['2026-10-04T08:10:00.000Z', 4, { vert: 2, jaune: 2, orange: 0, rouge: 0 }]);
    expect(body.sections.map((s) => [s.id, s.name, s.level])).toEqual([['MO12', 'Têt', 2], ['MO11', 'Agly', 2]]);
    expect(body.sections[0].territory).toEqual({ code: '21', name: 'Méditerranée Ouest', url: 'https://www.vigicrues.gouv.fr/territoire/21' });
    expect(body.sections[0].stations.map((s) => [s.name, s.heightM, s.change1hM, s.flowM3s])).toEqual([
      ['Vinca', 22.29, 0, null], ['Perpignan [Pont-Joffre]', 0.355, 0.029, 9.04], ['Ille-sur-Têt', null, null, null],
    ]);
    expect(body.sections[1].stations.map((s) => [s.code, s.heightM])).toEqual([['Y067406001', null]]);
    expect([body.stationsReadAt, body.stationsOmitted]).toEqual(['2026-10-04T08:10:00.000Z', 0]);
    // Hub'Eau : une lecture par grandeur, par codes de station, jamais par département.
    const hubeau = log.urls.filter((u) => u.startsWith(HUBEAU_OBSERVATIONS_URL));
    expect(hubeau).toHaveLength(2);
    expect(hubeau[0]).toContain('code_entite=Y046401001,Y047403001,Y046600501,Y067406001&grandeur_hydro=H&date_debut_obs=2026-10-02T08:10:00Z');
    expect(hubeau[1]).toContain('grandeur_hydro=Q');
    expect(log.urls.some((u) => u.includes('code_departement'))).toBe(false);
  });

  it('aucun tronçon en vigilance : verts comptés, aucune lecture de stations', async () => {
    const info = fxJson<Info>('vigicrues-infovigicru-reduit.geojson');
    for (const f of info.features) f.properties.NivInfViCr = 1;
    const log = sources(() => null, info);
    const { status, body } = await callHandler<FloodsResponse>(handler);
    expect([status, body.counts, body.sections, body.stationsReadAt]).toEqual([200, { vert: 4, jaune: 0, orange: 0, rouge: 0 }, [], null]);
    expect(log.urls).toEqual([INFOVIGICRU_URL]);
  });

  it(`plafond de ${MAX_STATIONS} stations : tronçons rouges d’abord, puis par paquets de 20 codes ; le reste est compté`, async () => {
    const children = Array.from({ length: 70 }, (_, i) => ({
      CdEntVigiCruInferieur: `Y0${String(i).padStart(8, '0')}`, TypEntVigiCruInferieur: '7', LbEntVigiCruInferieur: `Station ${i}`,
    }));
    const info = fxJson<Info>('vigicrues-infovigicru-reduit.geojson');
    info.features[1].properties.NivInfViCr = 4;
    const log = sources((url) => (url === sectionStationsUrl('MO12') ? respond({ ListEntVigiCru: [{ CdEntVigiCru: 'MO12', aNMoinsUn: children }] }) : null), info);
    const { body } = await callHandler<FloodsResponse>(handler);
    expect(body.sections.map((s) => [s.id, s.level, s.stations.length])).toEqual([['MO11', 4, 1], ['MO12', 2, 59]]);
    expect(body.stationsOmitted).toBe(11);
    expect(log.urls.filter((u) => u.startsWith(HUBEAU_OBSERVATIONS_URL))).toHaveLength(6);
  });

  it('Hub’Eau en panne : tronçons gardés, stations sans mesure, panne nommée', async () => {
    sources((url) => (url.startsWith(HUBEAU_OBSERVATIONS_URL) ? respond('{"error":"x"}', 503) : null));
    const { status, body, cache } = await callHandler<FloodsResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(body.errors).toEqual(["Hub'Eau : HTTP 503", "Hub'Eau, débits : HTTP 503"]);
    expect(body.sections).toHaveLength(2);
    expect(body.sections[0].stations.every((s) => s.heightM === null && s.heightSeries.length === 0)).toBe(true);
    expect(body.stationsReadAt).toBeNull();
  });

  it(`Hub’Eau plus lent que ${HUBEAU_WAIT_MS / 1000} s : réponse sans mesures, dite ; la lecture finit en arrière-plan pour la relève suivante`, async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const log = stubFetch(async (url) => {
      if (url.startsWith(HUBEAU_OBSERVATIONS_URL)) {
        await gate;
        return respond(url.includes('grandeur_hydro=Q') ? HUBEAU.Q : HUBEAU.H);
      }
      if (url === INFOVIGICRU_URL) return respond(fx('vigicrues-infovigicru-reduit.geojson'));
      if (url === TERRITORIES_URL) return respond(fx('vigicrues-terent.json'));
      if (url === sectionStationsUrl('MO12')) return respond(fx('vigicrues-tronent-MO12.json'));
      return respond(fx('vigicrues-tronent-MO11.json'));
    });
    const first = await loadFloods(NOW, { hubeauWaitMs: 20 });
    expect(first.errors).toEqual(["Hub'Eau : lecture en cours, hauteurs à la prochaine relève"]);
    expect([first.stationsReadAt, first.sections[0].stations[0].heightM]).toEqual([null, null]);
    release();
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await loadFloods(NOW, { hubeauWaitMs: 20 });
    expect([second.errors, second.sections[0].stations[0].heightM, second.stationsReadAt]).toEqual([[], 22.29, '2026-10-04T08:10:00.000Z']);
    // Une seule lecture par grandeur : la seconde réponse vient du cache rempli en arrière-plan.
    expect(log.urls.filter((u) => u.startsWith(HUBEAU_OBSERVATIONS_URL))).toHaveLength(2);
  });

  it('référentiels en panne : erreurs nommées, le tronçon reste listé', async () => {
    sources((url) => {
      if (url === sectionStationsUrl('MO12')) return respond('introuvable', 404);
      if (url === TERRITORIES_URL) return respond('{"error":"x"}', 500);
      return null;
    });
    const { status, body } = await callHandler<FloodsResponse>(handler);
    expect(status).toBe(200);
    expect(body.errors).toEqual(['Vigicrues, territoires : HTTP 500', 'Vigicrues, stations MO12 : HTTP 404']);
    expect(body.sections[0]).toMatchObject({ id: 'MO12', stations: [], territory: { code: '21', name: null, url: 'https://www.vigicrues.gouv.fr/territoire/21' } });
    expect(body.sections[1].stations).toHaveLength(1);
  });

  it('InfoVigiCru jamais lu : 502 non mis en cache, panne nommée', async () => {
    sources((url) => (url === INFOVIGICRU_URL ? respond('{"error":"x"}', 500) : null));
    const { status, body, cache } = await callHandler<FloodsResponse>(handler);
    expect([status, cache, body.readAt, body.sections, body.errors]).toEqual([502, 'no-store', null, [], ['Vigicrues : HTTP 500']]);
  });

  it('page HTML à la place du GeoJSON : panne nommée', async () => {
    sources((url) => (url === INFOVIGICRU_URL ? respond('<!DOCTYPE html><html><body>Maintenance</body></html>') : null));
    const { status, body } = await callHandler<FloodsResponse>(handler);
    expect([status, body.errors]).toEqual([502, ['Vigicrues : page HTML reçue au lieu de données']]);
  });

  it('InfoVigiCru en panne après une lecture : relevé précédent servi avec sa date, panne nommée', async () => {
    sources();
    expect((await callHandler<FloodsResponse>(handler)).status).toBe(200);
    vi.setSystemTime(NOW + 15 * 60_000);
    sources((url) => (url === INFOVIGICRU_URL ? respond('{"error":"x"}', 500) : null));
    const { status, body } = await callHandler<FloodsResponse>(handler);
    expect([status, body.readAt, body.sections.length]).toEqual([200, '2026-10-04T08:10:00.000Z', 2]);
    expect(body.errors).toEqual(['Vigicrues : relevé précédent servi (lecture en échec)']);
  });
  it('page HTML à la place des mesures Hub’Eau : pannes nommées par grandeur, tronçons gardés', async () => {
    sources((url) => (url.startsWith(HUBEAU_OBSERVATIONS_URL) ? respond('<!DOCTYPE html><html><body>Maintenance</body></html>') : null));
    const { status, body } = await callHandler<FloodsResponse>(handler);
    expect([status, body.sections.length]).toEqual([200, 2]);
    expect(body.errors).toEqual(["Hub'Eau : page HTML reçue au lieu de données", "Hub'Eau, débits : page HTML reçue au lieu de données"]);
  });

  it('réponse « lecture en cours » : cache CDN de 30 s seulement', async () => {
    stubFetch(async (url) => {
      if (url.startsWith(HUBEAU_OBSERVATIONS_URL)) return new Promise<FakeResponse>(() => {});
      if (url === INFOVIGICRU_URL) return respond(fx('vigicrues-infovigicru-reduit.geojson'));
      if (url === TERRITORIES_URL) return respond(fx('vigicrues-terent.json'));
      return respond(fx(url === sectionStationsUrl('MO12') ? 'vigicrues-tronent-MO12.json' : 'vigicrues-tronent-MO11.json'));
    });
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const call = callHandler<FloodsResponse>(handler);
    await vi.advanceTimersByTimeAsync(12_000);
    const { status, body, cache } = await call;
    expect([status, cache, body.errors]).toEqual([200, PENDING_CACHE_CONTROL, ["Hub'Eau : lecture en cours, hauteurs à la prochaine relève"]]);
  });

  it('deux requêtes simultanées pendant la lecture lente : une seule lecture Hub’Eau par grandeur', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const log = stubFetch(async (url) => {
      if (url.startsWith(HUBEAU_OBSERVATIONS_URL)) {
        await gate;
        return respond(url.includes('grandeur_hydro=Q') ? HUBEAU.Q : HUBEAU.H);
      }
      if (url === INFOVIGICRU_URL) return respond(fx('vigicrues-infovigicru-reduit.geojson'));
      if (url === TERRITORIES_URL) return respond(fx('vigicrues-terent.json'));
      return respond(fx(url === sectionStationsUrl('MO12') ? 'vigicrues-tronent-MO12.json' : 'vigicrues-tronent-MO11.json'));
    });
    const both = Promise.all([loadFloods(NOW, { hubeauWaitMs: 30 }), loadFloods(NOW, { hubeauWaitMs: 30 })]);
    const [a, b] = await both;
    expect([a.errors.length, b.errors.length]).toEqual([1, 1]);
    release();
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log.urls.filter((u) => u.startsWith(HUBEAU_OBSERVATIONS_URL))).toHaveLength(2);
    expect(log.urls.filter((u) => u === INFOVIGICRU_URL)).toHaveLength(1);
  });

  it('Hub’Eau simplement lent avec un relevé périmé en cache : « lecture en cours », jamais « lecture en échec »', async () => {
    sources();
    await callHandler<FloodsResponse>(handler);
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(NOW + 15 * 60_000);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stubFetch(async (url) => {
      if (url.startsWith(HUBEAU_OBSERVATIONS_URL)) {
        await gate;
        return respond(url.includes('grandeur_hydro=Q') ? HUBEAU.Q : HUBEAU.H);
      }
      if (url === INFOVIGICRU_URL) return respond(fx('vigicrues-infovigicru-reduit.geojson'));
      return respond('introuvable', 404);
    });
    const pending = loadFloods(NOW + 15 * 60_000, { hubeauWaitMs: 20_000, budgetMs: 30_000 });
    await vi.advanceTimersByTimeAsync(9_000);
    const body = await pending;
    expect(body.errors).toContain("Hub'Eau : relevé précédent servi (lecture en cours)");
    expect(body.errors.join('|')).not.toContain('lecture en échec');
    release();
    await vi.runAllTimersAsync();
  });
});

describe('échéance totale de la route', () => {
  it('référentiels lents et Hub’Eau lent : la réponse arrive à 15 s, bien avant les 20 s du client', async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
    stubFetch(async (url) => {
      if (url === INFOVIGICRU_URL) return respond(fx('vigicrues-infovigicru-reduit.geojson'));
      if (url === TERRITORIES_URL) { await sleep(30_000); return respond(fx('vigicrues-terent.json')); }
      if (url.startsWith(HUBEAU_OBSERVATIONS_URL)) { await sleep(40_000); return respond(HUBEAU.H); }
      await sleep(5_000);
      return respond(fx(url === sectionStationsUrl('MO12') ? 'vigicrues-tronent-MO12.json' : 'vigicrues-tronent-MO11.json'));
    });
    const started = Date.now();
    const pending = loadFloods(NOW);
    await vi.advanceTimersByTimeAsync(15_000);
    const body = await pending;
    expect(Date.now() - started).toBeLessThanOrEqual(15_000);
    expect(body.errors).toEqual(['Vigicrues, territoires : délai dépassé (échéance de la route)', "Hub'Eau : lecture en cours, hauteurs à la prochaine relève"]);
    expect(body.sections.map((s) => s.stations.length)).toEqual([3, 1]);
    await vi.runAllTimersAsync();
  });

  it('InfoVigiCru trop lent : erreur nommée, 502, avant l’échéance', async () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    stubFetch(() => new Promise<FakeResponse>(() => {}));
    const pending = loadFloods(NOW);
    await vi.advanceTimersByTimeAsync(15_000);
    const body = await pending;
    expect([body.readAt, body.errors]).toEqual([null, ['Vigicrues : délai dépassé (échéance de la route)']]);
  });
});
