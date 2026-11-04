// tests/football-data.test.ts : calendrier sportif football-data (04/11/2026). Aucun appel réel : fetch est simulé.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error module JS sans déclaration
import { ensureFootballFresh, footballSnapshot, __resetFootballForTests } from '../api/_lib/football-data.js';
// @ts-expect-error module JS sans déclaration
import { stadiumOf } from '../api/_lib/stadiums.js';
// @ts-expect-error module JS sans déclaration
import { toSignals } from '../api/_lib/anticipation/signals.js';

const NOW = Date.parse('2026-11-04T09:00:00Z');
const body = (matches: unknown[]) => new Response(JSON.stringify({ matches }), { status: 200, headers: { 'content-type': 'application/json' } });
const match = (id: number, home: string, tla: string, utcDate = '2026-11-07T19:45:00Z') => ({ id, utcDate, homeTeam: { name: home, tla }, awayTeam: { name: 'Autre FC', tla: 'AUT' } });

beforeEach(() => { __resetFootballForTests(); delete process.env.FOOTBALL_DATA_KEY; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.FOOTBALL_DATA_KEY; });

describe('ensureFootballFresh', () => {
  it('no key: no fetch, configured false', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await ensureFootballFresh(NOW);
    expect(f).not.toHaveBeenCalled();
    expect(r.configured).toBe(false);
    expect(r.matches).toEqual([]);
    expect(footballSnapshot(NOW).configured).toBe(false);
  });

  it('parses home matches with dept, key in header only', async () => {
    process.env.FOOTBALL_DATA_KEY = 'secret-key';
    const f = vi.fn(async (url: string) => (url.includes('/FL1/')
      ? body([match(1, 'Olympique Lyonnais', 'LYO'), match(2, 'AS Monaco FC', 'ASM'), match(3, 'Inconnu United', 'INC')])
      : body([])));
    vi.stubGlobal('fetch', f);
    const r = await ensureFootballFresh(NOW);
    expect(f).toHaveBeenCalledTimes(2);
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.football-data.org/v4/competitions/FL1/matches?dateFrom=2026-11-04&dateTo=2026-11-11');
    expect(url).not.toContain('secret-key');
    expect(init.headers['X-Auth-Token']).toBe('secret-key');
    expect(r.configured).toBe(true);
    expect(r.matches.map((m: { home: string; dept: string | null }) => [m.home, m.dept])).toEqual([['Olympique Lyonnais', '69'], ['AS Monaco FC', null], ['Inconnu United', null]]);
    expect(r.matches[0]).toMatchObject({ id: '1', competition: 'FL1', kickoff: '2026-11-07T19:45:00.000Z', venue: null });
  });

  it('403 on a competition is a permanent skip: reported once, no retry, others untouched', async () => {
    process.env.FOOTBALL_DATA_KEY = 'secret-key';
    const f = vi.fn(async (url: string) => (url.includes('/CL/') ? new Response('{}', { status: 403 }) : body([match(1, 'Olympique de Marseille', 'OLM')])));
    vi.stubGlobal('fetch', f);
    const r = await ensureFootballFresh(NOW);
    expect(r.matches).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(JSON.stringify(r.errors)).not.toContain('secret-key');
    expect(f).toHaveBeenCalledTimes(2);
    // 6 h plus tard : CL n'est plus demandée, FL1 l'est une fois.
    const r2 = await ensureFootballFresh(NOW + 6 * 3_600_000 + 1);
    expect(f).toHaveBeenCalledTimes(3);
    expect(r2.errors).toHaveLength(1);
  });

  it('partial failure keeps the failed competition previous matches, a success replaces its own', async () => {
    process.env.FOOTBALL_DATA_KEY = 'k';
    let failFl1 = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/FL1/')) return failFl1 ? new Response('{}', { status: 500 }) : body([match(1, 'Olympique Lyonnais', 'LYO')]);
      return body([match(2, 'Paris Saint-Germain FC', 'PSG')]);
    }));
    await ensureFootballFresh(NOW);
    failFl1 = true;
    const r = await ensureFootballFresh(NOW + 6 * 3_600_000 + 1);
    expect(r.matches.map((m: { id: string }) => m.id)).toEqual(['1', '2']);
    expect(r.errors).toHaveLength(1);
  });

  it('TLA fallback only for FL1; unknown FL1 home club kept with dept null; foreign CL club dropped', async () => {
    process.env.FOOTBALL_DATA_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/FL1/')
      ? body([match(1, 'Club Inconnu', 'NIC')])
      : body([match(2, 'Foreign Club', 'NIC'), match(3, 'Olympique Lyonnais', 'LYO')]))));
    const r = await ensureFootballFresh(NOW);
    expect(r.matches.map((m: { id: string; dept: string | null }) => [m.id, m.dept])).toEqual([['1', '06'], ['3', '69']]);
    expect(r.matches[0].home).toBe('Club Inconnu');
    expect(stadiumOf({ name: 'Club Inconnu', tla: 'NIC' })).toBeNull();
  });

  it('unknown FL1 club without TLA match has dept null', async () => {
    process.env.FOOTBALL_DATA_KEY = 'k';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/FL1/') ? body([match(1, 'Club Inconnu', 'ZZZ')]) : body([]))));
    const r = await ensureFootballFresh(NOW);
    expect(r.matches[0]).toMatchObject({ home: 'Club Inconnu', dept: null });
  });

  it('is cached for 6 h', async () => {
    process.env.FOOTBALL_DATA_KEY = 'k';
    const f = vi.fn(async () => body([]));
    vi.stubGlobal('fetch', f);
    await ensureFootballFresh(NOW);
    await ensureFootballFresh(NOW + 3_600_000);
    expect(f).toHaveBeenCalledTimes(2);
    await ensureFootballFresh(NOW + 6 * 3_600_000 + 1);
    expect(f).toHaveBeenCalledTimes(4);
  });
});

