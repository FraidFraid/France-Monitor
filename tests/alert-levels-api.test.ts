import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import handler, {
  buildAlertLevels, bulletinSummary, bulletinTerritory, loadAlertLevels, parseBulletinCards,
} from '../api/_handlers/health/alert-levels.js';
import { type FakeResponse, fakeRes, fixtureJson, fixtureText, maxLimitSent, respond, stubFetch } from './helpers/health-fixtures.ts';

const NOW = Date.parse('2026-10-03T08:00:00Z');
type Level = { region: string; regionName: string; pathology: string; phase: number; week: string; start: string };
type Bulletin = { territory: string; title: string; date: string; url: string; summary: string };
type Body = { levels: Level[]; bulletins: Bulletin[]; latestWeek: { id: string; start: string; end: string } | null; ignoredRegionCodes: string[]; errors: string[] };

function stubSources(override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    if (url.includes('odisse.santepubliquefrance.fr')) return respond(fixtureText('odisse-alertes.json'));
    if (url.endsWith('/regions-et-territoires/ocean-indien')) return respond(fixtureText('spf-ocean-indien.html'));
    if (url.endsWith('/regions-et-territoires/guyane')) return respond(fixtureText('spf-guyane.html'));
    if (url.endsWith('/regions-et-territoires/antilles')) return respond(fixtureText('spf-antilles.html'));
    if (url.includes('/bulletin-regional/')) return respond(fixtureText('spf-bulletin-reunion.html'));
    return respond('introuvable', 404);
  });
}

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('niveaux Odissé (relevé du 03/10/2026)', () => {
  const built = buildAlertLevels(fixtureJson<Array<Record<string, unknown>>>('odisse-alertes.json'));
  it('dernière ligne par région et pathologie ; 07 et 08 sans libellé écartés et comptés', () => {
    expect(built.levels).toHaveLength(36);
    expect(built.ignoredRegionCodes).toEqual(['07', '08']);
    expect(built.latestWeek).toEqual({ id: '2026-S39', start: '2026-09-21', end: '2026-09-27' });
  });
  it('grippe en pré-épidémie à Mayotte (niveau 2 montré), post-épidémie de bronchiolite, épidémie de grippe en Martinique en avril', () => {
    const find = (region: string, pathology: string) => built.levels.find((l) => l.region === region && l.pathology === pathology);
    expect(find('06', 'grippe')).toEqual({ region: '06', regionName: 'Mayotte', pathology: 'grippe', phase: 2, week: '2026-S39', start: '2026-09-21' });
    expect(find('06', 'bronchiolite')).toMatchObject({ phase: 4, week: '2026-S16', start: '2026-04-13' });
    expect(find('02', 'grippe')).toMatchObject({ phase: 3, start: '2026-04-06' });
    expect(find('11', 'grippe')).toMatchObject({ regionName: 'Île-de-France', phase: 1, week: '2026-S15' });
  });
  it('lignes illisibles ignorées : thème inconnu, valeur hors 1 à 4, date manquante', () => {
    const r = buildAlertLevels([
      { theme: 'Covid', reg: '11', date_lib: '2026-S39', date: '2026-09-21', valeur: 3 },
      { theme: 'Grippe', reg: '11', date_lib: '2026-S39', date: '2026-09-21', valeur: 5 },
      { theme: 'Grippe', reg: '11', date_lib: '2026-S39', valeur: 2 },
    ]);
    expect(r).toEqual({ levels: [], ignoredRegionCodes: [], latestWeek: null });
  });
});

