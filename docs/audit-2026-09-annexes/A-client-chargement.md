# France Monitor — Client-side data loading audit

Scope: everything that happens from `index.html` load until the dashboard (`App.ts`) is
showing real data. Read-only audit, no code changed. All facts below are cited as
`file:line` against the current working tree. Where a claim would need a live network
trace (exact byte counts of third-party responses, cartocdn's internal tile/sprite/glyph
request count) it is marked **not determinable from code**.

Note on the landing page: the default route `/` (no `?view=app`, no hash) renders
`LandingPage.ts`, not the dashboard (`src/main.ts:43-49,55-68`). Entering the dashboard
is a full URL navigation to `/?view=app#live` (`src/LandingPage.ts:61,78,228`), i.e. a
fresh page load — landing-page weight does not slow down the dashboard's own data
loading, but it is the first thing almost every visitor sees, so it is covered in §2/§6.

---

## 1. Startup sequence

`index.html` loads `/src/main.ts` as the only module script (`index.html:93`), no other
blocking `<script>`/`<link rel=preload>` for data. `index.html:22-27` preconnects/DNS-
prefetches `basemaps.cartocdn.com`, `tiles.basemaps.cartocdn.com`, `server.arcgisonline.com`,
`odre.opendatasoft.com` — all map/tile hosts, confirming the map is expected to be the
dominant early network consumer.

**main.ts (`src/main.ts`)**
1. `installChunkReloadGuard()` (`main.ts:12-38`) — sync, local.
2. `registerSW({ immediate: true })` (`main.ts:41`) — async, non-blocking.
3. `await initI18n()` (`main.ts:55`) — **awaited before any page renders**, but resolves
   from statically-bundled `locales/fr.ts` / `en.ts` (`services/i18n.ts:2-3,42-58`), no
   network call. Not a real bottleneck, just blocks on a microtask.
4. Route decision (`main.ts:56-68`): sources-quality page, else landing page (default `/`),
   else `new App(container); await app.init()`.

**App.init() (`src/App.ts:2107-2186`)** — every phase below runs in this order, top to
bottom, inside one `async` function:

| Step | Code | Awaited by init()? | Phase |
|---|---|---|---|
| Layer state from URL/localStorage | `App.ts:2110-2119` | sync | before paint |
| `renderShell()` (~900-line DOM build) | `App.ts:2121`, def. `App.ts:2190` | sync call | before paint |
| ↳ inside it: `refreshNetworkBarometerWidget()` fire-and-forget | `App.ts:2702` | **no** | **parallel with map init** (only such case) |
| `startVersionPolling()` | `App.ts:2122` | no | before paint |
| `await this.initMap()` | `App.ts:2124`, def. `App.ts:3711` | **yes** | **blocks everything below** |
| `setLayerVisibility`, `loadAplData()` (fire-and-forget) | `App.ts:2129-2134` | no | after map |
| `loadNewsFromCache()` (localStorage, instant paint) | `App.ts:2141-2150` | sync | after map |
| 13× `start*Polling()` (RSS, military, finance, commodities, oil, air-traffic, health, hydraulic, weather, mtgFrp, radar2d, infraNetwork, eolien, sncf) | `App.ts:2153-2166` | no (fire-and-forget) | after map |
| `loadStaticData()` (military bases + OSM merge, dynamic import) | `App.ts:2169`, def. `App.ts:6090` | no | after map |
| `await loadCriticalLayers()` (ecowatt, weather, floods, nuclear) | `App.ts:2172`, def. `App.ts:6112` | **yes** | after map |
| `updateISNR()`, `restoreActiveLayerPanelsAfterRefresh()` | `App.ts:2173-2174` | sync | after critical |
| `loadSecondaryLayers()` (fires, infra, hydraulic, eolien, traffic*, sncf, metropoles, outages) | `App.ts:2177-2182`, def. `App.ts:6157` | no | background |
| `loadOptionalLayers()` (air-traffic, health, hospitals, cyber, space-weather) | `App.ts:2185`, def. `App.ts:6224` | no | background |

