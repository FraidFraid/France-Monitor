import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INDEX_URL, SNAPSHOT_URL, __resetDatexStateForTests, buildRoadNational, classifyRecord, dirLabel, formatRoad, incrementUrl,
  loadDirSituations, mergeSituations, parseDatex,
} from '../api/_lib/datex-dir.js';
import { type FakeResponse, fixtureText, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const AT = (iso: string): number => Date.parse(iso);
const NOW = AT('2026-10-03T15:10:00+02:00');
const content = () => parseDatex(fixtureText('datex-content.xml'));
const inc = (n: number) => parseDatex(fixtureText(`datex-inc-${n}.xml`));

/** Sert l'instantané réel de 14 h 57, l'index et les fichiers du journal enregistrés le 03/10/2026. */
function stubDir(next = 3566873, override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    if (url === SNAPSHOT_URL) return respond(fixtureText('datex-content.xml'));
    if (url === INDEX_URL) return respond(`${next}\n`);
    const m = /\/(\d+)\.xml$/.exec(url);
    if (m) return respond(fixtureText(`datex-inc-${m[1]}.xml`));
    return respond('introuvable', 404);
  });
}

beforeEach(() => { __resetDatexStateForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('analyse DATEX II', () => {
  it('instantané réel (préfixe ns2) : 27 situations, numéro de journal et date de publication', () => {
    const p = content();
    expect(p.situations).toHaveLength(27);
    expect(p.feedNumber).toBe(3566868);
    expect(p.publishedAt).toBe('2026-10-03T14:57:44.192+02:00');
  });
  it('fichier du journal (sans préfixe) : une situation, version 2', () => {
    const p = inc(3566871);
    expect(p.publishedAt).toBe('2026-10-03T15:03:05.610+02:00');
    expect(p.situations.map((s) => [s.id, s.version, s.records[0]?.type, s.records[0]?.end]))
      .toEqual([['261003-001021', 2, 'VehicleObstruction', '2026-10-03T15:02:36.000+02:00']]);
  });
  it('document qui n’est pas du DATEX II : SyntaxError', () => {
    expect(() => parseDatex('<rss><channel/></rss>')).toThrow(SyntaxError);
  });
  it('routes et DIR mises en forme', () => {
    expect([formatRoad('A0063'), formatRoad('N0010'), formatRoad('A0007'), formatRoad('D0909'), formatRoad(null)]).toEqual(['A63', 'N10', 'A7', 'D909', null]);
    expect(dirLabel('Direction interdépartementale des routes/DIR Ouest')).toBe('DIR Ouest');
    expect(dirLabel('AURA_DIRCE')).toBe('DIR Centre-Est');
    expect(dirLabel('Direction interdépartementale des routes')).toBe('DIR non précisée');
    expect(dirLabel('CORG')).toBe('CORG');
  });
  it('classement § 2.1 : incidents, coupures et restrictions, chantiers, information', () => {
    expect(classifyRecord('Accident', 'accident')).toEqual({ kind: 'accident', label: 'Accident' });
    expect(classifyRecord('AbnormalTraffic', 'queuingTraffic')).toEqual({ kind: 'queue', label: 'Bouchon' });
    expect(classifyRecord('VehicleObstruction', 'brokenDownVehicle')).toEqual({ kind: 'obstruction', label: 'Véhicule en panne' });
    expect(classifyRecord('EnvironmentalObstruction', 'rockfalls')).toEqual({ kind: 'obstruction', label: 'Éboulement' });
    expect(classifyRecord('EnvironmentalObstruction', 'flooding')).toEqual({ kind: 'weather', label: 'Inondation' });
    expect(classifyRecord('WeatherRelatedRoadConditions', 'snowOnTheRoad')).toEqual({ kind: 'weather', label: 'Neige sur la chaussée' });
    expect(classifyRecord('RoadOrCarriagewayOrLaneManagement', 'roadClosed')).toEqual({ kind: 'closure', label: 'Route coupée' });
    expect(classifyRecord('RoadOrCarriagewayOrLaneManagement', 'laneClosures', 'carriagewayBlocked')).toEqual({ kind: 'closure', label: 'Chaussée fermée' });
    expect(classifyRecord('RoadOrCarriagewayOrLaneManagement', 'contraflow')).toEqual({ kind: 'lane', label: 'Basculement de circulation' });
    expect(classifyRecord('RoadOrCarriagewayOrLaneManagement', 'singleAlternateLineTraffic')).toEqual({ kind: 'lane', label: 'Alternat' });
    expect(classifyRecord('MaintenanceWorks', 'grassCuttingWork')).toEqual({ kind: 'works', label: 'Fauchage' });
    expect(classifyRecord('ReroutingManagement', 'followLocalDiversion')).toEqual({ kind: 'info', label: 'Déviation locale' });
    expect(classifyRecord('SpeedManagement', 'speedRestrictionInOperation')).toEqual({ kind: 'info', label: 'Limitation de vitesse' });
  });
});

describe('événements en cours et longue durée (T2) sur l’instantané réel, 15 h 10', () => {
  it('comptes : 4 accidents, 1 coupure (A63), 9 incidents, 6 chantiers en cours', () => {
    const r = buildRoadNational(content().situations, NOW);
    expect(r.counts).toEqual({ incidents: 9, accidents: 4, closures: 1, obstructions: 4, weather: 0, works: 6 });
    expect(r.events.slice(0, 6).map((e) => [e.kind, e.road])).toEqual([
      ['accident', 'A55'], ['accident', 'A86'], ['accident', 'N10'], ['accident', 'N10'], ['closure', 'A63'], ['queue', 'A7'],
    ]);
  });
  it('un accident complet : route, commune, sens, DIR, gravité de la situation, message de sécurité', () => {
    const e = buildRoadNational(content().situations, NOW).events.find((x) => x.id === '261003-000848-1');
    expect(e).toEqual({
      id: '261003-000848-1', kind: 'accident', subtype: 'accident', label: 'Accident', road: 'N10', place: 'Vignolles', direction: 'vers Bordeaux',
      dir: 'DIR Atlantique', start: '2026-10-03T13:02:20.516+02:00', end: null, severity: 'medium', safety: true, planned: false, longTerm: false,
      lat: 45.520645, lon: -0.09933381, detail: 'situé 3376 m au nord de Barbezieux nord · Hors voie de circulation',
    });
  });
  it('coupure de l’A63 saisie 25 min avant son début : non planifiée, en cours ; plus de 24 h après : longue durée', () => {
    const at = (t: number) => buildRoadNational(content().situations, t);
    const a63 = at(NOW).events.find((e) => e.id === '260930-001813-102');
    expect(a63).toMatchObject({ kind: 'closure', label: 'Route coupée', road: 'A63', place: 'de Pessac à Cestas', planned: false, longTerm: false });
    const later = AT('2026-10-04T09:25:39+02:00');
    expect(at(later).events.some((e) => e.id === '260930-001813-102')).toBe(false);
    expect(at(later).longTerm.find((e) => e.id === '260930-001813-102')?.longTerm).toBe(true);
  });
  it('longue durée : fermeture planifiée (N57), affaissement de 2024, éboulement du 31/01, chantiers ; jamais dans les événements', () => {
    const r = buildRoadNational(content().situations, NOW);
    const ids = r.longTerm.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['260923-001149-102', '260805-000596-2', '260131-000090-1', '260424-001677-1', '260930-001813-1']));
    expect(r.longTerm.find((e) => e.id === '260923-001149-102')).toMatchObject({ kind: 'closure', planned: true, end: '2026-10-08T05:00:00.000+02:00' });
    expect(r.longTerm.find((e) => e.id === '260131-000090-1')).toMatchObject({ label: 'Éboulement', dir: 'CORG', road: 'N20', place: 'Mérens-les-Vals' });
    expect(r.events.some((e) => e.longTerm || e.kind === 'works')).toBe(false);
  });
  it('écartés : chantier suspendu, chantier à venir, neige terminée en mai, déviations et aires de service (information)', () => {
    const r = buildRoadNational(content().situations, NOW);
    const all = [...r.events, ...r.longTerm].map((e) => e.id);
    for (const id of ['260924-003967-1', '260924-004402-1', '251023-001144-1', '260113-001342-1', '260316-001821-1']) expect(all).not.toContain(id);
  });
  it('incidents par DIR : toutes les DIR présentes, zéros compris, plus chargée d’abord', () => {
    const r = buildRoadNational(content().situations, NOW);
    expect(r.byDir.slice(0, 4)).toEqual([
      { dir: 'DIR Atlantique', incidents: 2 }, { dir: 'DIR Centre-Est', incidents: 2 }, { dir: 'DIR Île-de-France', incidents: 2 }, { dir: 'DIR Ouest', incidents: 2 },
    ]);
    expect(r.byDir.find((d) => d.dir === 'CORG')).toEqual({ dir: 'CORG', incidents: 0 });
  });
});

