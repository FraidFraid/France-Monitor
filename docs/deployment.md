# Deployment

Real topology as of the September 2026 infrastructure audit (`docs/audit-2026-09-infrastructure.md`, read that document for the full detail and the reasoning behind each choice). This page is the operational reference: who runs what, how the environment variables are laid out, how the single API router works, and the local dev commands.

## 0. Topology — who does what

```
Browser (every visitor)
  ├─ HTTPS  → Vercel        (static site + /api/*)
  ├─ WSS    → Render        (AIS relay, ais-relay.js)
  ├─ HTTPS  → Railway       (radar rasters, served directly to the browser)
  └─ HTTPS  → ~40 public APIs called directly (Hub'Eau, ODRE, EDF opendata, geo.api.gouv.fr,
              api-adresse/BAN, data.gouv.fr, NOAA SWPC, RainViewer, Carto tiles, NASA GIBS…)

Vercel — project `france-monitor` (functions in fra1, CDN observed in cdg1)
  ├─ dist/ static hosting (index.html, hashed assets, service worker, about/methodology/legal/contact/docs)
  ├─ ONE serverless function (api/index.js) serving every /api/* route (see §1)
  ├─ 3 dedicated functions: api/ingest/news.ts, api/fuel-price-series-refresh.js, api/sentinel-ndwi.ts
  ├─ Daily cron: fuel price refresh (05:00 UTC) — safety-net daily cron: news ingestion (04:15 UTC)
  ├─ reads/writes: Upstash Redis (cache, locks, situation history), Neon Postgres (news_items)
  └─ calls: Groq (LLM), RTE, Météo-France, TomTom, NASA FIRMS, Copernicus, Shodan/Censys, Cloudflare Radar…

Upstash
  ├─ Redis — response cache, ingest lock, ingest:last-tick stats, situation-history (6h slots, 31d TTL)
  └─ QStash — external scheduler that POSTs /api/ingest/news every 30 min (see §2 and the Hobby runbook)

Neon Postgres (eu-central-1) — feeds, news_items (~90 days retention), situation_snapshots

Railway — project `radar-worker`, environment `production`
  ├─ FastAPI/uvicorn container, port 8091, self-refreshing loop every ~300s
  ├─ downloads + decodes Météo-France DPRadar (IMFR27/PAM), no eccodes at runtime (home-grown bitstream decoders)
  ├─ publishes manifest.json + rasters/*.webp on a 5 GB volume mounted at /data
  └─ the browser downloads rasters directly from Railway's public domain (not proxied through Vercel bytes,
     only the manifest is proxied with a 120s CDN cache)

Render — service `france-monitor` (ais-relay.js, Node)
  ├─ WSS relay: one upstream subscription to aisstream.io, fanned out to every connected browser
  ├─ GET /opensky — civil air traffic snapshot, recomputed on every call, no cache (see the perf audit)
  └─ GET /health

GitHub Actions (public repo FraidFraid/France-Monitor)
  ├─ ci.yml — lint, typecheck, vitest, build, Python radar-worker tests, generated-files check (§5)
  ├─ smoke.yml — daily production smoke test against francemonitor.com + Railway + Render health (see the file)
  └─ radar-refresh.yml — best-effort safety net, POSTs /refresh on Railway (real cadence: every 3–6h, GitHub
     scheduler drift on low-traffic repos — never rely on it as a primary mechanism, see the file's own comments)
```

One-line summary: **Vercel hosts the site and proxies/caches ~40 public APIs; Railway does the one real heavy computation (Météo-France radar); Render holds the real-time AIS relay; Upstash and Neon store; GitHub Actions deploys and provides safety nets; the browser does the rest (classification, geocoding, situation history writes).**

## 1. The single API router

Vercel Hobby limits a Vite + `api/` deployment to **12 serverless functions**. France Monitor has ~50 API routes, so only 4 files are real Vercel functions:

