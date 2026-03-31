# Cloud / IXP Layer Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix icon overlap on Paris (clustering) and fix missing legend for the Cloud/IXP layer.

**Architecture:** Two independent changes in `DeckGLMap.ts` (clustering) and `App.ts` (legend visibility). Clustering follows the exact IODA/ISP pattern already in place — same source options, same layer structure, same filter idioms. Legend fix investigates the dynamic visibility logic and patches the condition.

**Tech Stack:** MapLibre GL JS (source clustering), Vanilla TypeScript, Vite.

---

## File Map

| File | Change |
|------|--------|
| `src/components/DeckGLMap.ts` | Add cluster options to SRC_DC/SRC_IXP, add 4 cluster layers, add filter on individual layers, remove icon-allow-overlap, update setLayerVisibility, add cluster click handlers |
| `src/App.ts` | Fix legend visibility for outagesCloud |

---

## Task 1 — Enable clustering on SRC_DC and SRC_IXP

**Files:**
- Modify: `src/components/DeckGLMap.ts`

### Step 1a — Add constants for cluster layers

- [ ] In `DeckGLMap.ts`, after line `const LYR_IXP_CIRCLE = 'infra-ixp-circle';` add:

```ts
const LYR_DC_CLUSTER       = 'infra-dc-cluster';
const LYR_DC_CLUSTER_COUNT = 'infra-dc-cluster-count';
const LYR_IXP_CLUSTER       = 'infra-ixp-cluster';
const LYR_IXP_CLUSTER_COUNT = 'infra-ixp-cluster-count';
```

### Step 1b — Enable cluster on source declarations

- [ ] Find the source declarations for SRC_DC and SRC_IXP (around line 1651):

```ts
// Infra cloud & IXP
this.map.addSource(SRC_DC, { type: 'geojson', data: emptyFC() });
this.map.addSource(SRC_IXP, { type: 'geojson', data: emptyFC() });
```

Replace with:

```ts
// Infra cloud & IXP — clustering activé pour éviter le chevauchement à faible zoom
this.map.addSource(SRC_DC, {
  type: 'geojson', data: emptyFC(),
  cluster: true, clusterRadius: 50, clusterMaxZoom: 8,
});
this.map.addSource(SRC_IXP, {
  type: 'geojson', data: emptyFC(),
  cluster: true, clusterRadius: 50, clusterMaxZoom: 8,
});
```

### Step 1c — Add cluster layers for DC (before LYR_DC_GLOW)

- [ ] Find the comment `// ─── Datacenter status — palette violet/purple (cloud) ───` (around line 3641). **Before** the `LYR_DC_GLOW` `addLayer`, insert:

```ts
// ── Clusters DC ──
this.map.addLayer({
  id: LYR_DC_CLUSTER,
  type: 'circle',
  source: SRC_DC,
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': 'rgba(167,139,250,0.25)',
    'circle-radius': ['step', ['get', 'point_count'], 14, 3, 18, 6, 22],
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#A78BFA',
    'circle-opacity': 0.90,
  },
});
this.map.addLayer({
  id: LYR_DC_CLUSTER_COUNT,
  type: 'symbol',
  source: SRC_DC,
  filter: ['has', 'point_count'],
  layout: {
    'text-field': '{point_count_abbreviated}',
    'text-size': 11,
    'text-font': ['Noto Sans Bold'],
  },
  paint: { 'text-color': '#C4B5FD' },
});
```

### Step 1d — Add cluster layers for IXP (before LYR_IXP_CIRCLE)

- [ ] Find the comment `// ─── IXP — diamants violet clair SDF (◆)` (around line 3682). **Before** the `LYR_IXP_CIRCLE` `addLayer`, insert:

```ts
// ── Clusters IXP ──
this.map.addLayer({
  id: LYR_IXP_CLUSTER,
  type: 'circle',
  source: SRC_IXP,
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': 'rgba(196,181,253,0.20)',
    'circle-radius': ['step', ['get', 'point_count'], 12, 3, 16, 6, 20],
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#C4B5FD',
    'circle-opacity': 0.88,
  },
});
this.map.addLayer({
  id: LYR_IXP_CLUSTER_COUNT,
  type: 'symbol',
  source: SRC_IXP,
  filter: ['has', 'point_count'],
  layout: {
    'text-field': '{point_count_abbreviated}',
    'text-size': 10,
    'text-font': ['Noto Sans Bold'],
  },
  paint: { 'text-color': '#DDD6FE' },
});
```

### Step 1e — Add filter to individual icon layers