**`initMap()` → what actually blocks (`App.ts:3711-3957`)**
- `this.mapContainer = new MapContainer(mapEl)` then `await this.mapContainer.init()` (`App.ts:3715,3813`).
- `MapContainer.init()` (`components/MapContainer.ts:66-94`): for desktop, `await import('./DeckGLMap.ts')` (`MapContainer.ts:76`, dynamic — own chunk, `DeckGLMap.ts` is only ever `import type`-referenced statically, `MapContainer.ts:6`), then `await this.deckMap.init()` (`MapContainer.ts:90`).
- `DeckGLMap.init()` (`components/DeckGLMap.ts:600-627`):
  1. `await getFrenchStyle()` (`DeckGLMap.ts:604`) → `fetch('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json')` (`components/deckgl/base-style.ts:16`).
  2. `new maplibregl.Map(...)` (`DeckGLMap.ts:606`).
  3. `await new Promise(r => this.map.on('load', r))` (`DeckGLMap.ts:626`) — blocks until MapLibre finishes loading the style's sprite, glyphs and the initial viewport's vector/raster tiles from cartocdn. Request count for this step is **not determinable from code** (depends on zoom/viewport), but index.html's preconnects imply it's expected to be several round trips.
  4. `await this.loadIconAtlas()` (`DeckGLMap.ts:627`, def. `DeckGLMap.ts:7961-7997`): `await fetch('/assets/dsfr-mapping.json')` **then** `await this.map.loadImage('/assets/dsfr-atlas.png')` — sequential, though the JSON fetch has no dependency on the map and could start earlier/in parallel.
  - After `map.on('load')` fires, `initMap()` synchronously adds ~30 empty GeoJSON sources plus two sources whose `data` is a **live external URL fetched immediately on `addSource`, regardless of layer visibility**: `SRC_GAS_NETWORK_GRT` → `https://odre.opendatasoft.com/.../trace-du-reseau-grt-250/exports/geojson` and `SRC_GAS_NETWORK_TEREGA` → `.../terega-trace-du-reseau/exports/geojson` (`DeckGLMap.ts:772-779`). These don't delay `initMap()`'s own promise (added after `'load'` already fired) but they are unconditional network calls competing for bandwidth with everything that starts right after.

**Net effect**: literally every data fetch except `refreshNetworkBarometerWidget()` (and the cached-news paint) is serialized behind a third-party network chain (cartocdn style → sprite/glyphs/tiles) plus ~2.1 MB raw of map-related JS (`DeckGLMap` own chunk + `maplibre-gl` + `deck-gl` vendor chunks, see §4). See §6 item 1.

### Polling cadence (single source of truth, `App.ts:154-174`)

| Source | Interval | Immediate fetch on start*Polling() call? |
|---|---|---|
| RSS | 5 min | yes (`App.ts:3963-3965`, "First fetch immediately") |
| Military flights | **5 s** (`App.ts:4062-4065`) | yes, unconditional, regardless of layer (`App.ts:3973-4059`) |
| AIS ships (WebSocket) | 5 s UI / 30 s alerts (`App.ts:4068-4069`) | `connectAis()` opens the socket unconditionally (`App.ts:3974`) |
| Finance / market | 5 min | yes, unconditional (`App.ts:4263-4277`) |
| Nuclear (RTE) | 15 min | no (interval-only; first call comes from `loadCriticalLayers`) (`App.ts:4278-4281`) |
| Oil | 5 min | **no** — gated: `if (!this.activeLayers.oilNetwork) return;` inside the tick (`App.ts:4284-4293`) — the correct pattern, contrast with military above |
| Commodities | 15 min | yes, unconditional (`App.ts:4294-4309`) |
| Air traffic | 12 s | not verified further (optional layer, first load unconditional via `loadOptionalLayers`) |
| SNCF | 5 min | interval-only, dynamic-imported (`App.ts:5484` area, per prior perf memory) |
| Health | 15 min | **no** — gated behind `activeLayers.health\|healthApl\|healthOscour\|hospitals` or panel visibility (`App.ts:5735-5754`) — same correct pattern as Oil |
| Hydraulic | 10 min | — |
| Weather vigilance | 5 min | interval-only (`App.ts:5804-5813`); first call from `loadCriticalLayers` |
| Weather radar | 10 min | — |
| MTG FRP | 10 min | — |
| Radar 2D | 5 min | — |
| Infra network | 5 min | — |
| Eolien | 5 min | — |
| Network barometer (aggregate) | 5 min | yes, immediate, from inside `renderShell()` (`App.ts:2702-2706`) |
| Space weather refresh | 15 min | terminator recompute every 60 s regardless |
| Version check | 1 min | — |