describe('stadiumOf', () => {
  it('matches by normalised name or TLA, null otherwise', () => {
    expect(stadiumOf({ name: 'AS Saint-Etienne' })?.dept).toBe('42');
    expect(stadiumOf({ name: 'Nom inconnu', tla: 'NIC' })).toBeNull();
    expect(stadiumOf({ name: 'Nom inconnu', tla: 'NIC' }, { useTla: true })?.dept).toBe('06');
    expect(stadiumOf({ name: 'Nom inconnu', tla: 'XXX' }, { useTla: true })).toBeNull();
  });
});

describe('toSignals football', () => {
  const football = { configured: true, readAt: '2026-11-04T08:59:00Z', errors: [], matches: [{ id: '1', competition: 'FL1', home: 'Olympique Lyonnais', away: 'Autre FC', kickoff: '2026-11-04T19:45:00.000Z', venue: null, dept: '69' }] };
  const empty = { protests: null, vigilance: null, rail: null, room: null, cyber: null, ecowatt: null, fuel: null, news: null };
  it('maps a match to evenement_sportif, window kickoff -2 h / +3 h, not counted in unknown', () => {
    const base = toSignals({ ...empty }, NOW);
    const r = toSignals({ ...empty, football }, NOW);
    expect(r.unknown).toEqual(base.unknown);
    const s = r.signals[0];
    expect(s).toMatchObject({ kind: 'evenement_sportif', domain: 'event', origin: 'football-data', official: false, dept: ['69'] });
    expect(s.window).toEqual({ from: '2026-11-04T17:45:00.000Z', to: '2026-11-04T22:45:00.000Z' });
  });
  it('not configured gives no signal', () => {
    expect(toSignals({ ...empty, football: { ...football, configured: false, matches: [] } }, NOW).signals).toEqual([]);
  });
});
