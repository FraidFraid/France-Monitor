import { describe, expect, it } from 'vitest';
import type { DataSourceStatus } from '../types/index.ts';
import { SOURCES_SNAPSHOT_KEY, SOURCES_SNAPSHOT_MAX_AGE_MS, parseSourcesSnapshot, readSourcesSnapshot, saveSourcesSnapshot, serializeSourcesSnapshot } from './sources-snapshot.ts';

const NOW = Date.parse('2026-11-03T11:35:00Z');
const src = (over: Partial<DataSourceStatus> = {}): DataSourceStatus => ({
  name: 'Vigicrues', status: 'ok', lastUpdate: new Date('2026-11-03T11:30:00Z'), lastSuccess: new Date('2026-11-03T11:30:00Z'), lastError: null, ...over,
});
const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('relevé des sources du tableau de bord (03/11/2026)', () => {
  it('aller-retour : dates rendues en Date, champs gardés', () => {
    const s = store();
    saveSourcesSnapshot(s, [src(), src({ name: 'RTE', status: 'error', error: 'HTTP 502', lastUpdate: null })], NOW - 60_000);
    const r = readSourcesSnapshot(s, NOW);
    expect(r?.at).toBe(NOW - 60_000);
    expect(r?.sources.map((x) => [x.name, x.status])).toEqual([['Vigicrues', 'ok'], ['RTE', 'error']]);
    expect(r?.sources[0].lastUpdate).toBeInstanceOf(Date);
    expect(r?.sources[0].lastUpdate?.toISOString()).toBe('2026-11-03T11:30:00.000Z');
    expect(r?.sources[1]).toMatchObject({ lastUpdate: null, error: 'HTTP 502' });
  });
  it('trop vieux, illisible, absent, venu du futur ou vide : null (la page dit « non mesuré »)', () => {
    const raw = serializeSourcesSnapshot([src()], NOW - SOURCES_SNAPSHOT_MAX_AGE_MS - 1);
    expect(parseSourcesSnapshot(raw, NOW)).toBeNull();
    expect(parseSourcesSnapshot('{pas du json', NOW)).toBeNull();
    expect(parseSourcesSnapshot(null, NOW)).toBeNull();
    expect(parseSourcesSnapshot(serializeSourcesSnapshot([src()], NOW + 3_600_000), NOW)).toBeNull();
    expect(parseSourcesSnapshot(serializeSourcesSnapshot([], NOW), NOW)).toBeNull();
    expect(parseSourcesSnapshot(JSON.stringify({ at: NOW, sources: [{ name: 'x', status: 'bizarre' }] }), NOW)).toBeNull();
  });
  it('stockage absent ou refusé : rien enregistré, lecture nulle, aucune exception', () => {
    expect(() => saveSourcesSnapshot({ setItem: () => { throw new Error('plein'); } }, [src()], NOW)).not.toThrow();
    expect(readSourcesSnapshot({ getItem: () => { throw new Error('refusé'); } }, NOW)).toBeNull();
    const s = store();
    saveSourcesSnapshot(s, [], NOW);
    expect(s.getItem(SOURCES_SNAPSHOT_KEY)).toBeNull();
  });
});
