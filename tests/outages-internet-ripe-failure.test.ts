// Rappel RIPEstat illisible : l'erreur est nommée, jamais avalée en silence ; IODA reste servi.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetInternetForTests, ensureInternetFresh } from '../api/_lib/outages-internet.js';
import { internetRoute as route } from './helpers/outages-b-fixtures.ts';
import { stubFetch } from './helpers/traffic-fixtures.ts';

vi.mock('../api/_lib/ripestat.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/_lib/ripestat.js')>()),
  storedRipe: vi.fn(async () => { throw new Error('relevé illisible'); }),
}));

const NOW = Date.parse('2026-10-08T20:30:00Z');
beforeEach(() => {
  __resetKvForTests(); __resetInternetForTests();
  const store = new Map<string, string>();
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
  vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', '');
});
afterEach(() => { __setKvClientForTests(null); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Internet : rappel RIPEstat en échec', () => {
  it('ripe null (n.d.), erreur nommée RIPEstat, IODA servi', async () => {
    stubFetch(route);
    const body = await ensureInternetFresh(NOW);
    expect(body.ripe).toBeNull();
    expect(body.errors).toEqual(['RIPEstat : relevé illisible']);
    expect(body.iodaReadAt).toBe('2026-10-08T20:30:00.000Z');
  });
});
