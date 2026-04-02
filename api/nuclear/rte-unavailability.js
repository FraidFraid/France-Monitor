/**
 * api/nuclear/rte-unavailability.js — Vercel Serverless Function
 *
 * OAuth2 flow inline + GET unavailabilities RTE pour le nucléaire.
 * Renvoie un tableau d'indisponibilités normalisées.
 *
 * Env vars requises : RTE_CLIENT_ID, RTE_CLIENT_SECRET
 * Env var optionnelle : RTE_API_VERSION (défaut: v4)
 *
 * Source : https://digital.iservices.rte-france.com/open_api/unavailability_additional_information/
 */

const RTE_TOKEN_URL = 'https://digital.iservices.rte-france.com/token/oauth/token';
const API_VERSION   = process.env.RTE_API_VERSION ?? 'v4';
const RTE_UNAV_URL  =
  `https://digital.iservices.rte-france.com/open_api/unavailability_additional_information/${API_VERSION}/generation_unavailabilities`;

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min
let _cache = null; // { data, fetchedAt }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const clientId     = process.env.RTE_CLIENT_ID;
  const clientSecret = process.env.RTE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    res.status(503).json({
      error: 'RTE_CLIENT_ID or RTE_CLIENT_SECRET not configured',
      available: false,
    });
    return;
  }

  // Serve from cache if fresh
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', `s-maxage=${Math.floor(CACHE_TTL_MS / 1000)}, stale-while-revalidate`);
    res.status(200).json(_cache.data);
    return;
  }

  try {
    // ── Step 1: Obtain OAuth2 token ───────────────────────────────────────
    const tokenResp = await fetch(RTE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenResp.ok) {
      const body = await tokenResp.text().catch(() => '');
      console.error('[nuclear-rte] Token error:', tokenResp.status, body);
      res.status(502).json({ error: `OAuth token failed: ${tokenResp.status}`, available: false });
      return;
    }

    const { access_token } = await tokenResp.json();

    // ── Step 2: Fetch unavailabilities ────────────────────────────────────
    const params = new URLSearchParams({
      resource_type: 'NUCLEAR',
      status: 'ACTIVE',
    });

    const unavResp = await fetch(`${RTE_UNAV_URL}?${params}`, {
      headers: { Authorization: `Bearer ${access_token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!unavResp.ok) {
      console.error('[nuclear-rte] Unavailability API error:', unavResp.status);
      res.status(502).json({ error: `RTE API error: ${unavResp.status}`, available: false });
      return;
    }

    const raw = await unavResp.json();

    // Normaliser la réponse vers un tableau plat
    const items = Array.isArray(raw)
      ? raw
      : (raw.generation_unavailabilities ?? raw.unavailabilities ?? []);

    const payload = { items, available: true, fetchedAt: new Date().toISOString() };
    _cache = { data: payload, fetchedAt: Date.now() };

    res.setHeader('Cache-Control', `s-maxage=${Math.floor(CACHE_TTL_MS / 1000)}, stale-while-revalidate`);
    res.status(200).json(payload);
  } catch (err) {
    console.error('[nuclear-rte] Unexpected error:', err);
    res.status(500).json({ error: String(err), available: false });
  }
}
