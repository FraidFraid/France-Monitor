// tests/rss-ingest-api.test.ts
// Tests de src/services/rss.ts#fetchFromIngestApi : arrondi de `since` à 5 min
// (cache CDN, cf. audit C6/P0) et mémoïsation en mémoire (requête partagée
// entre un préchargement précoce et le pipeline normal).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchFromIngestApi, clearRSSCache } from '../src/services/rss.ts';

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}

const SAMPLE_ITEM = {
  id: 1,
  feedId: 'le-monde',
  feedName: 'Le Monde',
  title: 'Un événement',
  link: 'https://example.fr/a',
  publishedAt: '2026-09-22T06:00:00Z',
  category: 'security',
  severity: 'high',
  confidence: 0.85,
  scoredBy: 'jev',
};

describe('fetchFromIngestApi', () => {
  beforeEach(() => {
    clearRSSCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T12:07:23.456Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('arrondit `since` à un palier de 5 min (URL stable pour le cache CDN)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { items: [SAMPLE_ITEM] }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchFromIngestApi();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    const since = new URL(url, 'http://localhost').searchParams.get('since');
    // Maintenant = 12:07:23, -24h = J-1 12:07:23 → arrondi au palier de 5 min ≤ (12:05:00)
    expect(since).toBe('2026-09-21T12:05:00.000Z');
  });

  it('mémoïse : deux appels rapprochés ne déclenchent qu\'une requête réseau', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { items: [SAMPLE_ITEM] }));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([fetchFromIngestApi(), fetchFromIngestApi()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);

    // Un 3e appel dans la fenêtre de 60 s réutilise aussi le résultat mémoïsé.
    await fetchFromIngestApi();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('au-delà du TTL de 60 s, une nouvelle requête est faite', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { items: [SAMPLE_ITEM] }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchFromIngestApi();
    vi.setSystemTime(new Date('2026-09-22T12:08:30.000Z')); // +67 s
    await fetchFromIngestApi();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('scoredBy=jev → threat.source="llm" (avant : toujours "keyword" côté serveur)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { items: [SAMPLE_ITEM] }));
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetchFromIngestApi();
    expect(items).not.toBeNull();
    expect(items![0].threat?.source).toBe('llm');
    expect(items![0].scoredBy).toBe('jev');
  });

  it('scoredBy=keywords → threat.source="keyword"', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { items: [{ ...SAMPLE_ITEM, scoredBy: 'keywords' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetchFromIngestApi();
    expect(items![0].threat?.source).toBe('keyword');
  });

  it('porte relevance/noise/alertable/scope quand présents', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { items: [{ ...SAMPLE_ITEM, relevance: 0.9, noise: false, alertable: true, scope: 'region' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetchFromIngestApi();
    expect(items![0].relevance).toBe(0.9);
    expect(items![0].noise).toBe(false);
    expect(items![0].alertable).toBe(true);
    expect(items![0].scope).toBe('region');
  });

  it('503 → null (fallback direct-feeds attendu côté fetchAllFeeds)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(503, { error: 'unavailable' }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchFromIngestApi()).toBeNull();
  });
});
