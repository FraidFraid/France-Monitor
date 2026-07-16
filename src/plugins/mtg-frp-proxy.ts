import type { Plugin } from 'vite';

import {
  parseMtgCapabilities,
  validateMtgMapRequest,
  type MtgFrpMetadata,
} from '../services/mtg-frp.ts';

const UPSTREAM_URL = 'https://adaguc.lsasvcs.ipma.pt/adagucserver';
const ATTRIBUTION = 'EUMETSAT LSA SAF · CC BY 4.0' as const;
const FETCH_TIMEOUT_MS = 10_000;

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

function jsonResponse(status: number, payload: unknown, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });
}

function isXmlContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return normalized.includes('/xml') || normalized.includes('+xml');
}

function isXmlExceptionBody(body: Uint8Array): boolean {
  if (body.byteLength === 0) return false;
  const prefix = new TextDecoder().decode(body.slice(0, 4096)).trimStart();
  return /^<\?xml\b/i.test(prefix) || /^<(?:\w+:)?(?:ServiceExceptionReport|ExceptionReport)\b/i.test(prefix);
}

function upstreamUrl(params: Record<string, string>): string {
  const url = new URL(UPSTREAM_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function fetchUpstream(
  fetchImplementation: FetchImplementation,
  url: string,
  accept: string,
): Promise<Response> {
  return fetchImplementation(url, {
    headers: { Accept: accept },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function handleMetadata(fetchImplementation: FetchImplementation): Promise<Response> {
  const upstream = await fetchUpstream(fetchImplementation, upstreamUrl({
    SERVICE: 'WMS',
    REQUEST: 'GetCapabilities',
    VERSION: '1.3.0',
    DATASET: 'MTG-FRP',
  }), 'application/xml,text/xml');

  const contentType = upstream.headers.get('Content-Type') ?? '';
  if (!upstream.ok || !isXmlContentType(contentType)) {
    return jsonResponse(502, { error: 'Invalid MTG-FRP capabilities response' });
  }
  const xml = await upstream.text();
  if (/<(?:\w+:)?(?:ServiceExceptionReport|ExceptionReport)\b/i.test(xml)) {
    return jsonResponse(502, { error: 'MTG-FRP capabilities exception' });
  }

  try {
    const parsed = parseMtgCapabilities(xml);
    const metadata: MtgFrpMetadata = {
      observedAt: parsed.observedAt,
      fetchedAt: Date.now(),
      cadenceMinutes: 10,
      attribution: ATTRIBUTION,
      demonstration: true,
    };
    return jsonResponse(200, metadata, 'public, s-maxage=120');
  } catch {
    return jsonResponse(502, { error: 'Malformed MTG-FRP capabilities' });
  }
}

async function handleMap(url: URL, fetchImplementation: FetchImplementation): Promise<Response> {
  let request;
  try {
    request = validateMtgMapRequest({
      bbox: url.searchParams.get('bbox'),
      width: url.searchParams.get('width'),
      height: url.searchParams.get('height'),
      time: url.searchParams.get('time'),
    });
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Invalid map request' });
  }

  const upstream = await fetchUpstream(fetchImplementation, upstreamUrl({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    DATASET: 'MTG-FRP',
    LAYERS: 'FRP',
    STYLES: 'pointdata/point',
    FORMAT: 'image/png',
    EXCEPTIONS: 'XML',
    TRANSPARENT: 'TRUE',
    CRS: 'EPSG:3857',
    BBOX: request.bbox,
    WIDTH: String(request.width),
    HEIGHT: String(request.height),
    ...(request.time ? { TIME: request.time } : {}),
  }), 'image/png');

  const body = new Uint8Array(await upstream.arrayBuffer());
  const contentType = upstream.headers.get('Content-Type') ?? '';
  if (!upstream.ok || contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'image/png' || isXmlExceptionBody(body)) {
    return jsonResponse(502, { error: 'Invalid MTG-FRP map response' });
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800',
    },
  });
}

export async function handleMtgFrpProxyRequest(
  url: URL,
  fetchImplementation: FetchImplementation = (input, init) => fetch(input, init),
): Promise<Response> {
  try {
    const operation = url.searchParams.get('operation');
    if (operation === 'metadata') return await handleMetadata(fetchImplementation);
    if (operation === 'map') return await handleMap(url, fetchImplementation);
    return jsonResponse(400, { error: 'operation must be metadata or map' });
  } catch {
    return jsonResponse(502, { error: 'MTG-FRP upstream unavailable' });
  }
}

export function mtgFrpProxyPlugin(): Plugin {
  return {
    name: 'mtg-frp-proxy',
    configureServer(server) {
      server.middlewares.use('/api/fire-observations/mtg-frp', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const response = await handleMtgFrpProxyRequest(new URL(req.url ?? '/', 'http://localhost'));
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(new Uint8Array(await response.arrayBuffer()));
      });
    },
  };
}
