// tests/ransomware-live.test.ts : revendications de rançongiciels en France (spec 2026-10-04 souveraineté § 2.3, V3 ; contrats § 2.4,
// arbitrage 15) sur l'extrait anonymisé de victims.json du 04/10/2026 (87 revendications françaises sur 120 jours et 30 hors de France ;
// noms, sites et liens remplacés). Aucun nom ni site de victime ne sort du résumé, ni de la réponse, ni du stockage clé-valeur.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests, kvGetJson } from '../api/_lib/kv-history.js';
import {
  RANSOM_FLOOR_MS, RANSOM_INTERVAL_MS, RANSOM_KEY, RANSOM_MAX_BYTES, VICTIMS_URL, __resetRansomwareForTests, ensureRansomwareFresh, summarizeVictims,
} from '../api/_lib/ransomware-live.js';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';
import { respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const TEXT = readFileSync(new URL('./fixtures/sovereignty/ransomware-live-victims-reduit.json', import.meta.url), 'utf8');
type Row = { post_title: string; group_name: string; discovered: string; published: string; website: string; country: string; activity: string };
const ROWS = (): Row[] => JSON.parse(TEXT) as Row[];
const NOW = Date.parse('2026-10-04T16:48:30+02:00');
const CHECKED = '2026-10-04T14:48:30.000Z';
const LAST_MODIFIED = 'Sun, 04 Oct 2026 14:30:09 GMT';

beforeEach(() => {
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  __resetRansomwareForTests();
});
afterEach(() => { __setKvClientForTests(null); vi.unstubAllGlobals(); });

describe('summarizeVictims (arbitrage 15 : date `discovered`, semaine de 7 × 24 h finissant au relevé)', () => {
  const s = summarizeVictims(ROWS(), CHECKED);
  it('7 revendications cette semaine, 70 sur les 90 jours précédents : moyenne 5,44, rapport 1,29 (sous 1,5)', () => {
    expect([s.weekCount, s.baselineWeekly, s.ratio]).toEqual([7, 5.44, 1.29]);
  });
  it('12 semaines, plus ancienne d’abord', () => {
    expect(s.weeks.map((w) => w.count)).toEqual([5, 4, 6, 10, 2, 9, 1, 2, 4, 7, 6, 7]);
    expect([s.weeks[0].weekStart, s.weeks[11].weekStart]).toEqual(['2026-07-12T14:48:30.000Z', '2026-09-27T14:48:30.000Z']);
  });
  it('30 derniers jours : 25, contre 20,67 en moyenne sur 30 jours des 90 jours précédents ; secteurs et groupes tels que publiés', () => {
    expect([s.last30, s.baseline30]).toEqual([25, 20.67]);
    expect(s.sectors30.slice(0, 3)).toEqual([{ label: 'Other', count: 5 }, { label: 'Agriculture and Food Production', count: 3 }, { label: 'Healthcare', count: 3 }]);
    expect(s.groups30.slice(0, 4)).toEqual([{ label: 'ZaWoo', count: 6 }, { label: 'krybit', count: 4 }, { label: 'qilin', count: 4 }, { label: 'Panzer', count: 3 }]);
    expect(s.sectors30.reduce((n, x) => n + x.count, 0)).toBe(25);
  });
  it('aucun nom, site ni lien de victime dans le résumé', () => {
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/victime-|\.example|post_url|onion/);
  });
  it('date `published` ignorée : seule `discovered` compte', () => {
    const shifted = ROWS().map((r) => ({ ...r, published: '2020-01-01T00:00:00+00:00' }));
    expect(summarizeVictims(shifted, CHECKED).weekCount).toBe(7);
  });
  it('sans historique (aucune ligne avant la semaine) : moyenne et rapport null, jamais un rapport inventé', () => {
    const recent = ROWS().filter((r) => Date.parse(r.discovered) > Date.parse(CHECKED) - 7 * 86_400_000);
    const r = summarizeVictims(recent, CHECKED);
    expect([r.weekCount, r.baselineWeekly, r.ratio, r.baseline30]).toEqual([7, null, null, null]);
  });
  it('moyenne nulle : rapport null', () => {
    const old = { ...ROWS()[0], country: 'BE', discovered: '2026-01-01T00:00:00+00:00' };
    const week = ROWS().filter((r) => Date.parse(r.discovered) > Date.parse(CHECKED) - 7 * 86_400_000);
    expect(summarizeVictims([...week, old], CHECKED)).toMatchObject({ baselineWeekly: 0, ratio: null });
  });
});

