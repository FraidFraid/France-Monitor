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
    expect(f).toHaveBeenCalledTimes(3);
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.football-data.org/v4/competitions/FL1/matches?dateFrom=2026-11-04&dateTo=2026-11-11');
    expect(url).not.toContain('secret-key');
    expect(init.headers['X-Auth-Token']).toBe('secret-key');
    expect(r.configured).toBe(true);
    expect(r.matches.map((m: { home: string; dept: string | null }) => [m.home, m.dept])).toEqual([['Olympique Lyonnais', '69'], ['AS Monaco FC', null]]);
    expect(r.matches[0]).toMatchObject({ id: '1', competition: 'FL1', kickoff: '2026-11-07T19:45:00.000Z', venue: null });
  });

  it('a failing competition is reported without the key and does not drop the others', async () => {
    process.env.FOOTBALL_DATA_KEY = 'secret-key';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/EL/') ? new Response('{}', { status: 403 }) : body([match(1, 'Olympique de Marseille', 'OLM')]))));
    const r = await ensureFootballFresh(NOW);
    expect(r.matches).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(JSON.stringify(r.errors)).not.toContain('secret-key');
  });

  it('is cached for 6 h', async () => {
    process.env.FOOTBALL_DATA_KEY = 'k';
    const f = vi.fn(async () => body([]));
    vi.stubGlobal('fetch', f);
    await ensureFootballFresh(NOW);
    await ensureFootballFresh(NOW + 3_600_000);
    expect(f).toHaveBeenCalledTimes(3);
    await ensureFootballFresh(NOW + 6 * 3_600_000 + 1);
    expect(f).toHaveBeenCalledTimes(6);
  });
});

describe('stadiumOf', () => {
  it('matches by normalised name or TLA, null otherwise', () => {
    expect(stadiumOf({ name: 'AS Saint-Etienne' })?.dept).toBe('42');
    expect(stadiumOf({ name: 'Nom inconnu', tla: 'NIC' })?.dept).toBe('06');
    expect(stadiumOf({ name: 'Nom inconnu', tla: 'XXX' })).toBeNull();
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