---

## 2. Startup request count

**Distinct fetch call-sites triggered unconditionally** (not gated behind a layer toggle)
during the sequence above: at least ~30 apex-level calls (several services issue 2-4
internal requests each — e.g. RSS has 4 call sites in `services/rss.ts:46,249,378,431`;
Hub'Eau hydrometry issues 2 (`services/hubeau-hydrometry.ts:402,477`), doubled by the
duplicate call in §5). Exact count of MapLibre's internal sprite/glyph/tile requests to
cartocdn is **not determinable from code**.

**Largest static payloads touched at/near startup** (`du -sh public/*`):

| File | Size | Loaded when |
|---|---|---|
| `public/data/departements.geojson` | 3.3 MB | **Unconditionally, on the critical path** — see §6 item 2 |
| `public/data/maires-politique.json` | 2.0 MB | On-demand only, gated behind an explicit layer toggle (`DeckGLMap.ts:11347-11362`) — correct pattern |
| `public/data/eolien-france.geojson` | 4.5 MB | Fallback only, used when `/api/energy/eolien?parks=1` fails (`services/eolien/eolien-tracker.ts:15`) — correct pattern |
| `public/data/regions.geojson` | 480 KB | not traced |
| `public/data/history-dev.json` | 36 KB | dev-only server file (`plugins/situation-history-proxy.ts:14`), not shipped to client |
| `public/data/fuel-price-series.json` | 20 KB | gated behind oil layer / poll guard |
| `public/data/apl-departements.json` | 12 KB | fire-and-forget, not awaited (`App.ts:2134`) |
| `public/data/submarine-cables.json` | 12 KB | fetched at `App.ts:4226` |
| `public/data/oil_pipelines.geojson` | 8 KB | on-demand (`DeckGLMap.ts:9614`) |
| `public/landing/*.png` (6 files) | **27.3 MB total** (1.4–5.7 MB each) | Landing page only — see §6 item 5 |

`vite.config.ts:228-231` explicitly excludes `eolien-france.geojson` and
`departements.geojson` from the PWA precache with the comment "chargés à la demande, pas
au démarrage" (loaded on demand, not at startup) — true for the former, **not true** for
the latter (§6 item 2).

---

## 3. Client caches

| Cache | Storage | TTL | Paints before network? |
|---|---|---|---|
| News (RSS) | `localStorage` (`utils/newsCache.ts`) | 30 min (`newsCache.ts:11`) | **Yes** — the only cache that does (`App.ts:2141-2150`) |
| ~20 data services (ecowatt, weather-timeline, floods n/a, nuclear, fires, hydraulic snapshot, eolien, health, cyber, infra-network, internet-outages, outages, space-weather, mtg-frp, radar-2d/column, isnr-synthesis, network-barometer, air-traffic, fuel-tension, fuel-prices, outages-scraper, france-intel-brief, military-flights) | **In-memory module variable/Map only** — see `grep TTL_MS` sweep, e.g. `services/ecowatt.ts:43-44`, `services/nuclear-rte.ts:25`, `services/fires.ts:140`, `services/cyber.ts:29-30` | 2 min – 6 h depending on source | **No** — every hard refresh starts from zero for all of these; only survives soft navigation within the same tab session |
| `resilientFetch` stale-cache | in-memory `Map` (`utils/resilientFetch.ts:36-37`) | 30 min | No — only used as a last-resort fallback **after** retries are exhausted, not stale-while-revalidate on the happy path |
| Geocoding | IndexedDB (`services/geocoder.ts`) | — | Background RSS enrichment only, not startup-relevant |
| Language pref | `localStorage` (`services/i18n.ts:31`) | — | n/a (instant, local) |
| Fuel tension, stability-history, source-quality-history, situation-history, traffic, sentinelles client, AlertMonitor | `localStorage` (various files) | not individually audited | not on critical path |

**Finding**: News is the only domain with a persistent, reload-surviving,
paint-before-network cache. Every other domain (weather, floods, nuclear, ecowatt itself
on cold start, fires, health…) shows a loading state on every fresh page load even when
the same data was fetched seconds ago in a previous tab. See §6 item 6.

---