- `api/index.js` — the router. Every other route lives under `api/_handlers/**`, a directory Vercel ignores (any `_`-prefixed folder is never turned into a function).
- `api/ingest/news.ts` — needs its own 300s `maxDuration`, kept as a dedicated function.
- `api/fuel-price-series-refresh.js` — daily cron target.
- `api/sentinel-ndwi.ts` — kept dedicated (large POST body handling).

`vercel.json` rewrites `/api/(.*)` to `/api?__fmroute=$1` **before** the SPA fallback (Vercel checks the filesystem — and therefore real function files — before applying rewrites, so `api/ingest/news.ts` etc. are reached directly and never go through the rewrite). `api/index.js` calls `dispatch()` from `api/_utils/dispatch.js`, which:

1. Resolves the route from the URL or the `__fmroute` hint against the generated table `api/_routes.js` (`ROUTES` + a small `ALIASES` map for renamed legacy paths).
2. Lazily imports the matching handler in `api/_handlers/`.
3. Runs it. Two handler styles coexist and both work unmodified:
   - **Node style** `(req, res)` using the familiar Vercel helpers (`req.query`, `res.status().json()`) — called as-is.
   - **"Edge" style** `Request → Response` (marked with `export const config = { runtime: 'edge' }`) — historically written for Vercel's Edge runtime. Since Vercel is deprecating Edge, these now run on the **Node runtime** too; `dispatch()` adapts the incoming `IncomingMessage` into a `Request` and the returned `Response` back into a `ServerResponse`, so the 10 handlers written this way (`threats`, `exposure`, `rss`, `rss-proxy`, `json-proxy`, `oil-proxy`, `fuel-prices-proxy`, `intelligence/v1/*` ×3) did not need rewriting.

`api/_routes.js` is **generated** — never edit it by hand:

```bash
npm run generate:api-routes
```

`tests/api-router.test.ts` fails the build if the checked-in file is stale, if any new file appears directly under `api/` (raising the function count above 4), or if `vercel.json`'s cron schedules stop being once-a-day (a Hobby requirement, see the runbook).

### Adding a new endpoint

1. Create the handler in `api/_handlers/<path>.js` (or `.ts`), Node or Edge style, matching the URL you want (`api/_handlers/energy/foo.js` → `/api/energy/foo`).
2. Run `npm run generate:api-routes` to regenerate `api/_routes.js`.
3. Add a matching Vite dev proxy plugin under `src/plugins/` and register it in `vite.config.ts` (dev mirrors prod route-by-route; there is currently one dev plugin per endpoint — see §4 below if that changes).
4. `npm run typecheck && npm test` — the router test and the generated-files CI check (§5) both catch drift.

Do **not** add a new top-level file directly under `api/` — it becomes its own Vercel function and pushes the project over the Hobby 12-function limit.

## 2. Crons and scheduling

- Vercel Hobby allows crons but at most **once per day**, hour precision only. `vercel.json` therefore only carries two daily crons: fuel price refresh (`0 5 * * *`) and a **safety-net** news ingestion run (`15 4 * * *`).
- The real 30-minute news ingestion cadence is driven by **Upstash QStash** (same account as Redis, free tier: 1,000 messages/day, 10 schedules — this uses 48/day), configured entirely in the Upstash console, not in this repo. It calls `POST https://www.francemonitor.com/api/ingest/news` with header `Upstash-Forward-Authorization: Bearer <CRON_SECRET>` (QStash forwards this as a plain `Authorization` header, which `api/ingest/news.ts` already validates — no code change needed). Setup steps: `docs/runbook-passage-hobby.md`.
- Never rely on `.github/workflows/radar-refresh.yml`'s `*/5 * * * *` schedule for anything time-sensitive: GitHub's scheduler drifts to every 3–6h on low-activity repos. It is a safety net for the Railway worker, which refreshes itself internally every ~5 minutes regardless.

## 3. Environment variables by platform