- [ ] In `LYR_DC_GLOW` `addLayer`, add `filter: ['!', ['has', 'point_count']]` to layout:

```ts
this.map.addLayer({
  id: LYR_DC_GLOW,
  type: 'circle',
  source: SRC_DC,
  filter: ['!', ['has', 'point_count']],   // ← ajouter cette ligne
  paint: { ... }
});
```

- [ ] In `LYR_DC_CORE` `addLayer`: add `filter: ['!', ['has', 'point_count']]` **and** remove `'icon-allow-overlap': true` and `'icon-ignore-placement': true`:

```ts
this.map.addLayer({
  id: LYR_DC_CORE,
  type: 'symbol',
  source: SRC_DC,
  filter: ['!', ['has', 'point_count']],   // ← ajouter
  layout: {
    'icon-image': 'triangle-dc',
    'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.28, 10, 0.50],
    // icon-allow-overlap et icon-ignore-placement SUPPRIMÉS
  },
  paint: { ... }
});
```

- [ ] In `LYR_IXP_CIRCLE` `addLayer`: same — add filter, remove allow-overlap/ignore-placement:

```ts
this.map.addLayer({
  id: LYR_IXP_CIRCLE,
  type: 'symbol',
  source: SRC_IXP,
  filter: ['!', ['has', 'point_count']],   // ← ajouter
  layout: {
    'icon-image': 'square-ixp',
    'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.18, 10, 0.34],
    // icon-allow-overlap et icon-ignore-placement SUPPRIMÉS
  },
  paint: { ... }
});
```

### Step 1f — Add cluster click handlers (zoom to expand)

- [ ] Find the block `// ─── Datacenter & IXP interactions ───` (around line 4466). After the existing `[LYR_DC_CORE, LYR_IXP_CIRCLE].forEach(...)` block, add:

```ts
// Cluster click: zoom in to expand (Promise API — MapLibre v2+)
[
  { cluster: LYR_DC_CLUSTER,  src: SRC_DC },
  { cluster: LYR_IXP_CLUSTER, src: SRC_IXP },
].forEach(({ cluster, src }) => {
  this.map!.on('mouseenter', cluster, () => { if (this.map) this.map.getCanvas().style.cursor = 'pointer'; });
  this.map!.on('mouseleave', cluster, () => { if (this.map) this.map.getCanvas().style.cursor = ''; });
  this.map!.on('click', cluster, (e) => {
    if (!this.map || !e.features?.length) return;
    const clusterId = e.features[0].properties?.cluster_id as number;
    const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
    const source = this.map.getSource(src) as maplibregl.GeoJSONSource;
    source.getClusterExpansionZoom(clusterId)
      .then(zoom => { this.map?.flyTo({ center: coords, zoom: zoom + 0.5, duration: 600, essential: true }); })
      .catch(() => { this.map?.flyTo({ center: coords, zoom: (this.map.getZoom() ?? 5) + 2, duration: 600, essential: true }); });
  });
});
```

> **Note:** `getClusterExpansionZoom` returns a **Promise** in MapLibre GL JS v2+. Do NOT use the callback form `(clusterId, (err, zoom) => {})` — it is silently ignored. Reference: existing ISP cluster handler at `DeckGLMap.ts` lines 4531-4549.

### Step 1g — Update setLayerVisibility

- [ ] In `setLayerVisibility` (around line 10178), replace the 3 existing DC/IXP lines with all 7 lines (4 new cluster layers + 3 existing individual layers — keep all):

```ts
// Cloud/IXP clusters
this.setVis(LYR_DC_CLUSTER,        vis(layers.outagesCloud));
this.setVis(LYR_DC_CLUSTER_COUNT,  vis(layers.outagesCloud));
this.setVis(LYR_IXP_CLUSTER,       vis(layers.outagesCloud));
this.setVis(LYR_IXP_CLUSTER_COUNT, vis(layers.outagesCloud));
// Cloud/IXP individual markers (hidden by cluster filter when zoomed out)
this.setVis(LYR_DC_GLOW,    vis(layers.outagesCloud));
this.setVis(LYR_DC_CORE,    vis(layers.outagesCloud));
this.setVis(LYR_IXP_CIRCLE, vis(layers.outagesCloud));
```

