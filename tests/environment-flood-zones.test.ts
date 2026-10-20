// tests/environment-flood-zones.test.ts
// Zones inondables officielles (Géorisques, WFS Directive inondation, TRI, 20/10/2026) : fixture RÉELLE (trois entités par scénario près du
// Vidourle), simplification, validation et ordre des axes de la boîte, gestionnaire, garde client, géométrie pure.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import {
  FLOOD_LAYERS, FLOOD_WFS_BASE, MAX_FEATURES_PER_SCENARIO, featureZones, floodUrl, loadFloodZones, parseBbox, roundBbox, simplifyLine, simplifyRing,
  parseScenarios, featureCap, MAX_FEATURES_SMALL_BOX,
} from '../api/_lib/flood-zones.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/environment/flood-zones.js';
import { FLOOD_ZONES_URL, fetchFloodZones, isFloodZonesResponse, resetFloodZonesCache, roundFloodBbox } from '../src/services/environment-flood-zones.ts';
import { pointInZones, zonesNearLine } from '../src/services/flood-zone-geo.ts';
import type { FloodZone, FloodZonesResponse } from '../src/types/index.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

type Fc = { type: string; features: Array<{ geometry: { type: string; coordinates: number[][][] }; properties: Record<string, unknown> }> };
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/environment/georisques-zones-inondables-vidourle.json', import.meta.url), 'utf8')) as Record<'frequent' | 'moyen' | 'extreme', Fc>;
const NOW = Date.parse('2026-10-20T14:00:00Z');
const BOX: [number, number, number, number] = [4.05, 43.65, 4.15, 43.75];