## 4. Lazy loading

**`vite.config.ts:332-345` `manualChunks`**: `maplibre-gl` → `maplibre` chunk;
`node_modules/d3` (matches `d3-geo`, `d3-selection`, any `d3-*` subpackage) → `d3` chunk;
`@huggingface/transformers` → `transformers` chunk; `onnxruntime-web` → `onnxruntime`
chunk; `@deck.gl` / `@luma.gl` / `@loaders.gl` / `@math.gl` → `deck-gl` chunk.
`vite.config.ts:220-226` also excludes `ai-worker-*`, `summarization-worker-*`,
`maplibre-*`, `onnxruntime-*`, `transformers-*` from the PWA precache list — they're
meant to load on demand and be cached via a separate `CacheFirst` runtime rule
(`vite.config.ts:279-293`).

| Library | Reached via | Critical path? |
|---|---|---|
| `maplibre-gl` | static import inside `DeckGLMap.ts`, itself only reachable via `import('./DeckGLMap.ts')` (`MapContainer.ts:76`) | **Yes, once map init starts** — required before `initMap()` resolves (§1) |
| `@deck.gl/*`, `@luma.gl/*` etc. | static imports inside `DeckGLMap.ts` | Loaded in parallel with the `DeckGLMap` chunk itself (bundler dependency-graph behavior for a dynamic import); not verified whether deck.gl specifically blocks `map.on('load')` or only later overlay rendering |
| `d3` (`d3-geo`, `d3-selection`) | **static** import in `components/Map.ts:7-9` (mobile SVG fallback), and `Map.ts` is **statically** imported into `MapContainer.ts:7`, which is statically imported into `App.ts:6` | Technically yes — pulled into the eager graph for all users, desktop included, even though only mobile ever instantiates `Map`. Small (32 KB raw in current dist), low priority |
| `@huggingface/transformers`, `onnxruntime-web` | only inside `services/ai-worker.ts` / `services/summarization-worker.ts` (dedicated Web Workers) | **No** — confirmed off the main-thread critical path, consistent with `project_perf_optimization.md` prior finding |
| `supercluster` | `components/DeckGLMap.ts` | inside the already-lazy DeckGLMap chunk |
| `hls.js` | `import type Hls from 'hls.js'` in `components/MapPopup.ts:16` — **type-only**, erased at compile time, not bundled | No issue found |
| `cheerio` | only under `src/plugins/*` (Vite dev / server-side proxy code) | Never shipped to the client |
| `i18next` | static, `main.ts` / `services/i18n.ts` | Yes, but tiny/local (resources are inline TS objects, no network) |