| Variable | Vercel | Railway | Render | GitHub Actions | Notes |
|---|---|---|---|---|---|
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | required | | | | absent locally → caches disabled in dev |
| `DATABASE_URL` (Neon) | required | | | | absent locally → `/api/news` returns 503 |
| `CRON_SECRET` | required | | | required (as `RADAR_WORKER_TOKEN` is separate, see below) | shared secret for QStash + the daily safety-net cron |
| `RTE_CLIENT_ID` / `_SECRET` | required | | | | Ecowatt, Eco2mix, nuclear unavailability |
| `METEO_FRANCE_API_KEY` | required | | | | vigilance |
| `METEO_FRANCE_RADAR_MANIFEST_URL` | required | | | | points at the Railway manifest |
| `METEO_FRANCE_RADAR_API_KEY` | | required | | | DPRadar access |
| `RADAR_WORKER_TOKEN` | | required | | required (secret) | shared bearer for `POST /refresh` and `/publish` |
| `RADAR_STORAGE_DIR`, `RADAR_PUBLIC_BASE_URL` | | required (Railway dashboard) | | | not in `railway.toml` — see §6 |
| `RADAR_RAW_RETENTION`, `RADAR_RASTER_RETENTION` | | optional (default 24) | | | |
| `AISSTREAM_API_KEY` | | | required | | Render env, outside this repo |
| `VITE_AIS_RELAY_URL` | required at build (inlined) | | | | points at the Render WSS endpoint |
| `AIR_RELAY_URL` / `WS_RELAY_URL` | optional | | | | if set, `/api/traffic/air` calls Render instead of airplanes.live directly |
| `OPENSKY_CLIENT_ID` / `_SECRET` | optional | | absent (Render `/health` reports `opensky:false`) | | |
| `TOMTOM_API_KEY` | required (road traffic) | | | | |
| `SNCF_API_KEY`, `NASA_FIRMS_API_KEY`, `CDSE_*`/`COPERNICUS_*`, `SHODAN_API_KEY`, `CENSYS_*`, `CLOUDFLARE_RADAR_TOKEN` | optional | | | | graceful degradation if absent |
| `GROQ_API_KEY` | optional | | | | cron reclassification, summaries, brief, synthesis — **never** set `VITE_GROQ_API_KEY` |
| `GROQ_MODEL` / `GROQ_FAST_MODEL` | optional | | | | defaults `openai/gpt-oss-120b` (brief, synthesis) and `openai/gpt-oss-20b` (summaries, cron). Groq retired `llama-3.3-70b-versatile` in 2026, which silently broke every Groq call; the model list is in `api/_lib/groq-models.js` |
| `TYPESAFE_API_KEY` | optional, server only | | | | Jev (TypeSafe) news scoring — see `NEWS_SCORING` below |
| `NEWS_SCORING` | optional (`off` default, `shadow`, `jev`) | | | | gates the Jev scoring path in the ingestion cron; `off`/absent = current keyword+Groq behaviour |
| `JEV_BUDGET_PER_TICK` | optional (default 200) | | | | per-tick article budget when `NEWS_SCORING` is not `off` |
| `GIE_API_KEY` | optional | | | | only if the GIE AGSI/ALSI gas-storage API requires a key for the production handler |
| `VITE_ENABLE_CYBER_PANEL` / `_GAS_PANEL` / `_OIL_LAYER` | **opt-out** — unset = panel active; set to `false` to disable | | | | do not set to `true`, that is already the default |

QStash itself needs **no environment variable in this repo** — the schedule (destination URL, cron expression, header) lives in the Upstash console. See `docs/runbook-passage-hobby.md` step 1.

## 4. Local development

```bash
npm install
cp .env.example .env.local
npm run dev          # Vite only, http://localhost:3001
npm run dev:full      # Vite + the Scrapling Python sidecar (Cloudflare-protected PQR RSS, port 8080)
```

