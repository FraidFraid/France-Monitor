import { fetchMilitaryFlightsSnapshot } from '../_shared/military-flights.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const snapshot = await fetchMilitaryFlightsSnapshot(fetch);
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=10');
    res.status(200).json(snapshot);
  } catch (error) {
    console.error('[military-flights]', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Military flights fetch failed',
    });
  }
}
