import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import handler, { DGS_URGENT_OFFICIAL_URL, PEPS_URL, loadMinistryMessages, parseMinistryMessages } from '../api/_handlers/health/dgs-messages.js';
import { fakeRes, fixtureText, respond, stubFetch } from './helpers/health-fixtures.ts';

const NOW = Date.parse('2026-10-03T08:00:00Z');
type Message = { kind: string; number: string; date: string; title: string; url: string | null; reply: boolean };
type Body = { messages: Message[]; sourceUrl: string; officialUrl: string; errors: string[] };

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('messages DGS-Urgent et MARS relayés par PEPS (page du 02/10/2026)', () => {
  const messages = parseMinistryMessages(fixtureText('peps-actualites.html'), NOW) as Message[];
  it('18 messages distincts (doublons de rubriques retirés), du plus récent au plus ancien', () => {
    expect(messages.map((m) => `${m.kind} ${m.number} ${m.date}`)).toEqual([
      'DGS-Urgent 2026-12 2026-09-28', 'MARS 2026-14 2026-09-22', 'DGS-Urgent 2026-11 2026-09-18', 'DGS-Urgent 2026-10 2026-08-10',
      'MARS 2026-13 2026-08-10', 'DGS-Urgent 2026-09 2026-06-24', 'DGS-Urgent 2026-08 2026-06-18', 'MARS 2026-09 2026-06-18',
      'DGS-Urgent 2026-06 2026-05-29', 'MARS 2026-08 2026-05-29', 'DGS-Urgent 2026-05 2026-05-22', 'DGS-Urgent 2026-04 2026-05-11',
      'MARS 2026-06 2026-05-11', 'DGS-Urgent 2026-03 2026-03-23', 'MARS 2026-03 2026-02-11', 'MARS 2026-02 2026-02-06',
      'DGS-Urgent 2026-02 2026-02-04', 'DGS-Urgent 2026-01 2026-01-23',
    ]);
  });
  it('version REPLY : remplace l’originale du 22/09, numéro normalisé (2026_12 → 2026-12), lien absolu', () => {
    expect(messages[0]).toEqual({
      kind: 'DGS-Urgent', number: '2026-12', date: '2026-09-28',
      title: 'Campagne de vaccination 2026-2027 contre la grippe saisonnière et le covid-19',
      url: 'https://sante.gouv.fr/IMG/pdf/dgs-urgent_no2026_12_campagne_grippe_covid-19_2026-2027.pdf',
      reply: true,
    });
  });
  it('lien MARS relatif résolu sur https://peps.sante.gouv.fr/actu/ ; erratum marqué comme version révisée', () => {
    expect(messages[1]).toMatchObject({ kind: 'MARS', number: '2026-14', url: 'https://peps.sante.gouv.fr/actu/2026/26_mars_2026-14.pdf', reply: false });
    expect(messages.find((m) => m.kind === 'MARS' && m.number === '2026-02')).toMatchObject({ reply: true, url: 'https://peps.sante.gouv.fr/actu/2026/26_mars_2026-02_erratum.pdf' });
  });
  it('séparateur « - » après la date ; MINSANTE ignorés', () => {
    expect(messages.find((m) => m.number === '2026-02' && m.kind === 'DGS-Urgent')?.title)
      .toBe('Chikungunya en Guyane : Détection de cas autochtones et appel à une vigilance renforcée');
    expect(messages.some((m) => /MINSANTE/i.test(m.title))).toBe(false);
  });
  it('douze derniers mois seulement', () => {
    const old = '<a href="2025/x.pdf">MARS n°2025_09 du 02/10/2025 : Ancien message</a><a href="2025/y.pdf">MARS n°2025_10 du 04/10/2025 : Récent</a>';
    expect((parseMinistryMessages(old, NOW) as Message[]).map((m) => m.number)).toEqual(['2025-10']);
  });
});

describe('/api/health/dgs-messages', () => {
  it('lit PEPS et jamais le site du ministère ; mention des sources ; cache 6 h', async () => {
    const { urls } = stubFetch(() => respond(fixtureText('peps-actualites.html')));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(urls).toEqual([PEPS_URL]);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=21600, stale-while-revalidate=86400');
    const body = res.body as Body;
    expect([body.messages.length, body.sourceUrl, body.officialUrl, body.errors]).toEqual([18, PEPS_URL, DGS_URGENT_OFFICIAL_URL, []]);
  });
  it('page de captcha : 502 non mis en cache, erreur nommée, aucune liste', async () => {
    stubFetch(() => respond(fixtureText('dgs-captcha.html')));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(502);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toMatchObject({ messages: [], errors: ['PEPS, messages DGS-Urgent et MARS : page de contrôle anti-robot'] });
  });
  it('analyse avant mise en cache : une page sans message reconnu n’est jamais figée ; la dernière liste lue est gardée', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const EMPTY = '<!DOCTYPE html><html><body><h2>Octobre</h2></body></html>';
    stubFetch(() => respond(EMPTY));
    expect((await loadMinistryMessages(NOW) as Body).messages).toHaveLength(0);
    vi.setSystemTime(NOW + 6 * 60_000);
    stubFetch(() => respond(fixtureText('peps-actualites.html')));
    expect((await loadMinistryMessages(NOW + 6 * 60_000) as Body).messages).toHaveLength(18);
    vi.setSystemTime(NOW + 7 * 3600_000);
    stubFetch(() => respond(EMPTY));
    const later = await loadMinistryMessages(NOW + 7 * 3600_000) as Body;
    expect([later.messages.length, later.errors]).toEqual([18, []]);
    vi.useRealTimers();
  });
  it('page lue mais aucun message reconnu (format changé) : erreur, pas de liste vide silencieuse', async () => {
    stubFetch(() => respond('<!DOCTYPE html><html><body><h2>Octobre</h2></body></html>'));
    const body = await loadMinistryMessages(NOW) as Body;
    expect(body.errors).toEqual(['PEPS, messages DGS-Urgent et MARS : aucun message DGS-Urgent ni MARS reconnu']);
  });
});
