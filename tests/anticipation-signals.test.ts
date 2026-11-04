// tests/anticipation-signals.test.ts : normalisation des relevés en signaux datés et attribués (04/11/2026).
import { describe, expect, it } from 'vitest';
import { MAX_AGE_MS, toSignals } from '../api/_lib/anticipation/signals.js';
import { deptsOfRailScope } from '../api/_lib/anticipation/rail-hubs.js';

type Inputs = Parameters<typeof toSignals>[0];

const NOW = Date.parse('2026-11-04T10:00:00Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const H = 3_600_000;

const empty: Inputs = { protests: null, vigilance: null, rail: null, room: null, cyber: null, ecowatt: null, fuel: null, news: null };
const run = (over: Partial<Inputs>) => toSignals({ ...empty, ...over }, NOW);

describe('toSignals', () => {
  it('protest announced → rassemblement_annonce with dept, window, origin demosphere', () => {
    const protests = {
      readAt: ago(10 * 60_000),
      items: [{ id: 'd1', source: 'demosphere', status: 'annonce', title: 'Rassemblement', startsAt: '2026-11-04T17:00:00Z', allDay: false, city: 'Toulouse', dept: '31', lat: 43.6, lon: 1.44, url: 'https://x', participants: null }],
    };
    const { signals, unknown } = run({ protests });
    const s = signals.find((x: { kind: string }) => x.kind === 'rassemblement_annonce');
    expect(s).toBeTruthy();
    expect(s.dept).toEqual(['31']);
    expect(s.origin).toBe('demosphere');
    expect(s.official).toBe(false);
    expect(s.window.from).toBe('2026-11-04T17:00:00.000Z');
    expect(unknown).not.toContain('Manifestations non lues');
  });

  it('protest signalé presse → rassemblement_signale with participants; arrêté → arrete_prefectoral', () => {
    const protests = {
      readAt: ago(60_000),
      items: [
        { id: 'p1', source: 'presse', status: 'signale', title: 'Manifestation', startsAt: ago(2 * H), allDay: false, city: null, dept: null, lat: 45.76, lon: 4.84, participants: 800 },
        { id: 'a1', source: 'prefecture', status: 'annonce', title: 'Interdiction', startsAt: '2026-11-05T08:00:00Z', allDay: false, city: 'Paris', dept: '75', lat: null, lon: null, arrete: { kind: 'interdiction' } },
      ],
    };
    const { signals } = run({ protests });
    const sig = signals.find((x: { kind: string }) => x.kind === 'rassemblement_signale');
    expect(sig.value).toBe(800);
    expect(sig.dept).toEqual(['69']);
    const arr = signals.find((x: { kind: string }) => x.kind === 'arrete_prefectoral');
    expect(arr.official).toBe(true);
    expect(arr.origin).toBe('prefecture:75');
  });

  it('vigilance J1 orange vent → level orange, window from slot, official true', () => {
    const vigilance = {
      readAt: ago(30 * 60_000), updateTime: ago(30 * 60_000),
      periods: [{ echeance: 'J1', begin: '2026-11-05T00:00:00Z', end: '2026-11-06T00:00:00Z', departments: [
        { code: '29', name: 'Finistère', color: 3, phenomena: [{ id: '1', color: 3, slots: [{ from: '2026-11-05T06:00:00Z', to: '2026-11-05T15:00:00Z', color: 3 }] }] },
      ] }],
    };
    const { signals } = run({ vigilance });
    const s = signals.find((x: { kind: string }) => x.kind === 'vigilance');
    expect(s.level).toBe('orange');
    expect(s.window).toEqual({ from: '2026-11-05T06:00:00.000Z', to: '2026-11-05T15:00:00.000Z' });
    expect(s.official).toBe(true);
    expect(s.origin).toBe('meteo-france');
    expect(s.dept).toEqual(['29']);
    expect(s.ref).toBe('vent');
    expect(s.domain).toBe('weather');
  });

  it('rail cause "mouvement social" Lyon-Grenoble → mouvement_social_transport depts ["69","38"]', () => {
    const rail = { at: ago(10 * 60_000), errors: [], situations: [{ id: 'r1', title: 'Lyon-Grenoble', cause: 'mouvement social', causeKind: 'autre', scope: 'Lyon-Grenoble', start: ago(H), end: null, trains: 4 }] };
    const { signals } = run({ rail });
    const s = signals.find((x: { kind: string }) => x.kind === 'mouvement_social_transport');
    expect(s.dept).toEqual(['69', '38']);
    expect(s.origin).toBe('sncf');
    expect(deptsOfRailScope('Paris-Lyon')).toEqual(['75', '69']);
  });

  it('room outage electricite dept 29 rouge → domain energy, level rouge', () => {
    const room = { generatedAt: ago(60_000), outages: [
      { id: 'electricite|dept:29', network: 'electricite', scope: 'departement', operator: null, dept: '29', level: 'rouge', since: ago(H), national: false, measured: true, rung: 'mesuree', evidence: [{ source: 'rte', text: 'x', at: ago(H), link: null }] },
      { id: 'mobile|op:Orange', network: 'mobile', scope: 'operateur', operator: 'Orange', dept: null, level: 'jaune', since: ago(H), national: true, measured: false, rung: 'signalee', evidence: [{ source: 'presse', text: 'x', at: null, link: null }] },
    ] };
    const { signals } = run({ room });
    const p = signals.filter((x: { kind: string }) => x.kind === 'panne');
    expect(p).toHaveLength(2);
    const e = p.find((x: { domain: string }) => x.domain === 'energy');
    expect(e.level).toBe('rouge');
    expect(e.dept).toEqual(['29']);
    expect(p.find((x: { domain: string }) => x.domain === 'telecom')).toBeTruthy();
  });

  it('press items same eventId → one presse signal', () => {
    const base = { category: 'security', severity: 'high', lat: 48.85, lon: 2.35, feedName: 'A', publishedAt: ago(H) };
    const news = [
      { ...base, id: 1, eventId: 7, title: 'Dépêche' },
      { ...base, id: 2, eventId: 7, title: 'Dépêche reprise', feedName: 'B' },
      { ...base, id: 3, eventId: null, title: 'Autre' },
    ];
    const { signals } = run({ news });
    const p = signals.filter((x: { kind: string }) => x.kind === 'presse');
    expect(p).toHaveLength(2);
    expect(p.map((x: { origin: string }) => x.origin).sort()).toEqual(['presse:event:7', 'presse:item:3']);
    expect(p[0].dept).toEqual(['75']);
  });

  it('press social item naming SNCF → mouvement_social_transport', () => {
    const news = [{ id: 9, eventId: 12, category: 'social', severity: 'medium', lat: null, lon: null, title: 'Préavis de grève à la SNCF', feedName: 'A', publishedAt: ago(H) }];
    const { signals } = run({ news });
    expect(signals.some((x: { kind: string }) => x.kind === 'mouvement_social_transport')).toBe(true);
  });

  it('ecowatt one per day J..J+3, official, rte', () => {
    const days = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'].map((date) => ({ date, level: 'green', message: '', hours: [] }));
    const { signals } = run({ ecowatt: { source: 'rte', generatedAt: ago(H), days } });
    const e = signals.filter((x: { kind: string }) => x.kind === 'ecowatt');
    expect(e).toHaveLength(4);
    expect(e[0].origin).toBe('rte');
    expect(e[0].official).toBe(true);
  });

  it('cyber: ddosia .fr target and radar above median', () => {
    const cyber = { readAt: ago(H), errors: [],
      radar: { readAt: ago(H), l7Ratio: 2.4, l3Ratio: 0.8 },
      ddosia: { readAt: ago(H), hosts: [
        { host: 'mairie.example.fr', first: ago(H), last: ago(H), configs: 1, kind: 'x', place: { dept: '13', name: 'Marseille', how: 'x', lon: 5, lat: 43 } },
        { host: 'site.example.com', first: ago(H), last: ago(H), configs: 1, kind: 'x', place: null },
      ] } };
    const { signals } = run({ cyber });
    expect(signals.filter((x: { kind: string }) => x.kind === 'cyber_revendication')).toHaveLength(1);
    const pic = signals.find((x: { kind: string }) => x.kind === 'cyber_pic');
    expect(pic.value).toBe(2.4);
    expect(pic.origin).toBe('cloudflare-radar');
  });

  it('fuel: dept share of stations en rupture', () => {
    const fuel = { generatedAt: ago(10 * 60_000), summaries: [
      { departmentCode: '13', anomalyShare: 27, stationCount: 200 },
      { departmentCode: '29', anomalyShare: 5, stationCount: 100 },
    ] };
    const { signals } = run({ fuel });
    const f = signals.filter((x: { kind: string }) => x.kind === 'tension_carburant');
    expect(f).toHaveLength(1);
    expect(f[0].dept).toEqual(['13']);
    expect(f[0].value).toBe(27);
    expect(f[0].level).toBe('orange');
  });

  it('stale vigilance (readAt 7 h ago) → no signal, unknown contains "Météo-France"', () => {
    const vigilance = { readAt: ago(7 * H), updateTime: ago(7 * H), periods: [{ echeance: 'J', begin: ago(H), end: ago(-H), departments: [{ code: '29', color: 3, phenomena: [{ id: '1', color: 3, slots: [] }] }] }] };
    const { signals, unknown } = run({ vigilance });
    expect(signals).toEqual([]);
    expect(unknown.some((u: string) => u.includes('Météo-France'))).toBe(true);
    expect(MAX_AGE_MS.vigilance).toBe(6 * H);
  });

  it('all inputs null → signals [] and 8 unknown entries', () => {
    const r = run({});
    expect(r.signals).toEqual([]);
    expect(r.unknown).toHaveLength(8);
  });

  it('football optional is not counted in unknown', () => {
    expect(run({ football: null }).unknown).toHaveLength(8);
  });

  it('signal ids are stable between ticks', () => {
    const rail = { at: ago(60_000), errors: [], situations: [{ id: 'r1', title: 'Lyon-Grenoble', cause: 'grève', causeKind: 'autre', scope: 'Lyon-Grenoble', start: ago(H), end: null, trains: 4 }] };
    const a = run({ rail }).signals[0].id;
    const b = toSignals({ ...empty, rail: { ...rail, at: ago(30_000) } }, NOW + 60_000).signals[0].id;
    expect(a).toBe(b);
  });
});
