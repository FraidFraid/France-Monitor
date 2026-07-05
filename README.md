<div align="center">

<img src="./public/icon.svg" alt="France Monitor logo" width="120" height="120" />

# 🇫🇷 France Monitor

**Open-source geospatial monitoring platform for public-interest infrastructure and territorial data**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Deploy on Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://vercel.com)
[![Version](https://img.shields.io/badge/version-0.1.1-brightgreen)](https://github.com/FraidFraid/France-Monitor)
[![Status](https://img.shields.io/badge/status-active%20development-orange)](https://github.com)

[Live App](https://www.francemonitor.com) · [About](https://www.francemonitor.com/about) · [Legal](https://www.francemonitor.com/legal)

[Features](#-features) · [Architecture](#-architecture) · [Getting Started](#-getting-started) · [Documentation](#-documentation) · [Roadmap](#-roadmap) · [Contributing](#-contributing)

</div>

---

## What is France Monitor?

France Monitor is an open-source geospatial monitoring platform for public-interest infrastructure and territorial data. The current implementation is a France-focused reference deployment: it aggregates real-time signals from public APIs, open data, technical feeds, and RSS sources into a single interactive map dashboard covering infrastructure, environment, transport, health, cyber threats, markets, and public information flows.

The goal is not to replace primary sources, official alerts, or newsroom verification. The project is designed as a public-facing monitoring and correlation tool for analysts, journalists, researchers, and technically curious users who want a unified view of weak signals and public data across France.

France Monitor is **not a media outlet and not a press publication**. Items shown in the app should be treated as monitoring signals that may require confirmation from primary sources.

The long-term goal is to turn the France prototype into a reusable European commons: documented ingestion patterns, auditable source attribution, deployable API proxies, and country-specific connectors that other civic-tech or research teams can adapt.

---

## ✨ Features

### 🗺️ 3D Interactive Map
- WebGL rendering via **MapLibre GL + Deck.gl** (desktop)
- D3/SVG fallback for mobile and low-memory devices
- Day/night terminator with real-time solar position
- Satellite basemap toggle (Copernicus Sentinel-2 NDWI overlays)
- Supercluster-based news marker clustering
- Military flight trails, ship tracks, AIS live positions, GPS jamming heatmap

### ⚡ Energy & Infrastructure
| Panel | Data | Cadence |
|-------|------|---------|
| Electricity grid (Ecowatt) | RTE stress levels by department | 5 min |
| Nuclear fleet | RTE unavailabilities + REMIT/IIP RSS notices | 15 min |
| Gas network | GRTgaz / Teréga flows + vital-organ facilities | 10 min |
| Oil & fuel | Refinery stocks, fuel tension, daily official price history | 10 min |
| Wind energy | RTE real-time éolien production by park | 5 min |
| Hydraulic backbone | Dam levels, barrage signals, Hub'Eau hydrometry | 10 min |
| DROM energy | Overseas territories grid data (Réunion, Martinique…) | 15 min |
| Citizen outages | infocoupure.fr scraping — real electricity outage reports | 10 min |

### 🛡️ Cyber & Digital Sovereignty
- **CyberBreachPanel** — live breach & ransomware incident map (RansomwareLive feed)
- **Exposure scoring** — Shodan + Censys OSINT aggregation of exposed French infrastructure
- **Threat scoring engine** — composite cyber pressure index per source/domain
- **Network barometer** — Cloudflare Radar + IODA internet anomaly detection
- **Internet outages** — ISP-level connectivity monitoring (ARCEP / IODA)
- Cyber incident feed with severity classification

### 🌦️ Environment
- **Météo-France** vigilance alerts (levels 1–4, all hazard types)
- **Vigicrues** flood segments with matched OSM waterway geometry
- Active wildfire hotspots (NASA FIRMS MODIS + VIIRS, DBSCAN clustered)
- Space weather (NOAA Kp index, geomagnetic storm alerts)
- EnvironmentPanel — unified view of weather, floods, fires, and space weather

### 🚂 Transport
- **SNCF** real-time disruptions with affected rail segments on map
- **Air traffic** (OpenSky ADS-B) — civil + military flight separation
- **Maritime AIS** live ship positions + anomaly detection (holding patterns, GPS drift)
- **Road traffic** incidents on-demand (TomTom / Bison Futé)

### 📰 News Intelligence
- RSS aggregation from **60+ French national and regional (PQR)** sources
- **Server-side ingestion** — Neon Postgres + Vercel Cron (5 min), 90-day retention
- Two-stage classification: keyword-based (instant) then optional **Groq LLM server-side** for ambiguous articles
- AI summarisation: Ollama (local) → Groq (cloud) → Transformers.js (browser)
- **History UI** — interactive heatmap (day × category), cursor-based pagination, filters (severity, region, search) across 90 days of articles
- Geocoding of news items to map locations
- Stale-article protection and deduplication across polling cycles

### 🔭 Defence & Sovereignty
- Military flight tracking with callsign-to-mission classification
- GPS jamming signal detection (anomalous position clustering)
- Subsea cable proximity threat analysis (AIS-based)
- Restricted airspace zones (ZIT/ZRT/ZIA)
- Military ship tracking (Marine Nationale + allied fleets)

### 🏥 Health
- **SPF / ISS** sanitary stress indicators by department
- SOS Médecins and OSCOUR emergency call indicators
- APL (medical access score — déserts médicaux) by department
- Hospital density overlay (FINESS)
- Health Barometer with département-level drill-down
- **Hantavirus layer** — active cluster map (MV Hondius, confirmed French cases) + historical SPF risk zones (2005–2023) as department polygons, auto-classified from DGS-Urgent and SPF live feeds

### 🧠 Situation Intelligence (ISNR)
- **ISNR** — France National Stability Index (composite score, 0–100)
- AI-generated situational briefs (FR/EN switchable)
- **SituationMonitor** — automatic alert detection with severity scoring
- **SituationHistoryPanel** — IndexedDB-backed timeline of past snapshots
- **BarometerWidget** — multi-domain real-time health indicators
- France Country Intel — structured country-level intelligence digest

### 📊 Finance & Markets
- CAC 40 + major European indices
- Key commodity prices (Brent, gas, wheat, metals)
- Euro/USD and strategic currency pairs
- Dedicated commodity strip and market strip UI widgets

### 🗳️ Governance Panels
- **ÉlusPanel** — elected officials by commune with political affiliation
- **MinistresPanel** — current government composition with portfolio tracking

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│                                                                  │
│  App.ts (orchestrator ~2500 lines)                               │
│  ├── MapContainer → DeckGLMap (WebGL) / Map (D3/SVG)            │
│  ├── 50 components (energy, news, health, cyber, intel…)        │
│  ├── RSS Pipeline (stage 1: keywords · stage 2: AI async)       │
│  ├── 12 polling loops (military, AIS, finance, cyber, health…)  │
│  ├── ISNR engine (stability index, situation detection)          │
│  └── Watchdog — centralised observability registry               │
│                                                                  │
│  State: in-memory + localStorage + IndexedDB (history)           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ fetch /api/*
┌──────────────────────────▼──────────────────────────────────────┐
│  Vercel Serverless Functions  (api/)                             │
│                                                                  │
│  Proxy + cache layer (Upstash Redis, TTL per route)              │
│  ├── energy/        RTE Ecowatt, Eco2mix, nuclear REMIT         │
│  ├── transport/     SNCF disruptions, air traffic, AIS relay    │
│  ├── health/        SPF / ISS, SOS Médecins, OSCOUR             │
│  ├── finance/       Boursorama scrape, commodities              │
│  ├── fires/         NASA FIRMS MODIS + VIIRS                    │
│  ├── outages/       citizen scraping, ORE, Cloudflare, IODA     │
│  ├── threats.js     Cyber OSINT aggregation (Shodan/Censys)     │
│  ├── exposure.js    Technical exposure scoring                  │
│  ├── intelligence/  LLM summarisation (Groq, server-side)       │
│  ├── ingest/        Cron news ingestion (Neon Postgres, 5 min)  │
│  ├── news/          News query + history timeline API            │
│  └── rss / rss-proxy  CORS-bypass + Scrapling bypass            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key design decisions

| Decision | Rationale |
|----------|-----------|
| **Vanilla TypeScript, no framework** | Zero virtual DOM overhead; direct DOM for 60fps map interactions |
| **Vercel Functions as API proxy** | CORS bypass, Redis caching, secret isolation without dedicated backend |
| **Ollama-first AI** | No PII leaves the machine; cloud LLM only as fallback |
| **Watchdog registry** | Centralised observability — all services self-report; StatusPanel auto-updates |
| **Non-blocking init** | Critical layers (energy, weather, floods) load first; optional layers in background |
| **DeckGLMap lazy-loaded** | Mobile users never download the 1 MB WebGL stack |
| **Dynamic `import()` for default-hidden modules** | Heavy panels/services/configs for off-by-default layers (oil, outages, military bases, hydraulic backbone…) load on demand, keeping `index.js` ~21% smaller |
| **Unified loader (`fmLoaderHTML`)** | One spinner everywhere; panels show a loader while data is in flight and swap to content/empty once settled (even on error) — no blank panels, no per-panel loader styles |
| **Service Worker (Workbox)** | API routes NetworkFirst (4s timeout); map tiles CacheFirst 30d; PWA installable |
| **`hasEverSucceeded` flag** | Distinguishes "first load in progress" from "persistent failure" in IIP/REMIT |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20+
- **npm** 10+
- A [Vercel](https://vercel.com) account (free tier works)
- An [Upstash](https://upstash.com) Redis database (free tier)
- An [RTE Open Data](https://data.rte-france.com) application (free, for energy + nuclear data)

Optional for full feature coverage:

- [Météo-France API](https://portail-api.meteofrance.fr) — weather alerts
- [AISstream.io](https://aisstream.io) — live maritime traffic
- [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api) — wildfire hotspots
- [TomTom](https://developer.tomtom.com) — road traffic
- [OpenSky](https://opensky-network.org) — civil air traffic
- [Groq](https://console.groq.com) — cloud LLM fallback
- [Ollama](https://ollama.com) running locally — preferred local LLM
- [Shodan](https://shodan.io) + [Censys](https://censys.io) — cyber exposure OSINT

### Installation

```bash
git clone https://github.com/FraidFraid/France-Monitor.git
cd France-Monitor
npm install
cp .env.example .env.local
# Edit .env.local and fill in your keys
```

### Development

```bash
# Vite dev server only (port 3001)
npm run dev

# Vite + Scrapling proxy (Cloudflare-protected RSS, port 8080)
npm run dev:full

# Install Python deps for Scrapling (first time only)
npm run scrapling:install
```

The app will be available at **http://localhost:3001**.

> Without any API keys the app still starts — energy, weather, and news panels show errors or fallback states, but the map, UI, and classification engine are fully functional.

### Build & Type Check

```bash
npm run typecheck   # strict, 0 errors required
npm run build       # outputs to dist/ with Brotli pre-compression
npm run preview     # preview production build locally
```

### Deployment

```bash
vercel
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN
# … repeat for each required variable (see .env.example)
```

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env.local` for local dev. On Vercel, configure in **Settings → Environment Variables**.

### Required

| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `RTE_CLIENT_ID` | RTE Open Data OAuth client ID (Ecowatt, nuclear) |
| `RTE_CLIENT_SECRET` | RTE Open Data OAuth client secret |
| `VITE_METEOFRANCE_API_KEY` | Météo-France vigilance API key |

### Optional (graceful fallback if absent)

| Variable | Description | Fallback |
|----------|-------------|----------|
| `VITE_AISSTREAM_KEY` | AISstream.io maritime AIS | Layer disabled |
| `VITE_TOMTOM_API_KEY` | TomTom road traffic tiles | Layer disabled |
| `OPENSKY_CLIENT_ID / SECRET` | OpenSky Network | Anonymous quota |
| `SNCF_API_KEY` | SNCF real-time disruptions | Layer disabled |
| `NASA_FIRMS_API_KEY` | NASA FIRMS wildfires | Layer disabled |
| `GROQ_API_KEY` | Groq cloud LLM (summarisation + cron classification) | Browser Transformers.js |
| `DATABASE_URL` | Neon Postgres (news ingestion + history) | News history disabled |
| `CRON_SECRET` | Vercel Cron auth token | Cron endpoint returns 401 |
| `SHODAN_API_KEY` | Shodan OSINT (cyber exposure) | Cyber panel degraded |
| `CENSYS_API_ID / SECRET` | Censys OSINT | Cyber panel degraded |
| `CLOUDFLARE_RADAR_TOKEN` | Cloudflare Radar anomalies | Layer disabled |
| `CDSE_CLIENT_ID / SECRET` | Copernicus Sentinel-2 imagery | Satellite overlay disabled |
| `SCRAPLING_PROXY_URL` | Python Scrapling sidecar URL | Direct fetch (may hit CF) |

> ⚠️ **Security:** Never prefix server-only secrets with `VITE_` — they would be embedded in the client bundle.

---

## 📡 Data Sources

| Domain | Source | Type |
|--------|--------|------|
| Electricity grid | [RTE Open Data](https://data.rte-france.com) | REST OAuth |
| Nuclear REMIT | [IIP RTE](https://iip.cloud-rte-france.com) | RSS (public) |
| Gas network | [GRTgaz / GIE](https://www.gie.eu) | REST |
| Weather alerts | [Météo-France](https://portail-api.meteofrance.fr) | REST |
| Flood levels | [Vigicrues / Hub'Eau](https://hubeau.eaufrance.fr) | REST |
| Maritime traffic | [AISstream.io](https://aisstream.io) | WebSocket |
| Civil air traffic | [OpenSky Network](https://opensky-network.org) | REST |
| Military flights | ADS-B + internal callsign database | Internal |
| Wildfires | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) | REST |
| Rail disruptions | [SNCF Open Data](https://numerique.sncf.com/startup/api) | REST |
| Road traffic | [TomTom](https://developer.tomtom.com) | REST + tiles |
| Health metrics | [Santé Publique France](https://www.santepubliquefrance.fr) | REST |
| Citizen outages | [infocoupure.fr](https://infocoupure.fr) | HTML scrape |
| Fuel prices | [data.economie.gouv.fr](https://data.economie.gouv.fr) | REST |
| Internet outages | [IODA](https://ioda.inetintel.cc.gatech.edu) + [Cloudflare Radar](https://radar.cloudflare.com) | REST |
| Cyber exposure | [Shodan](https://shodan.io) + [Censys](https://censys.io) | REST |
| Ransomware breaches | [RansomwareLive](https://data.ransomware.live/posts.json) | REST (public) |
| Finance | Boursorama (server-side proxy) | HTML scrape |
| News | 60+ RSS feeds (national + PQR) | RSS (CORS-proxied) |
| Satellite imagery | [Copernicus CDSE](https://dataspace.copernicus.eu) | OData |
| Space weather | [NOAA SWPC](https://www.swpc.noaa.gov) | REST |
| Élus / communes | [data.gouv.fr](https://data.gouv.fr) | REST |

All external API calls are **server-side only** (Vercel Functions + Upstash cache). No API key is ever exposed to the browser.

---

## 🔌 Public API

A subset of the `/api/*` endpoints is exposed as a read-only public API so third parties (public agencies, researchers, journalists) can consume the aggregated open-source signals — news feed, energy mix, wildfires, cyber incidents, operational health — without reading the code. Endpoints are `GET`, unauthenticated, and CORS-open for reads.

The contract is published as a machine-readable **OpenAPI 3.1** document at [`/openapi.json`](https://www.francemonitor.com/openapi.json). See [`docs/api.md`](docs/api.md) for the base URL, curl examples, cache policy and the "signal ≠ confirmed fact" caveat.

---

## 📁 Project Structure

```
france-monitor/
├── api/                         # Vercel Serverless Functions
│   ├── rss.js / rss-proxy.js    # RSS CORS bypass + JSON conversion
│   ├── threats.js               # Cyber OSINT aggregation (Shodan/Censys/breaches)
│   ├── exposure.js              # Technical exposure scoring
│   ├── json-proxy.js            # Generic JSON proxy (Ransomware Live, etc.)
│   ├── energy/                  # Ecowatt, Eco2mix, nuclear REMIT
│   ├── health/                  # ISS, SOS Médecins, OSCOUR
│   ├── finance/                 # Market data, commodities
│   ├── transport/               # SNCF, air traffic, AIS relay
│   ├── outages/                 # Citizen outages, ORE, IODA
│   ├── ingest/                  # Cron news ingestion (Neon Postgres + Groq LLM)
│   ├── news.js / news/history   # News query API + history timeline
│   ├── _lib/                    # Shared: classifier, geocoder, RSS parser, Groq classifier
│   └── intelligence/v1/         # LLM summarisation (Groq)
│
├── services/
│   └── scrapling-proxy/         # FastAPI + Scrapling — Cloudflare bypass for PQR RSS
│
├── src/
│   ├── main.ts                  # Entry point — SW registration + stale chunk guard
│   ├── App.ts                   # Main orchestrator (~2500 lines)
│   │
│   ├── components/              # 50 UI panels and map wrappers
│   │   ├── DeckGLMap.ts         # WebGL map (MapLibre + Deck.gl) — lazy-loaded
│   │   ├── Map.ts               # D3/SVG mobile fallback
│   │   ├── CyberPanel.ts        # Cyber threat monitoring panel
│   │   ├── NewsHeatmap.ts       # History heatmap grid (day × category)
│   │   ├── CyberBreachPanel.ts  # Ransomware / breach map panel
│   │   ├── NuclearPanel.ts      # Nuclear fleet status (4 tabs)
│   │   ├── OutagesPanel.ts      # Power + telecom outages
│   │   ├── FranceIntelPanel.ts  # AI situational brief — lazy-loaded
│   │   ├── ISNRPanel.ts         # Stability index dashboard
│   │   ├── BarometerWidget.ts   # Multi-domain health barometer
│   │   └── …
│   │
│   ├── services/                # 70 data fetching and processing modules
│   │   ├── rss.ts               # RSS feed aggregation
│   │   ├── classifier.ts        # Keyword-based news classification
│   │   ├── ai-classifier.ts     # Browser LLM classification override
│   │   ├── situation-engine.ts  # Alert detection + severity scoring
│   │   ├── stability-index.ts   # ISNR composite index
│   │   ├── cyber.ts             # Cyber threat feed aggregation
│   │   ├── cyber-threat-scoring.ts  # Composite cyber pressure scoring (NEW)
│   │   ├── exposure.ts          # Technical exposure (Shodan/Censys)
│   │   ├── threat-map.ts        # Geo-located threat cartography
│   │   ├── network-barometer.ts # Internet health signals
│   │   ├── rte-iip.ts           # RTE IIP RSS (REMIT nuclear notices)
│   │   ├── nuclear-correlation.ts   # REMIT × RTE correlation
│   │   ├── outages-scraper.ts   # infocoupure.fr citizen outage scraper
│   │   ├── watchdog.ts          # Centralised observability registry
│   │   └── …
│   │
│   ├── plugins/                 # Vite dev proxy plugins (mirror api/ for local dev)
│   ├── config/                  # Static datasets (feeds, military callsigns, geo)
│   ├── utils/                   # URL state, caches, spatial helpers
│   ├── types/index.ts           # All shared TypeScript types
│   └── styles/main.css          # Global styles — dark mode via CSS custom properties
│
├── vite.config.ts               # Dev proxies, PWA, Brotli, chunk splitting
├── tsconfig.json                # Strict TS config
└── .env.example                 # Environment variable reference
```

---

## 🧩 Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript 5.9 — strict, no `any` |
| Bundler | Vite 7 |
| Map (desktop) | MapLibre GL 5 + Deck.gl 9 |
| Map (mobile) | D3 7 / SVG |
| Clustering | Supercluster |
| Geo processing | Turf.js |
| AI — local | Ollama (Mistral, Llama 3) |
| AI — cloud fallback | Groq API |
| AI — browser fallback | Transformers.js + ONNX Runtime Web |
| Client persistence | IndexedDB (idb), localStorage |
| Server cache | Upstash Redis |
| Deployment | Vercel (Serverless Functions + Edge) |
| PWA | Vite Plugin PWA (Workbox 7) |
| Compression | Brotli quality 11 (pre-compressed at build) |

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [Architecture](docs/architecture.md) | Runtime layers, data flow, map architecture, reuse model |
| [Deployment](docs/deployment.md) | Local development, Vercel deployment, self-hosting direction |
| [Data Sources](docs/data-sources.md) | Source families, provenance principles, reproducibility checklist |
| [Public API](docs/api.md) | Read-only `/api/*` endpoints for third parties, with the OpenAPI 3.1 spec at `/openapi.json` |
| [Privacy and Safety](docs/privacy.md) | Privacy principles, AI processing boundaries, safety scope |
| [Roadmap](docs/roadmap.md) | NLnet-aligned milestones for open-source release and European reuse |
| [NLnet Context](docs/nlnet.md) | Public context for application `2026-06-104` |

---

## 🛠️ Development Notes

### Scrapling and Cloudflare-protected RSS

Some French regional newspapers serve RSS behind Cloudflare. A lightweight Python sidecar (`services/scrapling-proxy/`) using [Scrapling](https://github.com/D4Vinci/Scrapling) handles these in dev on port 8080.

```bash
npm run scrapling:install   # create venv + install deps (first time only)
npm run dev:full            # Vite (3001) + Scrapling (8080) together
```

### News Ingestion Pipeline

Articles are ingested server-side via a **Vercel Cron** (every 5 min) into **Neon Postgres**:

1. **Fetch & parse** — 60+ RSS feeds, concurrent (6 workers), exponential backoff on failure
2. **Keyword classification** — instant category + severity assignment (< 1ms/item)
3. **Groq LLM refinement** (optional) — if `GROQ_API_KEY` is set, ambiguous articles (confidence < 0.60) are sent to Groq for reclassification (max 5/tick, `llama-3.3-70b-versatile`)
4. **Geocoding** — best-effort lat/lon assignment (max 30/tick)
5. **Retention** — articles older than 90 days are purged automatically

The **History UI** exposes this data via `/api/news` (paginated articles) and `/api/news/history` (time-bucketed aggregations for the heatmap).

### Client-side RSS Pipeline

In parallel, the browser runs its own RSS pipeline for real-time display:

1. **Stage 1 — immediate:** Keyword classifier assigns category + severity. Map and news panel update instantly.
2. **Stage 2 — background:** Low-confidence items go to the LLM chain (Ollama → Groq → browser). Geocoding and AI summarisation run in parallel. UI republishes enriched items progressively.

Items are shallow-cloned before background enrichment to prevent WebGL marker flicker during geocoding.

### Nuclear REMIT / IIP RTE

The IIP feed (`iip.cloud-rte-france.com`) is fetched via the `/api/rss` proxy with:
- **25s timeout** (server is slow on first call)
- **1 automatic retry** on timeout/network error (2s delay)
- **`hasEverSucceeded` flag** in `RTEIIPState`: the UI shows a spinner badge "EN COURS" during the first load, and only "INDISPONIBLE" after a confirmed persistent failure.

### Watchdog Observability

Every data service registers with `Watchdog` and emits `loading` / `success` / `failure` events. `StatusPanel` subscribes and auto-updates. Sources automatically transition to `stale` state when their cache exceeds the configured `staleAfterMs` threshold — no manual polling needed.

### Coding Conventions

- **Strict TypeScript** — `noUnusedLocals`, `noUnusedParameters`, no `any`
- **Vanilla DOM** — no JSX, no virtual DOM, no framework
- **Classes** for UI components; **pure functions** for services
- `PascalCase` → components · `kebab-case` → services · `camelCase` → variables · `UPPER_SNAKE_CASE` → constants
- `@/*` path alias resolves to `./src/*`
- Commit prefixes: `feat:` `fix:` `refactor:` `docs:` `test:`

---

## 🤝 Contributing

Contributions are welcome.

### Before opening a PR

```bash
npm run typecheck   # 0 errors required
npm run build       # clean build required
npm run lint        # no new ESLint warnings
```

### Good first contributions

| Area | What to do |
|------|------------|
| **New data source** | `src/services/xxx.ts` + `src/plugins/xxx-proxy.ts` + `api/xxx.js` |
| **New panel** | Extend `Panel.ts`, register in `App.ts`, wire service |
| **New layer** | Add to `MapLayers` type → `DEFAULT_LAYERS` → `LAYER_CONFIGS` |
| **New RSS feed** | Add URL to `src/config/feeds.ts` — classifier handles the rest |
| **Bug report** | Include browser console, network tab, and reproduction steps |

### Hard constraints

- Do not introduce React, Vue, Svelte, or any virtual DOM framework
- Do not send user data or news content to cloud LLMs without going through the server-side proxy
- Do not add npm dependencies without a discussion — bundle size is actively managed

---

## 📋 Roadmap

See [docs/roadmap.md](docs/roadmap.md) for the public milestone plan.

Current high-level milestones:

- M1 — Open-source release and documentation
- M2 — Stable data model and API contracts
- M3 — Reproducible ingestion pipelines
- M4 — European reusability and deployment guide

---

## 📋 Recent Updates

### 2026-06-27
- **Unified loader system** — single source of truth `src/components/shared/loader.ts` (`fmLoaderHTML({ text?, variant? })`) + CSS `.fm-loader` (spinner ring, `--text-accent`, `spin` 0.8s). 11 heterogeneous loaders (emoji+pulse, skeletons, custom spin, empty cards) migrated to it. 6 data panels now show the loader **while data is in flight** and swap to content (or empty state) once settled, **even on fetch error**: Fires, Traffic, Environment (weather+floods), Outages, Health barometer, Maritime (AIS). New panels must use `fmLoaderHTML` — never hand-roll a spinner.
- **Critical-bundle slimming** — `index.js` reduced **1064 → 842 KB (−21%, gzip −17%)** by moving non-critical, default-hidden modules out of the main chunk via dynamic `import()`: services `health`/`oil`/`transport`, panels `OilPanel`/`OutagesPanel`, and large static configs `military-bases-db` (~1100 lines) + `hydraulic-backbone` (~1200 lines). Layers concerned are off by default, so the deferred load is invisible. Clean chunk-splitting is now exhausted (remaining heavy modules are shared with `DeckGLMap`/`MapContainer` or need risky async refactors).

### 2026-06-11
- **News History UI** — toggle Live/Historique in the news feed panel; interactive heatmap (day × category, 7j/30j/90j); cursor-based article pagination; filters by severity, region, and full-text search across 90 days of ingested articles
- **Groq server-side classification** — optional LLM reclassification of ambiguous articles during cron ingestion (confidence < 0.60, max 5/tick); gated by `GROQ_API_KEY`; zero impact without the key
- **API improvements** — `/api/news` migrated from `collected_at` to `published_at`; new `before`/`until` params for cursor pagination; `/api/news/history` supports `week` bucket for 90-day views

### 2026-05-13
- **Hantavirus layer** — couche dédiée avec heatmap remplacée par polygones de départements bleus (zones historiques SPF 2005–2023), cercles colorés pour les clusters actifs (crise/alerte/surveillance), pulse halo sur les cas confirmés
- **Classifieur DGS automatique** — scan DGS-Urgent + SPF à chaque requête, sévérité dérivée par mots-clés, règle `maxSeverity` (ne descend jamais sous le seed)
- **Panneau Santé restructuré** — bloc "Alertes du moment" avec groupes pliants par sévérité (rouge ouvert, orange/jaune fermés), triés par date
- **Tooltips zones historiques** — hover sur chaque département hantavirus : nom, période, souche Puumala, source SPF
- **Légende améliorée** — colonnes clusters / fond historique avec note explicative inline

### 2026-05-05
- **Fix APIs bloquées** — IIP RTE timeout 15s → 25s avec retry automatique ; Pannes Citoyennes timeout 15s → 60s
- **REMIT nucléaire** — nouvel état `loading` (spinner ⚛ animé) vs `unavailable` basé sur `hasEverSucceeded`
- **CyberBreachPanel** — nouveau composant cartographie des incidents ransomware et fuites cyber
- **Cyber threat scoring** — moteur de scoring composite des pressions cyber par domaine/source
- **Watchdog** — observabilité centralisée de tous les services avec staleness automatique
- **BarometerWidget** — indicateurs de santé multi-domaine en temps réel

### 2026-05-04
- Migration endpoint RansomwareLive vers `data.ransomware.live/posts.json` (ancien endpoint 301)
- CyberPanel avec filtres avancés, recherche, et synchronisation carte
- Intégration OSINT Shodan + Censys pour l'exposition technique des infrastructures françaises

### 2026-04-29
- OilPanel avec historique quotidien des prix officiels des carburants (fuel-price-series)
- Tooltip interactif sur le graphique des prix carburant

---

## 📄 License

France Monitor is released under the **GNU Affero General Public License v3.0** (AGPL-3.0).

- You can freely use, study, and modify the code
- If you run a modified version as a network service, you must release your modifications under AGPL-3.0
- Attribution to the original project is required

Third-party data sources are subject to their own terms of service. Review each provider's documentation before commercial use.

---

<div align="center">

Built with public data, for public interest · France, 2026

*Star the repo to follow updates — France Monitor evolves fast.*

</div>
