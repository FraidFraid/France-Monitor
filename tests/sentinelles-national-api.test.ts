import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import handler, { SENTIWEB_RSS_URL, isoWeekMonday, parseSentinellesRss, parseSegment } from '../api/_handlers/health/sentinelles-national.js';
import { fakeRes, fixtureText, respond, stubFetch } from './helpers/health-fixtures.ts';

const RSS = fixtureText('sentiweb-rss.xml');
type Indicator = { key: string; label: string; parent: string | null; rate: number | null; ciLow: number | null; ciHigh: number | null; previous: number | null; trend: string | null; activity: string | null };
type Body = { week: { id: string; start: string; end: string } | null; provisional: boolean; indicators: Indicator[]; topRegions: Array<{ indicator: string; region: string; rate: number; ciLow: number | null; ciHigh: number | null }>; bulletinUrl: string | null; errors: string[] };

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('flux RSS Sentinelles réel (semaine 202639)', () => {
  const parsed = parseSentinellesRss(RSS) as Omit<Body, 'errors'>;
  const ind = (key: string) => parsed.indicators.find((i) => i.key === key);
  it('semaine ISO 2026-S39 (21-27 sept.), provisoire, lien du bulletin PDF', () => {
    expect(parsed.week).toEqual({ id: '2026-S39', start: '2026-09-21', end: '2026-09-27' });
    expect(parsed.provisional).toBe(true);
    expect(parsed.bulletinUrl).toBe('https://www.sentiweb.fr/6917.pdf');
    expect(isoWeekMonday(2026, 1)).toBe('2025-12-29');
  });
  it('IRA : 151 [144 ; 158], semaine précédente consolidée 103, en augmentation, activité faible', () => {
    expect(ind('ira')).toEqual({ key: 'ira', label: 'Infections respiratoires aiguës', parent: null,
      rate: 151, ciLow: 144, ciHigh: 158, previous: 103, trend: 'en augmentation', activity: 'faible' });
  });
  it('sous-indicateurs des IRA : COVID-19 13, grippe 4, VRS 0 (et non n.d.), bronchiolite 135', () => {
    expect(ind('covid')).toMatchObject({ parent: 'ira', rate: 13, ciLow: 9, ciHigh: 17, previous: 9, trend: 'en légère augmentation', activity: 'faible' });
    expect(ind('grippe')).toMatchObject({ rate: 4, ciLow: 1, ciHigh: 7, previous: 5, trend: 'stable', activity: 'faible' });
    expect(ind('vrs')).toMatchObject({ rate: 0, ciLow: 0, ciHigh: 6, previous: 0, trend: 'stable', activity: 'faible' });
    expect(ind('bronchiolite')).toMatchObject({ label: 'Bronchiolite (moins d’un an)', rate: 135, ciLow: 45, ciHigh: 225, previous: 236, trend: 'stable' });
  });
  it('diarrhée aiguë 50 et varicelle 4 ; ordre des sept indicateurs', () => {
    expect(ind('diarrhee')).toMatchObject({ rate: 50, ciLow: 46, ciHigh: 55, previous: 45, trend: 'stable', activity: 'faible' });
    expect(ind('varicelle')).toMatchObject({ rate: 4, ciLow: 3, ciHigh: 5, previous: 2, trend: 'en légère augmentation', activity: 'faible' });
    expect(parsed.indicators.map((i) => i.key)).toEqual(['ira', 'covid', 'grippe', 'vrs', 'bronchiolite', 'diarrhee', 'varicelle']);
  });
  it('régions les plus touchées citées dans le texte', () => {
    expect(parsed.topRegions).toEqual([
      { indicator: 'ira', region: 'Bourgogne-Franche-Comté', rate: 310, ciLow: 259, ciHigh: 361 },
      { indicator: 'ira', region: 'Bretagne', rate: 254, ciLow: 212, ciHigh: 296 },
      { indicator: 'ira', region: 'Hauts-de-France', rate: 186, ciLow: 159, ciHigh: 214 },
      { indicator: 'diarrhee', region: 'Corse', rate: 95, ciLow: 36, ciHigh: 154 },
      { indicator: 'diarrhee', region: 'Grand Est', rate: 66, ciLow: 49, ciHigh: 83 },
      { indicator: 'diarrhee', region: 'Hauts-de-France', rate: 63, ciLow: 48, ciHigh: 79 },
      { indicator: 'diarrhee', region: 'Provence-Alpes-Côte d\'Azur', rate: 63, ciLow: 45, ciHigh: 81 },
      { indicator: 'varicelle', region: 'Normandie', rate: 12, ciLow: 0, ciHigh: 25 },
      { indicator: 'varicelle', region: 'Auvergne-Rhône-Alpes', rate: 6, ciLow: 2, ciHigh: 10 },
    ]);
  });
  it('niveaux en saison : « modérée », « très forte » ; libellé inconnu gardé brut et journalisé', () => {
    expect(parseSegment('se situe à un niveau d\'activité modéré').activity).toBe('modérée');
    expect(parseSegment('se situe à un très fort niveau d\'activité').activity).toBe('très forte');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const odd = parseSentinellesRss(RSS.replace('Activité faible en médecine générale]]', 'Activité inhabituelle en médecine générale]]')) as Omit<Body, 'errors'>;
    expect(odd.indicators[0].activity).toBe('inhabituelle');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('inhabituelle'));
  });
});

