export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const tomtomKey = (process.env.VITE_TOMTOM_API_KEY || process.env.TOMTOM_API_KEY || '').replace(/\s+/g, ''); // env collée avec \n = URL/headers invalides
  if (!tomtomKey) {
    res.status(500).json({ error: 'TomTom API key missing' });
    return;
  }

  const bbox = typeof req.query?.bbox === 'string' ? req.query.bbox : '';
  if (!bbox) {
    res.status(400).json({ error: 'bbox query param is required' });
    return;
  }

  try {
    const upstreamUrl =
      `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(tomtomKey)}` +
      `&bbox=${encodeURIComponent(bbox)}` +
      `&fields=${encodeURIComponent('{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity,probabilityOfOccurrence,numberOfReports,lastReportTime}}}')}` +
      `&language=fr-FR&timeValidityFilter=present,future`;

    const response = await fetch(upstreamUrl, { signal: AbortSignal.timeout(10_000) });
    const json = await response.json();

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30');
    res.status(response.status).json(json);
  } catch (error) {
    console.error('[traffic-road]', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Road traffic fetch failed',
    });
  }
}
