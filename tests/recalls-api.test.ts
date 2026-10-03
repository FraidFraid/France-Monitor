import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { ECONOMIE_BASE } from '../api/_lib/odisse.js';
import handler, { buildRecalls, classifyRecallRisks, loadRecalls, parisDay } from '../api/_handlers/health/recalls.js';
import { fakeRes, fixtureJson, fixtureText, maxLimitSent, respond, stubFetch } from './helpers/health-fixtures.ts';

const NOW = Date.parse('2026-10-03T08:00:00Z');
type Recall = { id: string; date: string; label: string; brand: string; category: string; risks: string[]; riskText: string; zone: string; url: string };
type Body = { since: string; total: number; healthRisk: number; byRisk: Record<string, number>; byDay: Array<{ day: string; total: number; healthRisk: number }>; latest: Recall[]; errors: string[] };
const ROWS = fixtureJson<{ results: Array<Record<string, unknown>> }>('rappelconso-14j.json').results;

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('classement des risques', () => {
  it('sous-chaînes de risques_encourus (valeurs réelles)', () => {
    expect(classifyRecallRisks('listeria monocytogenes (agent responsable de la listériose)')).toEqual(['listeria']);
    expect(classifyRecallRisks('salmonella spp (agent responsable de la salmonellose)')).toEqual(['salmonelle']);
    expect(classifyRecallRisks('escherichia coli shiga toxinogène (stec)')).toEqual(['stec']);
    expect(classifyRecallRisks('substances allergisantes non déclarées|anomalie d\'étiquetage')).toEqual(['allergene']);
    expect(classifyRecallRisks('toxines endogènes : histamine')).toEqual(['histamine']);
    expect(classifyRecallRisks('campylobacter|staphylococcus aureus')).toEqual(['campylobacter', 'staphylocoque']);
    expect(classifyRecallRisks('brûlures|risque chimique|dommage à la vue')).toEqual(['autre']);
    expect(classifyRecallRisks(null)).toEqual(['autre']);
  });
  it('jour de Paris (une publication à 22 h 30 UTC compte le lendemain)', () => {
    expect(parisDay('2026-10-02T17:50:11+00:00')).toBe('2026-10-02');
    expect(parisDay('2026-10-02T22:30:00+00:00')).toBe('2026-10-03');
  });
});

describe('14 jours réels (du 20/09 au 03/10/2026, versions 1)', () => {
  const r = buildRecalls(ROWS, NOW) as Omit<Body, 'errors'>;
  it('88 rappels dont 52 à risque sanitaire', () => {
    expect([r.since, r.total, r.healthRisk]).toEqual(['2026-09-20', 88, 52]);
    expect(r.byRisk).toEqual({ salmonelle: 24, listeria: 20, stec: 5, allergene: 3, autre: 36 });
  });
  it('comptes par jour, week-ends à zéro', () => {
    expect(r.byDay.map((d) => [d.day, d.total, d.healthRisk])).toEqual([
      ['2026-09-20', 0, 0], ['2026-09-21', 7, 6], ['2026-09-22', 8, 3], ['2026-09-23', 8, 4], ['2026-09-24', 8, 7], ['2026-09-25', 18, 11],
      ['2026-09-26', 0, 0], ['2026-09-27', 0, 0], ['2026-09-28', 4, 2], ['2026-09-29', 7, 1], ['2026-09-30', 6, 3], ['2026-10-01', 12, 7],
      ['2026-10-02', 10, 8], ['2026-10-03', 0, 0],
    ]);
  });
  it('dix derniers rappels à risque sanitaire, avec lien de la fiche', () => {
    expect(r.latest.map((x) => x.id)).toEqual(['2026-10-0018', '2026-10-0019', '2026-10-0020', '2026-10-0014', '2026-10-0017',
      '2026-10-0016', '2026-09-0258', '2026-10-0013', '2026-10-0010', '2026-10-0009']);
    expect(r.latest[0]).toEqual({
      id: '2026-10-0018', date: '2026-10-02T17:50:11+00:00', label: 'haché de veau façon bouchère', brand: 'carrefour le marché',
      category: 'viandes', risks: ['salmonelle'], riskText: 'salmonella spp (agent responsable de la salmonellose)', zone: 'france entière',
      url: 'https://rappel.conso.gouv.fr/fiche-rappel/23689/interne',
    });
  });
  it('une version 2 republiée n’est jamais comptée', () => {
    const v2 = { ...ROWS[0], numero_version: 2, date_publication: '2026-10-03T07:00:00+00:00' };
    expect((buildRecalls([...ROWS, v2], NOW) as Omit<Body, 'errors'>).total).toBe(88);
  });
});

describe('/api/health/recalls', () => {
  it('requête versions 1 depuis le 19/09 (UTC), 100 lignes au plus par appel, cache 1 h', async () => {
    const { urls } = stubFetch(() => respond(fixtureText('rappelconso-14j.json')));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=3600, stale-while-revalidate=21600');
    const u = new URL(urls[0]);
    expect(u.origin + u.pathname).toBe(`${ECONOMIE_BASE}/rappelconso-v2-gtin-espaces/records`);
    expect(u.searchParams.get('where')).toBe("numero_version=1 and date_publication>=date'2026-09-19'");
    expect(maxLimitSent(urls)).toBe(100);
    expect((res.body as Body).total).toBe(88);
  });
  it('HTTP 500 : 502 non mis en cache, comptes vides et erreur nommée', async () => {
    stubFetch(() => respond('erreur', 500));
    const body = await loadRecalls(NOW) as Body;
    expect([body.total, body.latest, body.errors]).toEqual([0, [], ['RappelConso : HTTP 500']]);
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect([res.statusCode, res.headers['Cache-Control']]).toEqual([502, 'no-store']);
  });
});
