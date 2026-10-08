import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import handler, { ECDC_CDTR_URL, WHO_DON_URL, ecdcTopics, loadInternational, parseEcdcFeed, parseWhoDon } from '../api/_handlers/health/international.js';
import { fakeRes, fixtureJson, fixtureText, respond, stubFetch } from './helpers/health-fixtures.ts';

type News = { id: string; title: string; originalTitle: string; date: string; url: string; summary: string };
type Report = { title: string; date: string; url: string; topics: string[] };
type Body = { who: News[]; ecdc: Report[]; errors: string[] };

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('OMS, Disease Outbreak News (10 derniers, relevé du 03/10/2026)', () => {
  const who = parseWhoDon(fixtureJson('who-don.json')) as News[];
  it('tri par date de publication (DON609 du 25/06 avant DON610 du 24/06)', () => {
    expect(who.map((n) => n.id)).toEqual(['2026-DON618', '2026-DON617', '2026-DON616', '2026-DON615', '2026-DON614',
      '2026-DON613', '2026-DON612', '2026-DON611', '2026-DON609', '2026-DON610']);
  });
  it('titre traduit, titre original, date, lien officiel', () => {
    expect(who[0]).toMatchObject({
      id: '2026-DON618',
      title: 'Maladie à virus Ebola (souche Bundibugyo) : République démocratique du Congo',
      originalTitle: 'Ebola disease caused by Bundibugyo virus - Democratic Republic of the Congo',
      date: '2026-09-25T15:16:26Z',
      url: 'https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON618',
    });
  });
  it('hantavirus : l’épisode est le message DON611 du 02/07/2026 (12 cas confirmés, 1 probable, 3 décès)', () => {
    const don611 = who.find((n) => n.id === '2026-DON611');
    expect(don611?.title).toBe('Foyer d’hantavirus lié à une croisière : plusieurs pays');
    expect(don611?.date).toBe('2026-07-02T18:00:00Z');
    expect(don611?.summary.startsWith('This is the fifth Disease Outbreak News posting on the Andes hantavirus')).toBe(true);
    expect(don611?.summary.length).toBeLessThanOrEqual(400);
  });
});

describe('ECDC, rapport hebdomadaire des menaces', () => {
  const ecdc = parseEcdcFeed(fixtureText('ecdc-cdtr.xml')) as Report[];
  it('trois derniers rapports : semaines 40, 39, 38', () => {
    expect(ecdc.map((r) => [r.title, r.date])).toEqual([
      ['Rapport hebdomadaire des menaces sanitaires, semaine 40', '2026-10-02T16:00:46.000Z'],
      ['Rapport hebdomadaire des menaces sanitaires, semaine 39', '2026-09-25T12:26:04.000Z'],
      ['Rapport hebdomadaire des menaces sanitaires, semaine 38', '2026-09-18T13:52:50.000Z'],
    ]);
    expect(ecdc[0].url).toBe('https://www.ecdc.europa.eu/en/publications-data/communicable-disease-threats-report-26-september-2-october-week-40');
  });
  it('sujets de la semaine 40 traduits', () => {
    expect(ecdc[0].topics).toEqual(['Fièvre hémorragique de Crimée-Congo', 'Chikungunya', 'Choléra', 'COVID-19', 'Dengue', 'Ebola',
      'Grippe aviaire', 'Grippe saisonnière', 'MERS', 'Infection à VRS', 'Vibrioses', 'Infection à virus du Nil occidental']);
  });
  it('sujets inconnus laissés en anglais ; « , and » final reconnu', () => {
    expect(ecdc[2].topics).toContain('expert deployments');
    expect(ecdc[2].topics.slice(0, 5)).toEqual(['Ebola', 'Paludisme', 'Botulisme', 'Grippe aviaire A(H9N2)', 'Grippe A(H5)']);
    expect(ecdcTopics('<p>No list here</p>')).toEqual([]);
  });
});

describe('/api/health/international', () => {
  it('deux sources, cache 1 h', async () => {
    const { urls } = stubFetch((url) => respond(url.startsWith('https://www.who.int') ? fixtureText('who-don.json') : fixtureText('ecdc-cdtr.xml')));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(urls.sort()).toEqual([ECDC_CDTR_URL, WHO_DON_URL].sort());
    expect(new URL(WHO_DON_URL).searchParams.get('$orderby')).toBe('PublicationDateAndTime desc');
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=3600, stale-while-revalidate=21600');
    const body = res.body as Body;
    expect([body.who.length, body.ecdc.length, body.errors]).toEqual([10, 3, []]);
  });
  it('OMS en HTTP 500, ECDC servi : erreur nommée, ECDC gardé', async () => {
    stubFetch((url) => (url.startsWith('https://www.who.int') ? respond('erreur', 500) : respond(fixtureText('ecdc-cdtr.xml'))));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as Body).errors).toEqual(['OMS, Disease Outbreak News : HTTP 500']);
    expect((res.body as Body).ecdc).toHaveLength(3);
  });
  it('analyse avant mise en cache : un flux OMS vide n’est jamais figé, la dernière liste lue est gardée', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-10-03T08:00:00Z');
    vi.setSystemTime(t0);
    const route = (who: string) => stubFetch((url) => respond(url.startsWith('https://www.who.int') ? who : fixtureText('ecdc-cdtr.xml')));
    route('{"value":[]}');
    expect((await loadInternational()).errors).toEqual(['OMS, Disease Outbreak News : aucun message']);
    vi.setSystemTime(t0 + 6 * 60_000);
    route(fixtureText('who-don.json'));
    expect((await loadInternational()).who).toHaveLength(10);
    vi.setSystemTime(t0 + 2 * 3600_000);
    route('{"value":[]}');
    const later = await loadInternational();
    expect([later.who.length, later.errors]).toEqual([10, []]);
    vi.useRealTimers();
  });
  it('OMS sans message et ECDC en page HTML : 502 non mis en cache', async () => {
    stubFetch((url) => (url.startsWith('https://www.who.int') ? respond({ value: [] }) : respond('<!DOCTYPE html><html></html>')));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(502);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect((res.body as Body).errors).toEqual([
      'ECDC, rapport hebdomadaire des menaces : page HTML reçue au lieu de données',
      'OMS, Disease Outbreak News : aucun message',
    ]);
  });
});