> **Note:** All 7 `setVis` calls are needed. The individual marker layers are still active at high zoom levels (when features aren't in clusters). The `['!', ['has', 'point_count']]` filter on each marker layer hides them at low zoom, not `setVis`.

### Step 1h — Typecheck and verify

- [ ] Run: `npm run typecheck`
  - Expected: no errors
- [ ] Run: `npm run build`
  - Expected: build succeeds

### Step 1i — Commit

```bash
git add src/components/DeckGLMap.ts
git commit -m "feat(cloud-ixp): add MapLibre clustering to DC and IXP layers to fix Paris overlap"
```

---

## Task 2 — Fix legend visibility for outagesCloud

**Files:**
- Modify: `src/App.ts`

### Step 2a — Diagnose the legend visibility logic

- [ ] Read `src/App.ts` lines 1972–1991. The current logic:

```ts
const groupsOn = new Set(
  LAYER_CONFIGS
    .filter(l => l.role === "groupMaster" && this.activeLayers[l.id])
    .map(l => l.groupId)
);

for (const config of LAYER_CONFIGS) {
  if (config.legend) {
    let isVisible = false;
    if (this.activeLayers[config.id]) {
      if (config.role === 'child' && config.dependsOnGroup) {
        isVisible = groupsOn.has(config.groupId);
      } else {
        isVisible = true;
      }
    }
    this.mapLegend?.setCategoryVisibility(config.legend.id, isVisible);
  }
}
```

For `outagesCloud` (`role: 'child'`, `dependsOnGroup: true`, `groupId: 'outages'`):
- `isVisible` depends on `groupsOn.has('outages')`
- `groupsOn` has 'outages' only if the groupMaster `{ id: 'outages', role: 'groupMaster' }` has `activeLayers['outages'] === true`
- `activeLayers.outages` is set at line 1959-1964 **only when `key` is one of the sub-layers**

**The bug**: when `outagesCloud` is toggled ON (key = 'outagesCloud'), `activeLayers.outages` is set to `true` at line 1960. So the logic *should* work. Check that `this.mapLegend.addCategory(OUTAGES_CLOUD_LEGEND)` is actually called at init (line ~2325 in App.ts).

- [ ] Search `App.ts` for `addCategory(OUTAGES_CLOUD_LEGEND)` — verify it's called unconditionally in the init flow.

### Step 2b — Verify legend panel is scrolled to show outagesCloud entry

The issue might be that the legend category exists but has wrong `isVisible` state on load (from saved localStorage state). The init at line 1097 calls `setLayerVisibility(getEffectiveLayers())` but this does NOT call the legend visibility update path (which is only in `onLayerToggle`).

- [ ] Read `App.ts` around line 2320-2340 — find where `addCategory` calls happen and whether initial legend visibility is set after init.

- [ ] If the init does NOT call the dynamic legend visibility loop after `addCategory`, add a call to `refreshLegendVisibility()` (create a helper) at the end of the init flow.

### Step 2c — Extract legend refresh into a reusable method

- [ ] In `App.ts`, extract the legend visibility block (lines 1972-1991) into a private method:

```ts
private refreshLegendVisibility(): void {
  const groupsOn = new Set(
    LAYER_CONFIGS
      .filter(l => l.role === 'groupMaster' && this.activeLayers[l.id])
      .map(l => l.groupId)
  );

  for (const config of LAYER_CONFIGS) {
    if (config.legend) {
      let isVisible = false;
      if (this.activeLayers[config.id]) {
        if (config.role === 'child' && config.dependsOnGroup) {
          isVisible = groupsOn.has(config.groupId);
        } else {
          isVisible = true;
        }
      }
      this.mapLegend?.setCategoryVisibility(config.legend.id, isVisible);
    }
  }
}
```

- [ ] Replace the inline block in `onLayerToggle` with `this.refreshLegendVisibility()`.

- [ ] Add `this.refreshLegendVisibility()` call at the end of the init section where `addCategory` calls happen (after all `addCategory` calls at line ~2325), so saved state from localStorage is reflected on first load.

### Step 2d — Typecheck and verify

- [ ] Run: `npm run typecheck`
  - Expected: no errors
- [ ] Run: `npm run build`
  - Expected: build succeeds
- [ ] Manual test: enable Cloud/IXP layer → legend panel should show "Pannes Cloud / IXP" section with 5 items (triangles + squares)

### Step 2e — Commit

```bash
git add src/App.ts
git commit -m "fix(legend): call refreshLegendVisibility on init to restore saved layer legend state"
```

---

## Final Verification

- [ ] `npm run build && npm run typecheck` — both pass
- [ ] Open app in browser, zoom to Paris, enable Cloud/IXP layer → cluster badge replaces stacked icons
- [ ] Click cluster → map zooms in and expands
- [ ] Zoom > 8 → individual triangles (DC) and squares (IXP) visible
- [ ] Legend panel shows "Pannes Cloud / IXP" with correct symbols and colors
