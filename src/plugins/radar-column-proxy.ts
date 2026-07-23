import type { Plugin } from 'vite';

import { parseRadarColumnProfile } from '../services/radar-column.ts';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;

type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(status: number, payload: unknown, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function workerOrigin(configuredManifestUrl: string): string | null {
  if (!configuredManifestUrl.trim()) return null;
  try {
    const url = new URL(configuredManifestUrl);
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHostname(url.hostname))) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error('Radar column body is too large');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Radar column body is unavailable');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('Radar column body is too large');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

export async function handleRadarColumnRequest(
  configuredManifestUrl: string,
  lat: number,
  lon: number,
  fetchImplementation: FetchImplementation = fetch,
): Promise<Response> {
  const origin = workerOrigin(configuredManifestUrl);
  if (!origin) return jsonResponse(200, { configured: false });
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 41 || lat > 52 || lon < -6 || lon > 10) {
    return jsonResponse(400, { error: 'lat/lon hors métropole' });
  }

  try {
    const upstream = await fetchImplementation(
      `${origin}/volume/column?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
      { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (upstream.status === 404) {
      return jsonResponse(404, { error: 'hors_couverture' }, 'public, s-maxage=120');
    }
    const contentType = (upstream.headers.get('Content-Type') ?? '').toLowerCase();
    if (!upstream.ok || !contentType.includes('application/json')) {
      return jsonResponse(502, { error: 'Invalid radar column response' });
    }
    const profile = parseRadarColumnProfile(await readLimitedJson(upstream));
    if (!profile) return jsonResponse(502, { error: 'Malformed radar column' });
    return jsonResponse(200, profile, 'public, s-maxage=120');
  } catch {
    return jsonResponse(502, { error: 'Radar column upstream unavailable' });
  }
}

export function radarColumnProxyPlugin(configuredManifestUrl: string): Plugin {
  return {
    name: 'radar-column-proxy',
    configureServer(server) {
      server.middlewares.use('/api/fire-observations/radar-column', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        const requestUrl = new URL(req.url ?? '/', 'http://localhost');
        const lat = Number(requestUrl.searchParams.get('lat'));
        const lon = Number(requestUrl.searchParams.get('lon'));
        const response = await handleRadarColumnRequest(configuredManifestUrl, lat, lon);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(new Uint8Array(await response.arrayBuffer()));
      });
    },
  };
}
