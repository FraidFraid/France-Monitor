// tests/hubeau-stations.test.ts : hauteurs et débits Hub'Eau des stations des tronçons en vigilance (spec 2026-10-04
// environnement § 2.2), sur une réponse réelle enregistrée le 04/10/2026 (Têt : Vinca, Perpignan [Pont-Joffre]).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HUBEAU_OBSERVATIONS_URL, MAX_PAGES, buildStations, fetchObservations, observationsUrl, parseObservationsPage, quarterSeries, sinceIso,
} from '../api/_lib/hubeau-stations.js';
import { respond, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const fxJson = <T>(name: string): T => JSON.parse(fx(name)) as T;

interface HubeauObservation { code_station: string; date_obs: string; resultat_obs: number; longitude: number | null; latitude: number | null }
interface HubeauPage { count: number; next: string | null; data: HubeauObservation[] }
const HUBEAU = fxJson<{ H: HubeauPage; Q: HubeauPage }>('hubeau-observations-code-entite.json');
const NOW = Date.parse('2026-10-04T10:10:00+02:00');
const VINCA = 'Y046401001';
const PERPIGNAN = 'Y047403001';
const ILLE = 'Y046600501';
const REFS = [{ code: VINCA, name: 'Vinca' }, { code: PERPIGNAN, name: 'Perpignan [Pont-Joffre]' }, { code: ILLE, name: 'Ille-sur-Têt' }];

afterEach(() => { vi.unstubAllGlobals(); });

describe('adresse Hub’Eau : toujours par code_entite, jamais par département', () => {
  it('fenêtre de 48 h, 20 000 résultats, ordre décroissant (le plus récent d’abord), champs utiles seulement', () => {
    expect(sinceIso(NOW)).toBe('2026-10-02T08:10:00Z');
    expect(observationsUrl([VINCA, PERPIGNAN], 'H', sinceIso(NOW))).toBe(
      `${HUBEAU_OBSERVATIONS_URL}?code_entite=Y046401001,Y047403001&grandeur_hydro=H&date_debut_obs=2026-10-02T08:10:00Z`
      + '&size=20000&sort=desc&fields=code_station,date_obs,resultat_obs,longitude,latitude',
    );
    expect(observationsUrl([VINCA], 'Q', sinceIso(NOW))).not.toContain('code_departement');
  });
  it('un code mal formé n’entre jamais dans l’adresse', () => {
    expect(observationsUrl([VINCA, '66&x=1'], 'H', sinceIso(NOW))).toContain('code_entite=Y046401001&');
  });
  it('filtre départemental non appliqué par Hub’Eau (réponse réelle : Guadeloupe et Vosges pour « 66 ») : stations non demandées ignorées', async () => {
    const page = fxJson<{ count: number; data: HubeauObservation[] }>('hubeau-observations-tr-66.json');
    expect(page.count).toBe(16_583_584);
    expect(page.data.map((o) => o.code_station)).toEqual(['1110000101', 'A402061001', 'A405062001', 'A414020201', 'A417301001']);
    stubFetch(() => respond(page, 206));
    expect((await fetchObservations([VINCA], 'H', NOW)).observations).toEqual([]);
  });
});

describe('pages Hub’Eau', () => {
  it('HTTP 206 : la page suivante (`next`) est lue, les mesures sont réunies', async () => {
    const next = `${observationsUrl([VINCA, PERPIGNAN], 'H', sinceIso(NOW))}&cursor=AoJw`;
    const log = stubFetch((url) => (url === next
      ? respond({ ...HUBEAU.H, next: null, data: HUBEAU.H.data.slice(20) })
      : respond({ ...HUBEAU.H, next, data: HUBEAU.H.data.slice(0, 20) }, 206)));
    const read = await fetchObservations([VINCA, PERPIGNAN], 'H', NOW);
    expect(log.urls).toEqual([observationsUrl([VINCA, PERPIGNAN], 'H', sinceIso(NOW)), next]);
    expect([read.observations.length, read.truncated]).toEqual([40, false]);
  });
  it(`au plus ${MAX_PAGES} pages : la suite est signalée, jamais lue sans fin`, async () => {
    const log = stubFetch((url) => respond({ ...HUBEAU.H, next: `${url}x`, data: HUBEAU.H.data.slice(0, 2) }, 206));
    const read = await fetchObservations([VINCA, PERPIGNAN], 'H', NOW);
    expect([log.urls.length, read.truncated, read.observations.length]).toEqual([5, true, 10]);
  });
  it('aucun code lisible : Hub’Eau n’est pas appelé (un code_entite vide lirait toute la base)', async () => {
    const log = stubFetch(() => respond(HUBEAU.H));
    const read = await fetchObservations(['66&x=1', 'bad'], 'H', NOW);
    expect([log.urls.length, read.observations, read.truncated]).toEqual([0, [], false]);
  });
  it('`next` hors de hubeau.eaufrance.fr : jamais suivi, lecture en échec nommée', async () => {
    const log = stubFetch(() => respond({ ...HUBEAU.H, next: 'https://example.org/api?cursor=1' }, 206));
    await expect(fetchObservations([VINCA], 'H', NOW)).rejects.toThrow('page suivante hors de hubeau.eaufrance.fr');
    expect(log.urls).toHaveLength(1);
  });
  it('forme inattendue : erreur, jamais une liste vide silencieuse', () => {
    expect(() => parseObservationsPage({ count: 0 })).toThrow("réponse Hub'Eau sans liste « data »");
  });
});

describe('stations : dernière mesure, variation sur 1 h, séries au quart d’heure', () => {
  const [vinca, perpignan, ille] = buildStations(REFS, HUBEAU.H.data, HUBEAU.Q.data, NOW);

  it('Vinca : hauteur au repère 22,29 m à 08:10 UTC, stable sur 1 h, pas de débit publié', () => {
    expect(vinca).toMatchObject({
      code: VINCA, name: 'Vinca', lat: 42.657988931, lon: 2.544186844, lastAt: '2026-10-04T08:10:00Z',
      heightM: 22.29, flowM3s: null, change1hM: 0, flowSeries: [],
    });
  });
  it('Perpignan [Pont-Joffre] : 0,355 m, +0,029 m en 1 h (326 mm à 07:10), débit 9,04 m³/s', () => {
    expect(perpignan).toMatchObject({ lastAt: '2026-10-04T08:10:00Z', heightM: 0.355, change1hM: 0.029, flowM3s: 9.04, lat: 42.703618825, lon: 2.892828825 });
  });
  it('station sans mesure : n.d. partout, aucune valeur inventée', () => {
    expect(ille).toEqual({
      code: ILLE, name: 'Ille-sur-Têt', lat: null, lon: null, lastAt: null, flowAt: null, heightM: null, flowM3s: null, change1hM: null, heightSeries: [], flowSeries: [],
    });
  });
  it('mesures reçues du plus récent au plus ancien (sort=desc) : mêmes stations, mêmes séries', () => {
    const [v, p] = buildStations(REFS, [...HUBEAU.H.data].reverse(), [...HUBEAU.Q.data].reverse(), NOW);
    expect(v).toEqual(vinca);
    expect(p).toEqual(perpignan);
  });
  it('station avec débit seul : le débit a sa propre date, la hauteur reste absente', () => {
    const [only] = buildStations(REFS.slice(1, 2), [], HUBEAU.Q.data, NOW);
    expect(only).toMatchObject({ lastAt: null, heightM: null, flowM3s: 9.04, flowAt: '2026-10-04T08:10:00Z', lat: 42.703618825 });
    expect(perpignan.flowAt).toBe('2026-10-04T08:10:00Z');
  });
  it('un point par quart d’heure, la première mesure du quart ; le trou de 20:45 à 21:25 reste un trou', () => {
    expect(perpignan.heightSeries.map((p) => p.at)).toEqual([
      '2026-10-02T12:00:00Z', '2026-10-02T18:00:00Z', '2026-10-03T00:00:00Z', '2026-10-03T06:00:00Z', '2026-10-03T12:00:00Z',
      '2026-10-03T18:00:00Z', '2026-10-03T20:40:00Z', '2026-10-03T20:45:00Z', '2026-10-03T21:25:00Z', '2026-10-03T21:30:00Z',
      '2026-10-04T00:00:00Z', '2026-10-04T06:00:00Z', '2026-10-04T07:00:00Z', '2026-10-04T07:15:00Z', '2026-10-04T07:30:00Z',
      '2026-10-04T07:45:00Z', '2026-10-04T08:00:00Z',
    ]);
    expect(perpignan.heightSeries.slice(-5).map((p) => p.value)).toEqual([0.319, 0.33, 0.346, 0.347, 0.355]);
    expect(perpignan.flowSeries.at(-1)).toEqual({ at: '2026-10-04T08:00:00Z', value: 9.04 });
    expect(vinca.heightSeries[0]).toEqual({ at: '2026-10-02T12:00:00Z', value: 22.28 });
  });
  it('variation à 10 min près : 07:15 à défaut de 07:10 ; rien dans les 10 min : null', () => {
    const without = (times: string[]): HubeauObservation[] => HUBEAU.H.data.filter((o) => !(o.code_station === PERPIGNAN && times.includes(o.date_obs)));
    const near = buildStations(REFS.slice(1, 2), without(['2026-10-04T07:10:00Z']), [], NOW)[0];
    expect(near.change1hM).toBe(0.025);
    const none = buildStations(REFS.slice(1, 2), without(['2026-10-04T07:00:00Z', '2026-10-04T07:10:00Z', '2026-10-04T07:15:00Z']), [], NOW)[0];
    expect(none.change1hM).toBeNull();
  });
  it('fenêtre de 48 h : une mesure plus ancienne n’entre pas dans la série', () => {
    const old: HubeauObservation = { code_station: VINCA, date_obs: '2026-10-02T08:00:00Z', resultat_obs: 22000, longitude: 2.544186844, latitude: 42.657988931 };
    expect(quarterSeries([old, ...HUBEAU.H.data.filter((o) => o.code_station === VINCA)], NOW, 1000)[0].at).toBe('2026-10-02T12:00:00Z');
  });
});
