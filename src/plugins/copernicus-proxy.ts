import type { Plugin } from 'vite';

const STAC_BASE = 'https://earth-search.aws.element84.com/v1';
const ALLOWED_COLLECTIONS = ['sentinel-2-l2a', 'sentinel-1-grd'] as const;

function formatBrowserDayBounds(date: Date): { fromTime: string; toTime: string } {
  const day = date.toISOString().split('T')[0];
  return {
    fromTime: `${day}T00:00:00.000Z`,
    toTime: `${day}T23:59:59.999Z`,
  };
}

function buildEoBrowserUrl(
  bbox: [number, number, number, number],
  collection: typeof ALLOWED_COLLECTIONS[number],
): string {
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

export function copernicusProxyPlugin(): Plugin {
  return {
    name: 'copernicus-proxy',
    configureServer(server) {
      server.middlewares.use('/api/copernicus', async (req, res) => {
        const rawUrl = req.url ?? '/';
        const url = new URL(rawUrl, 'http://localhost');

        const collection = url.searchParams.get('collection');
        const bboxStr = url.searchParams.get('bbox');
        const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '5', 10), 10);
        const cloudMax = parseInt(url.searchParams.get('cloud_max') ?? '30', 10);

        if (!collection || !ALLOWED_COLLECTIONS.includes(collection as typeof ALLOWED_COLLECTIONS[number])) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Invalid collection. Allowed: sentinel-2-l2a, sentinel-1-grd' }));
          return;
        }
        const collectionKey = collection as typeof ALLOWED_COLLECTIONS[number];

        if (!bboxStr) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing bbox. Format: minLng,minLat,maxLng,maxLat' }));
          return;
        }

        const bboxParts = bboxStr.split(',').map(Number);
        if (bboxParts.length !== 4 || bboxParts.some((value) => Number.isNaN(value))) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Invalid bbox format. Expected 4 floats.' }));
          return;
        }

        const bbox = bboxParts as [number, number, number, number];
        if (Math.abs(bbox[2] - bbox[0]) > 5 || Math.abs(bbox[3] - bbox[1]) > 5) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'bbox extent exceeds 5 degrees' }));
          return;
        }

        const eoBrowserUrl = buildEoBrowserUrl(bbox, collectionKey);
        const now = new Date();
        const pastDate = new Date(now);
        pastDate.setDate(pastDate.getDate() - 90);
        const datetime = `${pastDate.toISOString().split('T')[0]}T00:00:00Z/${now.toISOString().split('T')[0]}T23:59:59Z`;

        const stacParams = new URLSearchParams({
          collections: collectionKey,
          bbox: bboxStr,
          datetime,
          limit: String(limit),
        });

        try {
          const upstream = await fetch(`${STAC_BASE}/search?${stacParams.toString()}`, {
            signal: AbortSignal.timeout(10000),
            headers: { Accept: 'application/geo+json' },
          });

          if (!upstream.ok) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ scenes: [], eoBrowserUrl, mode: 'thumbnail', fallbackReason: 'stac_error' }));
            return;
          }

          const data = await upstream.json() as { features?: Array<Record<string, any>> };
          let features = Array.isArray(data.features) ? data.features : [];

          if (collectionKey === 'sentinel-2-l2a') {
            features = features.filter((feature) => {
              const value = feature.properties?.['eo:cloud_cover'];
              return value == null || Number(value) <= cloudMax;
            });
          }

          features.sort((a, b) => {
            const aTime = Date.parse(a?.properties?.datetime ?? '') || 0;
            const bTime = Date.parse(b?.properties?.datetime ?? '') || 0;
            return bTime - aTime;
          });

          const scenes = features.map((feature) => {
            const props = feature.properties ?? {};
            const thumbnailLink = Array.isArray(feature.links)
              ? feature.links.find((link: { rel?: string; href?: string }) => link?.rel === 'thumbnail')?.href
              : undefined;
            return {
              id: feature.id ?? `${collectionKey}-${Date.now()}`,
              // Keep timestamps/raw ids from upstream for scene selection.
              datetime: props.datetime ?? props['datetime:created'] ?? new Date().toISOString(),
              cloudCover: props['eo:cloud_cover'] != null ? Number(props['eo:cloud_cover']) : undefined,
              thumbnailUrl: thumbnailLink ?? feature.assets?.thumbnail?.href ?? feature.assets?.overview?.href,
              cogUrl: collectionKey === 'sentinel-2-l2a'
                ? (feature.assets?.visual?.href ?? feature.assets?.TCI?.href ?? undefined)
                : undefined,
              bbox: feature.bbox ?? bbox,
              collection: collectionKey,
            };
          });

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.end(JSON.stringify({ scenes, eoBrowserUrl, mode: 'thumbnail' }));
        } catch (error) {
          console.error('[copernicus-proxy]', error);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ scenes: [], eoBrowserUrl, mode: 'thumbnail', fallbackReason: 'stac_error' }));
        }
      });
    },
  };
}
