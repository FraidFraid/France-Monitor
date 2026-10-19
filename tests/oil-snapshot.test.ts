// tests/oil-snapshot.test.ts : relevé pétrole de la VM (minuteur fm-oil) : route qui le sert, lecture par le navigateur (à jour,
// trop vieux, mauvaise forme, absent → calcul dans le navigateur comme avant).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OIL_SNAPSHOT_MAX_AGE_MS, OIL_SNAPSHOT_URL, OIL_SNAPSHOT_VERSION, readOilSnapshot } from '../src/services/oil.ts';
import { callHandler } from './helpers/traffic-fixtures.ts';

const NOW = Date.parse('2026-10-19T17:00:00Z');
const DASHBOARD = { meta: { status: 'normal' }, stocks: { nationalStocksDays: 97 }, flows: {}, deliveries: [], sourceStatus: { sdes: 'ok' } };
const body = (over: Record<string, unknown> = {}) => ({ version: OIL_SNAPSHOT_VERSION, generatedAt: new Date(NOW - 3_600_000).toISOString(), dashboard: DASHBOARD, ...over });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('route /api/energy/oil-dashboard', () => {
  it('sert le fichier tel quel ; 404 non mis en cache tant que le minuteur n’est pas passé', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fm-oil-'));
    const file = join(dir, 'oil-dashboard.json');
    writeFileSync(file, JSON.stringify(body()));
    vi.stubEnv('OIL_SNAPSHOT_FILE', file);
    const ok = await callHandler<{ dashboard: unknown }>((await import('../api/_handlers/energy/oil-dashboard.js')).default);
    expect(ok.status).toBe(200);
    expect(ok.body.dashboard).toEqual(DASHBOARD);
    expect(ok.cache).toContain('s-maxage=600');
    vi.resetModules();
    vi.stubEnv('OIL_SNAPSHOT_FILE', join(dir, 'absent.json'));
    const none = await callHandler((await import('../api/_handlers/energy/oil-dashboard.js')).default);
    expect([none.status, none.cache]).toEqual([404, 'no-store']);
  });
});

describe('lecture du relevé par le navigateur', () => {
  const serve = (status: number, json: unknown) => {
    const f = vi.fn(async () => new Response(JSON.stringify(json), { status }));
    vi.stubGlobal('fetch', f);
    return f;
  };
  it('à jour et bien formé : servi ; trop vieux, autre version, forme incomplète ou absent : null (calcul dans le navigateur)', async () => {
    const f = serve(200, body());
    expect((await readOilSnapshot(NOW))?.stocks.nationalStocksDays).toBe(97);
    expect(f.mock.calls[0]?.[0]).toBe(OIL_SNAPSHOT_URL);
    serve(200, body({ generatedAt: new Date(NOW - OIL_SNAPSHOT_MAX_AGE_MS - 1000).toISOString() }));
    expect(await readOilSnapshot(NOW)).toBeNull();
    serve(200, body({ version: OIL_SNAPSHOT_VERSION + 1 }));
    expect(await readOilSnapshot(NOW)).toBeNull();
    serve(200, body({ dashboard: { meta: {}, stocks: {} } }));
    expect(await readOilSnapshot(NOW)).toBeNull();
    serve(404, { error: 'relevé pétrole absent' });
    expect(await readOilSnapshot(NOW)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('réseau'); }));
    expect(await readOilSnapshot(NOW)).toBeNull();
  });
});
