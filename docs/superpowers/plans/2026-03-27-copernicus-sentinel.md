# Copernicus / Sentinel Satellite Imagery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Voir satellite" CTA to Vigicrues flood popups and geolocated news popups that shows Sentinel-2/SAR thumbnails (via AWS Earth Search STAC public API) or falls back to an EO Browser deep-link — zero credentials required.

**Architecture:** A new `SatellitePanel` floating overlay (instantiated in `App.ts`) is triggered by a `SatelliteViewRequest` callback wired from `DeckGLMap` (flood) and `MapPopup` (news). A `copernicus.ts` service fetches from `/api/copernicus`, which proxies to AWS Earth Search STAC v1 — public, no auth. EO Browser deep-link is always available as fallback.

**Tech Stack:** Vanilla TypeScript, MapLibre GL JS, Vercel Serverless Functions, Vite Plugin dev proxies. AWS Earth Search STAC v1 (`earth-search.aws.element84.com/v1`). No new npm packages.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/types/index.ts` | Modify | Add 4 Copernicus types |
| `src/services/copernicus.ts` | Create | Bbox helpers, STAC fetch, EO Browser URL builder |
| `api/copernicus.js` | Create | Vercel function — proxy AWS Earth Search STAC |
| `src/plugins/copernicus-proxy.ts` | Create | Vite dev proxy for `/api/copernicus` |
| `vite.config.ts` | Modify | Register `copernicusProxyPlugin()` |
| `src/components/SatellitePanel.ts` | Create | Floating overlay: thumbnails, toggle, EO Browser CTA |
| `src/styles/main.css` | Modify | Add satellite panel and CTA button styles |
| `src/components/DeckGLMap.ts` | Modify | `onSatelliteView` property + bbox + button in flood popup |
| `src/components/MapPopup.ts` | Modify | `setOnSatelliteView` setter + button in item popup |
| `src/components/MapContainer.ts` | Modify | `setOnSatelliteView` relay to `deckMap` |
| `src/App.ts` | Modify | Instantiate `SatellitePanel`, wire callbacks |

---

## Task 1: Add Copernicus types to `src/types/index.ts`

**Files:**
- Modify: `src/types/index.ts` (after line 223, after the `FloodSegment` block)

- [ ] **Step 1: Open and read the types file to find insertion point**

  Confirm line 223 ends the floods section:
  ```typescript
  // ═══ Fires (NASA FIRMS) ═══
  ```
  Insert the Copernicus block immediately before this line.

- [ ] **Step 2: Add the 4 Copernicus types**

  Insert after the `FloodSegment` interface (line ~223), before the `// ═══ Fires` comment:

  ```typescript
  // ═══ Copernicus / Satellite ═══

  export type SatelliteCollection = 'sentinel-2-l2a' | 'sentinel-1-grd';
  export type SatelliteSourceType = 'news' | 'flood';

  export interface CopernicusScene {
    id: string;
    datetime: string;           // ISO 8601
    cloudCover?: number;        // 0–100; undefined for SAR
    thumbnailUrl?: string;      // Public S3 URL — may be absent on some S1 GRD items
    bbox: [number, number, number, number];  // [minLng, minLat, maxLng, maxLat]
    collection: SatelliteCollection;
  }

  export interface SatelliteViewRequest {
    bbox: [number, number, number, number];
    sourceType: SatelliteSourceType;
    title?: string;
    point?: [number, number];              // [lng, lat] if news source
    geometry?: LineString | MultiLineString;  // if flood source (named types, not GeoJSON.*)
    preferredCollection?: SatelliteCollection;
  }

  // Internal state type for SatellitePanel (private state field)
  export interface SatelliteViewState {
    visible: boolean;
    request: SatelliteViewRequest | null;
    activeCollection: SatelliteCollection;
    s2Scenes: CopernicusScene[];
    s1Scenes: CopernicusScene[];
    activeSceneIndex: number;
    loading: boolean;
    error: string | null;
    eoBrowserUrl: string;
  }
  ```

  Note: `LineString` and `MultiLineString` are already imported at the top of `src/types/index.ts` via `import type { LineString, MultiLineString } from 'geojson'`. Do NOT add a duplicate import.

