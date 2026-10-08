// @vitest-environment happy-dom
// MTG-FRP (démonstration, vague finale, point 7) : une lecture réussie donne l'état « ok » ; son retard se lit à l'affichage avec la
// constante S2 de 60 min (ENVIRONMENT_LATE_AFTER_MIN['mtg-frp'], tâche 1), jamais l'ancien seuil de 45 min figé à la lecture.
// « Dernière valide gardée » ne se dit qu'après une lecture en échec.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FireObservationFeedState, MtgFrpMetadata } from './types/index.ts';
import { mtgFrpState } from './components/layer-panel/feux.ts';

const { fetchMtgFrpMetadata } = vi.hoisted(() => ({ fetchMtgFrpMetadata: vi.fn() }));
vi.mock('./services/mtg-frp.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/mtg-frp.ts')>()),
  fetchMtgFrpMetadata,
}));

import { App } from './App.ts';

const NOW = Date.parse('2026-10-04T10:10:00+02:00');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function feedAfterRead(read: () => Promise<MtgFrpMetadata>): Promise<FireObservationFeedState> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  fetchMtgFrpMetadata.mockImplementation(read);
  const app = Object.create(App.prototype) as App & Record<string, unknown>;
  Object.assign(app, { mtgFrpRequestInFlight: false, latestMtgFrpMetadata: null, mtgFrpEnabled: false, mapContainer: null, firesPanel: null });
  await (app as unknown as { loadMtgFrpMetadata: () => Promise<void> }).loadMtgFrpMetadata().catch(() => undefined);
  return (app as unknown as { mtgFrpFeed: FireObservationFeedState }).mtgFrpFeed;
}

const metadata = (minutesAgo: number): MtgFrpMetadata => ({
  observedAt: new Date(NOW - minutesAgo * 60_000).toISOString(), fetchedAt: NOW, cadenceMinutes: 10,
  attribution: 'EUMETSAT LSA SAF · CC BY 4.0', demonstration: true,
});

describe('App : état MTG-FRP tiré de la lecture', () => {
  it('observation de 50 min lue avec succès : « ok », sans retard (seuil S2 de 60 min) ni « dernière valide gardée »', async () => {
    const feed = await feedAfterRead(async () => metadata(50));
    expect(feed.status).toBe('ok');
    expect(mtgFrpState(feed, NOW)).not.toMatch(/en retard|dernière valide gardée/);
  });
  it('observation de 61 min lue avec succès : « (en retard) », jamais « dernière valide gardée »', async () => {
    const feed = await feedAfterRead(async () => metadata(61));
    expect(feed.status).toBe('ok');
    expect(mtgFrpState(feed, NOW)).toContain('(en retard)');
    expect(mtgFrpState(feed, NOW)).not.toContain('dernière valide gardée');
  });
});