beforeEach(() => { __resetSwrCacheForTests(); resetFloodZonesCache(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function wfs(over: Partial<Record<'frequent' | 'moyen' | 'extreme', ReturnType<typeof respond>>> = {}) {
  return stubFetch((url) => {
    if (!url.startsWith(FLOOD_WFS_BASE)) return respond('introuvable', 404);
    const layer = new URL(url).searchParams.get('typeNames');
    const l = FLOOD_LAYERS.find((x) => x.layer === layer);
    if (!l) return respond('couche inconnue', 400);
    return over[l.scenario as 'frequent'] ?? respond(FIXTURE[l.scenario as 'frequent']);
  });
}

describe('boîte : validation et ordre des axes', () => {
  it('lon,lat en entrée, lat,lon dans l’URN du WFS', () => {
    const url = floodUrl('ms:ALEA_SYNT_01_02MOY_FXX', [4.05, 43.65, 4.15, 43.75]);
    expect(url).toContain('bbox=43.65,4.05,43.75,4.15,urn:ogc:def:crs:EPSG::4326');
    expect(new URL(url).searchParams.get('typeNames')).toBe('ms:ALEA_SYNT_01_02MOY_FXX');
    expect(new URL(url).searchParams.get('count')).toBe(String(MAX_FEATURES_PER_SCENARIO));
  });
  it('valide : quatre nombres ordonnés, 1° au plus par côté', () => {
    expect(parseBbox('4.05,43.65,4.15,43.75')).toEqual({ ok: true, bbox: [4.05, 43.65, 4.15, 43.75] });
    for (const bad of [undefined, '', '1,2,3', '1,2,3,x', '4.15,43.65,4.05,43.75', '4,43,4.1,43', '0,43,1.5,43.5', '0,43,0.5,44.5', '-181,0,0,1', '0,0,1,91', ',,,']) {
      expect(parseBbox(bad), String(bad)).toMatchObject({ ok: false });
    }
    expect(parseBbox('0,43,1,44')).toMatchObject({ ok: true });
  });
  it('arrondie vers l’extérieur à 0,05° (client et serveur identiques)', () => {
    expect(roundBbox([4.0312, 43.6, 4.1201, 43.7999])).toEqual([4, 43.6, 4.15, 43.8]);
    expect(roundBbox([4.05, 43.65, 4.15, 43.75])).toEqual([4.05, 43.65, 4.15, 43.75]);
    expect(roundFloodBbox([4.0312, 43.6, 4.1201, 43.7999])).toEqual(roundBbox([4.0312, 43.6, 4.1201, 43.7999]));
  });
});

describe('simplification (Douglas-Peucker)', () => {
  it('une ligne droite bruitée se réduit à ses extrémités, un coin franc est gardé', () => {
    expect(simplifyLine([[0, 0], [1, 0.00001], [2, 0], [3, 0]], 0.0003)).toEqual([[0, 0], [3, 0]]);
    expect(simplifyLine([[0, 0], [1, 1], [2, 0]], 0.0003)).toEqual([[0, 0], [1, 1], [2, 0]]);
  });
  it('un anneau reste fermé, garde sa forme et perd des points ; un anneau dégénéré est refusé', () => {
    const ring: Array<[number, number]> = [];
    for (let i = 0; i <= 100; i++) ring.push([i * 0.0001, 0]);
    ring.push([0.01, 0.01], [0, 0.01], [0, 0]);
    const out = simplifyRing(ring);
    expect(out).not.toBeNull();
    expect(out).toEqual([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]);
    expect(simplifyRing([[0, 0], [1, 0], [0, 0]])).toBeNull();
  });
  it('fixture réelle : bien moins de points, tous les sommets restent dans la boîte de l’entité, anneau fermé à 5 décimales', () => {
    for (const s of ['frequent', 'moyen', 'extreme'] as const) {
      for (const f of FIXTURE[s].features) {
        const before = f.geometry.coordinates[0].length;
        const zones = featureZones(f, s);
        expect(zones.length, `${s} ${f.properties['id']}`).toBeGreaterThan(0);
        const z = zones[0];
        expect(z.ring.length).toBeLessThanOrEqual(before);
        expect(z.ring.length).toBeGreaterThanOrEqual(4);
        expect(z.ring[0]).toEqual(z.ring[z.ring.length - 1]);
        const xs = f.geometry.coordinates[0].map((p) => p[0]);
        const ys = f.geometry.coordinates[0].map((p) => p[1]);
        for (const [x, y] of z.ring) {
          expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-5);
          expect(x).toBeLessThanOrEqual(Math.max(...xs) + 1e-5);
          expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-5);
          expect(y).toBeLessThanOrEqual(Math.max(...ys) + 1e-5);
          expect(String(x).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);
        }
      }
    }
    const big = FIXTURE.moyen.features[2];
    expect(featureZones(big, 'moyen')[0].ring.length).toBeLessThan(big.geometry.coordinates[0].length / 2);
  });
  it('MultiPolygon : une zone par polygone, trous écartés ; géométrie absente ou inconnue : rien', () => {
    const sq = (x: number): number[][] => [[x, 0], [x + 0.01, 0], [x + 0.01, 0.01], [x, 0.01], [x, 0]];
    const hole = [[0.003, 0.003], [0.006, 0.003], [0.006, 0.006], [0.003, 0.006], [0.003, 0.003]];
    const multi = { geometry: { type: 'MultiPolygon', coordinates: [[sq(0), hole], [sq(1)]] }, properties: { id: '42' } };
    const zones = featureZones(multi, 'moyen');
    expect(zones.map((z) => [z.id, z.scenario, z.ring.length])).toEqual([['42', 'moyen', 5], ['42-1', 'moyen', 5]]);
    expect(featureZones({ geometry: null, properties: {} }, 'moyen')).toEqual([]);
    expect(featureZones({ geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }, 'moyen')).toEqual([]);
  });
});

describe('loadFloodZones', () => {
  it('trois scénarios lus en parallèle sur la boîte arrondie, zones des trois scénarios', async () => {
    const log = wfs();
    const out = await loadFloodZones([4.0312, 43.65, 4.15, 43.75], NOW);
    expect(log.urls).toHaveLength(3);
    for (const u of log.urls) expect(u).toContain('bbox=43.65,4,43.75,4.15,urn:ogc:def:crs:EPSG::4326');
    expect(out.bbox).toEqual([4, 43.65, 4.15, 43.75]);
    expect(out.readAt).toBe('2026-10-20T14:00:00.000Z');
    expect(out.covered).toBe(true);
    expect(out.errors).toEqual([]);
    expect([...new Set(out.zones.map((z) => z.scenario))].sort()).toEqual(['extreme', 'frequent', 'moyen']);
    expect(out.zones.filter((z) => z.scenario === 'extreme').length).toBe(3); // trois entités, trous de la 3e écartés
  });
  it('hors TRI : réponse vide normale, covered faux, aucune zone inventée, readAt posé', async () => {
    const empty = { type: 'FeatureCollection', features: [] };
    wfs({ frequent: respond(empty), moyen: respond(empty), extreme: respond(empty) });
    const out = await loadFloodZones([-1.2, 45, -1.1, 45.1], NOW);
    expect(out).toMatchObject({ zones: [], covered: false, errors: [] });
    expect(out.readAt).not.toBeNull();
  });
  it('un scénario en panne est nommé, les autres servis ; tout en panne : readAt null', async () => {
    wfs({ moyen: respond('erreur', 503) });
    const partial = await loadFloodZones(BOX, NOW);
    expect(partial.readAt).not.toBeNull();
    expect(partial.errors).toHaveLength(1);
    expect(partial.errors[0]).toContain('crue moyenne');
    expect(partial.zones.some((z) => z.scenario === 'moyen')).toBe(false);
    __resetSwrCacheForTests();
    wfs({ frequent: respond('x', 500), moyen: respond('x', 500), extreme: respond('x', 500) });
    const none = await loadFloodZones([5, 44, 5.1, 44.1], NOW);
    expect(none.readAt).toBeNull();
    expect(none.errors).toHaveLength(3);
  });
  it('plafond d’entités atteint : troncature signalée (300 pour une grande boîte, 2 000 pour une case de 0,05°)', async () => {
    const f = FIXTURE.moyen.features[0];
    const many = { type: 'FeatureCollection', features: Array.from({ length: MAX_FEATURES_PER_SCENARIO }, () => f) };
    wfs({ moyen: respond(many) });
    const big = await loadFloodZones([4.2, 43.5, 4.3, 43.6], NOW);
    expect(big.errors.some((e) => e.includes('tronqué à 300'))).toBe(true);
    const small = await loadFloodZones([4.2, 43.5, 4.25, 43.55], NOW);
    expect(small.errors.some((e) => e.includes('tronqué'))).toBe(false);
    expect(featureCap([4.2, 43.5, 4.25, 43.55])).toBe(MAX_FEATURES_SMALL_BOX);
  });
  it('mis en cache : une deuxième lecture de la même boîte n’appelle plus le WFS', async () => {
    const log = wfs();
    await loadFloodZones([4.3, 43.1, 4.4, 43.2], NOW);
    await loadFloodZones([4.31, 43.11, 4.39, 43.19], NOW);
    expect(log.urls).toHaveLength(3);
  });
});

describe('/api/environment/flood-zones', () => {
  it('200 avec cache CDN long ; 400 sans cache sur une boîte invalide ; 502 non mis en cache si rien n’est lu', async () => {
    wfs();
    const ok = await callHandler<FloodZonesResponse>(handler, { bbox: '4.05,43.65,4.15,43.75' });
    expect(ok.status).toBe(200);
    expect(ok.cache).toBe(CACHE_CONTROL);
    expect(CACHE_CONTROL).toBe('s-maxage=86400, stale-while-revalidate=604800');
    expect(isFloodZonesResponse(ok.body)).toBe(true);
    const bad = await callHandler<{ error: string }>(handler, { bbox: '4.15,43.65,4.05,43.75' });
    expect(bad.status).toBe(400);
    expect(bad.cache).toBe('no-store');
    expect(bad.body.error).toContain('bbox');
    expect((await callHandler<{ error: string }>(handler, {})).status).toBe(400);
    __resetSwrCacheForTests();
    wfs({ frequent: respond('x', 500), moyen: respond('x', 500), extreme: respond('x', 500) });
    const down = await callHandler<FloodZonesResponse>(handler, { bbox: '6,45,6.1,45.1' });
    expect(down.status).toBe(502);
    expect(down.cache).toBe('no-store');
    expect(down.body.errors).toHaveLength(3);
  });
});

describe('client : garde et lecture', () => {
  const zone: FloodZone = { id: '1', scenario: 'moyen', ring: [[0, 0], [1, 0], [1, 1], [0, 0]] };
  const good: FloodZonesResponse = { readAt: '2026-10-20T14:00:00.000Z', bbox: [0, 0, 1, 1], zones: [zone], covered: true, errors: [] };
  it('garde : accepte la réponse, refuse les formes inattendues', () => {
    expect(isFloodZonesResponse(good)).toBe(true);
    expect(isFloodZonesResponse({ ...good, zones: [], covered: false })).toBe(true);
    for (const bad of [null, {}, { ...good, covered: 'oui' }, { ...good, bbox: [0, 0, 1] }, { ...good, errors: [1] }, { ...good, readAt: 3 },
      { ...good, zones: [{ ...zone, scenario: 'rare' }] }, { ...good, zones: [{ ...zone, ring: [[0, 0], [1, 1]] }] }, { ...good, zones: [{ ...zone, ring: [[0, 0], [1, 'x'], [1, 1], [0, 0]] }] }]) {
      expect(isFloodZonesResponse(bad)).toBe(false);
    }
  });
  it('fetchFloodZones : boîte arrondie dans l’URL, cache de session, null sans rejet en cas d’échec', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = stubFetch(() => respond(good));
    const a = await fetchFloodZones([0.01, 0.01, 0.96, 0.96]);
    const b = await fetchFloodZones([0.02, 0.02, 0.97, 0.97]);
    expect(a).toEqual(good);
    expect(b).toEqual(good);
    expect(log.urls).toEqual([`${FLOOD_ZONES_URL}?bbox=0,0,1,1`]);
    resetFloodZonesCache();
    stubFetch(() => respond('panne', 500));
    await expect(fetchFloodZones([2, 2, 2.1, 2.1])).resolves.toBeNull();
    stubFetch(() => respond({ pas: 'une réponse' }));
    await expect(fetchFloodZones([3, 3, 3.1, 3.1])).resolves.toBeNull();
    warn.mockRestore();
  });
});

