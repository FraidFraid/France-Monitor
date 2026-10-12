// tests/environment-ems-api.test.ts
// /api/environment/ems (spec 2026-10-12 Copernicus EMS) : liste lue, détail des activations françaises en cours seulement, détail en
// échec sans zone inventée, relevé précédent servi, 502 non mis en cache, déclarations de production.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { EMS_LIST_URL, EMS_STALE_SERVED_ERROR, emsDetailUrl, loadEms } from '../api/_lib/copernicus-ems.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/environment/ems.js';
import type { EmsResponse } from '../src/types/index.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const LIST = JSON.parse(read('./fixtures/environment/ems-liste-extrait.json')) as { results: Array<Record<string, unknown>> };
const DETAIL = read('./fixtures/environment/ems-detail-EMSR866.json');
const NOW = Date.parse('2026-10-12T08:00:00Z');
const listWithOpen = (codes: string[]) => JSON.stringify({ ...LIST, results: LIST.results.map((r) => ({ ...r, closed: !codes.includes(String(r['code'])) })) });

beforeEach(() => { __resetSwrCacheForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('loadEms', () => {
  it('détail lu pour la seule activation française en cours ; zones, déclencheur, population', async () => {
    const log = stubFetch((url) => (url === EMS_LIST_URL ? respond(listWithOpen(['EMSR866', 'EMSR934'])) : respond(DETAIL)));
    const body = await loadEms(NOW);
    expect(log.urls).toEqual([EMS_LIST_URL, emsDetailUrl('EMSR866')]);
    expect(body.readAt).toBe('2026-10-12T08:00:00.000Z');
    expect(body.active).toHaveLength(1);
    expect(body.active[0]).toMatchObject({ code: 'EMSR866', activator: 'COGIC', population: 83890 });
    expect(body.active[0]?.zones).toHaveLength(2);
    expect(body.elsewhere).toEqual({ count: 1, countries: ['Panama'] });
    expect(body.errors).toEqual([]);
  });
  it('détail en échec : ligne gardée, aucune zone, panne nommée', async () => {
    stubFetch((url) => (url === EMS_LIST_URL ? respond(listWithOpen(['EMSR866'])) : respond('x', 503)));
    const body = await loadEms(NOW);
    expect(body.active[0]).toMatchObject({ code: 'EMSR866', zones: [], activator: null });
    expect(body.errors[0]).toMatch(/^Copernicus EMS EMSR866 : HTTP 503/);
  });
  it('liste muette après une lecture : relevé précédent servi avec sa date et la panne', async () => {
    stubFetch(() => respond(listWithOpen([])));
    await loadEms(NOW);
    vi.setSystemTime(NOW + 2 * 3_600_000);
    stubFetch(() => respond('x', 503));
    const body = await loadEms(NOW + 2 * 3_600_000);
    expect(body.readAt).toBe('2026-10-12T08:00:00.000Z');
    expect(body.errors).toContain(EMS_STALE_SERVED_ERROR);
  });
});

describe('route', () => {
  it('200 et cache CDN ; liste illisible sans relevé : 502 no-store, panne nommée', async () => {
    stubFetch(() => respond(listWithOpen([])));
    const ok = await callHandler<EmsResponse>(handler);
    expect([ok.status, ok.cache]).toEqual([200, CACHE_CONTROL]);
    __resetSwrCacheForTests();
    stubFetch(() => respond('x', 503));
    const down = await callHandler<EmsResponse>(handler);
    expect([down.status, down.cache]).toEqual([502, 'no-store']);
    expect(down.body.errors[0]).toMatch(/^Copernicus EMS : HTTP 503/);
  });
  it('déclarations de production', () => {
    expect(read('../api/_routes.js')).toContain("'/api/environment/ems': () => import('./_handlers/environment/ems.js')");
    const openapi = JSON.parse(read('../public/openapi.json')) as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
    expect(openapi.paths['/api/environment/ems']).toBeDefined();
    expect(openapi.components.schemas.EmsResponse).toBeDefined();
    expect(read('../docs/api.md')).toContain('`GET /api/environment/ems`');
    expect(read('../.github/workflows/smoke.yml')).toContain('"/api/environment/ems;200"');
  });
});