describe('bulletins régionaux Santé publique France', () => {
  it('cartes de la page Océan Indien : titre, date de publication, lien absolu (index.php retiré)', () => {
    const cards = parseBulletinCards(fixtureText('spf-ocean-indien.html'));
    expect(cards[0]).toEqual({
      title: 'Surveillance sanitaire à La Réunion. Bulletin du 2 octobre 2026.',
      date: '2026-10-02',
      url: 'https://www.santepubliquefrance.fr/regions-et-territoires/ocean-indien/bulletin-regional/surveillance-sanitaire-a-la-reunion-bulletin-du-2-octobre-2026',
    });
    expect(cards.every((c) => !c.url.includes('index.php') && !c.url.includes('facebook'))).toBe(true);
  });
  it('territoire lu dans le titre', () => {
    expect(bulletinTerritory('Surveillance sanitaire à La Réunion. Bulletin du 2 octobre 2026.', 'Océan Indien')).toBe('La Réunion');
    expect(bulletinTerritory('Dengue aux Antilles. Bulletin du 10 septembre 2026.', 'Antilles')).toBe('Antilles');
    expect(bulletinTerritory('Dengue en Guadeloupe et en Martinique', 'Antilles')).toBe('Antilles');
    expect(bulletinTerritory('Bulletin de surveillance', 'Océan Indien')).toBe('Océan Indien');
  });
  it('points clés du bulletin réel du 2 octobre, coupés à 500 caractères sur un mot', () => {
    const summary = bulletinSummary(fixtureText('spf-bulletin-reunion.html'));
    expect(summary.startsWith('Arboviroses : Cas sporadiques. · Bronchiolite chez les moins de 1 an : Progression du nombre de passages aux urgences sans impact sanitaire · Gastro-entérite : L’activité aux urgences demeure élevée depuis trois semaines · ')).toBe(true);
    expect(summary).toContain('Infections respiratoires aiguës : L’épidémie de grippe reste active avec un virus A(H1N1) pdm09 prédominant');
    expect(summary.endsWith('Variole B (Mpox) : 24 cas importés en provenance…')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(500);
    expect(bulletinSummary('<h1>Sans points clés</h1>')).toBe('');
  });
});

describe('/api/health/alert-levels', () => {
  it('niveaux et bulletins des 45 derniers jours (bilans de santé mentale et anciens bilans écartés), sans limit', async () => {
    const { urls } = stubSources();
    const body = await loadAlertLevels(NOW) as Body;
    expect(body.errors).toEqual([]);
    expect(body.levels).toHaveLength(36);
    expect(body.bulletins.map((b) => [b.date, b.territory])).toEqual([
      ['2026-10-02', 'Guyane'], ['2026-10-02', 'La Réunion'], ['2026-09-25', 'La Réunion'], ['2026-09-25', 'Guyane'], ['2026-09-11', 'Antilles'],
    ]);
    expect(body.bulletins[1].title).toBe('Surveillance sanitaire à La Réunion. Bulletin du 2 octobre 2026.');
    expect(body.bulletins[1].summary.startsWith('Arboviroses : Cas sporadiques.')).toBe(true);
    expect(maxLimitSent(urls)).toBe(0);
    const odisse = new URL(urls.find((u) => u.includes('odisse')) ?? '');
    expect(odisse.pathname.endsWith('/ma_region_epidemies_hivernales_alertes/exports/json')).toBe(true);
    expect(odisse.searchParams.get('where')).toBe("date>=date'2025-08-29'");
  });
  it('Odissé en HTTP 400 : erreur nommée, bulletins gardés, réponse 200', async () => {
    stubSources((url) => (url.includes('odisse') ? respond(fixtureText('odisse-400.json'), 400) : null));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    const body = res.body as Body;
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=3600, stale-while-revalidate=21600');
    expect(body.errors).toEqual(['Odissé, niveaux d’alerte : HTTP 400']);
    expect(body.levels).toEqual([]);
    expect(body.bulletins).toHaveLength(5);
  });
  it('page Antilles en captcha et bulletin en HTTP 500 : erreurs nommées, le bulletin reste sans résumé', async () => {
    stubSources((url) => {
      if (url.endsWith('/antilles')) return respond(fixtureText('dgs-captcha.html'));
      if (url.includes('surveillance-sanitaire-en-guyane-bulletin-du-24-septembre-2026')) return respond('erreur', 500);
      return null;
    });
    const body = await loadAlertLevels(NOW) as Body;
    expect(body.errors).toEqual([
      'Santé publique France, bulletin du 25/09 (Guyane) : HTTP 500',
      'Santé publique France, page Antilles : page de contrôle anti-robot',
    ]);
    expect(body.bulletins.map((b) => b.territory)).toEqual(['Guyane', 'La Réunion', 'La Réunion', 'Guyane']);
    expect(body.bulletins[3]).toMatchObject({ title: 'Surveillance sanitaire en Guyane. Bulletin du 24 septembre 2026.', summary: '' });
  });
  it('tout en échec : 502 non mis en cache', async () => {
    stubSources(() => respond('erreur', 500));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(502);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect((res.body as Body).errors).toHaveLength(4);
  });
  it('export Odissé vide : erreur « aucune ligne », jamais une liste vide silencieuse', async () => {
    stubSources((url) => (url.includes('odisse') ? respond([]) : null));
    const body = await loadAlertLevels(NOW) as Body;
    expect(body.errors).toEqual(['Odissé, niveaux d’alerte : aucune ligne']);
  });
});
