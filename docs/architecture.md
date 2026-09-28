# Architecture

France Monitor is a Vanilla TypeScript + Vite application with Vercel Serverless Functions used as API proxies and cache boundaries. The current France deployment is the reference implementation for a reusable geospatial monitoring commons.

## Goals

- ingest public-interest territorial and infrastructure data
- normalize heterogeneous feeds into typed client-side contracts
- expose reproducible API proxy patterns for CORS, authentication, and caching
- render weak signals on a MapLibre + Deck.gl geospatial interface
- keep AI processing local-first where possible
- document every source and fallback so outputs remain auditable

## Runtime Layers

| Layer | Role |
|-------|------|
| Browser app | Vanilla TypeScript UI, MapLibre/Deck.gl map, panels, local state |
| Vite dev plugins | Local `/api/*` proxy equivalents for external data sources |
| Vercel Functions | Production `/api/*` proxies, source normalization, cache boundary |
| Upstash Redis | Optional shared serverless cache |
| IndexedDB/localStorage | Browser-side persistence and history |
| Scrapling proxy | Optional Python sidecar for Cloudflare-protected RSS feeds |

## Data Flow

1. A service in `src/services/` requests an app-local endpoint or public source.
2. In development, `src/plugins/*-proxy.ts` handles `/api/*` routes.
3. In production, Vercel Functions under `api/` handle the same routes.
4. Services normalize responses into shared TypeScript types from `src/types/index.ts`.
5. `App.ts` updates panels, map layers, and the watchdog source registry.

## Map Architecture

- Desktop: `DeckGLMap.ts` uses MapLibre GL with Deck.gl layers.
- Mobile fallback: `Map.ts` uses D3/SVG to reduce WebGL pressure.
- Coordinates are always `[lng, lat]`.
- Layers are built from typed domain objects rather than raw upstream payloads.

## Intelligence Layer

Raw domain signals converge into a country-level intelligence pipeline (`src/services/france-country-intel.ts`):

1. `detectSituations` (10 deterministic rules) correlates multi-source signals into explainable situations — drivers, confidence, affected zones, recommended actions.
2. The stability score v3 derives from pressure pillars (baseline 95 minus progressive deductions), is capped by active situations and smoothed against a local 7-day history; the full per-pillar breakdown ships with each snapshot for explainability.
3. A structured intelligence brief (BLUF, prioritised judgments, watch items) is generated server-side as validated JSON (Groq), with a deterministic client-side fallback built from the same detected situations — outputs remain auditable even without any LLM.

## News Classification

Server-side ingestion (`api/ingest/news.ts`, every 30 min) qualifies each article, then groups articles into events. Every article and event carries a reported severity, a kept (operational) severity, a timing (ongoing / past / upcoming), a location (France / abroad / undetermined) and the reasons for any downgrade — following the separation of severity, urgency and certainty of the Common Alerting Protocol.

1. **Keywords (`kw-2`)** — `src/services/classifier.ts` + `src/services/classification-guards.ts`, shared with the browser and bundled into `api/_lib/server-classifier.js` (generated).
2. **LLM arbitration (`groq-2` / `llm-2`)** — `api/_lib/llm-pass.js` sends at most 2 batches of 10 articles per run with a written 5-level scale to an OpenAI-compatible endpoint (Groq by default, configurable); the server applies the caps.
3. **Event severity** — `api/_lib/event-model.js`: each media group counts once; an event keeps the second-highest group level; a single group is capped at `medium` and shown as "to be confirmed" when reported higher.
4. **Screen** — press enters the "À traiter" list only through consolidated events; the event card explains the level.

See `docs/classification.md` for the rules, measurements and known limits.

## Reuse Model

The intended European reuse model is country-specific connector modules feeding a common presentation and API-proxy architecture. A new country should be able to add:

- source registry entries
- geocoding and administrative geography helpers
- one or more ingestion services
- optional map layers and panels
- documentation for source provenance and update cadence

France remains the first complete reference dataset.
