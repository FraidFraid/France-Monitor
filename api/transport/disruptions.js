/**
 * api/transport/disruptions.js — Vercel serverless proxy for SNCF disruptions.
 * Mirrors src/plugins/sncf-proxy.ts for production deployment.
 * Route: GET /api/transport/disruptions
 */

const SNCF_API_BASE = 'https://api.sncf.com/v1';
const CACHE_TTL_MS = 5 * 60_000; // 5 min

let _cache = null;
let _cacheAt = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // In-process cache — reused across warm lambda invocations
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(_cache);
    return;
  }

  const apiKey = process.env.SNCF_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: 'SNCF_API_KEY not configured' } });
    return;
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
    // depth=2 includes detailed object info with coordinates
    const url = `${SNCF_API_BASE}/coverage/sncf/disruptions?count=100&depth=2`;

    const upstream = await fetch(url, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error('[sncf-disruptions] upstream error:', upstream.status, body);
      res.status(502).json({ error: { message: `SNCF API error ${upstream.status}` } });
      return;
    }

    const data = await upstream.json();
    _cache = data;
    _cacheAt = Date.now();

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(data);
  } catch (err) {
    console.error('[sncf-disruptions] fetch failed:', err);
    res.status(502).json({ error: { message: 'SNCF API fetch failed' } });
  }
}