describe('/api/health/sentinelles-national', () => {
  it('lit le flux officiel /rss/fr/fr (et non /html), cache 6 h', async () => {
    const { urls } = stubFetch(() => respond(RSS));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(urls).toEqual([SENTIWEB_RSS_URL]);
    expect(SENTIWEB_RSS_URL).toBe('https://www.sentiweb.fr/rss/fr/fr');
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=21600, stale-while-revalidate=86400');
    expect((res.body as Body).errors).toEqual([]);
  });
  it('HTTP 429 (IP bloquée par Sentiweb) : 502 non mis en cache, erreur nommée, aucune valeur', async () => {
    stubFetch(() => respond("IP '88.178.86.96' have been blocked after several requests exceeding the rate limit", 429));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(502);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toEqual({ week: null, provisional: false, indicators: [], topRegions: [], bulletinUrl: null, errors: ['Sentinelles, flux RSS : HTTP 429'] });
  });
  it('format changé : indicateur attendu illisible alors que les IRA se lisent, erreur nommée (valeurs lues gardées)', async () => {
    const noVaricelle = RSS.replace(/<item>(?:(?!<\/item>)[\s\S])*Varicelle(?:(?!<\/item>)[\s\S])*<\/item>/, '');
    stubFetch(() => respond(noVaricelle.replace('<strong>Grippe</strong>', '<strong>Influenza</strong>')));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    const body = res.body as Body;
    expect(res.statusCode).toBe(200);
    expect(body.indicators.find((i) => i.key === 'ira')?.rate).toBe(151);
    expect(body.errors).toEqual(['Sentinelles : indicateurs introuvables dans le flux (Grippe, Varicelle)']);
  });
  it('analyse avant mise en cache : un flux sans article reconnu n’efface pas la dernière valeur lue, et n’est jamais figé', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-10-03T08:00:00Z');
    vi.setSystemTime(t0);
    const EMPTY = '<?xml version="1.0"?><rss><channel></channel></rss>';
    stubFetch(() => respond(EMPTY));
    const r1 = fakeRes();
    await handler({ method: 'GET' }, r1);
    expect(r1.statusCode).toBe(502);
    vi.setSystemTime(t0 + 6 * 60_000);
    stubFetch(() => respond(RSS));
    const r2 = fakeRes();
    await handler({ method: 'GET' }, r2);
    expect([r2.statusCode, (r2.body as Body).week?.id]).toEqual([200, '2026-S39']);
    vi.setSystemTime(t0 + 13 * 3600_000);
    stubFetch(() => respond(EMPTY));
    const r3 = fakeRes();
    await handler({ method: 'GET' }, r3);
    expect([r3.statusCode, (r3.body as Body).week?.id, (r3.body as Body).indicators[0]?.rate]).toEqual([200, '2026-S39', 151]);
    vi.useRealTimers();
  });
  it('page HTML (ancienne URL /html) ou flux sans article reconnu : erreur', async () => {
    stubFetch(() => respond('<!DOCTYPE html><html><body>Sentinelles</body></html>'));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect((res.body as Body).errors).toEqual(['Sentinelles, flux RSS : page HTML reçue au lieu de données']);
    __resetSwrCacheForTests();
    stubFetch(() => respond('<?xml version="1.0"?><rss><channel></channel></rss>'));
    const res2 = fakeRes();
    await handler({ method: 'GET' }, res2);
    expect((res2.body as Body).errors).toEqual(['Sentinelles, flux RSS : aucun article Sentinelles reconnu']);
  });
});