Local `/api/*` calls are served first by the per-route Vite dev plugins under `src/plugins/` (registered in `vite.config.ts`). Any `/api/*` route without a dedicated plugin falls through to `apiRouterFallbackPlugin()` (`src/plugins/api-router-fallback.ts`, registered **after** every proxy plugin), which runs the production router `api/_utils/dispatch.js` with Vercel-like helpers and loads `.env*` into `process.env`. New endpoints therefore work locally without writing a plugin. Prefer this over writing a plugin that re-implements a handler: the `arcep`, `biogas-sites` and `json-proxy` plugins were removed on 2026-09-23 because they had drifted from production (old ARCEP URL, removed GRDF fields, no ransomware trimming).

Use relative `/api/...` URLs in client services: absolute `http://localhost:3001/...` dev URLs were removed so the app runs on any port (`npx vite --port 3011`). Radar worker (`npm run radar:dev`, port 8091) and the AIS relay can also be run locally; see `services/radar-worker/` and `ais-relay.js`.

Without any API keys the app still starts — energy, weather, and news panels show errors or fallback states; the map, UI, and classification engine work regardless.

```bash
npm run typecheck   # tsc --noEmit, 0 errors required
npm run build        # tsc && vite build
npm run test          # vitest run
npm run lint           # eslint src/
```

## 5. Generated files — do not hand-edit

Three files are generated from source and checked by CI (`scripts/check-generated.mjs`, see `.github/workflows/ci.yml`):

| Generated file | Generator | Source of truth |
|---|---|---|
| `api/_routes.js` | `npm run generate:api-routes` | `api/_handlers/**` (filesystem walk) |
| `api/_lib/server-classifier.js`, `api/_lib/server-geocoder.js` | `npm run generate:server-libs` | `src/services/classifier.ts`, `src/services/geocoder.ts`, `src/config/geo.ts` |
| `api/_lib/feeds-snapshot.js` | `npm run sync:feeds` | `src/config/feeds.ts` |

If you change any of the source files above, run the matching command and commit the regenerated output in the same commit. CI regenerates and diffs `api/` on every push; a stale generated file fails the build with a message telling you which command to run.

## 6. Railway — radar-worker

Config-as-code lives in `services/radar-worker/railway.toml` (builder, health check path, restart policy). The public domain (port 8091), the persistent volume (`/data`, 5 GB), and the application secrets (`METEO_FRANCE_RADAR_API_KEY`, `RADAR_WORKER_TOKEN`, `RADAR_STORAGE_DIR`, `RADAR_PUBLIC_BASE_URL`) are configured in the Railway dashboard, not in the repo — `railway.toml` intentionally does not set a start command so it never overrides `services/radar-worker/entrypoint.sh` (root-owns-then-drops-privilege pattern for the mounted volume).

## 7. Render — ais-relay

`ais-relay.js` at the repo root runs on Render as service `france-monitor` (`https://france-monitor.onrender.com`). Its start command, port, and `AISSTREAM_API_KEY` are configured directly in the Render dashboard — there is no `render.yaml` in this repo. See the infrastructure audit §1.3 for the free-tier sleep-on-idle risk and the consolidation option (moving the relay to Railway as a second service) if that risk needs to be closed.

## 8. Monitoring

- `/api/health-check` reports `ok` / `degraded` / `down` from the last ingestion tick age and the newest article age — see `api/_handlers/health-check.js` for the current thresholds, and keep them in sync with the actual ingestion cadence (§2) whenever that cadence changes.
- `.github/workflows/smoke.yml` runs daily against production and checks that key routes return JSON (not the SPA fallback HTML — this is exactly how `/api/ministers/*` and `/api/gie/*` went dark in production without anyone noticing) plus the Railway and Render `/health` endpoints.
- A free external monitor (UptimeRobot or equivalent) should also watch the three health URLs directly — see step 5 of `docs/runbook-passage-hobby.md`.

## 9. Cost and the Hobby migration

See `docs/runbook-passage-hobby.md` for the full, ordered runbook to move from Vercel Pro to Hobby (≈23€/month → ≈4.6€/month) now that the single-router change removes the function-count blocker. The infrastructure audit (`docs/audit-2026-09-infrastructure.md` §7) has the underlying cost analysis and a further €0 option (self-hosting the radar worker and AIS relay on an Oracle Cloud free VM) for later.
