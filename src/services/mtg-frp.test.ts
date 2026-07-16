import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchMtgFrpMetadata,
  getMtgFrpTileTemplate,
  parseMtgCapabilities,
  validateMtgMapRequest,
} from './mtg-frp.ts';
import { handleMtgFrpProxyRequest } from '../plugins/mtg-frp-proxy.ts';
import mtgFrpHandler from '../../api/fire-observations/mtg-frp.js';

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

  it('returns a fixed same-origin MapLibre tile template', () => {
    const template = getMtgFrpTileTemplate();
    expect(template).toBe('/api/fire-observations/mtg-frp?operation=map&bbox={bbox-epsg-3857}&width=256&height=256');
    expect(template).not.toContain('adaguc');
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
});
