/**
 * api/transport/osm-railways.js — OSM railway extraction proxy for SNCF UI.
 * Route: GET /api/transport/osm-railways?bbox=minLat,minLon,maxLat,maxLon
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_MS = 10 * 60_000;

const cache = new Map();

function parseBbox(raw) {
  if (!raw) return null;
  const parts = raw.split(',').map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [minLat, minLon, maxLat, maxLon] = parts;
  return { minLat, minLon, maxLat, maxLon };
}

function overpassQuery({ minLat, minLon, maxLat, maxLon }) {
  return `
[out:json][timeout:20];
(
  way["railway"="rail"](${minLat},${minLon},${maxLat},${maxLon});
);
out body geom;
`.trim();
}

function toFeatureCollection(elements) {
  const features = [];
  for (const element of elements) {
    if (element.type !== 'way' || !Array.isArray(element.geometry) || element.geometry.length < 2) continue;
    const coordinates = element.geometry
      .map((coord) => [coord.lon, coord.lat])
      .filter((coord) => Number.isFinite(coord[0]) && Number.isFinite(coord[1]));

    if (coordinates.length < 2) continue;

    features.push({
      type: 'Feature',
      id: element.id,
      geometry: {
        type: 'LineString',
        coordinates,
      },
      properties: {
        id: element.id,
        name: element.tags?.name ?? null,
        railway: element.tags?.railway ?? 'rail',
        service: element.tags?.service ?? null,
        usage: element.tags?.usage ?? null,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const bbox = parseBbox(req.query?.bbox);
  if (!bbox) {
    res.status(400).json({ error: { message: 'Missing or invalid bbox' } });
    return;
  }

  const key = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.status(200).json(cached.data);
    return;
  }

  try {
    const upstream = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Accept': 'application/json',
      },
      body: `data=${encodeURIComponent(overpassQuery(bbox))}`,
      signal: AbortSignal.timeout(20_000),
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error('[osm-railways] upstream error:', upstream.status, body);
      res.status(502).json({ error: { message: `Overpass error ${upstream.status}` } });
      return;
    }

    const data = await upstream.json();
    const geojson = toFeatureCollection(data.elements ?? []);
    cache.set(key, { at: Date.now(), data: geojson });

    res.setHeader('Cache-Control', 'public, max-age=600');
    res.status(200).json(geojson);
  } catch (error) {
    console.error('[osm-railways] fetch failed:', error);
    res.status(502).json({ error: { message: 'OSM rail fetch failed' } });
  }
}
