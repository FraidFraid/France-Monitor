import { fetchAirTrafficSnapshotFromRelay, resolveRelayBaseUrl } from '../_shared/air-relay.js';
import { fetchAirTrafficSnapshot } from '../_shared/air-traffic.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    let snapshot;
    const relayBaseUrl = resolveRelayBaseUrl();
    if (relayBaseUrl) {
      try {
        snapshot = await fetchAirTrafficSnapshotFromRelay(fetch, relayBaseUrl);
      } catch (relayError) {
        console.warn('[air-traffic] relay failed, falling back to direct upstream', relayError);
        snapshot = await fetchAirTrafficSnapshot(fetch);
      }
    } else {
      snapshot = await fetchAirTrafficSnapshot(fetch);
    }
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=30');
    res.status(200).json(snapshot);
  } catch (error) {
    console.error('[air-traffic]', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Air traffic fetch failed',
    });
  }
}
