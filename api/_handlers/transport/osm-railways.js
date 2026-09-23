/**
 * api/transport/osm-railways.js — OSM railway extraction proxy for SNCF UI.
 * Route: GET /api/transport/osm-railways?bbox=minLat,minLon,maxLat,maxLon
 *
 * Cache : swr-cache (mémoire + Redis), par bbox — le réseau ferré est quasi-statique,
 * donc 24 h de fraîcheur et une tolérance de 7 jours en cas de panne Overpass.
 */

import { getOrRefresh } from '../../_utils/swr-cache.js';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_SEC = 24 * 60 * 60;
const CACHE_STALE_SEC = 7 * 24 * 60 * 60;

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

async function fetchOsmRailways(bbox) {
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
    throw new Error(`Overpass error ${upstream.status}`);
  }

  const data = await upstream.json();
  return toFeatureCollection(data.elements ?? []);
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

  const key = `swr:transport:osm-railways:${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;

  try {
    const { value: geojson, cache } = await getOrRefresh(
      key,
      { ttlSec: CACHE_TTL_SEC, staleSec: CACHE_STALE_SEC, timeoutMs: 22_000 },
      () => fetchOsmRailways(bbox),
    );
    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_TTL_SEC}, stale-while-revalidate=${CACHE_STALE_SEC}`);
    res.setHeader('X-Cache', cache);
    res.status(200).json(geojson);
  } catch (error) {
    console.error('[osm-railways] fetch failed:', error);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: { message: 'OSM rail fetch failed' } });
  }
}
