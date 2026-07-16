import type { Plugin } from 'vite';

import { parseRadar2dManifest } from '../services/radar-2d.ts';

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

function validateConfiguredUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHostname(url.hostname))) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new Error('Radar manifest body is too large');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Radar manifest body is unavailable');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('Radar manifest body is too large');
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

export async function handleRadar2dProxyRequest(
  configuredManifestUrl: string,
  fetchImplementation: FetchImplementation = fetch,
): Promise<Response> {
  if (!configuredManifestUrl.trim()) return jsonResponse(200, { configured: false });
  const manifestUrl = validateConfiguredUrl(configuredManifestUrl);
  if (!manifestUrl) return jsonResponse(503, { error: 'Radar manifest URL is not safely configured' });

  try {
    const upstream = await fetchImplementation(manifestUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const contentType = (upstream.headers.get('Content-Type') ?? '').toLowerCase();
    if (!upstream.ok || !contentType.includes('application/json')) {
      return jsonResponse(502, { error: 'Invalid radar manifest response' });
    }
    const manifest = parseRadar2dManifest(await readLimitedJson(upstream));
    if (!manifest) return jsonResponse(502, { error: 'Malformed radar manifest' });
    return jsonResponse(200, manifest, 'public, s-maxage=120');
  } catch {
    return jsonResponse(502, { error: 'Radar manifest upstream unavailable' });
  }
}

export function radar2dProxyPlugin(configuredManifestUrl: string): Plugin {
  return {
    name: 'radar-2d-proxy',
    configureServer(server) {
      server.middlewares.use('/api/fire-observations/radar-2d', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        const response = await handleRadar2dProxyRequest(configuredManifestUrl);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(new Uint8Array(await response.arrayBuffer()));
      });
    },
  };
}
