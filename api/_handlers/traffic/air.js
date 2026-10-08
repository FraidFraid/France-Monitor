// api/_handlers/traffic/air.js : positions des avions pour la carte (spec 2026-10-03 panneaux trafic § 2.3).
// Lit la collecte serveur OpenSky partagée (2 min au plus) : la relève client de 12 s ne déclenche aucun
// appel OpenSky de plus. Plus de relais ni d'airplanes.live.
import { fetchAirTrafficSnapshot } from '../../_shared/air-traffic.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const snapshot = await fetchAirTrafficSnapshot(Date.now());
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.status(200).json(snapshot);
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: error instanceof Error ? error.message : 'OpenSky indisponible' });
  }
}
