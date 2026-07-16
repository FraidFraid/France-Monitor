import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchMtgFrpMetadata,
  getMtgFrpTileTemplate,
  parseMtgCapabilities,
  validateMtgMapRequest,
} from './mtg-frp.ts';
import { handleMtgFrpProxyRequest } from '../plugins/mtg-frp-proxy.ts';
import mtgFrpHandler from '../../api/fire-observations/mtg-frp.js';
import {
  MTG_FRP_LAYER_ID,
  MTG_FRP_SOURCE_ID,
} from '../components/deckgl/format-utils.ts';

const CAPABILITIES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities xmlns="http://www.opengis.net/wms" version="1.3.0">
  <Capability><Layer><Title>MTG-FRP</Title>
    <Layer queryable="1">
      <Name>FRP</Name>
      <Dimension name="time" units="ISO8601" default="2026-07-16T12:50:00Z">2025-07-21T01:10:00Z/2026-07-16T12:50:00Z/PT10M</Dimension>
    </Layer>
  </Layer></Capability>
</WMS_Capabilities>`;

const METADATA_RESPONSE = {
  observedAt: '2026-07-16T12:50:00Z',
  // Le cache client démarre à la réception, même si un CDN a conservé le fetchedAt amont.
  fetchedAt: Date.parse('2026-07-16T12:00:00Z'),
  cadenceMinutes: 10 as const,
  attribution: 'EUMETSAT LSA SAF · CC BY 4.0' as const,
  demonstration: true as const,
};

async function invokeVercelHandler(
  url: string,
  method = 'GET',
): Promise<{ statusCode: number; headers: Map<string, string>; body: unknown }> {
  const headers = new Map<string, string>();
  let body: unknown;
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    end(value?: unknown) { body = value; },
  };

  await mtgFrpHandler({ method, url, headers: { host: 'localhost' } }, response);
  return { statusCode: response.statusCode, headers, body };
}

describe('parseMtgCapabilities', () => {
  it('extracts the default ISO time from MTG-FRP capabilities', () => {
    expect(parseMtgCapabilities(CAPABILITIES_XML).observedAt).toBe('2026-07-16T12:50:00Z');
  });

  it('rejects capabilities without the FRP layer or an ISO default time', () => {
    expect(() => parseMtgCapabilities(CAPABILITIES_XML.replace('<Name>FRP</Name>', '<Name>OTHER</Name>')))
      .toThrow(/FRP/);
    expect(() => parseMtgCapabilities(CAPABILITIES_XML.replace('2026-07-16T12:50:00Z', 'latest')))
      .toThrow(/time/i);
  });

  it('does not borrow the default time from another WMS layer', () => {
    const splitLayers = CAPABILITIES_XML
      .replace(
        '<Dimension name="time" units="ISO8601" default="2026-07-16T12:50:00Z">2025-07-21T01:10:00Z/2026-07-16T12:50:00Z/PT10M</Dimension>',
        '',
      )
      .replace(
        '</Layer>\n  </Layer></Capability>',
        '</Layer><Layer><Name>OTHER</Name><Dimension name="time" default="2026-07-16T12:50:00Z" /></Layer>\n  </Layer></Capability>',
      );

    expect(() => parseMtgCapabilities(splitLayers)).toThrow(/time/i);
  });

  it('rejects impossible UTC calendar dates', () => {
    expect(() => parseMtgCapabilities(
      CAPABILITIES_XML.replaceAll('2026-07-16T12:50:00Z', '2026-02-31T12:50:00Z'),
    )).toThrow(/time/i);
  });
});

describe('validateMtgMapRequest', () => {
  it('accepts a valid EPSG:3857 tile request', () => {
    expect(validateMtgMapRequest({
      bbox: '-626172.1357,5621521.4862,0,6261721.3571',
      width: '256',
      height: '256',
      time: '2026-07-16T12:50:00Z',
    })).toEqual({
      bbox: '-626172.1357,5621521.4862,0,6261721.3571',
      width: 256,
      height: 256,
      time: '2026-07-16T12:50:00Z',
    });
  });

  it('rejects malformed or out-of-range bboxes', () => {
    expect(() => validateMtgMapRequest({ bbox: '10,0,-10,20', width: '256', height: '256' }))
      .toThrow();
    expect(() => validateMtgMapRequest({ bbox: '0,0,20037509,20', width: '256', height: '256' }))
      .toThrow();
    expect(() => validateMtgMapRequest({ bbox: '0,0,10', width: '256', height: '256' }))
      .toThrow();
  });

  it('rejects non-integer dimensions outside 1–1024 and invalid times', () => {
    expect(() => validateMtgMapRequest({ bbox: '0,0,10,20', width: '0', height: '256' }))
      .toThrow();
    expect(() => validateMtgMapRequest({ bbox: '0,0,10,20', width: '256.5', height: '256' }))
      .toThrow();
    expect(() => validateMtgMapRequest({ bbox: '0,0,10,20', width: '256', height: '1025' }))
      .toThrow();
    expect(() => validateMtgMapRequest({ bbox: '0,0,10,20', width: '256', height: '256', time: 'latest' }))
      .toThrow();
    expect(() => validateMtgMapRequest({
      bbox: '0,0,10,20',
      width: '256',
      height: '256',
      time: '2026-04-31T12:50:00Z',
    })).toThrow();
  });
});

describe('MTG-FRP client', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T13:00:00Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the MapLibre bbox token intact and uses the same-origin proxy', () => {
    expect(getMtgFrpTileTemplate()).toContain('bbox={bbox-epsg-3857}');
    expect(getMtgFrpTileTemplate().startsWith('/api/fire-observations/mtg-frp?operation=map')).toBe(true);
  });

  it('uses stable MapLibre ids for atomic MTG-FRP replacement', () => {
    expect(MTG_FRP_SOURCE_ID).toBe('fire-mtg-frp-source');
    expect(MTG_FRP_LAYER_ID).toBe('fire-mtg-frp-layer');
  });

  it('caches metadata for 120 seconds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(METADATA_RESPONSE), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchMtgFrpMetadata(true);
    vi.advanceTimersByTime(119_000);
    const second = await fetchMtgFrpMetadata();

    expect(first.observedAt).toBe('2026-07-16T12:50:00Z');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once and serves stale metadata if both attempts fail', async () => {
    const initialFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(METADATA_RESPONSE), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', initialFetch);
    const cached = await fetchMtgFrpMetadata(true);

    vi.advanceTimersByTime(121_000);
    const failedFetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', failedFetch);

    await expect(fetchMtgFrpMetadata()).resolves.toBe(cached);
    expect(failedFetch).toHaveBeenCalledTimes(2);
  });
});

describe('MTG-FRP development proxy', () => {
  it('keeps the metadata upstream fixed and returns parsed metadata', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(CAPABILITIES_XML, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    }));

    const response = await handleMtgFrpProxyRequest(
      new URL('http://localhost/api/fire-observations/mtg-frp?operation=metadata&dataset=evil'),
      upstreamFetch,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      observedAt: '2026-07-16T12:50:00Z',
      cadenceMinutes: 10,
      demonstration: true,
    });
    const upstreamUrl = new URL(String(upstreamFetch.mock.calls[0]?.[0]));
    expect(upstreamUrl.origin + upstreamUrl.pathname).toBe('https://adaguc.lsasvcs.ipma.pt/adagucserver');
    expect(upstreamUrl.searchParams.get('DATASET')).toBe('MTG-FRP');
  });

  it('fixes map layer and style while accepting an empty PNG', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));
    const response = await handleMtgFrpProxyRequest(new URL(
      'http://localhost/api/fire-observations/mtg-frp?operation=map&bbox=0,0,10,20&width=256&height=256&layer=evil',
    ), upstreamFetch);

    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    const upstreamUrl = new URL(String(upstreamFetch.mock.calls[0]?.[0]));
    expect(upstreamUrl.searchParams.get('LAYERS')).toBe('FRP');
    expect(upstreamUrl.searchParams.get('STYLES')).toBe('pointdata/point');
    expect(response.headers.get('Cache-Control')).toBe('public, s-maxage=600, stale-while-revalidate=1800');
  });

  it('rejects unsupported operations and XML exception bodies', async () => {
    const unusedFetch = vi.fn();
    const invalid = await handleMtgFrpProxyRequest(
      new URL('http://localhost/api/fire-observations/mtg-frp?operation=features'),
      unusedFetch,
    );
    expect(invalid.status).toBe(400);
    expect(unusedFetch).not.toHaveBeenCalled();

    const exceptionFetch = vi.fn().mockResolvedValue(new Response(
      '<ServiceExceptionReport><ServiceException>bad request</ServiceException></ServiceExceptionReport>',
      { status: 200, headers: { 'Content-Type': 'image/png' } },
    ));
    const exception = await handleMtgFrpProxyRequest(new URL(
      'http://localhost/api/fire-observations/mtg-frp?operation=map&bbox=0,0,10,20&width=256&height=256',
    ), exceptionFetch);
    expect(exception.status).toBe(502);
  });

  it('rejects impossible calendar times before contacting the map upstream', async () => {
    const unusedFetch = vi.fn();
    const response = await handleMtgFrpProxyRequest(new URL(
      'http://localhost/api/fire-observations/mtg-frp?operation=map&bbox=0,0,10,20&width=256&height=256&time=2026-02-31T12:50:00Z',
    ), unusedFetch);

    expect(response.status).toBe(400);
    expect(unusedFetch).not.toHaveBeenCalled();
  });
});

describe('MTG-FRP Vercel proxy', () => {
  it('uses the same fixed upstream contract and preserves an empty PNG', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));
    vi.stubGlobal('fetch', upstreamFetch);

    const headers = new Map<string, string>();
    let responseBody: unknown;
    const response = {
      statusCode: 200,
      setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
      end(body?: unknown) { responseBody = body; },
    };
    await mtgFrpHandler({
      method: 'GET',
      url: '/api/fire-observations/mtg-frp?operation=map&bbox=0,0,10,20&width=256&height=256&style=evil',
      headers: { host: 'localhost' },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(headers.get('content-type')).toBe('image/png');
    expect(responseBody).toBeInstanceOf(Uint8Array);
    expect((responseBody as Uint8Array).byteLength).toBe(0);
    const upstreamUrl = new URL(String(upstreamFetch.mock.calls[0]?.[0]));
    expect(upstreamUrl.origin + upstreamUrl.pathname).toBe('https://adaguc.lsasvcs.ipma.pt/adagucserver');
    expect(upstreamUrl.searchParams.get('DATASET')).toBe('MTG-FRP');
    expect(upstreamUrl.searchParams.get('LAYERS')).toBe('FRP');
    expect(upstreamUrl.searchParams.get('STYLES')).toBe('pointdata/point');
  });

  it.each([
    ['bbox', 'bbox=10,0,-10,20&width=256&height=256'],
    ['width', 'bbox=0,0,10,20&width=0&height=256'],
    ['height', 'bbox=0,0,10,20&width=256&height=1025'],
    ['time', 'bbox=0,0,10,20&width=256&height=256&time=2026-02-31T12:50:00Z'],
  ])('rejects invalid map %s before contacting upstream', async (_field, query) => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await invokeVercelHandler(
      `/api/fire-observations/mtg-frp?operation=map&${query}`,
    );

    expect(response.statusCode).toBe(400);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('forwards validated bbox, dimensions and time to the fixed GetMap operation', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'Content-Type': 'image/png; charset=binary' },
    }));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await invokeVercelHandler(
      '/api/fire-observations/mtg-frp?operation=map&bbox=-10,-20,10,20&width=512&height=128&time=2026-07-16T12:50:00Z',
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=600, stale-while-revalidate=1800');
    const upstreamUrl = new URL(String(upstreamFetch.mock.calls[0]?.[0]));
    expect(upstreamUrl.searchParams.get('REQUEST')).toBe('GetMap');
    expect(upstreamUrl.searchParams.get('BBOX')).toBe('-10,-20,10,20');
    expect(upstreamUrl.searchParams.get('WIDTH')).toBe('512');
    expect(upstreamUrl.searchParams.get('HEIGHT')).toBe('128');
    expect(upstreamUrl.searchParams.get('TIME')).toBe('2026-07-16T12:50:00Z');
  });

  it.each([
    ['an upstream non-PNG content type', new Response('not png', { status: 200, headers: { 'Content-Type': 'text/plain' } })],
    ['an XML exception disguised as PNG', new Response(
      '<ServiceExceptionReport><ServiceException>bad request</ServiceException></ServiceExceptionReport>',
      { status: 200, headers: { 'Content-Type': 'image/png' } },
    )],
  ])('rejects %s', async (_case, upstreamResponse) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstreamResponse));

    const response = await invokeVercelHandler(
      '/api/fire-observations/mtg-frp?operation=map&bbox=0,0,10,20&width=256&height=256',
    );

    expect(response.statusCode).toBe(502);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });

  it('rejects non-GET methods and unsupported operations without contacting upstream', async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);

    const methodResponse = await invokeVercelHandler(
      '/api/fire-observations/mtg-frp?operation=metadata',
      'POST',
    );
    const operationResponse = await invokeVercelHandler(
      '/api/fire-observations/mtg-frp?operation=features',
    );

    expect(methodResponse.statusCode).toBe(405);
    expect(methodResponse.headers.get('allow')).toBe('GET');
    expect(operationResponse.statusCode).toBe(400);
    expect(operationResponse.headers.get('cache-control')).toBe('no-store');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('returns parsed metadata with the metadata cache policy', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(CAPABILITIES_XML, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    }));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await invokeVercelHandler(
      '/api/fire-observations/mtg-frp?operation=metadata',
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=120');
    expect(JSON.parse(String(response.body))).toMatchObject({
      observedAt: '2026-07-16T12:50:00Z',
      cadenceMinutes: 10,
      demonstration: true,
    });
    const upstreamUrl = new URL(String(upstreamFetch.mock.calls[0]?.[0]));
    expect(upstreamUrl.searchParams.get('REQUEST')).toBe('GetCapabilities');
  });

  it.each([
    ['a non-XML metadata content type', new Response(CAPABILITIES_XML, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })],
    ['a metadata XML exception', new Response(
      '<ServiceExceptionReport><ServiceException>bad request</ServiceException></ServiceExceptionReport>',
      { status: 200, headers: { 'Content-Type': 'application/xml' } },
    )],
  ])('rejects %s', async (_case, upstreamResponse) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstreamResponse));

    const response = await invokeVercelHandler(
      '/api/fire-observations/mtg-frp?operation=metadata',
    );

    expect(response.statusCode).toBe(502);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects impossible metadata calendar dates', async () => {
    const invalidCapabilities = CAPABILITIES_XML.replaceAll(
      '2026-07-16T12:50:00Z',
      '2026-04-31T12:50:00Z',
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(invalidCapabilities, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })));

    const response = await invokeVercelHandler(
      '/api/fire-observations/mtg-frp?operation=metadata',
    );

    expect(response.statusCode).toBe(502);
  });
});
