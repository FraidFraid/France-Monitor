import { getOrRefresh } from '../../_utils/swr-cache.js';
import { fetchAirTrafficSnapshotFromRelay, resolveRelayBaseUrl } from '../../_shared/air-relay.js';
import { fetchAirTrafficSnapshot } from '../../_shared/air-traffic.js';

// Clé unique : le snapshot ne dépend d'aucun paramètre de requête (l'ancien `?t=Date.now()`
// côté client servait uniquement à contourner le cache HTTP, pas à faire varier la donnée).
const CACHE_KEY = 'swr:traffic:air';

async function produceSnapshot() {
  const relayBaseUrl = resolveRelayBaseUrl();
  if (relayBaseUrl) {
    try {
      return await fetchAirTrafficSnapshotFromRelay(fetch, relayBaseUrl);
    } catch (relayError) {
      console.warn('[air-traffic] relay failed, falling back to direct upstream', relayError);
      return await fetchAirTrafficSnapshot(fetch);
    }
  }
  return fetchAirTrafficSnapshot(fetch);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { value: snapshot, cache } = await getOrRefresh(
      CACHE_KEY,
      { ttlSec: 20, staleSec: 120, timeoutMs: 8_000 },
      produceSnapshot,
    );
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=120');
    res.setHeader('X-Cache', cache);
    res.status(200).json(snapshot);
  } catch (error) {
    console.error('[air-traffic]', error);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Air traffic fetch failed',
    });
  }
}
