# SNCF Rail Network Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent `trafficRail` map layer displaying SNCF disrupted arcs and stations, colored by severity, togglable as a child of the `traffic` group — Option B: only disrupted segments appear (no background rail network).

**Architecture:** `fetchSncfDisruptions()` (already exists) → `buildRailNetworkData()` (new, in transport.ts) → two GeoJSON FeatureCollections (arcs + stations) → `DeckGLMap.updateRailNetwork()` → MapLibre layers. No static background rail GeoJSON. Layer is empty when no disruptions exist. The Vercel serverless function `api/transport/disruptions.js` mirrors the dev proxy.

**Tech Stack:** TypeScript strict, MapLibre GL JS expressions, GeoJSON FeatureCollections, Vercel Node.js serverless.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types/index.ts` | Modify | Add `trafficRail` to `MapLayers`, add `RailNetworkData` type |
| `src/services/transport.ts` | Modify | Add `buildRailNetworkData()` |
| `api/transport/disruptions.js` | Create | Vercel serverless SNCF proxy |
| `src/components/DeckGLMap.ts` | Modify | SRC/LYR constants, sources, layers, `updateRailNetwork()`, `setLayerVisibility()` |
| `src/components/MapContainer.ts` | Modify | `updateRailNetwork()` passthrough |
| `src/App.ts` | Modify | `DEFAULT_LAYERS`, legend, `LAYER_CONFIGS`, toggle logic, `loadSncf()` |

---

## Severity Color Palette

Used consistently across arcs and stations:

```
critical → #ff3b30
high     → #ff9500
medium   → #ffcc00
low      → #8e8e93
info     → #636366
```

---

## Task 1 — Add `trafficRail` to `MapLayers` and `RailNetworkData` type

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1.1 — Add `trafficRail` to `MapLayers`**

In `src/types/index.ts`, find `MapLayers` (around line 60). Add after `trafficAir`:

```typescript
  trafficRail: boolean;
```

Result (showing context):
```typescript
export interface MapLayers {
  // ...existing fields...
  trafficRoad: boolean;
  trafficMaritime: boolean;
  trafficAir: boolean;
  trafficRail: boolean;   // ← add this
  // ...rest...
}
```

- [ ] **Step 1.2 — Add `RailNetworkData` type**

In `src/types/index.ts`, find the `// ═══ Transport (SNCF) ═══` section (after `TransportDisruption`). Add after the `TransportDisruption` interface:

```typescript
export interface RailNetworkData {
  /** LineString features: disrupted arc between departure and arrival */
  arcs: GeoJSON.FeatureCollection<GeoJSON.LineString, {
    id: string;
    severity: string;
    type: string;
    line: string;
    description: string;
  }>;
  /** Point features: unique impacted stations, worst severity wins */
  stations: GeoJSON.FeatureCollection<GeoJSON.Point, {
    name: string;
    severity: string;
    count: number;
  }>;
}
```

- [ ] **Step 1.3 — Verify typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | tail -20
```

Expected: errors only about missing `trafficRail` in DEFAULT_LAYERS and `buildRailNetworkData` not yet defined (we'll fix in later tasks). Zero errors about the types we just added.

---

## Task 2 — Add `buildRailNetworkData()` to transport service

**Files:**
- Modify: `src/services/transport.ts`

- [ ] **Step 2.1 — Add the import for `RailNetworkData`**

At the top of `src/services/transport.ts`, update the import line:

```typescript
import type { TransportDisruption, ThreatLevel, TrainStop, RailNetworkData } from '../types/index.ts';
```

- [ ] **Step 2.2 — Add `buildRailNetworkData()` at the bottom of the file**

Append at the end of `src/services/transport.ts`:

```typescript
/**
 * Builds two GeoJSON FeatureCollections from disruption data for map rendering.
 *
 * Arcs: one LineString per disruption that has both departure AND arrival coordinates.
 * Stations: deduplicated stop points across all disruptions — worst severity per station.
 *
 * Fallback strategy (documented for OSINT clarity):
 * - Disruption with only departure coord → station point emitted, no arc
 * - Disruption with no coords → skipped entirely
 */
