export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { lat, lon, fields = 'nom', format = 'json' } = req.query || {};

  if (!lat || !lon) {
    res.status(400).json({ error: 'Missing lat/lon query params' });
    return;
  }

  const search = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    fields: String(fields),
    format: String(format),
  });

  try {
    const upstream = await fetch(`https://geo.api.gouv.fr/communes?${search.toString()}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'FranceMonitor/1.0',
      },
      signal: AbortSignal.timeout(15000),
    });

    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(body);
  } catch (error) {
    console.error('[api/elus/communes] upstream error:', error);
    res.status(502).json({ error: 'Proxy error' });
  }
}