**App-level dynamic `import()`**: 35 call sites in `App.ts` (most panels: `DromEnergyPanel`,
`HydraulicPanel`, `EolienPanel`, `NationalHealthPanel`, `HealthBarometerPanel`,
`FiresPanel`, `TrafficPanel`, `MaritimePanel`, `CyberPanel`, `OilPanel`, `NuclearPanel`,
`OutagesPanel`, `DefensePanel`, `RightSidebar`, `SentinelModal`, `WildfireDossierModal`,
`SearchModal`, `FranceIntelPanel`, `SituationHistoryPanel`, plus services `military-bases-db`,
`hydraulic-backbone`, `transport`). This matches the prior perf work recorded in
`project_perf_optimization.md` (index.js reduced 1064.78→841.76 KB raw across 3 verified
iterations, "extractions propres épuisées" for `military-flights`/`military-ships`
(co-imported by `DeckGLMap.ts`/`MapContainer.ts`, can't be split further),
`config/infrastructure`, `stability-index`, `config/military`).

**Current bundle snapshot** (from `dist/assets`, produced by a build running concurrently
with this audit — Sep 22 08:15 — treat as approximate, not independently reproduced):

| Chunk | Raw size |
|---|---|
| `maplibre-*.js` | 1,022,684 B (~999 KB) |
| `index-*.js` (entry) | 922,066 B (~900 KB) |
| `deck-gl-*.js` | 792,931 B (~774 KB) |
| `summarization-worker-*.js` | 524,514 B |
| `ai-worker-*.js` | 524,504 B |
| `DeckGLMap-*.js` | 331,771 B (~324 KB) |
| `osm-france-military-*.js` | 285,852 B |
| `hydraulic-backbone-*.js` | 55,224 B |

Note: current `index-*.js` (~900 KB raw) is larger than the 841.76 KB raw figure recorded
86 days ago as the "final state" in `project_perf_optimization.md`, suggesting feature
growth since then (SituationBrief, wildfire dossier, radar-2d/column, source-quality
tracking, etc. all added to `App.ts` per current line count of 6,830 vs. whatever it was
at that time) has eroded some of that prior work. Re-running that lazy-loading audit
against the newer services is a reasonable follow-up but is out of scope for this
data-loading audit.

---

## 5. Waterfalls & blocking

1. **Map gates almost all data fetching** (detailed in §1). This is the single largest
   waterfall: `renderShell → await initMap (network-bound, 3rd-party) → THEN start
   everything else`. Only `refreshNetworkBarometerWidget()` escapes it.
2. **`departements.geojson` (3.3 MB) on the awaited critical path regardless of layer
   visibility** — `loadWeather()` (`App.ts:4588-4624`) does `await
   this.mapContainer?.updateWeather(alerts)` (`App.ts:4600/4607/4611`), which calls
   `DeckGLMap.updateWeather()` (`DeckGLMap.ts:9666`), which calls
   `getDepartmentsGeojson()` (`DeckGLMap.ts:9643-9653`, memoized after first call but
   unconditional). `loadWeather()` is one of the four tasks `await`-ed inside
   `loadCriticalLayers()` (`App.ts:6112-6155`), which `init()` itself awaits
   (`App.ts:2172`) before calling `updateISNR()` and
   `restoreActiveLayerPanelsAfterRefresh()`. Same file is also required by
   `updateHealth`, `updateISNR`, `updateOutages`, `updateFuelTensionDepartments`
   (`DeckGLMap.ts:9816,9973,10104,10319`) — so it loads even for sessions that never
   touch weather/health/ISNR/outages/fuel-tension.
3. **Duplicate hydraulic refresh, exact same work run twice** — `loadWeather()` ends with
   `await this.refreshHydraulicLayer()` (`App.ts:4622`). `loadSecondaryLayers()` has its
   own `'hydraulic'` task calling `this.loadHydraulic()` (`App.ts:6171-6177`), whose
   entire body is `await this.refreshHydraulicLayer()` (`App.ts:4772-4774`). Since
   `loadCriticalLayers()` (which runs `loadWeather`) resolves before `loadSecondaryLayers()`
   starts, `refreshHydraulicLayer()` — dynamic import of `services/hydraulic-backbone.ts`
   + Hub'Eau hydrometry fetch (`services/hubeau-hydrometry.ts:402,477`) + asset rebuild —
   runs in full **twice**, every single page load, regardless of whether the hydraulic
   layer is visible.
4. **Sequential icon-atlas fetches** — `loadIconAtlas()` awaits `fetch(mapping.json)` then
   awaits `map.loadImage(atlas.png)` sequentially (`DeckGLMap.ts:7964,7967`); the JSON
   fetch doesn't depend on the map and could run in parallel with map creation instead of
   after `map.on('load')`.
5. **5-second military/AIS polling, unconditional** — `startMilitaryPolling()`
   (`App.ts:3973-4065`) calls `connectAis()` and `fetchFlights()` immediately, then every
   5 s via `registerPausableInterval(..., 5_000)` (`App.ts:4062-4065`), **regardless of
   `activeLayers.military`/maritime visibility** — contrast with `startOilPolling()`
   (`App.ts:4284-4293`) and `startHealthPolling()` (`App.ts:5735-5754`), which correctly
   check layer/panel visibility before fetching. This competes for network/CPU with the
   critical-layer fetches during the exact window right after map init resolves.
6. **Gas network sources fetched unconditionally at map init** regardless of the gas
   layer's visibility (`DeckGLMap.ts:772-779`, direct `odre.opendatasoft.com` URLs handed
   to `map.addSource`, which MapLibre fetches immediately). Doesn't block `initMap()`'s
   own promise (added after `'load'` fires) but is still unconditional third-party
   network work at startup for a hidden-by-default layer.
