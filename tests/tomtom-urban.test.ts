import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests, kvSetJson } from '../api/_lib/kv-history.js';
import {
  AGGLO_ORDER, INCIDENT_BUDGET, URBAN_FRAMES, aggregateAgglo, collectUrban, ensureUrbanFresh, incidentsUrl, isUrbanDue, readQuota, reserveFlowCall,
  toUrbanJam, urbanCadenceMs,
} from '../api/_lib/tomtom-urban.js';
import { startTrafficCollectors } from '../server/prod/traffic-collectors.mjs';
import { parisHour, parisWallTime } from '../api/_lib/paris-time.js';
import { type FakeResponse, fixtureJson, fixtureText, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

type Incident = { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
const LYON = fixtureJson<{ incidents: Incident[] }>('tomtom-lyon-ouest-cat6.json');
const PARIS = fixtureJson<{ incidents: Incident[] }>('tomtom-paris-mixed.json');
const DAY = Date.parse('2026-10-03T14:00:00+02:00');

/** Redis simulé partagé entre deux « processus » (la mémoire est vidée pour simuler un redémarrage). */
function fakeRedis() {
  const store = new Map<string, string>();
  return { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } };
}

/** Cadres de Paris : incidents réels mêlés (catégories 1, 6, 8, 9, 14) ; Lyon : catégorie 6 réelle ; ailleurs : aucun. */
function stubTomTom(override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    const bbox = new URL(url).searchParams.get('bbox') ?? '';
    const frame = URBAN_FRAMES.find((f) => f.bbox === bbox);
    if (frame?.agglo === 'Paris') return respond(PARIS);
    if (frame?.agglo === 'Lyon') return respond(LYON);
    return respond({ incidents: [] });
  });
}

beforeEach(() => {
  __resetKvForTests();
  __setKvClientForTests(fakeRedis());
  vi.stubEnv('VITE_TOMTOM_API_KEY', '');
  vi.stubEnv('TOMTOM_API_KEY', 'cle-de-test');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); __setKvClientForTests(null); __resetKvForTests(); });

describe('fonctions pures', () => {
  it('bouchon réel de Lyon : route, tronçon, longueur, retard, début, tracé allégé', () => {
    const jam = toUrbanJam(LYON.incidents[0]);
    expect(jam).toMatchObject({
      road: 'D386', from: 'Givors - A47 (D386)', to: 'A7 - D42 (D386)', lengthKm: 0.6, delayMin: 2, magnitude: 2,
      start: '2026-10-03T13:50:30Z', lat: 45.65329, lon: 4.75098,
    });
    expect(jam?.path.length).toBeLessThanOrEqual(31);
  });
  it('catégorie 8 (route fermée), 9 (travaux), 1, 14 ou magnitude 4 : écartés', () => {
    expect(PARIS.incidents.map(toUrbanJam).filter(Boolean)).toHaveLength(6);
    const undefinedMagnitude = { ...LYON.incidents[0], properties: { ...LYON.incidents[0].properties, magnitudeOfDelay: 4 } };
    expect(toUrbanJam(undefinedMagnitude)).toBeNull();
  });
  it('agrégats d’agglomération : nombre, kilomètres, retard cumulé, plus long bouchon', () => {
    const a = aggregateAgglo('Lyon', LYON.incidents.map(toUrbanJam).filter((j): j is NonNullable<typeof j> => j !== null), '2026-10-03T12:00:00.000Z');
    expect(a).toMatchObject({ name: 'Lyon', jams: 10, jamKm: 7.2, delayMin: 44, collectedAt: '2026-10-03T12:00:00.000Z' });
    expect(a.longest).toMatchObject({ road: 'M6', lengthKm: 1.7 });
  });
  it('cadence : 15 min de 7 h à 21 h, 30 min la nuit (heure de Paris) ; due après la cadence moins une minute', () => {
    expect(urbanCadenceMs(DAY)).toBe(15 * 60_000);
    expect(urbanCadenceMs(Date.parse('2026-10-03T21:00:00+02:00'))).toBe(30 * 60_000);
    expect(urbanCadenceMs(Date.parse('2026-10-04T06:59:00+02:00'))).toBe(30 * 60_000);
    expect(isUrbanDue(null, DAY)).toBe(true);
    expect(isUrbanDue(new Date(DAY - 13 * 60_000).toISOString(), DAY)).toBe(false);
    expect(isUrbanDue(new Date(DAY - 14 * 60_000).toISOString(), DAY)).toBe(true);
  });
  it('14 cadres et 12 agglomérations', () => {
    expect(URBAN_FRAMES).toHaveLength(14);
    expect(new Set(URBAN_FRAMES.map((f) => f.agglo))).toEqual(new Set(AGGLO_ORDER));
  });
  it('URL : catégorie 6 seulement, incidents présents, en français', () => {
    const u = new URL(incidentsUrl('4.70,45.62,4.86,45.86', 'k'));
    expect([u.searchParams.get('categoryFilter'), u.searchParams.get('timeValidityFilter'), u.searchParams.get('language')]).toEqual(['6', 'present', 'fr-FR']);
  });
});

