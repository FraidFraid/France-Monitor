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

function formatBrowserDayBounds(date) {
  const day = date.toISOString().split('T')[0];
  return {
    fromTime: `${day}T00:00:00.000Z`,
    toTime: `${day}T23:59:59.999Z`,
  };
}

function buildEoBrowserUrl(bbox, collection) {
  const centerLng = ((bbox[0] + bbox[2]) / 2).toFixed(5);
  const centerLat = ((bbox[1] + bbox[3]) / 2).toFixed(5);
  const extent = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const zoom = extent < 0.2 ? 13 : extent < 1 ? 11 : extent < 3 ? 9 : 7;
  const { fromTime, toTime } = formatBrowserDayBounds(new Date());

  if (collection === 'sentinel-1-grd') {
    return `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${centerLat}&lng=${centerLng}&themeId=DEFAULT-THEME&fromTime=${encodeURIComponent(fromTime)}&toTime=${encodeURIComponent(toTime)}`;
  }
  return `https://browser.dataspace.copernicus.eu/?zoom=${zoom}&lat=${centerLat}&lng=${centerLng}&themeId=DEFAULT-THEME&datasetId=S2_L2A_CDAS&fromTime=${encodeURIComponent(fromTime)}&toTime=${encodeURIComponent(toTime)}&layerId=1_TRUE_COLOR&cloudCoverage=30&dateMode=SINGLE`;
}

function mapStacFeatures(features, collection) {
  return features.map((feat) => {
    const props = feat.properties ?? {};
    const thumbnailLink = Array.isArray(feat.links)
      ? feat.links.find((link) => link?.rel === 'thumbnail')?.href
      : undefined;
    const thumbnailUrl = thumbnailLink
      ?? feat.assets?.thumbnail?.href
      ?? feat.assets?.overview?.href;
    // S2 TCI Cloud Optimized GeoTIFF — public on S3, used for TiTiler AOI crop (MVP Option A)
    const cogUrl = collection === 'sentinel-2-l2a'
      ? (feat.assets?.visual?.href ?? feat.assets?.TCI?.href ?? undefined)
      : undefined;
    return {
      id: feat.id ?? `${collection}-${Date.now()}`,
      datetime: props.datetime ?? props['datetime:created'] ?? new Date().toISOString(),
      cloudCover: props['eo:cloud_cover'] !== undefined ? Number(props['eo:cloud_cover']) : undefined,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(cogUrl ? { cogUrl } : {}),
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
    collections: collection,
    bbox: bboxStr,
    datetime,
    limit: String(limit),
  });

  const stacUrl = `${STAC_BASE}/search?${stacParams.toString()}`;

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

    features.sort((a, b) => {
      const aTime = Date.parse(a?.properties?.datetime ?? '') || 0;
      const bTime = Date.parse(b?.properties?.datetime ?? '') || 0;
      return bTime - aTime;
    });

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