- [ ] **Step 3: Verify the file parses — run typecheck**

  ```bash
  cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -20
  ```
  Expected: no new errors.

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/fraid/Desktop/FranceMonitor
  git add src/types/index.ts
  git commit -m "feat(satellite): add Copernicus/Sentinel types to index.ts"
  ```

---

## Task 2: Create `src/services/copernicus.ts`

**Files:**
- Create: `src/services/copernicus.ts`

- [ ] **Step 1: Create the file**

  ```typescript
  /**
   * copernicus.ts — Copernicus / Sentinel satellite imagery service.
   * Fetches Sentinel-2 and Sentinel-1 SAR scene thumbnails via /api/copernicus
   * (proxy to AWS Earth Search STAC v1, no auth required).
   * Builds EO Browser deep-links as fallback.
   */

  import type { CopernicusScene, SatelliteCollection } from '../types/index.ts';
  import type { LineString, MultiLineString } from 'geojson';

  // ─── Constants ───

  const PADDING_NEWS_DEG = 0.08;    // ~8 km radius around a news point
  const PADDING_FLOOD_DEG = 0.02;   // ~2 km padding around flood segment extent

  // ─── Bbox helpers ───

  /** Compute a square bbox around a news point [lng, lat]. */
  export function computeNewsItemBbox(lat: number, lon: number): [number, number, number, number] {
    return [
      lon - PADDING_NEWS_DEG,
      lat - PADDING_NEWS_DEG,
      lon + PADDING_NEWS_DEG,
      lat + PADDING_NEWS_DEG,
    ];
  }

  /**
   * Compute bbox from a Vigicrues LineString or MultiLineString geometry.
   * Returns extent of all coordinates + padding.
   */
  export function computeFloodSegmentBbox(
    geometry: LineString | MultiLineString,
    paddingDeg = PADDING_FLOOD_DEG,
  ): [number, number, number, number] {
    const allCoords: [number, number][] = geometry.type === 'LineString'
      ? (geometry.coordinates as [number, number][])
      : (geometry.coordinates as [number, number][][]).flat();

    if (allCoords.length === 0) {
      // Fallback: bounding box over Metropolitan France
      return [-5, 41, 10, 52];
    }

    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of allCoords) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }

    return [
      minLng - paddingDeg,
      minLat - paddingDeg,
      maxLng + paddingDeg,
      maxLat + paddingDeg,
    ];
  }

  // ─── EO Browser URL builder ───

  function computeZoom(bbox: [number, number, number, number]): number {
    const extent = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
    if (extent < 0.2) return 13;
    if (extent < 1) return 11;
    if (extent < 3) return 9;
    return 7;
  }

  /**
   * Build a Copernicus EO Browser deep-link URL centered on the bbox.
   * When date is omitted, defaults to today (required for S2 toTime param).
   */
  export function buildEoBrowserUrl(
    bbox: [number, number, number, number],
    collection: SatelliteCollection,
    date?: Date,
  ): string {
    const centerLng = ((bbox[0] + bbox[2]) / 2).toFixed(5);
    const centerLat = ((bbox[1] + bbox[3]) / 2).toFixed(5);
    const zoom = computeZoom(bbox);
    const base = 'https://browser.dataspace.copernicus.eu/';

    if (collection === 'sentinel-1-grd') {
      // S1: no toTime needed — EO Browser defaults to latest available
      return `${base}?zoom=${zoom}&lat=${centerLat}&lng=${centerLng}&datasetId=S1GRD`;
    }

    // S2: always include toTime to land on a specific date window
    const d = date ?? new Date();
    const toTime = d.toISOString().split('T')[0] + 'T23:59:59.000Z';
    return `${base}?zoom=${zoom}&lat=${centerLat}&lng=${centerLng}&datasetId=S2L2A&toTime=${encodeURIComponent(toTime)}&cloudCoverage=30`;
  }

  // ─── STAC fetch ───

  interface CopernicusApiResponse {
    scenes: CopernicusScene[];
    eoBrowserUrl: string;
    mode: 'thumbnail' | 'wms';
    fallbackReason?: string;
    wmsUrl?: string;  // present only if COPERNICUS_CLIENT_ID/SECRET are set (Approach C)
  }

  async function fetchFromApi(
    collection: SatelliteCollection,
    bbox: [number, number, number, number],
    options: { cloudMax?: number; limit?: number } = {},
  ): Promise<CopernicusScene[]> {
    const params = new URLSearchParams({
      collection,
      bbox: bbox.join(','),
      limit: String(options.limit ?? 5),
    });
    if (collection === 'sentinel-2-l2a' && options.cloudMax != null) {
      params.set('cloud_max', String(options.cloudMax));
    }

    try {
      const resp = await fetch(`/api/copernicus?${params.toString()}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!resp.ok) {
        console.warn(`[copernicus] HTTP ${resp.status}`);
        return [];
      }
      const data = await resp.json() as CopernicusApiResponse;
      return data.scenes ?? [];
    } catch (err) {
      console.warn('[copernicus] Fetch failed:', err);
      return [];
    }
  }

  /** Fetch Sentinel-2 L2A scenes for the given bbox. Returns [] on error. */
  export async function fetchSentinel2Scenes(
    bbox: [number, number, number, number],
    _eventDate?: Date,
  ): Promise<CopernicusScene[]> {
    return fetchFromApi('sentinel-2-l2a', bbox, { cloudMax: 30, limit: 6 });
  }

  /** Fetch Sentinel-1 GRD (SAR) scenes for the given bbox. Returns [] on error. */
  export async function fetchSentinel1Scenes(
    bbox: [number, number, number, number],
  ): Promise<CopernicusScene[]> {
    return fetchFromApi('sentinel-1-grd', bbox, { limit: 3 });
  }
  ```

- [ ] **Step 2: Run typecheck**

  ```bash
  cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -30
  ```
  Expected: no new errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/services/copernicus.ts
  git commit -m "feat(satellite): add copernicus.ts service — bbox helpers, STAC fetch, EO Browser URL"
  ```

---

## Task 3: Create `api/copernicus.js`

**Files:**
- Create: `api/copernicus.js`

- [ ] **Step 1: Create the Vercel function**

  ```javascript
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
  ```

- [ ] **Step 2: Test the endpoint manually in dev (after the proxy is wired in Task 4)**

  After Task 4, test with:
  ```bash
  curl "http://localhost:3001/api/copernicus?collection=sentinel-2-l2a&bbox=2.2,48.8,2.4,49.0&limit=3"
  ```
  Expected: JSON with `scenes` array (may be empty if no recent scenes) and `eoBrowserUrl`.

- [ ] **Step 3: Commit**

  ```bash
  git add api/copernicus.js
  git commit -m "feat(satellite): add api/copernicus.js Vercel function — STAC proxy, no auth"
  ```

---

## Task 4: Create Vite plugin + register in `vite.config.ts`

**Files:**
- Create: `src/plugins/copernicus-proxy.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Create `src/plugins/copernicus-proxy.ts`**

  ```typescript
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
  ```

- [ ] **Step 2: Register the plugin in `vite.config.ts`**

  Add the import at the top of `vite.config.ts` (after line 25, alongside the other plugin imports):
  ```typescript
  import { copernicusProxyPlugin } from './src/plugins/copernicus-proxy';
  ```

  Add `copernicusProxyPlugin()` to the `plugins` array (after `ministersProxyPlugin()`, before `aisRelayPlugin`):
  ```typescript
  ministersProxyPlugin(),
  copernicusProxyPlugin(),   // ← add this line
  aisRelayPlugin(aisApiKey),
  ```

- [ ] **Step 3: Run typecheck**

  ```bash
  cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -30
  ```
  Expected: no new errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/plugins/copernicus-proxy.ts vite.config.ts
  git commit -m "feat(satellite): add copernicus-proxy Vite plugin + register in vite.config.ts"
  ```

---

## Task 5: Create `src/components/SatellitePanel.ts`

**Files:**
- Create: `src/components/SatellitePanel.ts`

- [ ] **Step 1: Create the component**

  ```typescript
  /**
   * SatellitePanel.ts — Floating satellite imagery overlay.
   * Instantiated in App.ts. Triggered via show(SatelliteViewRequest).
   * Displays Sentinel-2/1 STAC thumbnails or falls back to EO Browser deep-link.
   * STAC-S1-THUMBNAIL-RELIABILITY: S1 GRD items may not have thumbnails in AWS Earth Search.
   * In that case, the SAR tab shows EO Browser deep-link only.
   */

  import type {
    SatelliteViewRequest,
    SatelliteViewState,
    CopernicusScene,
    SatelliteCollection,
  } from '../types/index.ts';
  import {
    fetchSentinel2Scenes,
    fetchSentinel1Scenes,
    buildEoBrowserUrl,
  } from '../services/copernicus.ts';

  function escapeHtml(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function formatDate(isoDate: string): string {
    try {
      return new Date(isoDate).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch {
      return isoDate;
    }
  }

  export class SatellitePanel {
    private element: HTMLElement;
    private parentEl: HTMLElement;
    private abortController: AbortController | null = null;
    private state: SatelliteViewState = {
      visible: false,
      request: null,
      activeCollection: 'sentinel-2-l2a',
      s2Scenes: [],
      s1Scenes: [],
      activeSceneIndex: 0,
      loading: false,
      error: null,
      eoBrowserUrl: '',
    };

    /** Callback for Approach C upgrade: called when WMS URL is available from backend */
    onWmsRequested?: (wmsUrl: string, bbox: [number, number, number, number]) => void;

    constructor(parentEl: HTMLElement) {
      this.parentEl = parentEl;
      this.element = document.createElement('div');
      this.element.className = 'satellite-panel';
      this.element.style.display = 'none';
      parentEl.appendChild(this.element);
    }

    show(req: SatelliteViewRequest): void {
      // Cancel any in-flight fetch
      this.abortController?.abort();
      this.abortController = new AbortController();

      const coll: SatelliteCollection = req.preferredCollection ?? 'sentinel-2-l2a';
      this.state = {
        visible: true,
        request: req,
        activeCollection: coll,
        s2Scenes: [],
        s1Scenes: [],
        activeSceneIndex: 0,
        loading: true,
        error: null,
        eoBrowserUrl: buildEoBrowserUrl(req.bbox, coll, new Date()),
      };

      this.element.style.display = 'block';
      this.render();

      void this.loadScenes(req, this.abortController.signal);
    }

    private async loadScenes(req: SatelliteViewRequest, signal: AbortSignal): Promise<void> {
      try {
        const [s2Result, s1Result] = await Promise.allSettled([
          fetchSentinel2Scenes(req.bbox),
          fetchSentinel1Scenes(req.bbox),
        ]);

        if (signal.aborted) return;

        const s2Scenes = s2Result.status === 'fulfilled' ? s2Result.value : [];
        const s1Scenes = s1Result.status === 'fulfilled' ? s1Result.value : [];

        this.state = {
          ...this.state,
          s2Scenes,
          s1Scenes,
          loading: false,
          error: null,
        };
        this.render();
      } catch {
        if (signal.aborted) return;
        this.state = { ...this.state, loading: false, error: 'Erreur de chargement' };
        this.render();
      }
    }

    private getActiveScenes(): CopernicusScene[] {
      return this.state.activeCollection === 'sentinel-1-grd'
        ? this.state.s1Scenes
        : this.state.s2Scenes;
    }

    private render(): void {
      const { state } = this;
      const req = state.request;
      const title = req?.title ?? 'Vue satellite';
      const scenes = this.getActiveScenes();
      const activeScene: CopernicusScene | null = scenes[state.activeSceneIndex] ?? null;
      const s2Active = state.activeCollection === 'sentinel-2-l2a';
      const s1Active = state.activeCollection === 'sentinel-1-grd';

      // Avant/Après only for S2 with 2+ scenes
      const showAvantApres = s2Active && state.s2Scenes.length >= 2;
      const eoBrowserUrl = state.eoBrowserUrl;

      // ─── Body ───
      let bodyHtml = '';

      if (state.loading) {
        bodyHtml = `
          <div class="satellite-panel__loading">
            <div class="satellite-panel__spinner"></div>
            <span>Recherche scènes Sentinel…</span>
          </div>`;
      } else if (state.error || scenes.length === 0) {
        const msg = scenes.length === 0
          ? 'Aucune scène disponible pour cette zone'
          : (state.error ?? 'Erreur');
        bodyHtml = `<div class="satellite-panel__empty">${escapeHtml(msg)}</div>`;
      } else if (activeScene) {
        const thumb = activeScene.thumbnailUrl;
        const dateStr = formatDate(activeScene.datetime);
        const cloudHtml = activeScene.cloudCover != null
          ? `<span class="satellite-panel__cloud">☁️ ${activeScene.cloudCover.toFixed(0)}%</span>`
          : '';

        bodyHtml = `
          <div class="satellite-panel__thumb-wrap">
            ${thumb
              ? `<img class="satellite-panel__thumb"
                      src="${escapeHtml(thumb)}"
                      alt="Sentinel thumbnail"
                      loading="lazy"
                      onerror="this.parentElement.innerHTML='<div class=\\"satellite-panel__thumb satellite-panel__thumb--placeholder\\">🛰️</div>'"
                 />`
              : `<div class="satellite-panel__thumb satellite-panel__thumb--placeholder">🛰️</div>`
            }
          </div>
          <div class="satellite-panel__meta">🗓️ ${escapeHtml(dateStr)} ${cloudHtml}</div>`;

        if (showAvantApres) {
          const apresActive = state.activeSceneIndex === 0;
          const avantActive = state.activeSceneIndex === state.s2Scenes.length - 1;
          bodyHtml += `
            <div class="satellite-panel__toggle">
              <button class="satellite-panel__toggle-btn ${avantActive ? 'active' : ''}"
                      data-action="avant">◀ Avant</button>
              <button class="satellite-panel__toggle-btn ${apresActive ? 'active' : ''}"
                      data-action="apres">Après ▶</button>
            </div>`;
        }
      }

      this.element.innerHTML = `
        <div class="satellite-panel__header">
          <span class="satellite-panel__icon">🛰️</span>
          <span class="satellite-panel__title">${escapeHtml(title)}</span>
          <button class="satellite-panel__close" data-action="close" title="Fermer">✕</button>
        </div>
        <div class="satellite-panel__collections">
          <button class="satellite-panel__coll-btn ${s2Active ? 'active' : ''}" data-action="s2">
            Sentinel-2
          </button>
          <button class="satellite-panel__coll-btn ${s1Active ? 'active' : ''}" data-action="s1">
            SAR S-1
          </button>
        </div>
        <div class="satellite-panel__body">${bodyHtml}</div>
        <div class="satellite-panel__footer">
          <a class="satellite-panel__eo-btn"
             href="${escapeHtml(eoBrowserUrl)}"
             target="_blank"
             rel="noopener noreferrer">
            ↗ Ouvrir dans EO Browser
          </a>
        </div>
      `;

      this.attachListeners();
    }

    private attachListeners(): void {
      this.element.querySelector('[data-action="close"]')
        ?.addEventListener('click', () => this.hide());

      this.element.querySelector('[data-action="s2"]')?.addEventListener('click', () => {
        if (!this.state.request) return;
        this.state.activeCollection = 'sentinel-2-l2a';
        this.state.activeSceneIndex = 0;
        this.state.eoBrowserUrl = buildEoBrowserUrl(this.state.request.bbox, 'sentinel-2-l2a', new Date());
        this.render();
      });

      this.element.querySelector('[data-action="s1"]')?.addEventListener('click', () => {
        if (!this.state.request) return;
        this.state.activeCollection = 'sentinel-1-grd';
        this.state.activeSceneIndex = 0;
        this.state.eoBrowserUrl = buildEoBrowserUrl(this.state.request.bbox, 'sentinel-1-grd');
        this.render();
      });

      this.element.querySelector('[data-action="avant"]')?.addEventListener('click', () => {
        this.state.activeSceneIndex = this.state.s2Scenes.length - 1;
        this.render();
      });

      this.element.querySelector('[data-action="apres"]')?.addEventListener('click', () => {
        this.state.activeSceneIndex = 0;
        this.render();
      });
    }

    hide(): void {
      this.element.style.display = 'none';
      this.state.visible = false;
      this.abortController?.abort();
      this.abortController = null;
    }

    destroy(): void {
      this.abortController?.abort();
      this.abortController = null;
      if (this.element.parentElement) {
        this.element.remove();
      }
    }
  }
  ```

- [ ] **Step 2: Run typecheck**

  ```bash
  cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -30
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/SatellitePanel.ts
  git commit -m "feat(satellite): add SatellitePanel component — thumbnail, toggle, EO Browser fallback"
  ```

---

## Task 6: Add CSS styles to `src/styles/main.css`

**Files:**
- Modify: `src/styles/main.css` (append at end of file)

- [ ] **Step 1: Append satellite panel styles**

  Append at the **end** of `src/styles/main.css`:

  ```css
  /* ════════════════════════════════════════
     Satellite Panel (Copernicus / Sentinel)
     ════════════════════════════════════════ */

  .satellite-panel {
    position: fixed;
    top: var(--right-panel-top, 80px);
    right: 20px;
    width: 320px;
    background: var(--bg-panel, #1a1a2e);
    border: 1px solid var(--border-color, rgba(255,255,255,0.1));
    border-radius: 8px;
    z-index: 900;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    font-family: var(--font-ui, sans-serif);
    color: var(--text-primary, #e8e8ec);
    font-size: 13px;
  }

  .satellite-panel__header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .satellite-panel__icon { font-size: 16px; }

  .satellite-panel__title {
    flex: 1;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .satellite-panel__close {
    background: none;
    border: none;
    color: var(--text-secondary, #9898a8);
    cursor: pointer;
    padding: 2px 6px;
    font-size: 14px;
    line-height: 1;
    border-radius: 4px;
  }
  .satellite-panel__close:hover { background: rgba(255,255,255,0.08); }

  .satellite-panel__collections {
    display: flex;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .satellite-panel__coll-btn {
    flex: 1;
    padding: 5px 8px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    color: var(--text-secondary, #9898a8);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }
  .satellite-panel__coll-btn.active,
  .satellite-panel__coll-btn:hover {
    background: rgba(90,200,250,0.15);
    border-color: rgba(90,200,250,0.3);
    color: #5ac8fa;
  }

  .satellite-panel__body {
    padding: 12px;
    min-height: 80px;
  }

  .satellite-panel__loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 16px 0;
    color: var(--text-secondary, #9898a8);
  }

  .satellite-panel__spinner {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(255,255,255,0.1);
    border-top-color: #5ac8fa;
    border-radius: 50%;
    animation: satellite-spin 0.8s linear infinite;
  }
  @keyframes satellite-spin { to { transform: rotate(360deg); } }

  .satellite-panel__empty {
    color: var(--text-secondary, #9898a8);
    text-align: center;
    padding: 12px 0;
  }

  .satellite-panel__thumb-wrap {
    border-radius: 6px;
    overflow: hidden;
    background: rgba(255,255,255,0.05);
    margin-bottom: 8px;
  }

  .satellite-panel__thumb {
    width: 100%;
    height: 180px;
    object-fit: cover;
    display: block;
  }

  .satellite-panel__thumb--placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 48px;
    height: 180px;
    background: rgba(255,255,255,0.03);
  }

  .satellite-panel__meta {
    font-size: 12px;
    color: var(--text-secondary, #9898a8);
    margin-bottom: 8px;
  }

  .satellite-panel__cloud { margin-left: 8px; }

  .satellite-panel__toggle {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .satellite-panel__toggle-btn {
    flex: 1;
    padding: 5px 8px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    color: var(--text-secondary, #9898a8);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }
  .satellite-panel__toggle-btn.active {
    background: rgba(90,200,250,0.2);
    border-color: #5ac8fa;
    color: #5ac8fa;
    font-weight: 600;
  }

  .satellite-panel__footer {
    padding: 10px 12px;
    border-top: 1px solid rgba(255,255,255,0.08);
  }

  .satellite-panel__eo-btn {
    display: block;
    text-align: center;
    padding: 8px;
    background: rgba(90,200,250,0.1);
    border: 1px solid rgba(90,200,250,0.2);
    border-radius: 4px;
    color: #5ac8fa;
    text-decoration: none;
    font-size: 13px;
    transition: background 0.15s;
  }
  .satellite-panel__eo-btn:hover { background: rgba(90,200,250,0.2); }

  /* CTA button inside Vigicrues flood popup */
  .satellite-cta-btn {
    display: inline-block;
    margin-top: 8px;
    padding: 5px 10px;
    background: rgba(90,200,250,0.1);
    border: 1px solid rgba(90,200,250,0.3);
    border-radius: 4px;
    color: #5ac8fa;
    font-size: 12px;
    cursor: pointer;
    font-family: sans-serif;
    line-height: 1.4;
  }
  .satellite-cta-btn:hover { background: rgba(90,200,250,0.2); }

  /* Inline satellite button in news popup */
  .satellite-inline-btn {
    display: inline-block;
    margin-left: 6px;
    padding: 2px 7px;
    background: rgba(90,200,250,0.08);
    border: 1px solid rgba(90,200,250,0.2);
    border-radius: 4px;
    color: #5ac8fa;
    font-size: 11px;
    cursor: pointer;
    vertical-align: middle;
    font-family: inherit;
    line-height: 1.4;
  }
  .satellite-inline-btn:hover { background: rgba(90,200,250,0.15); }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/styles/main.css
  git commit -m "feat(satellite): add satellite panel and CTA button CSS styles"
  ```

---

## Task 7: Integrate into `DeckGLMap.ts` (flood popup)

**Files:**
- Modify: `src/components/DeckGLMap.ts`

- [ ] **Step 1: Add imports at top of DeckGLMap.ts**

  Find the existing import block (around line 14). Add **after** the last import line:

  ```typescript
  import type { LineString, MultiLineString } from 'geojson';
  import { computeFloodSegmentBbox } from '../services/copernicus.ts';
  import type { SatelliteViewRequest } from '../types/index.ts';
  ```

  Note: Check if `LineString`/`MultiLineString` are already imported before adding.

- [ ] **Step 2: Add `onSatelliteView` public property to the class**

  Find the `DeckGLMap` class declaration (line 1177) and its properties block. Add after the `_selectedShipMmsi` line (~line 1201):

  ```typescript
  /** Callback triggered when user clicks "Voir satellite" on a flood segment. Set by App.ts via MapContainer. */
  public onSatelliteView: ((req: SatelliteViewRequest) => void) | null = null;
  ```

- [ ] **Step 3: Modify the flood click handler (line ~4514)**

  Find the handler at:
  ```typescript
  this.map.on('click', LYR_FLOODS, (e) => {
    if (!this.map || !e.features || e.features.length === 0) return;
    const feat = e.features[0];
    const p = feat.properties || {};
    ...
    const html = `
      <div style="color:#e8e8ec; ...">
        ...
      </div>
    `;

    new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '300px', className: 'dark-popup' })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(this.map);
  });
  ```

  Replace the entire `this.map.on('click', LYR_FLOODS, ...)` handler block with:

  ```typescript
  this.map.on('click', LYR_FLOODS, (e) => {
      if (!this.map || !e.features || e.features.length === 0) return;
      const feat = e.features[0];
      const p = feat.properties || {};

      let levelText = 'Inconnu';
      let levelColor = '#888';
      if (p.level === 'red') { levelText = 'Rouge'; levelColor = '#ff3b30'; }
      else if (p.level === 'orange') { levelText = 'Orange'; levelColor = '#ff9500'; }
      else if (p.level === 'yellow') { levelText = 'Jaune'; levelColor = '#ffcc00'; }
      else if (p.level === 'green') { levelText = 'Vert'; levelColor = '#34c759'; }

      // Compute satellite bbox from actual geometry, fallback to click point
      const geom = feat.geometry;
      const hasLineGeom = geom !== null &&
          (geom.type === 'LineString' || geom.type === 'MultiLineString');

      const satelliteBbox: [number, number, number, number] = hasLineGeom
          ? computeFloodSegmentBbox(geom as LineString | MultiLineString)
          : [e.lngLat.lng - 0.05, e.lngLat.lat - 0.05, e.lngLat.lng + 0.05, e.lngLat.lat + 0.05];

      const showSatBtn = this.onSatelliteView !== null;

      const html = `
          <div style="color:#e8e8ec; font-family:sans-serif; min-width:180px;">
            <h4 style="margin:0 0 4px; font-weight:700; font-size: 15px; color: #ffffff;">
              Vigicrues
            </h4>
            <div style="margin:0 0 10px; font-size: 13px; font-weight: 600; color: #64d2ff;">
              ${p.name || 'Tronçon inconnu'}
            </div>
            <div style="font-size:13px; margin-bottom: 2px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:#9898a8">Niveau de vigilance :</span>
                <span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; color:${p.level === 'yellow' || p.level === 'green' ? '#000' : '#fff'}; background:${levelColor}">${levelText}</span>
              </div>
            </div>
            ${showSatBtn ? `<button class="satellite-cta-btn" data-action="satellite">🛰️ Voir satellite</button>` : ''}
          </div>
      `;

      const popupInst = new maplibregl.Popup({
          closeButton: true, closeOnClick: true, maxWidth: '300px', className: 'dark-popup',
      })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(this.map);

      if (showSatBtn) {
          // Use getElement() for scoped selection — avoid document.querySelector
          const btnEl = popupInst.getElement().querySelector('[data-action="satellite"]');
          btnEl?.addEventListener('click', (ev) => {
              ev.stopPropagation();
              this.onSatelliteView?.({
                  bbox: satelliteBbox,
                  sourceType: 'flood',
                  title: String(p.name || 'Tronçon Vigicrues'),
                  geometry: hasLineGeom ? (geom as LineString | MultiLineString) : undefined,
                  preferredCollection: 'sentinel-1-grd',
              });
          }, { once: true });
      }
  });
  ```

- [ ] **Step 4: Run typecheck**

  ```bash
  cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -30
  ```
  Expected: no new errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/DeckGLMap.ts
  git commit -m "feat(satellite): add onSatelliteView callback and Voir satellite button to flood popup"
  ```

---

## Task 8: Integrate into `MapPopup.ts` (news items)

**Files:**
- Modify: `src/components/MapPopup.ts`

- [ ] **Step 1: Add imports**

  At the top of `MapPopup.ts` (after the existing import on line 13), add:

  ```typescript
  import { computeNewsItemBbox } from '../services/copernicus.ts';
  import type { SatelliteViewRequest } from '../types/index.ts';
  ```

- [ ] **Step 2: Add private field and setter**

  After the `private onClusterExpand` line (line ~59), add:

  ```typescript
  private onSatelliteView: ((req: SatelliteViewRequest) => void) | null = null;
  ```

  After the existing `setOnClusterExpand` method (line ~132), add:

  ```typescript
  /** Set callback for when user clicks "Voir satellite" on a geolocated news item */
  setOnSatelliteView(handler: (req: SatelliteViewRequest) => void): void {
    this.onSatelliteView = handler;
  }
  ```

- [ ] **Step 3: Add the satellite button to `show()` HTML**

  In the `show(item, x, y)` method, find the `.map-popup-action` section (~line 198):
  ```typescript
  ${item.lat != null && item.lon != null ? `<div class="map-popup-action">Cliquez pour ouvrir · 🏛️ Élus &amp; représentants</div>` : `<div class="map-popup-action">Cliquez pour ouvrir</div>`}
  ```

  Replace with:
  ```typescript
  <div class="map-popup-action">
    ${item.lat != null && item.lon != null
      ? `Cliquez pour ouvrir · 🏛️ Élus &amp; représentants${this.onSatelliteView ? ` <button class="satellite-inline-btn" data-action="satellite">🛰️ Satellite</button>` : ''}`
      : 'Cliquez pour ouvrir'
    }
  </div>
  ```

- [ ] **Step 4: Modify the click handler to check satellite button first**

  In the constructor's click handler, find the `if (this.mode === 'item')` block (~line 86):

  ```typescript
  if (this.mode === 'item') {
    // Click anywhere on single item popup -> open article
    if (this.currentItem && this.onItemClick) {
      this.onItemClick(this.currentItem);
      this.hideNow();
    }
    return;
  }
  ```

  Replace with:

  ```typescript
  if (this.mode === 'item') {
    // Satellite button takes priority over article open
    if (target.closest('[data-action="satellite"]')) {
      e.stopPropagation();
      if (this.currentItem?.lat != null && this.currentItem?.lon != null && this.onSatelliteView) {
        const bbox = computeNewsItemBbox(this.currentItem.lat, this.currentItem.lon);
        this.onSatelliteView({
          bbox,
          sourceType: 'news',
          title: this.currentItem.title,
          point: [this.currentItem.lon, this.currentItem.lat],
          preferredCollection: 'sentinel-2-l2a',
        });
      }
      return; // Do NOT open article or hide popup
    }
    // Default: click anywhere else → open article
    if (this.currentItem && this.onItemClick) {
      this.onItemClick(this.currentItem);
      this.hideNow();
    }
    return;
  }
  ```

- [ ] **Step 5: Run typecheck**

  ```bash
  cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -30
  ```
  Expected: no new errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/MapPopup.ts
  git commit -m "feat(satellite): add setOnSatelliteView and Voir satellite button to MapPopup"
  ```

---

## Task 9: Add relay to `MapContainer.ts`

**Files:**
- Modify: `src/components/MapContainer.ts`

- [ ] **Step 1: Add import**

  After the existing imports (line ~11), add:

  ```typescript
  import type { SatelliteViewRequest } from '../types/index.ts';
  ```

- [ ] **Step 2: Add private field and setter**

  After the `private onRawMapClick` line (~line 45), add:

  ```typescript
  private _onSatelliteView: ((req: SatelliteViewRequest) => void) | null = null;
  ```

  After the `setOnMaritimeShipClick` method (~line 357), add the setter:

  ```typescript
  setOnSatelliteView(handler: (req: SatelliteViewRequest) => void): void {
    this._onSatelliteView = handler;
    // Delegate to deckMap if already initialized
    if (this.deckMap) this.deckMap.onSatelliteView = handler;
  }
  ```

- [ ] **Step 3: Delegate in `init()` after `deckMap` is created**

  In `async init()`, after `await this.deckMap.init()` (line ~73), add:

  ```typescript
  // Propagate satellite view callback if set before init()
  if (this._onSatelliteView) {
    this.deckMap.onSatelliteView = this._onSatelliteView;
  }
  ```

  The full block after `await this.deckMap.init()` becomes:
  ```typescript
  await this.deckMap.init();
  if (this._onSatelliteView) {
    this.deckMap.onSatelliteView = this._onSatelliteView;
  }
  console.log('[MapContainer] Desktop map (MapLibre) initialized');
  ```

- [ ] **Step 4: Run typecheck**

  ```bash
  cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -30
  ```
  Expected: no new errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/MapContainer.ts
  git commit -m "feat(satellite): add setOnSatelliteView relay to MapContainer"
  ```

---

## Task 10: Wire everything in `App.ts`

**Files:**
- Modify: `src/App.ts`

- [ ] **Step 1: Add import**

  After the existing component imports (around line 37), add:

  ```typescript
  import { SatellitePanel } from './components/SatellitePanel.ts';
  import { buildEoBrowserUrl } from './services/copernicus.ts';
  import type { SatelliteViewRequest } from './types/index.ts';
  ```

- [ ] **Step 2: Add private field**

  In the `App` class properties (after `private toastNotification: ToastNotification | null = null;`, line ~843), add:

  ```typescript
  private satellitePanel: SatellitePanel | null = null;
  ```

- [ ] **Step 3: Instantiate and wire in `initMap()`**

  In `initMap()`, after the line `this.mapPopup = new MapPopup(mapEl);` (line ~2097), add:

  ```typescript
  // ─── Satellite Panel ───
  this.satellitePanel = new SatellitePanel(this.container);

  const openSatelliteView = (req: SatelliteViewRequest): void => {
    // Mobile guard: open EO Browser directly, no panel
    if (window.innerWidth < 768) {
      const eoBrowserUrl = buildEoBrowserUrl(
        req.bbox,
        req.preferredCollection ?? 'sentinel-2-l2a',
        new Date(),  // explicit date — avoids missing toTime in S2 URL
      );
      window.open(eoBrowserUrl, '_blank', 'noopener');
      return;
    }
    this.satellitePanel?.show(req);
  };

  // Wire callbacks: mapContainer relays to deckMap; mapPopup has its own setter
  this.mapContainer?.setOnSatelliteView(openSatelliteView);
  this.mapPopup?.setOnSatelliteView(openSatelliteView);
  ```

- [ ] **Step 4: Add cleanup in `destroy()`**

  In `public destroy()` (line ~871), add before the closing brace:

  ```typescript
  this.satellitePanel?.destroy();
  this.satellitePanel = null;
  ```

- [ ] **Step 5: Run typecheck**

  ```bash
  cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -40
  ```
  Expected: zero errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/App.ts
  git commit -m "feat(satellite): wire SatellitePanel in App.ts — instantiate, openSatelliteView callback, cleanup"
  ```

---

## Task 11: Final verification — typecheck + build

**Files:** No changes — verification only.

- [ ] **Step 1: Run full typecheck**

  ```bash
  cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck
  ```
  Expected: zero errors. If errors appear, fix them before proceeding.

- [ ] **Step 2: Run full build**

  ```bash
  cd /Users/fraid/Desktop/FranceMonitor && npm run build
  ```
  Expected: successful build with no TypeScript errors and no Vite transform errors.

- [ ] **Step 3: Manual smoke test in dev (optional but recommended)**

  ```bash
  npm run dev
  ```
  - Open the app in browser
  - Click a Vigicrues flood segment → popup should show "🛰️ Voir satellite" button
  - Click it → SatellitePanel opens, shows loading spinner, then thumbnail or empty state + EO Browser button
  - Click "↗ Ouvrir dans EO Browser" → opens correct URL in new tab
  - Click on a geolocated news item → popup should show "🛰️ Satellite" button
  - Click it → SatellitePanel opens with Sentinel-2 view
  - Verify existing flood popup (colors, name) still works correctly
  - Verify existing news item click (open article) still works when clicking outside satellite button

- [ ] **Step 4: Commit verification pass**

  ```bash
  git add -A
  git status  # verify nothing unexpected
  git commit -m "feat(satellite): MVP Copernicus/Sentinel imagery — STAC thumbnails + EO Browser fallback"
  ```

---

## Fallback Behaviour Summary

| Scenario | Result |
|---|---|
| AWS Earth Search timeout / error | `scenes: []` → EO Browser button only, no crash |
| S1 GRD item has no thumbnail | Placeholder icon shown, EO Browser always available |
| Geometry null on flood segment | bbox computed from `e.lngLat` ± 0.05° |
| Mobile screen < 768px | `window.open(eoBrowserUrl)` directly, no panel rendered |
| Fetch aborted (panel closed mid-load) | AbortController cancels fetch, no state update post-abort |
| No STAC scenes for area/date | "Aucune scène disponible" message + EO Browser button |

## Upgrade Path (Approach C — future)

When `COPERNICUS_CLIENT_ID` + `COPERNICUS_CLIENT_SECRET` are set:
1. `api/copernicus.js` fetches OAuth2 token from CDSE identity server
2. Adds `{ mode: 'wms', wmsUrl: '...' }` to the response
3. `SatellitePanel.onWmsRequested` callback triggers `DeckGLMap.addSentinelOverlay(wmsUrl, bbox)`
4. Today: `mode` is always `'thumbnail'` — the client ignores `wmsUrl` if absent