describe('journal appliqué sur l’instantané', () => {
  it('fin de l’accident de l’A86 (15 h 20) et du bouchon de l’A7 (15 h 32) ; nouvel accident sur l’A3 (15 h 14)', () => {
    const map = mergeSituations(new Map(), content().situations);
    mergeSituations(map, inc(3566894).situations);
    mergeSituations(map, inc(3566901).situations);
    mergeSituations(map, inc(3566915).situations);
    const r = buildRoadNational(map.values(), AT('2026-10-03T15:40:00+02:00'));
    const ids = r.events.map((e) => e.id);
    expect(ids).not.toContain('261003-000963-1');
    expect(ids).not.toContain('261003-001012-1');
    expect(r.events.find((e) => e.id === '261003-001094-1')).toMatchObject({ kind: 'accident', road: 'A3', dir: 'DIR Île-de-France' });
  });
  it('une version plus ancienne ne remplace jamais la plus récente', () => {
    const map = mergeSituations(new Map(), inc(3566901).situations);
    mergeSituations(map, content().situations);
    expect(map.get('261003-000963')?.version).toBe(2);
  });
});

describe('lecture du flux (instantané horaire et journal)', () => {
  it('instantané puis fichiers 3566869 à 3566872 ; date = dernier fichier appliqué', async () => {
    const log = stubDir();
    const r = await loadDirSituations(NOW);
    expect(r.errors).toEqual([]);
    expect(r.publishedAt).toBe('2026-10-03T15:03:35.704+02:00');
    expect(log.urls).toEqual([SNAPSHOT_URL, INDEX_URL, incrementUrl(3566869), incrementUrl(3566870), incrementUrl(3566871), incrementUrl(3566872)]);
    const national = buildRoadNational(r.situations, NOW);
    expect(national.events.some((e) => e.id === '261003-001021-1')).toBe(false);
    expect(national.events.find((e) => e.id === '261003-001061-1')).toMatchObject({ road: 'N356', dir: 'DIR Nord' });
    expect(national.longTerm.some((e) => e.id === '261003-000953-1' && e.kind === 'works')).toBe(true);
  });
  it('deuxième lecture : seul l’index est relu ; instantané relu après 65 min', async () => {
    const log = stubDir();
    await loadDirSituations(NOW);
    await loadDirSituations(NOW + 5 * 60_000);
    expect(log.urls.slice(6)).toEqual([INDEX_URL]);
    await loadDirSituations(NOW + 66 * 60_000);
    expect(log.urls.slice(7, 9)).toEqual([SNAPSHOT_URL, INDEX_URL]);
  });
  it('fichier du journal en HTTP 404 : arrêt à ce fichier, erreur nommée, repris à la lecture suivante', async () => {
    let broken = true;
    const log = stubDir(3566873, (url) => (broken && url === incrementUrl(3566871) ? respond('absent', 404) : null));
    const first = await loadDirSituations(NOW);
    expect(first.errors).toEqual(['DIR, journal : fichier 3566871 : HTTP 404']);
    expect(first.publishedAt).toBe('2026-10-03T15:01:41.973+02:00');
    broken = false;
    const second = await loadDirSituations(NOW + 60_000);
    expect(second.errors).toEqual([]);
    expect(log.urls.slice(-2)).toEqual([incrementUrl(3566871), incrementUrl(3566872)]);
  });
  it('index injoignable : instantané seul, erreur nommée', async () => {
    stubDir(3566873, (url) => (url === INDEX_URL ? respond('erreur', 503) : null));
    const r = await loadDirSituations(NOW);
    expect(r.publishedAt).toBe('2026-10-03T14:57:44.192+02:00');
    expect(r.errors).toEqual(['DIR, journal : HTTP 503']);
  });
  it('instantané en panne sans état connu : erreur levée (rien d’inventé)', async () => {
    stubDir(3566873, (url) => (url === SNAPSHOT_URL ? respond(fixtureText('challenge-captcha.html')) : null));
    await expect(loadDirSituations(NOW)).rejects.toMatchObject({ kind: 'challenge' });
  });
});
