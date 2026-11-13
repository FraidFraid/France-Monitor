/**
 * api/traffic/tile.js — Vercel Serverless Function
 *
 * Proxy des tuiles raster TomTom Traffic Flow : garde la clé TomTom côté serveur.
 * MapLibre appelle /api/traffic/tile?z={z}&x={x}&y={y} ; on renvoie le PNG binaire.
 * Le CDN Vercel absorbe la volumétrie (Cache-Control long).
 *
 * Route : GET /api/traffic/tile
 */
import { asRateLimitRequest, checkRateLimit } from '../../_utils/rate-limit.js';

/** Tuiles par adresse et par minute : un écran en demande quelques dizaines par déplacement de carte. */
const TILE_RATE_LIMIT_PER_MIN = 600;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rl = await checkRateLimit('traffic-tile', asRateLimitRequest(req), TILE_RATE_LIMIT_PER_MIN);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter || 60));
    res.status(429).json({ error: 'Too Many Requests' });
    return;
  }

  const tomtomKey = (process.env.TOMTOM_API_KEY || process.env.VITE_TOMTOM_API_KEY || '').replace(/\s+/g, ''); // env collée avec \n = URL/headers invalides
  if (!tomtomKey) {
    res.status(500).json({ error: 'TomTom API key missing' });
    return;
  }

  const z = Number(req.query?.z);
  const x = Number(req.query?.x);
  const y = Number(req.query?.y);
  const valid =
    Number.isInteger(z) && z >= 0 && z <= 22 &&
    Number.isInteger(x) && x >= 0 && x < 2 ** z &&
    Number.isInteger(y) && y >= 0 && y < 2 ** z;
  if (!valid) {
    res.status(400).json({ error: 'z/x/y integer query params are required (0<=z<=22)' });
    return;
  }

  try {
    const upstreamUrl =
      `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png` +
      `?tileSize=256&key=${encodeURIComponent(tomtomKey)}`;

    const response = await fetch(upstreamUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      res.status(response.status).json({ error: `TomTom tile ${response.status}` });
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).send(buffer);
  } catch (error) {
    console.error('[traffic-tile]', error);
    res.status(502).json({
      error: 'Tile fetch failed',
    });
  }
}