describe('ensureRansomwareFresh', () => {
  it('lecture : résumé daté (last-modified, relevé), User-Agent FranceMonitor ; stockage clé-valeur sans nom de victime', async () => {
    const log = stubFetch((url) => (url === VICTIMS_URL ? respond(TEXT, 200, { 'Last-Modified': LAST_MODIFIED }) : respond('introuvable', 404)));
    const { summary, errors } = await ensureRansomwareFresh(NOW);
    expect([summary?.lastModified, summary?.checkedAt, summary?.ratio, errors]).toEqual(['2026-10-04T14:30:09.000Z', CHECKED, 1.29, []]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
    expect(sentHeader(log.inits[0], 'If-Modified-Since')).toBeUndefined();
    expect(JSON.stringify(await kvGetJson(RANSOM_KEY, NOW))).not.toMatch(/victime-|\.example/);
  });
  it('relu toutes les 6 h seulement ; If-Modified-Since ; 304 = inchangé, jamais une panne', async () => {
    let calls = 0;
    const log = stubFetch(() => { calls += 1; return calls === 1 ? respond(TEXT, 200, { 'Last-Modified': LAST_MODIFIED }) : respond('', 304); });
    await ensureRansomwareFresh(NOW);
    await ensureRansomwareFresh(NOW + 3_600_000);
    expect(log.urls).toHaveLength(1);
    const later = await ensureRansomwareFresh(NOW + RANSOM_INTERVAL_MS);
    expect(sentHeader(log.inits[1], 'If-Modified-Since')).toBe(LAST_MODIFIED);
    expect([later.errors, later.summary?.checkedAt, later.summary?.ratio, later.summary?.weeks[11].weekStart]).toEqual([
      [], '2026-10-04T20:48:30.000Z', 1.29, '2026-09-27T14:48:30.000Z',
    ]);
  });
  it('panne : dernier résumé gardé, panne nommée ; nouvel essai 30 min plus tard, pas avant', async () => {
    let calls = 0;
    const log = stubFetch(() => { calls += 1; return calls === 1 ? respond(TEXT, 200, { 'Last-Modified': LAST_MODIFIED }) : respond('indisponible', 503); });
    await ensureRansomwareFresh(NOW);
    const failed = await ensureRansomwareFresh(NOW + RANSOM_INTERVAL_MS);
    expect([failed.errors, failed.summary?.checkedAt]).toEqual([['Ransomware.live : HTTP 503'], CHECKED]);
    await ensureRansomwareFresh(NOW + RANSOM_INTERVAL_MS + 10 * 60_000);
    expect(log.urls).toHaveLength(2);
    await ensureRansomwareFresh(NOW + RANSOM_INTERVAL_MS + RANSOM_FLOOR_MS);
    expect(log.urls).toHaveLength(3);
  });
  it('fichier au-delà de 64 Mo (revue finale M6) : panne nommée, résumé précédent gardé, jamais lu en entier', async () => {
    expect(RANSOM_MAX_BYTES).toBe(64 * 1024 * 1024);
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls === 1 ? respond(TEXT, 200, { 'Last-Modified': LAST_MODIFIED }) : respond('[]', 200, { 'Content-Length': String(RANSOM_MAX_BYTES + 1) });
    });
    await ensureRansomwareFresh(NOW);
    const big = await ensureRansomwareFresh(NOW + RANSOM_INTERVAL_MS);
    expect([big.errors, big.summary?.checkedAt, big.summary?.ratio]).toEqual([['Ransomware.live : réponse trop volumineuse (plus de 64\u00a0Mo)'], CHECKED, 1.29]);
  });
  it('jamais lu et en panne : résumé null, panne nommée ; page HTML nommée', async () => {
    stubFetch(() => respond('<!DOCTYPE html><html><body>maintenance</body></html>'));
    expect(await ensureRansomwareFresh(NOW)).toEqual({ summary: null, errors: ['Ransomware.live : page HTML reçue au lieu de données'] });
  });
});