describe('collecte serveur', () => {
  it('14 appels identifiés, quota compté, Paris et Lyon dédoublonnés sur leurs deux cadres', async () => {
    const log = stubTomTom();
    const r = await collectUrban(DAY);
    expect(log.urls).toHaveLength(14);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe('FranceMonitor/1.0 (+https://www.francemonitor.com)');
    expect(r.errors).toEqual([]);
    expect(r.collectedAt).toBe('2026-10-03T12:00:00.000Z');
    expect(r.quota).toEqual({ callsToday: 14, limit: 2500 });
    expect(r.agglos.map((a) => a.name)).toEqual(AGGLO_ORDER);
    expect(r.agglos[0]).toMatchObject({ name: 'Paris', jams: 6, jamKm: 27.5, delayMin: 80 });
    expect(r.agglos[1]).toMatchObject({ name: 'Lyon', jams: 10, jamKm: 7.2 });
    expect(r.agglos[2]).toMatchObject({ name: 'Marseille', jams: 0, jamKm: 0, delayMin: 0, longest: null });
    expect(r.jams).toHaveLength(16);
  });
  it('dans les 15 min : aucune nouvelle requête ; après : un nouveau cycle', async () => {
    const log = stubTomTom();
    await ensureUrbanFresh(DAY);
    await ensureUrbanFresh(DAY + 5 * 60_000);
    expect(log.urls).toHaveLength(14);
    await ensureUrbanFresh(DAY + 15 * 60_000);
    expect(log.urls).toHaveLength(28);
  });
  it('redémarrage du serveur : la dernière collecte est relue dans Redis, pas de cycle en plus (quota tenu)', async () => {
    const log = stubTomTom();
    await ensureUrbanFresh(DAY);
    __resetKvForTests();
    const r = await ensureUrbanFresh(DAY + 2 * 60_000);
    expect(log.urls).toHaveLength(14);
    expect(r.collectedAt).toBe('2026-10-03T12:00:00.000Z');
  });
  it('un cadre de Lyon en HTTP 500 : Lyon retirée et nommée, jamais de chiffre partiel', async () => {
    stubTomTom((url) => (url.includes('bbox=4.86') ? respond('erreur', 500) : null));
    const r = await collectUrban(DAY);
    expect(r.errors).toEqual(['TomTom, Lyon : HTTP 500']);
    expect(r.agglos.map((a) => a.name)).not.toContain('Lyon');
    expect(r.agglos).toHaveLength(11);
  });
  it('clé refusée partout (réponse réelle HTTP 401) : dernière collecte réussie gardée avec sa date', async () => {
    stubTomTom();
    await collectUrban(DAY);
    stubTomTom(() => respond(fixtureText('tomtom-401.json'), 401));
    const r = await collectUrban(DAY + 15 * 60_000);
    expect(r.collectedAt).toBe('2026-10-03T12:00:00.000Z');
    expect(r.errors).toHaveLength(12);
    expect(r.errors[0]).toBe('TomTom, Paris : HTTP 401');
    expect(r.quota.callsToday).toBe(28);
  });
  it('budget du jour atteint : aucun appel, erreur nommée', async () => {
    const log = stubTomTom();
    await kvSetJson('traffic:tomtom:incidents:2026-10-03', INCIDENT_BUDGET - 10, 172_800, DAY);
    const r = await collectUrban(DAY);
    expect(log.urls).toHaveLength(0);
    expect(r.errors).toEqual(['TomTom : budget du jour atteint (2200 appels d’incidents)']);
    expect(r.collectedAt).toBeNull();
  });
  it('clé absente : aucun appel', async () => {
    vi.stubEnv('TOMTOM_API_KEY', '');
    const log = stubTomTom();
    const r = await collectUrban(DAY);
    expect(log.urls).toHaveLength(0);
    expect(r.errors).toEqual(['TomTom : clé absente (TOMTOM_API_KEY)']);
  });
  it('compteur du jour remis à zéro au changement de jour (heure de Paris)', async () => {
    stubTomTom();
    await collectUrban(DAY);
    expect((await readQuota(Date.parse('2026-10-04T00:05:00+02:00'))).callsToday).toBe(0);
  });
  it('cycle à réponses lentes : le compteur du jour est incrémenté une fois de 14, pas perdu en route', async () => {
    const log = stubTomTom();
    const slow = vi.fn(async (url: string) => {
      log.urls.push(url);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return respond({ incidents: [] });
    });
    vi.stubGlobal('fetch', slow);
    const r = await collectUrban(DAY);
    expect(slow).toHaveBeenCalledTimes(14);
    expect(r.quota.callsToday).toBe(14);
  });
  it('deux déclenchements simultanés : un seul cycle (14 appels), le second relit le marqueur du premier', async () => {
    const log = stubTomTom();
    await Promise.all([ensureUrbanFresh(DAY), ensureUrbanFresh(DAY)]);
    expect(log.urls).toHaveLength(14);
    expect((await readQuota(DAY)).callsToday).toBe(14);
  });
  it('survols simultanés : le compteur compte chaque appel réservé, sans mise à jour perdue', async () => {
    const results = await Promise.all(Array.from({ length: 14 }, () => reserveFlowCall(DAY)));
    expect(results.every(Boolean)).toBe(true);
    expect((await readQuota(DAY)).callsToday).toBe(14);
  });
});