export function buildRailNetworkData(disruptions: TransportDisruption[]): RailNetworkData {
  // ─── Arcs ───
  const arcFeatures: RailNetworkData['arcs']['features'] = [];

  for (const d of disruptions) {
    const dep = d.departure?.coordinates;
    const arr = d.arrival?.coordinates;

    // Arc requires both endpoints; skip otherwise (station-only fallback below)
    if (!dep || !arr) continue;

    arcFeatures.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [dep, arr],
      },
      properties: {
        id: d.id,
        severity: d.severity,
        type: d.type,
        line: d.line,
        description: d.description,
      },
    });
  }

  // ─── Stations: deduplicate by name, keep worst severity ───
  const SEVERITY_ORDER: Record<ThreatLevel, number> = {
    critical: 0, high: 1, medium: 2, low: 3, info: 4,
  };

  const stationMap = new Map<string, { coords: [number, number]; severity: ThreatLevel; count: number }>();

  const recordStop = (stop: TrainStop | undefined, severity: ThreatLevel): void => {
    if (!stop?.coordinates || !stop.name) return;
    const existing = stationMap.get(stop.name);
    if (!existing) {
      stationMap.set(stop.name, { coords: stop.coordinates, severity, count: 1 });
    } else {
      existing.count++;
      if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[existing.severity]) {
        existing.severity = severity;
      }
    }
  };

  for (const d of disruptions) {
    recordStop(d.departure, d.severity);
    recordStop(d.arrival, d.severity);
  }

  const stationFeatures: RailNetworkData['stations']['features'] = Array.from(
    stationMap.entries()
  ).map(([name, { coords, severity, count }]) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: { name, severity, count },
  }));

  return {
    arcs: { type: 'FeatureCollection', features: arcFeatures },
    stations: { type: 'FeatureCollection', features: stationFeatures },
  };
}
```

- [ ] **Step 2.3 — Verify typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | grep -E "transport\.ts|Error" | head -20
```

Expected: no errors in transport.ts.

---

## Task 3 — Create Vercel serverless function `api/transport/disruptions.js`

**Files:**
- Create: `api/transport/disruptions.js`

- [ ] **Step 3.1 — Create the serverless function**

Create `api/transport/disruptions.js`:

```javascript
/**
 * api/transport/disruptions.js — Vercel serverless proxy for SNCF disruptions.
 * Mirrors src/plugins/sncf-proxy.ts for production deployment.
 */

const SNCF_API_BASE = 'https://api.sncf.com/v1';
const CACHE_TTL_MS = 5 * 60_000; // 5 min

let _cache = null;
let _cacheAt = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // In-process cache — reused across warm lambda invocations
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(_cache);
    return;
  }

  const apiKey = process.env.SNCF_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: 'SNCF_API_KEY not configured' } });
    return;
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
    const url = `${SNCF_API_BASE}/coverage/sncf/disruptions?count=100&depth=2`;

    const upstream = await fetch(url, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error('[sncf-disruptions] upstream error:', upstream.status, body);
      res.status(502).json({ error: { message: `SNCF API error ${upstream.status}` } });
      return;
    }

    const data = await upstream.json();
    _cache = data;
    _cacheAt = Date.now();

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(data);
  } catch (err) {
    console.error('[sncf-disruptions] fetch failed:', err);
    res.status(502).json({ error: { message: 'SNCF API fetch failed' } });
  }
}
```

- [ ] **Step 3.2 — Diagnose existing URL routing (read-only)**

Run to understand the current state — do NOT add any rewrite:

```bash
cat /Users/fraid/Desktop/FranceMonitor/vercel.json 2>/dev/null || echo "no vercel.json"
grep -n "sncf\|transport/disruptions" /Users/fraid/Desktop/FranceMonitor/src/services/transport.ts
```

Vercel auto-routes `api/transport/disruptions.js` to `/api/transport/disruptions` with no rewrite needed. We align the dev proxy and fetch URL to that path in Step 3.3 below. Do not add a vercel.json rewrite.

- [ ] **Step 3.3 — Align dev proxy and fetch URL to `/api/transport/disruptions`**

