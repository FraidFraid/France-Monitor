// Exception inattendue de la collecte Internet : la route ne lève jamais et garde « configuré » selon le jeton (P36).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadInternet } from '../api/_handlers/outages/internet.js';

vi.mock('../api/_lib/outages-internet.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/_lib/outages-internet.js')>()),
  ensureInternetFresh: vi.fn(async () => { throw new Error('collecte cassée'); }),
}));

beforeEach(() => { vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', ''); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('/api/outages/internet : exception de collecte', () => {
  it('réponse vide, erreur nommée Internet, « non configuré » sans jeton', async () => {
    const body = await loadInternet(Date.parse('2026-10-08T20:30:00Z'));
    expect(body.errors).toEqual(['Internet : collecte cassée']);
    expect(body.iodaReadAt).toBeNull();
    expect(body.radar).toEqual({ configured: false, readAt: null, items: [] });
  });
  it('avec un jeton posé : « configuré » (en panne, pas « non configuré »), jeton jamais servi', async () => {
    vi.stubEnv('CLOUDFLARE_RADAR_TOKEN', 'jeton-de-test');
    const body = await loadInternet(Date.parse('2026-10-08T20:30:00Z'));
    expect(body.radar).toEqual({ configured: true, readAt: null, items: [] });
    expect(JSON.stringify(body)).not.toContain('jeton-de-test');
  });
});
