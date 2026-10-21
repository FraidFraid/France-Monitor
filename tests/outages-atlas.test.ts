// tests/outages-atlas.test.ts : sondes RIPE Atlas décrochées par opérateur (control room des pannes, 21/10/2026).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetAtlasForTests, atlasOutages, atlasSignals, ensureAtlasFresh } from '../api/_lib/outages-atlas.js';
import { respond, stubFetch } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const MIN = 60_000;
const probe = (id: number, asn: number | null, status: 1 | 2, sinceMin: number) => ({
  id, asn_v4: asn, status: { id: status, name: status === 1 ? 'Connected' : 'Disconnected', since: new Date(NOW - sinceMin * MIN).toISOString() },
});
const many = (n: number, asn: number, status: 1 | 2, sinceMin: number, from = 0) => Array.from({ length: n }, (_, i) => probe(from + i, asn, status, sinceMin));

describe('sondes RIPE Atlas', () => {
  it('opérateur : 5 sondes ou plus décrochées depuis moins de 30 min et 10 % de ses sondes actives ; rouge à 25 %', () => {
    const probes = [...many(40, 3215, 1, 600), ...many(6, 3215, 2, 10, 100), ...many(20, 15557, 1, 600, 200), ...many(8, 15557, 2, 5, 300), ...many(3, 5410, 2, 5, 400)];
    const s = atlasSignals(probes, NOW);
    expect(s.operators).toEqual([
      expect.objectContaining({ asn: 15557, operator: 'SFR', down: 8, active: 28, level: 'rouge' }),
      expect.objectContaining({ asn: 3215, operator: 'Orange', down: 6, active: 46, level: 'orange' }),
    ]);
    expect(s.national).toBeNull();
  });
  it('décrochées depuis plus de 30 min, ou trop peu : rien ; pays entier au-delà de 20 sondes et 10 %', () => {
    expect(atlasSignals([...many(30, 3215, 1, 600), ...many(10, 3215, 2, 90, 100)], NOW).operators).toEqual([]);
    const wide = [...many(100, 12322, 1, 600), ...many(12, 12322, 2, 5, 200), ...many(100, 3215, 1, 600, 400), ...many(12, 3215, 2, 5, 600)];
    expect(atlasSignals(wide, NOW).national).toMatchObject({ down: 24, level: 'orange' });
  });
});

describe('relève RIPE Atlas', () => {
  beforeEach(() => { __resetAtlasForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('pages suivies, toutes les 5 min au plus ; panne d’opérateur rendue', async () => {
    const page2 = 'https://atlas.ripe.net/api/v2/probes/?page=2';
    const log = stubFetch((url) => (url === page2
      ? respond({ next: null, results: many(6, 3215, 2, 10, 100) })
      : respond({ next: page2, results: many(40, 3215, 1, 600) })));
    await ensureAtlasFresh(NOW);
    expect(log.urls).toHaveLength(2);
    expect(atlasOutages(NOW)).toEqual([expect.objectContaining({ operator: 'Orange', level: 'orange', down: 6 })]);
    await ensureAtlasFresh(NOW + 2 * MIN);
    expect(log.urls).toHaveLength(2);
    expect(atlasOutages(NOW + 20 * MIN)).toEqual([]);
  });
});
