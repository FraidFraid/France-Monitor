import { beforeEach, describe, it, expect, vi } from 'vitest';
import { loadDepartementsGeojson, resetDepartementsGeojsonCache } from './departements-geojson.ts';
import { loadDepartementIndex } from './departement-lookup.ts';

const collection = { type: 'FeatureCollection', features: [] };
const ok = (): Response => new Response(JSON.stringify(collection), { status: 200 });

beforeEach(() => {
  resetDepartementsGeojsonCache();
  vi.restoreAllMocks();
});

describe('chargeur partagé des départements (relecture finale I8)', () => {
  it('un seul téléchargement pour tous les appelants', async () => {
    const fetchImpl = vi.fn(async () => ok());
    const [a, b] = await Promise.all([loadDepartementsGeojson(fetchImpl), loadDepartementsGeojson(fetchImpl)]);
    expect(a).toBe(b);
    await loadDepartementIndex(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('un échec n’est pas mémorisé', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = vi.fn(async () => new Response('', { status: 503 }));
    expect(await loadDepartementsGeojson(failing)).toBeNull();
    const fetchImpl = vi.fn(async () => ok());
    expect(await loadDepartementsGeojson(fetchImpl)).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