7. **No duplicate-fetch problem found for ecowatt/cyber specifically** — checked
   explicitly because `refreshNetworkBarometerWidget()` (fires at t≈0 from
   `renderShell()`) and `loadCriticalLayers()`'s ecowatt task (fires only after `initMap`
   resolves) both call `fetchEcowatt()`; the module-level TTL cache
   (`services/ecowatt.ts:43-44,99`) means the second call is a free cache hit in
   practice. `services/cyber.ts:29-30,346` additionally has a proper in-flight-promise
   guard (not just a TTL cache) preventing even concurrent duplicate calls — this is the
   most robust pattern in the codebase and a good template for other services.

---

## 6. Top 10 optimization opportunities

Ranked by estimated impact on time-to-usable-dashboard.

1. **Stop letting the map gate all data fetching.** Problem: `App.ts:2107-2186` — every
   `start*Polling()` call and `await loadCriticalLayers()` sits textually (and therefore
   temporally) after `await this.initMap()`, which itself waits on a third-party network
   chain (cartocdn style/sprite/glyphs/tiles) plus downloading/parsing ~2.1 MB raw of map
   JS (`maplibre` + `deck-gl` + `DeckGLMap` chunks, §4). File: `App.ts:2107-2186`,
   `DeckGLMap.ts:600-627`. Change: kick off the critical-layer network requests (ecowatt,
   weather, floods, nuclear) in parallel with `initMap()` instead of after it — e.g. start
   the promises before `await this.initMap()` and only gate the `mapContainer?.updateX()`
   calls (not the `fetch`) on map readiness, replaying stored state once the map exists.
   Requires care: several `updateX()` calls currently silently no-op via optional chaining
   if `this.mapContainer`'s internal `deckMap` isn't set yet, so a naive reorder can drop
   the first paint of a layer. Gain: potentially the largest lever available — removes a
   full serialization of (map network time) + (data network time) into
   max(map network time, data network time). Effort: **L** (real architectural change,
   needs a replay-on-ready mechanism to avoid dropped updates).

2. **Stop loading `departements.geojson` (3.3 MB) unconditionally.** Problem: fetched on
   every session via `updateWeather`/`updateISNR` regardless of whether
   weather/health/ISNR/outages/fuel-tension layers are ever opened (`DeckGLMap.ts:9643-9653,9666`,
   chained through `App.ts:4600,6112-6155,2172-2173`). The PWA config already documents
   the intent to defer it (`vite.config.ts:228-229`) but the client code doesn't honor
   that for this path. Change: only call `getDepartmentsGeojson()` (and build the
   department choropleth) when at least one department-choropleth-consuming layer is
   actually active; otherwise skip that portion of `updateWeather`/`updateISNR` and
   backfill lazily the first time such a layer is toggled on. Gain: removes 3.3 MB from
   the critical path for the majority of sessions. Effort: **M**.

3. **Delete the duplicate hydraulic refresh.** Problem: `refreshHydraulicLayer()` runs
   twice per page load — once from inside `loadWeather()` (`App.ts:4622`) and once from
   `loadHydraulic()` in `loadSecondaryLayers()` (`App.ts:4772-4774`). Change: remove the
   `await this.refreshHydraulicLayer();` call at `App.ts:4622` — `loadSecondaryLayers()`'s
   own `'hydraulic'` task already runs it after `loadCriticalLayers()` has populated
   ecowatt/floods/weather, which is exactly what `refreshHydraulicLayer()` needs
   (`App.ts:4748-4752`). Gain: removes one duplicate dynamic import + one duplicate
   Hub'Eau network round trip on every load, and shortens `loadWeather()`'s own await
   chain. Effort: **S**.

4. **Gate military/AIS polling behind layer visibility.** Problem: `startMilitaryPolling()`
   fetches immediately and every 5 s indefinitely, regardless of
   `activeLayers.military`/maritime visibility (`App.ts:3973-4065`). Change: mirror the
   guard already used correctly in `startOilPolling()` (`App.ts:4284-4293`)/
   `startHealthPolling()` (`App.ts:5735-5754`): keep one unconditional fetch for the
   status bar if needed, but stop the 5 s drumbeat (and defer `connectAis()`) until the
   relevant layer or panel is actually visible. Gain: removes a persistent 5 s-cadence
   background load that directly competes with the startup fetches for connections/CPU,
   plus ongoing battery/data savings. Effort: **M**.

