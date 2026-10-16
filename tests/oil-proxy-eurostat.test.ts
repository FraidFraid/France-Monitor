// tests/oil-proxy-eurostat.test.ts
// Stocks stratégiques (16/10/2026) : Eurostat (ec.europa.eu) doit passer le proxy pétrole ; un domaine inconnu reste refusé.
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/_handlers/oil-proxy.js';

const EUROSTAT = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_stk_oem?geo=FR&lastTimePeriod=6&format=JSON&lang=FR';
const call = (target: string) => handler(new Request(`https://francemonitor.test/api/oil-proxy?url=${encodeURIComponent(target)}`));

afterEach(() => vi.unstubAllGlobals());

describe('proxy pétrole : Eurostat', () => {
  it('Eurostat autorisé (réponse relayée)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":[]}', { status: 200, headers: { 'content-type': 'application/json' } })));
    const r = await call(EUROSTAT);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('{"id":[]}');
  });
  it('domaine inconnu toujours refusé', async () => {
    expect((await call('https://example.com/x')).status).toBe(403);
  });
});