describe('géométrie pure', () => {
  const sq = (id: string, scenario: FloodZone['scenario'], x: number, y: number, s: number): FloodZone => ({
    id, scenario, ring: [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]],
  });
  const zones = [sq('a', 'frequent', 0, 0, 1), sq('b', 'moyen', 0, 0, 2), sq('c', 'extreme', 10, 10, 1)];
  it('pointInZones : dedans, dehors, filtre par scénario', () => {
    expect(pointInZones(0.5, 0.5, zones).map((z) => z.id)).toEqual(['a', 'b']);
    expect(pointInZones(1.5, 1.5, zones).map((z) => z.id)).toEqual(['b']);
    expect(pointInZones(5, 5, zones)).toEqual([]);
    expect(pointInZones(0.5, 0.5, zones, ['moyen']).map((z) => z.id)).toEqual(['b']);
    expect(pointInZones(0.5, 0.5, zones, [])).toEqual([]);
    expect(pointInZones(10.5, 10.5, zones, ['extreme', 'frequent']).map((z) => z.id)).toEqual(['c']);
  });
  it('zonesNearLine : sommet à moins de maxKm (équirectangulaire), ligne vide : rien', () => {
    // 0,01° de latitude ≈ 1,11 km.
    const line: Array<[number, number]> = [[10.0, 10.02], [10.0, 10.03]];
    expect(zonesNearLine(zones, line, 3).map((z) => z.id)).toEqual(['c']);
    expect(zonesNearLine(zones, line, 0.5)).toEqual([]);
    expect(zonesNearLine(zones, [[0.5, 0.5]], 80).map((z) => z.id)).toEqual(['a', 'b']);
    expect(zonesNearLine(zones, [], 100)).toEqual([]);
  });
});

describe('scénarios demandés', () => {
  it('absents : les trois ; liste : dans l’ordre officiel ; nom inconnu : erreur', () => {
    expect(parseScenarios(undefined)).toEqual({ ok: true, scenarios: ['frequent', 'moyen', 'extreme'] });
    expect(parseScenarios('moyen,frequent')).toEqual({ ok: true, scenarios: ['frequent', 'moyen'] });
    expect(parseScenarios('centennale').ok).toBe(false);
  });
});