5. **Landing page: lazy-load and size the 27.3 MB of screenshots.** Problem:
   `LandingPage.ts:89,137,148,159,170,181,202,205,208,211,214,217` render six PNGs
   (1.4–5.7 MB each, `du -sh public/landing/*`), each referenced by **two** `<img>` tags
   (feature card + gallery), none with `loading="lazy"`, `width`/`height`, or a modern
   format. This is the default `/` route almost every visitor lands on first. Change:
   add `loading="lazy"` + explicit `width`/`height` to every below-the-fold `<img>` now
   (S effort, safe, immediate); separately, re-encode to WebP/AVIF with responsive
   `srcset` (M/L effort, needs new asset generation). Gain: large LCP and bandwidth
   reduction for the page most users see first. Effort: **S** for the attribute fix,
   **M/L** for format conversion.

6. **Persist critical-layer responses to localStorage like news already does.** Problem:
   ~20 services (ecowatt, weather, floods, nuclear, fires, hydraulic, eolien, health,
   cyber, infra-network, etc.) cache only in an in-memory module variable
   (§3 table), so every hard refresh re-fetches everything from zero — unlike
   `utils/newsCache.ts`, which persists to `localStorage` and paints instantly
   (`App.ts:2141-2150`). Change: generalize the existing, already-tested `newsCache.ts`
   pattern to at least the four critical-layer responses (ecowatt/weather/floods/nuclear),
   writing to `localStorage` on success and reading it back before the network call
   resolves, with the TTLs each service already defines. Gain: instant paint of
   last-known state on reload, matching what news already does. Effort: **M**.

7. **Parallelize the icon-atlas fetch with map creation.** Problem:
   `loadIconAtlas()`'s `fetch('/assets/dsfr-mapping.json')` runs only after
   `map.on('load')` fires (`DeckGLMap.ts:626-627,7964`), even though it has no dependency
   on the map. Change: kick off that `fetch` alongside `getFrenchStyle()`/map creation
   (`DeckGLMap.ts:604-606`) and only await it once needed for `map.loadImage()`. Gain:
   small (saves roughly one small round trip), but safe. Effort: **S**.

8. **Gate the two gas-network `addSource` URLs behind the gas layer.** Problem:
   `SRC_GAS_NETWORK_GRT`/`SRC_GAS_NETWORK_TEREGA` are added with a live
   `odre.opendatasoft.com` URL as `data` at map-init time (`DeckGLMap.ts:772-779`),
   which MapLibre fetches immediately regardless of layer visibility. Change: add these
   sources with empty data at init (like the ~30 other sources already are) and only
   `setData`/fetch when the gas layer is actually toggled on, same memoized-promise
   pattern already used for `departements.geojson`. Gain: removes 2 unconditional
   third-party requests from every session for a layer that's off by default. Effort: **S/M**.

9. **Re-run the lazy-loading audit against services added since the last perf pass.**
   Problem: current `index-*.js` (~900 KB raw per the concurrent build snapshot in §4) is
   larger than the 841.76 KB raw figure recorded as "final" 86 days ago in
   `project_perf_optimization.md`, and `App.ts` has grown to 6,830 lines. Newer services
   (radar-2d/column, wildfire-dossier, mtg-frp, cyber-threat-scoring,
   source-quality-history, situation-brief/engine) weren't covered by that earlier audit.
   Change: repeat the same static-import → dynamic-import sweep the prior work did for
   `military-bases-db`/`hydraulic-backbone`/`transport`. Gain: not quantified without
   redoing the analysis; prior three iterations delivered ~21% raw reduction, so more is
   plausible. Effort: **M**.

10. **Stop pulling `d3-geo`/`d3-selection` into the eager graph for desktop users.**
    Problem: `components/Map.ts:7-9` (mobile-only SVG fallback) is statically imported by
    `components/MapContainer.ts:7`, which is statically imported by `App.ts:6` — so the
    `d3` manualChunk (32 KB raw in the current dist snapshot) loads for every session even
    though only `isMobileDevice()` sessions (`MapContainer.ts:21-36,66-74`) ever instantiate
    it. Change: make the `Map.ts` import inside `MapContainer.ts` dynamic
    (`await import('./Map.ts')`), mirroring how `DeckGLMap.ts` is already only
    `import type`-referenced. Gain: small (tens of KB), low priority, but trivial and
    risk-free. Effort: **S**.
