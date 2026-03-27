/**
 * copernicus-proxy.ts — Vite Plugin (dev)
 *
 * Intercepts /api/copernicus and proxies to AWS Earth Search STAC v1.
 * Logic duplicated from api/copernicus.js (project convention — each plugin is standalone).
 */

import type { Plugin } from 'vite';

const STAC_BASE = 'https://earth-search.aws.element84.com/v1';
const ALLOWED = ['sentinel-2-l2a', 'sentinel-1-grd'];

function buildEoBrowserUrl(bbox: [number, number, number, number], collection: string): string {
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

function mapFeatures(features: unknown[], collection: string): unknown[] {
  return (features as Record<string, unknown>[]).map((feat) => {
    const props = (feat.properties as Record<string, unknown>) ?? {};
    const assets = feat.assets as Record<string, { href?: string }> | undefined;
    const thumbnailUrl = assets?.thumbnail?.href ?? assets?.overview?.href;
    return {
      id: feat.id ?? `${collection}-${Date.now()}`,
      datetime: (props.datetime as string) ?? new Date().toISOString(),
      cloudCover: props['eo:cloud_cover'] !== undefined ? Number(props['eo:cloud_cover']) : undefined,
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      bbox: feat.bbox ?? [0, 0, 0, 0],
      collection,
    };
  });
}

export function copernicusProxyPlugin(): Plugin {
  return {
    name: 'copernicus-proxy',
    configureServer(server) {
      server.middlewares.use('/api/copernicus', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        const u = new URL(req.url!, 'http://localhost');
        const collection = u.searchParams.get('collection');
        const bboxStr = u.searchParams.get('bbox');
        const limit = Math.min(parseInt(u.searchParams.get('limit') ?? '5', 10), 10);
        const cloudMax = parseInt(u.searchParams.get('cloud_max') ?? '30', 10);

        if (!collection || !ALLOWED.includes(collection) || !bboxStr) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid parameters' }));
          return;
        }

        const bboxParts = bboxStr.split(',').map(Number);
        if (bboxParts.length !== 4 || bboxParts.some(isNaN)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid bbox' }));
          return;
        }
        const bbox = bboxParts as [number, number, number, number];
        if (Math.abs(bbox[2] - bbox[0]) > 5 || Math.abs(bbox[3] - bbox[1]) > 5) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'bbox too large' }));
          return;
        }

        const eoBrowserUrl = buildEoBrowserUrl(bbox, collection);

        const now = new Date();
        const pastDate = new Date(now);
        pastDate.setDate(pastDate.getDate() - 90);
        const datetime = `${pastDate.toISOString().split('T')[0]}T00:00:00Z/${now.toISOString().split('T')[0]}T23:59:59Z`;
        const params = new URLSearchParams({ bbox: bboxStr, datetime, limit: String(limit), sortby: '-datetime' });
        const stacUrl = `${STAC_BASE}/collections/${collection}/items?${params.toString()}`;

        try {
          const upstream = await fetch(stacUrl, {
            signal: AbortSignal.timeout(10000),
            headers: { Accept: 'application/geo+json' },
          });
          if (!upstream.ok) throw new Error(`STAC HTTP ${upstream.status}`);

          const data = await upstream.json() as { features?: unknown[] };
          let features = data.features ?? [];

          if (collection === 'sentinel-2-l2a') {
            features = (features as Record<string, unknown>[]).filter((f) => {
              const props = f.properties as Record<string, unknown> | undefined;
              const cc = props?.['eo:cloud_cover'];
              return cc == null || Number(cc) <= cloudMax;
            });
          }

          const scenes = mapFeatures(features, collection);
          res.end(JSON.stringify({ scenes, eoBrowserUrl, mode: 'thumbnail' }));
        } catch (err) {
          console.error('[copernicus-proxy]', err);
          res.end(JSON.stringify({ scenes: [], eoBrowserUrl, mode: 'thumbnail', fallbackReason: 'stac_error' }));
        }
      });
    },
  };
}
