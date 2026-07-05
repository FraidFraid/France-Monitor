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

## Reuse Model

The intended European reuse model is country-specific connector modules feeding a common presentation and API-proxy architecture. A new country should be able to add:

- source registry entries
- geocoding and administrative geography helpers
- one or more ingestion services
- optional map layers and panels
- documentation for source provenance and update cadence

France remains the first complete reference dataset.