In `src/plugins/sncf-proxy.ts`, change the route registration to match prod. Update the disruptions middleware line:

Change:
```typescript
server.middlewares.use('/api/sncf/disruptions', async (_req, res) => {
```
to:
```typescript
server.middlewares.use('/api/transport/disruptions', async (_req, res) => {
```

And update `src/services/transport.ts` fetch call:
```typescript
const resp = await fetch('/api/transport/disruptions', {
```

Keep the `/api/sncf/lines` route unchanged (it's not used in prod yet).

- [ ] **Step 3.4 — Verify typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | tail -10
```

Expected: no new errors.

---

## Task 4 — Add rail sources, layers, and `updateRailNetwork()` to DeckGLMap

**Files:**
- Modify: `src/components/DeckGLMap.ts`

This is the largest task. Follow the established pattern: constants first, source init, layer init, update method, visibility toggle.

- [ ] **Step 4.1 — Add source and layer constants**

In the constants section (after line ~270, near `LYR_MAIRES_POL_LABEL`), add:

```typescript
// ─── Rail disruptions (SNCF) ───
const SRC_RAIL_ARCS = 'rail-disruptions-arcs-src';
const SRC_RAIL_STATIONS = 'rail-disruptions-stations-src';
const LYR_RAIL_ARC_GLOW = 'rail-arc-glow';
const LYR_RAIL_ARC = 'rail-arc';
const LYR_RAIL_STATION_GLOW = 'rail-station-glow';
const LYR_RAIL_STATION = 'rail-stations-disrupted';
const LYR_RAIL_STATION_LABEL = 'rail-station-label';
```

- [ ] **Step 4.2 — Add severity color expression constant**

Add right after the constants above (shared between arc and station layers):

```typescript
/** MapLibre match expression: ThreatLevel → hex color */
const RAIL_SEVERITY_COLOR: maplibregl.ExpressionSpecification = [
  'match', ['get', 'severity'],
  'critical', '#ff3b30',
  'high',     '#ff9500',
  'medium',   '#ffcc00',
  'low',      '#8e8e93',
  /* info default */ '#636366',
];
```

- [ ] **Step 4.3 — Register sources in the map `load` handler**

Find the block that registers `SRC_TRAIN_ROUTE` (around line 1634):
```typescript
// Train route highlight
this.map.addSource(SRC_TRAIN_ROUTE, { type: 'geojson', data: emptyFC() });
```

Add immediately BEFORE this line:

```typescript
// Rail disruptions network (arcs + stations, updated from SNCF data)
this.map.addSource(SRC_RAIL_ARCS, { type: 'geojson', data: emptyFC() });
this.map.addSource(SRC_RAIL_STATIONS, { type: 'geojson', data: emptyFC() });
```

- [ ] **Step 4.4 — Add MapLibre layers**

Find the section `// ─── Train route highlight ───` (around line 2160). Add the following block IMMEDIATELY BEFORE it (so rail network renders below the hover highlight):

```typescript
// ─── Rail disruptions network (persistent layer, toggle via trafficRail) ───
// Glow halo: fat semi-transparent line behind each arc
this.map.addLayer({
  id: LYR_RAIL_ARC_GLOW,
  type: 'line',
  source: SRC_RAIL_ARCS,
  paint: {
    'line-color': RAIL_SEVERITY_COLOR,
    'line-width': ['interpolate', ['linear'], ['zoom'], 4, 8, 8, 14, 12, 20],
    'line-opacity': 0.18,
    'line-blur': 4,
  },
  layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
});
// Main arc
this.map.addLayer({
  id: LYR_RAIL_ARC,
  type: 'line',
  source: SRC_RAIL_ARCS,
  paint: {
    'line-color': RAIL_SEVERITY_COLOR,
    'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 8, 2.5, 12, 4],
    'line-opacity': 0.85,
    'line-dasharray': [4, 2],
  },
  layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
});
// Station glow halo
this.map.addLayer({
  id: LYR_RAIL_STATION_GLOW,
  type: 'circle',
  source: SRC_RAIL_STATIONS,
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 14, 12, 20],
    'circle-color': RAIL_SEVERITY_COLOR,
    'circle-opacity': 0.20,
    'circle-blur': 1,
    'circle-stroke-width': 0,
  },
  layout: { visibility: 'none' },
});
// Station circle
this.map.addLayer({
  id: LYR_RAIL_STATION,
  type: 'circle',
  source: SRC_RAIL_STATIONS,
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 8, 7, 12, 10],
    'circle-color': RAIL_SEVERITY_COLOR,
    'circle-stroke-width': 2,
    'circle-stroke-color': '#1a1a2e',
    'circle-opacity': 0.95,
  },
  layout: { visibility: 'none' },
});
// Station label (appears from zoom 8)
this.map.addLayer({
  id: LYR_RAIL_STATION_LABEL,
  type: 'symbol',
  source: SRC_RAIL_STATIONS,
  minzoom: 8,
  layout: {
    'text-field': ['get', 'name'],
    'text-size': 11,
    'text-offset': [0, -1.4],
    'text-anchor': 'bottom',
    'text-font': ['Noto Sans Regular'],
    visibility: 'none',
  },
  paint: {
    'text-color': '#f0f0f0',
    'text-halo-color': '#1a1a2e',
    'text-halo-width': 1.5,
    'text-opacity': 0.9,
  },
});
```

- [ ] **Step 4.5 — Add `updateRailNetwork()` method**

First, check that `RailNetworkData` is importable from types. Add it to the existing import from `'../types/index.ts'` near the top of DeckGLMap.ts:

```bash
grep -n "from '../types/index.ts'" /Users/fraid/Desktop/FranceMonitor/src/components/DeckGLMap.ts | head -3
```

Add `RailNetworkData` to that import line.

Then find the `// ─── Train Route Highlight ───` section (around line 8832). Add the following method BEFORE it:

```typescript
// ─── Rail Network (SNCF disruptions) ───

/**
 * Update the persistent rail disruption layer.
 * Call with the result of buildRailNetworkData(disruptions).
 * Pass empty FeatureCollections to clear the layer.
 */
updateRailNetwork(data: RailNetworkData): void {
  if (!this.map) return;

  const arcSrc = this.map.getSource(SRC_RAIL_ARCS) as maplibregl.GeoJSONSource | undefined;
  const staSrc = this.map.getSource(SRC_RAIL_STATIONS) as maplibregl.GeoJSONSource | undefined;

  arcSrc?.setData(data.arcs);
  staSrc?.setData(data.stations);
}
```

- [ ] **Step 4.6 — Wire `trafficRail` in `setLayerVisibility()`**

Find the line `this.setVis(LYR_TRAFFIC, vis(layers.trafficRoad));` (around line 10331). Add immediately AFTER it:

```typescript
const railVis = vis(layers.trafficRail ?? false);
this.setVis(LYR_RAIL_ARC_GLOW,        railVis);
this.setVis(LYR_RAIL_ARC,             railVis);
this.setVis(LYR_RAIL_STATION_GLOW,    railVis);
this.setVis(LYR_RAIL_STATION,         railVis);
this.setVis(LYR_RAIL_STATION_LABEL,   railVis);
```

- [ ] **Step 4.7 — Verify typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | grep -E "DeckGLMap|Error" | head -20
```

Expected: no errors in DeckGLMap.ts.

---

## Task 5 — Add `updateRailNetwork()` passthrough to MapContainer

**Files:**
- Modify: `src/components/MapContainer.ts`

- [ ] **Step 5.1 — Add `RailNetworkData` import and `updateRailNetwork()` method**

Check the existing imports in MapContainer.ts:

```bash
grep -n "from '../types/index.ts'" /Users/fraid/Desktop/FranceMonitor/src/components/MapContainer.ts | head -3
```

Add `RailNetworkData` to the existing import from `'../types/index.ts'`.

Then add this method after `highlightTrainRoute()` (around line 450):

```typescript
updateRailNetwork(data: RailNetworkData): void {
  this.deckMap?.updateRailNetwork(data);
}
```

Both `DeckGLMap.updateRailNetwork()` and `MapContainer.updateRailNetwork()` use `RailNetworkData` as the parameter type — no ambiguity.

- [ ] **Step 5.2 — Verify typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | grep -E "MapContainer|Error" | head -20
```

Expected: no errors.

---

## Task 6 — Wire everything in App.ts

**Files:**
- Modify: `src/App.ts`

Six sub-steps, each localized and independently verifiable.

- [ ] **Step 6.1 — Add `trafficRail` to `DEFAULT_LAYERS`**

Find `DEFAULT_LAYERS` (around line 97). After `trafficAir: false,` add:

```typescript
trafficRail: false,
```

- [ ] **Step 6.2 — Add `RAIL_TRAFFIC_LEGEND` constant**

After `AIR_TRAFFIC_LEGEND` (around line 323), add:

```typescript
const RAIL_TRAFFIC_LEGEND: LegendCategory = {
  id: 'trafficRail',
  title: 'Réseau ferroviaire — Perturbations',
  columns: 2,
  items: [
    { id: 'rail-critical', label: 'Supprimé (NO_SERVICE)',    color: '#ff3b30', shape: 'square' },
    { id: 'rail-high',     label: 'Retards importants',       color: '#ff9500', shape: 'square' },
    { id: 'rail-medium',   label: 'Service réduit',           color: '#ffcc00', shape: 'square' },
    { id: 'rail-low',      label: 'Perturbation mineure',     color: '#8e8e93', shape: 'square' },
    { id: 'rail-arc',      label: 'Arc départ → arrivée',     color: '#c0c0c0', shape: 'square' },
    { id: 'rail-station',  label: 'Gare impactée',            color: '#ffffff', shape: 'circle' },
  ],
  source: {
    label: 'SNCF API — info-trafic.sncf.com',
    year: new Date().getFullYear(),
  },
  refresh: { label: 'Environ 5 min' },
  notes: [
    'Arcs affichés uniquement si départ ET arrivée connus.',
    'Gare seule si coordonnées partielles.',
  ],
};
```

- [ ] **Step 6.2b — Register `RAIL_TRAFFIC_LEGEND` with the legend system**

Find the `addCategory` block (around line 2320 in App.ts), which looks like:

```typescript
this.mapLegend.addCategory(AIR_TRAFFIC_LEGEND);
```

Add immediately after it:

```typescript
this.mapLegend.addCategory(RAIL_TRAFFIC_LEGEND);
```

Without this, `setCategoryVisibility('trafficRail', ...)` has no effect and the legend never appears.

- [ ] **Step 6.3 — Add `trafficRail` entry to `LAYER_CONFIGS`**

Find the `trafficAir` config entry (around line 655). Add immediately AFTER its closing `},`:

```typescript
{
  id: 'trafficRail',
  groupId: 'traffic',
  role: 'child',
  dependsOnGroup: true,
  label: 'Réseau ferroviaire (SNCF)',
  legend: RAIL_TRAFFIC_LEGEND,
},
```

- [ ] **Step 6.4 — Update `syncTrafficGroupState()`**

Find `syncTrafficGroupState()` (around line 994):
```typescript
private syncTrafficGroupState(): void {
  this.activeLayers.traffic =
    this.activeLayers.trafficRoad ||
    this.activeLayers.trafficMaritime ||
    this.activeLayers.trafficAir;
}
```

Replace with:
```typescript
private syncTrafficGroupState(): void {
  this.activeLayers.traffic =
    this.activeLayers.trafficRoad ||
    this.activeLayers.trafficMaritime ||
    this.activeLayers.trafficAir ||
    this.activeLayers.trafficRail;
}
```

- [ ] **Step 6.5 — Update `onLayerToggle()` to handle `trafficRail`**

Find (around line 1987):
```typescript
if (key === 'trafficRoad' || key === 'trafficMaritime' || key === 'trafficAir') {
  this.syncTrafficGroupState();
}
```

Replace with:
```typescript
if (key === 'trafficRoad' || key === 'trafficMaritime' || key === 'trafficAir' || key === 'trafficRail') {
  this.syncTrafficGroupState();
}
```

Also update the URL back-compat block (around line 1103) that reads:
```typescript
merged.traffic = merged.trafficRoad || merged.trafficMaritime || merged.trafficAir;
```

Replace with:
```typescript
merged.traffic = merged.trafficRoad || merged.trafficMaritime || merged.trafficAir || (merged.trafficRail ?? false);
```

- [ ] **Step 6.6 — Update `loadSncf()` to call `updateRailNetwork()`**

Find `loadSncf()` (around line 3380). Also add the import at the top of App.ts:

```typescript
import { fetchSncfDisruptions, buildRailNetworkData } from './services/transport.ts';
```

Update `loadSncf()`:

```typescript
private async loadSncf(): Promise<void> {
  this.statusPanel?.updateSource('SNCF', { status: 'loading', lastUpdate: null });
  const disruptions = await fetchSncfDisruptions();
  this.currentSncfDisruptions = disruptions;
  if (disruptions.length > 0) {
    this.statusPanel?.updateSource('SNCF', { status: 'ok', lastUpdate: new Date() });
    console.log(`[SNCF] ${disruptions.length} perturbations chargées`);
  } else {
    this.statusPanel?.updateSource('SNCF', { status: 'stale', lastUpdate: new Date() });
  }
  // Update rail map layer (empty FCs when no disruptions → clears layer cleanly)
  const railData = buildRailNetworkData(disruptions);
  this.mapContainer?.updateRailNetwork(railData);
}
```

- [ ] **Step 6.7 — Update `refreshTrafficLegend()`**

Find `refreshTrafficLegend()` (around line 1023):

```typescript
private refreshTrafficLegend(): void {
  if (!this.mapLegend) return;
  this.mapLegend.setCategoryVisibility('trafficRoad', this.activeLayers.traffic && this.activeLayers.trafficRoad);
  this.mapLegend.setCategoryVisibility('trafficMaritime', this.activeLayers.traffic && this.activeLayers.trafficMaritime);
  this.mapLegend.setCategoryVisibility('trafficAir', this.activeLayers.traffic && this.activeLayers.trafficAir);
}
```

Add the rail line:

```typescript
private refreshTrafficLegend(): void {
  if (!this.mapLegend) return;
  this.mapLegend.setCategoryVisibility('trafficRoad', this.activeLayers.traffic && this.activeLayers.trafficRoad);
  this.mapLegend.setCategoryVisibility('trafficMaritime', this.activeLayers.traffic && this.activeLayers.trafficMaritime);
  this.mapLegend.setCategoryVisibility('trafficAir', this.activeLayers.traffic && this.activeLayers.trafficAir);
  this.mapLegend.setCategoryVisibility('trafficRail', this.activeLayers.traffic && this.activeLayers.trafficRail);
}
```

- [ ] **Step 6.8 — Verify typecheck (App.ts)**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | tail -20
```

Expected: zero TypeScript errors.

---

## Task 7 — Full Build Verification

- [ ] **Step 7.1 — Run full typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1
```

Expected: `Found 0 errors.` (or only pre-existing unrelated errors).

- [ ] **Step 7.2 — Run build**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run build 2>&1 | tail -30
```

Expected: build completes, no errors, `dist/` updated.

- [ ] **Step 7.3 — Smoke test in dev**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run dev:vite &
sleep 3
curl -s http://localhost:3001/ | head -5
```

Open `http://localhost:3001` in browser, toggle the "Réseau ferroviaire" layer under Trafics in the layer panel, verify the legend appears/disappears correctly.

---

## Known V1 Limits (document in code comments, not to fix now)

1. **No curved arcs** — straight geodesic lines between departure/arrival. Visually clear, not curved like the hover route. Acceptable for OSINT.
2. **No geojson route geometry** — the SNCF API `depth=2` sometimes returns a `geojson` polyline for lines. This is NOT used here (V2 enhancement: use actual route shape when available).
3. **No filtering by active time** — all active disruptions (SNCF filters past ones server-side). Time-range filtering is a V2 enhancement.
4. **`api/sncf/lines` unused** — the `/api/sncf/lines` proxy route (background network) remains dormant. V1 does not use it.
5. **Station deduplication by name** — imperfect for stations with identical names in different cities. GeoJSON doesn't expose SNCF station IDs here. V2: deduplicate by stop_point.id.