/**
 * Simulation de la vraie relève (une minute) sous horloge simulée : seuls les appels `incidentDetails`
 * réellement émis sont comptés (fetch simulé, aucun appel TomTom réel).
 */
async function simulate(startMs: number, durationMs: number) {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(startMs);
  const cycles: number[] = [];
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (calls % URBAN_FRAMES.length === 0) cycles.push(Date.now());
    calls += 1;
    return respond({ incidents: [] });
  }));
  const stop = startTrafficCollectors({
    collectors: [{ name: 'tomtom', run: ensureUrbanFresh }],
    now: () => Date.now(),
    log: { error: () => {} },
  });
  await vi.advanceTimersByTimeAsync(durationMs);
  stop();
  return { calls, cycles };
}

describe('cadence réelle de la relève (horloge simulée)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('24 h ordinaires : environ 1 130 appels (cycle toutes les 14 min le jour, 29 min la nuit), sous les 2 500', async () => {
    const { calls } = await simulate(parisWallTime(2026, 10, 3, 0, 0, 0), 24 * 3_600_000);
    // Le cycle est dû à cadence moins une minute (tolérance) et la relève passe chaque minute : 14 min de
    // 7 h à 21 h (60 cycles) et 29 min la nuit (21 cycles), soit 81 cycles ; mesuré : 1 134 appels.
    expect(calls % URBAN_FRAMES.length).toBe(0);
    expect(calls).toBeGreaterThanOrEqual(1120);
    expect(calls).toBeLessThanOrEqual(1150);
    expect(calls).toBeLessThan(2500);
  });
  it('25/10/2026 (retour à l’heure d’hiver, 25 h) : cadence suivie sur l’heure murale de Paris, rien de sauté ni de doublé', async () => {
    const { calls, cycles } = await simulate(parisWallTime(2026, 10, 25, 0, 0, 0), 25 * 3_600_000);
    const gaps = cycles.slice(1).map((t, i) => ({ gap: (t - cycles[i]) / 60_000, from: parisHour(cycles[i]), to: parisHour(t) }));
    expect(gaps.every((g) => g.gap >= 14 && g.gap <= 30)).toBe(true);
    // Jour (7 h à 21 h, heure murale) : 14 min exactement ; nuit, y compris les deux passages de 2 h : 29 min.
    expect(gaps.filter((g) => g.from >= 7 && g.to < 21).every((g) => g.gap === 14)).toBe(true);
    const night = (h: number) => h < 7 || h >= 21;
    expect(gaps.filter((g) => night(g.from) && night(g.to)).every((g) => g.gap === 29)).toBe(true);
    // 25 h = 14 h de jour (60 cycles) + 11 h de nuit (23 cycles) : 83 cycles mesurés (1 162 appels).
    expect(calls).toBeGreaterThanOrEqual(82 * URBAN_FRAMES.length);
    expect(calls).toBeLessThanOrEqual(84 * URBAN_FRAMES.length);
  });
});
