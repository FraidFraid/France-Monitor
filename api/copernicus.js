/**
 * api/copernicus.js — Vercel Serverless Function
 *
 * Proxies AWS Earth Search STAC v1 for Sentinel-2 and Sentinel-1 scenes.
 * No authentication required (STAC catalog is public).
 *
 * When COPERNICUS_CLIENT_ID + COPERNICUS_CLIENT_SECRET are set:
 *   → adds { mode: 'wms', wmsUrl: '...' } to the response (Approach C upgrade path).
 * Today: mode is always 'thumbnail'.
 *
 * GET /api/copernicus
 *   ?collection=sentinel-2-l2a|sentinel-1-grd   (required)
 *   &bbox=minLng,minLat,maxLng,maxLat            (required)
 *   &limit=5                                     (optional, default 5, max 10)
 *   &cloud_max=30                                (optional, S2 only, default 30)
 */

const STAC_BASE = 'https://earth-search.aws.element84.com/v1';
const ALLOWED_COLLECTIONS = ['sentinel-2-l2a', 'sentinel-1-grd'];

function buildEoBrowserUrl(bbox, collection) {
  const centerLng = ((bbox[0] + bbox[2]) / 2).toFixed(5);
  const centerLat = ((bbox[1] + bbox[3]) / 2).toFixed(5);
  const extent = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const zoom = extent < 0.2 ? 13 : extent < 1 ? 11 : extent < 3 ? 9 : 7;

  if (collection === 'sentinel-1-grd') {
    return `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${centerLat}&lng=${centerLng}&datasetId=S1GRD`;
  }
  const toTime = new Date().toISOString().split('T')[0] + 'T23:59:59.000Z';
  return `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${centerLat}&lng=${centerLng}&datasetId=S2L2A&toTime=${encodeURIComponent(toTime)}&cloudCoverage=30`;
}

function mapStacFeatures(features, collection) {
  return features.map((feat) => {
    const props = feat.properties ?? {};
    // Prefer thumbnail asset; fall back to overview if present
    const thumbnailUrl = feat.assets?.thumbnail?.href ?? feat.assets?.overview?.href;
    return {
      id: feat.id ?? `${collection}-${Date.now()}`,
      datetime: props.datetime ?? props['datetime:created'] ?? new Date().toISOString(),
      cloudCover: props['eo:cloud_cover'] !== undefined ? Number(props['eo:cloud_cover']) : undefined,
      // Only include thumbnailUrl if present (optional in CopernicusScene type)
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      bbox: feat.bbox ?? [0, 0, 0, 0],
      collection,
    };
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Parse params
  const rawUrl = req.url ?? '/';
  const baseUrl = `http://${req.headers?.host ?? 'localhost'}`;
  const url = new URL(rawUrl, baseUrl);

  const collection = url.searchParams.get('collection');
  const bboxStr = url.searchParams.get('bbox');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '5', 10), 10);
  const cloudMax = parseInt(url.searchParams.get('cloud_max') ?? '30', 10);

  // Validate collection
  if (!collection || !ALLOWED_COLLECTIONS.includes(collection)) {
    res.status(400).json({ error: 'Invalid collection. Allowed: sentinel-2-l2a, sentinel-1-grd' });
    return;
  }

  // Validate bbox
  if (!bboxStr) {
    res.status(400).json({ error: 'Missing bbox. Format: minLng,minLat,maxLng,maxLat' });
    return;
  }
  const bboxParts = bboxStr.split(',').map(Number);
  if (bboxParts.length !== 4 || bboxParts.some(isNaN)) {
    res.status(400).json({ error: 'Invalid bbox format. Expected 4 floats.' });
    return;
  }
  const [minLng, minLat, maxLng, maxLat] = bboxParts;
  if (Math.abs(maxLng - minLng) > 5 || Math.abs(maxLat - minLat) > 5) {
    res.status(400).json({ error: 'bbox extent exceeds 5 degrees' });
    return;
  }

  const bbox = [minLng, minLat, maxLng, maxLat];
  const eoBrowserUrl = buildEoBrowserUrl(bbox, collection);

  // Time window: last 90 days
  const now = new Date();
  const pastDate = new Date(now);
  pastDate.setDate(pastDate.getDate() - 90);
  const datetime = `${pastDate.toISOString().split('T')[0]}T00:00:00Z/${now.toISOString().split('T')[0]}T23:59:59Z`;

  const stacParams = new URLSearchParams({
    bbox: bboxStr,
    datetime,
    limit: String(limit),
    sortby: '-datetime',
  });

  const stacUrl = `${STAC_BASE}/collections/${collection}/items?${stacParams.toString()}`;

  try {
    const upstream = await fetch(stacUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/geo+json' },
    });

    if (!upstream.ok) {
      console.warn(`[api/copernicus] STAC HTTP ${upstream.status} for ${collection}`);
      res.status(200).json({ scenes: [], eoBrowserUrl, mode: 'thumbnail', fallbackReason: 'stac_error' });
      return;
    }

    const data = await upstream.json();
    let features = data.features ?? [];

    // Cloud cover filter applied server-side for S2
    // (CQL2 GET filter on AWS Earth Search may be unreliable; filter here instead)
    if (collection === 'sentinel-2-l2a') {
      features = features.filter((f) => {
        const cc = f.properties?.['eo:cloud_cover'];
        return cc == null || cc <= cloudMax;
      });
    }

    const scenes = mapStacFeatures(features, collection);

    // Upgrade path — Approach C: add WMS URL if credentials are set
    const clientId = process.env.COPERNICUS_CLIENT_ID;
    const clientSecret = process.env.COPERNICUS_CLIENT_SECRET;
    if (clientId && clientSecret) {
      // Future: fetch OAuth2 token and build WMS URL
      // For now: signal that upgrade is possible
      res.status(200).json({ scenes, eoBrowserUrl, mode: 'thumbnail', upgradeAvailable: true });
    } else {
      res.status(200).json({ scenes, eoBrowserUrl, mode: 'thumbnail' });
    }
  } catch (err) {
    console.error('[api/copernicus] Error:', err);
    res.status(200).json({ scenes: [], eoBrowserUrl, mode: 'thumbnail', fallbackReason: 'stac_error' });
  }
}
