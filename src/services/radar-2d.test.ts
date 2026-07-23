import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchRadar2dManifest,
  parseRadar2dManifest,
  type Radar2dManifest,
} from './radar-2d.ts';
import { handleRadar2dProxyRequest } from '../plugins/radar-2d-proxy.ts';
import radar2dHandler from '../../api/fire-observations/radar-2d.js';
import {
  RADAR_2D_LAYER_ID,
  RADAR_2D_SOURCE_ID,
} from '../components/deckgl/format-utils.ts';

const VALID: Radar2dManifest = {
  schemaVersion: 1,
  source: 'Météo-France DPRadar',
  observedAt: '2026-07-16T12:50:00Z',
  generatedAt: '2026-07-16T12:52:00Z',
  bounds: [-6.2, 40.8, 10.1, 52.3],
  imageUrl: 'https://radar.example.test/rasters/radar-20260716T1250Z.webp',
  resolutionMeters: 1000,
  license: 'Licence Ouverte 2.0',
};

async function invokeVercelHandler(
  envValue: string | undefined,
): Promise<{ statusCode: number; headers: Map<string, string>; body: unknown }> {
  const previous = process.env.METEO_FRANCE_RADAR_MANIFEST_URL;
  if (envValue === undefined) delete process.env.METEO_FRANCE_RADAR_MANIFEST_URL;
  else process.env.METEO_FRANCE_RADAR_MANIFEST_URL = envValue;

  const headers = new Map<string, string>();
  let body: unknown;
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    end(value?: unknown) { body = value; },
  };

  try {
    await radar2dHandler({ method: 'GET' }, response);
  } finally {
    if (previous === undefined) delete process.env.METEO_FRANCE_RADAR_MANIFEST_URL;
    else process.env.METEO_FRANCE_RADAR_MANIFEST_URL = previous;
  }
  return { statusCode: response.statusCode, headers, body };
}

describe('parseRadar2dManifest', () => {
  it('accepts the normalized worker manifest contract', () => {
    expect(parseRadar2dManifest(VALID)).toEqual(VALID);
  });

  it('rejects manifests with non-https image origins or invalid bounds', () => {
    expect(parseRadar2dManifest({ ...VALID, imageUrl: 'javascript:alert(1)' })).toBeNull();
    expect(parseRadar2dManifest({ ...VALID, bounds: [10, 50, -5, 40] })).toBeNull();
  });

  it('rejects invalid schema, product metadata and calendar timestamps', () => {
    expect(parseRadar2dManifest({ ...VALID, schemaVersion: 2 })).toBeNull();
    expect(parseRadar2dManifest({ ...VALID, source: 'RainViewer' })).toBeNull();
    expect(parseRadar2dManifest({ ...VALID, resolutionMeters: 500 })).toBeNull();
    expect(parseRadar2dManifest({ ...VALID, observedAt: '2026-02-31T12:50:00Z' })).toBeNull();
  });
});

describe('radar 2D client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T13:00:00Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('maps an honest unconfigured response without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ configured: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(fetchRadar2dManifest(true)).resolves.toEqual({ configured: false });
  });

  it('caches a valid manifest for 120 seconds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchRadar2dManifest(true);
    vi.advanceTimersByTime(119_000);
    const second = await fetchRadar2dManifest();

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a cached manifest after configuration is removed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(VALID), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ configured: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })));
    vi.stubGlobal('fetch', fetchMock);

    await fetchRadar2dManifest(true);
    await expect(fetchRadar2dManifest(true)).resolves.toEqual({ configured: false });
    await expect(fetchRadar2dManifest()).resolves.toEqual({ configured: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('preserves the last valid manifest after a failed refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const valid = await fetchRadar2dManifest(true);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(fetchRadar2dManifest(true)).resolves.toMatchObject({
      configured: true,
      manifest: VALID,
      degraded: true,
    });
    expect(valid).toMatchObject({ configured: true, degraded: false });
  });
});

describe('radar 2D development proxy', () => {
  it('returns configured:false without contacting an upstream', async () => {
    const upstreamFetch = vi.fn();
    const response = await handleRadar2dProxyRequest('', upstreamFetch);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ configured: false });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('contacts only the configured manifest URL and validates the response', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const configuredUrl = 'https://worker.example.test/manifest.json';
    const response = await handleRadar2dProxyRequest(configuredUrl, upstreamFetch);

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledWith(configuredUrl, expect.objectContaining({
      headers: { Accept: 'application/json' },
      redirect: 'error',
    }));
    await expect(response.json()).resolves.toEqual(VALID);
  });

  it('rejects insecure non-local configured origins', async () => {
    const upstreamFetch = vi.fn();
    const response = await handleRadar2dProxyRequest(
      'http://worker.example.test/manifest.json',
      upstreamFetch,
    );

    expect(response.status).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('caps streamed bodies even when Content-Length is absent', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(64 * 1024 + 1), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const response = await handleRadar2dProxyRequest(
      'https://worker.example.test/manifest.json',
      upstreamFetch,
    );

    expect(response.status).toBe(502);
  });

  it('rejects upstream redirect responses', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { Location: 'https://other.example.test/manifest.json' },
    }));

    const response = await handleRadar2dProxyRequest(
      'https://worker.example.test/manifest.json',
      upstreamFetch,
    );

    expect(response.status).toBe(502);
  });
});

describe('radar 2D Vercel proxy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns configured:false with status 200 when no manifest URL is configured', async () => {
    const response = await invokeVercelHandler(undefined);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(String(response.body))).toEqual({ configured: false });
  });

  it('proxies and validates a configured manifest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const response = await invokeVercelHandler('https://worker.example.test/manifest.json');

    expect(response.statusCode).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=120');
    expect(JSON.parse(String(response.body))).toEqual(VALID);
  });

  it('rejects an invalid configured URL before contacting upstream', async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await invokeVercelHandler('http://worker.example.test/manifest.json');

    expect(response.statusCode).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('uses stable MapLibre ids distinct from RainViewer', () => {
    expect(RADAR_2D_SOURCE_ID).toBe('fire-radar-2d-source');
    expect(RADAR_2D_LAYER_ID).toBe('fire-radar-2d-layer');
  });
});

describe('parseRadar2dManifest — sommets d\'écho optionnels', () => {
  it('propage une echoTopImageUrl valide', () => {
    const manifest = parseRadar2dManifest({
      ...VALID,
      echoTopImageUrl: 'https://radar.example.test/rasters/radar-echotops-x.webp',
    });
    expect(manifest?.echoTopImageUrl).toBe(
      'https://radar.example.test/rasters/radar-echotops-x.webp',
    );
  });

  it('écarte une echoTopImageUrl invalide sans rejeter le manifeste', () => {
    const manifest = parseRadar2dManifest({
      ...VALID,
      echoTopImageUrl: 'javascript:alert(1)',
    });
    expect(manifest).not.toBeNull();
    expect(manifest?.echoTopImageUrl).toBeUndefined();
  });

  it('reste absent quand le worker ne publie pas de sommets d\'écho', () => {
    expect(parseRadar2dManifest(VALID)?.echoTopImageUrl).toBeUndefined();
  });
});
