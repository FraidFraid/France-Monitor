/**
 * api/_handlers/traffic/flow.js : survol d'un tronçon (TomTom Flow Segment Data v4), clé côté serveur.
 * Le client appelle /api/traffic/flow?point=lat,lon&zoom=Z ; la réponse TomTom brute (JSON) est renvoyée
 * telle quelle pour que le parsing client reste identique. Budget serveur journalier (spec 2026-10-03
 * panneaux trafic § 2.2) : 250 appels par jour (heure de Paris), compté avec la collecte urbaine.
 */
import { reserveFlowCall, tomtomKey } from '../../_lib/tomtom-urban.js';
import { SOURCE_USER_AGENT } from '../../_lib/source-http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = tomtomKey();
  if (!key) {
    res.status(500).json({ error: 'TomTom API key missing' });
    return;
  }

  const point = typeof req.query?.point === 'string' ? req.query.point : '';
  // point attendu : "lat,lon" (deux nombres décimaux, éventuellement négatifs).
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(point)) {
    res.status(400).json({ error: 'point query param (lat,lon) is required' });
    return;
  }

  const zoomRaw = Number(req.query?.zoom ?? 10);
  const zoom = Math.max(0, Math.min(22, Math.round(Number.isFinite(zoomRaw) ? zoomRaw : 10)));

  if (!(await reserveFlowCall(Date.now()))) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(429).json({ error: 'Budget TomTom du jour atteint pour le survol des tronçons' });
    return;
  }

  try {
    const upstreamUrl =
      `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/${zoom}/json` +
      `?key=${encodeURIComponent(key)}&point=${encodeURIComponent(point)}&unit=kmph&thickness=10`;

    const response = await fetch(upstreamUrl, { headers: { 'User-Agent': SOURCE_USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    const json = await response.json();

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
    res.status(response.status).json(json);
  } catch (error) {
    console.error('[traffic-flow]', error instanceof Error ? error.message : error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Flow segment fetch failed',
    });
  }
}
