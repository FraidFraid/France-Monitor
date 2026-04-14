<div align="center">

# 🇫🇷 France Monitor

**Real-time situational awareness dashboard for France**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Deploy on Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://vercel.com)
[![Version](https://img.shields.io/badge/version-1.0-brightgreen)](https://github.com)
[![Status](https://img.shields.io/badge/status-active%20development-orange)](https://github.com)

*v1.0 is the first public release — the feature set will expand rapidly.*

[Features](#-features) · [Architecture](#-architecture) · [Getting Started](#-getting-started) · [Data Sources](#-data-sources) · [Contributing](#-contributing)

</div>

---

## What is France Monitor?

France Monitor is an open-source OSINT situational awareness platform focused exclusively on France. It aggregates real-time signals from dozens of public APIs — energy grid, weather alerts, river floods, military flights, maritime AIS, news, transport disruptions, wildfires, cyber threats, financial markets, and more — into a single 3D interactive map dashboard.

The goal is not to replace professional tools, but to give analysts, journalists, researchers, and curious citizens a unified, openly auditable view of what is happening across France's critical infrastructure and public information space.

> **v1.0 note:** This first public release covers the core monitoring surface. Many data sources, panels, and AI features are already in place but will be significantly extended, stabilised, and documented in the coming months.

---

## ✨ Features

### 🗺️ 3D Interactive Map
- WebGL rendering via **MapLibre GL + Deck.gl** (desktop)
- D3/SVG fallback for mobile and low-memory devices
- Day/night terminator with real-time solar position
- Satellite basemap toggle (Copernicus Sentinel-2 NDWI overlays)
- Supercluster-based news marker clustering
- Military flight trails, ship tracks, and AIS live positions

### ⚡ Energy & Infrastructure
| Panel | Data | Cadence |
|-------|------|---------|
| Electricity grid (Ecowatt) | RTE stress levels by department | 5 min |
| Nuclear fleet | RTE real-time unavailabilities + REMIT notices | 15 min |
| Gas network | GRTgaz / Teréga flows + vital-organ facilities | 10 min |
| Oil & fuel | Refinery stocks, pipeline flows, departmental fuel tension | 10 min |
| Wind energy | RTE real-time éolien production by park | 5 min |
| Hydraulic backbone | Dam levels, barrage signals, hydrometry (Hub'Eau) | 10 min |

### 🌦️ Environment
- **Météo-France** vigilance alerts (levels 1–4, all hazard types)
- **Vigicrues** flood segments with matched OSM waterway geometry
- Active wildfire hotspots (NASA FIRMS MODIS + VIIRS)
- Space weather (NOAA Kp index, geomagnetic storm alerts)

### 🚂 Transport
- **SNCF** real-time disruptions with affected rail segments highlighted on map
- **Air traffic** (OpenSky ADS-B) — civil + military flight separation
- **Maritime AIS** live ship positions (AISstream.io or self-hosted relay)
- **Road traffic** incidents on-demand (TomTom)

### 📰 News Intelligence
- RSS aggregation from 40+ French national and regional (PQR) sources
- Two-stage classification pipeline: keyword-based (instant) then LLM override (async)
- AI summarisation: Ollama (local) → Groq (cloud fallback) → Transformers.js (browser fallback)
- Geocoding of news items to map locations
- Stale-article protection and deduplication across polling cycles

### 🛡️ Defence & Sovereignty
- Military flight tracking with callsign-to-mission classification
- GPS jamming signal detection (anomalous position clustering)
- Subsea cable proximity threat analysis (AIS-based)
- Cyber incident feed
- Restricted airspace zones

### 🏥 Health
- **SPF / ISS** sanitary stress indicators by department
- SOS Médecins and OSCOUR emergency call indicators
- Hospital density overlay (FINESS)
- APL (medical access score) by department

### 📊 Finance & Markets
- CAC 40 + major European indices
- Key commodity prices (Brent, natural gas, wheat, metals)
- Euro/USD and strategic currency pairs

### 🧠 France Intel Panel
- AI-generated situational brief (language-switchable FR/EN)
- Detected situation alerts with severity scoring
- Sparkline timeline of stability index (ISNR) by department
- Exportable history snapshots (IndexedDB)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│                                                              │
│  App.ts (orchestrator)                                       │
│  ├── MapContainer → DeckGLMap (WebGL) / Map (D3/SVG)        │
│  ├── 23 floating panels (energy, news, health, intel…)      │
│  ├── RSS Pipeline (stage 1: keywords · stage 2: AI async)   │
│  ├── 9 polling loops (military, AIS, finance, health…)      │
│  └── ISNR engine (stability index, situation detection)     │
│                                                              │
│  State: in-memory + localStorage + IndexedDB (history)      │
└────────────────────┬────────────────────────────────────────┘
                     │ fetch /api/*
┌────────────────────▼────────────────────────────────────────┐
│  Vercel Serverless Functions  (api/)                         │
│                                                              │
│  Proxy + cache layer (Upstash Redis, TTL per route)          │
│  ├── energy/     RTE Ecowatt, Eco2mix, nuclear REMIT        │
│  ├── transport/  SNCF disruptions, air traffic, AIS relay   │
│  ├── health/     SPF / ISS, SOS Médecins, OSCOUR            │
│  ├── finance/    Boursorama scrape, commodities             │
│  ├── fires/      NASA FIRMS MODIS + VIIRS                   │
│  ├── outages/    ORE Enedis, Cloudflare Radar, IODA         │
│  ├── intelligence/v1/  LLM summarisation (Groq)             │
│  └── rss-proxy   CORS-bypass + Scrapling bypass             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Key design decisions

| Decision | Rationale |
|----------|-----------|
| **Vanilla TypeScript, no framework** | Zero virtual DOM overhead; direct DOM control for 60fps map interactions |
| **Vercel Functions as API proxy** | CORS bypass, Redis caching, and secret isolation without a dedicated backend |
| **Ollama-first AI** | No PII leaves the machine; cloud LLM only as fallback |
| **Non-blocking init** | Critical layers (energy, weather, floods) load first; secondary and optional layers load in background |
| **Shallow-clone RSS items before background enrichment** | Prevents WebGL animation loop from reading mid-geocoding state (flicker elimination) |
| **DeckGLMap lazy-loaded** | Mobile users never download the 1 MB WebGL stack |
| **Service Worker (Workbox)** | API routes use NetworkFirst (4s timeout); map tiles CacheFirst 30d; PWA installable |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20+
- **npm** 10+
- A [Vercel](https://vercel.com) account (free tier works for deployment)
- An [Upstash](https://upstash.com) Redis database (free tier, ~10k req/day)
- An [RTE Open Data](https://data.rte-france.com) application (free, for energy data)

Optional for full feature coverage:

- [Météo-France API](https://portail-api.meteofrance.fr) key — weather alerts
- [AISstream.io](https://aisstream.io) key — live maritime traffic
- [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api) key — wildfire hotspots
- [TomTom](https://developer.tomtom.com) key — road traffic
- [OpenSky](https://opensky-network.org) credentials — civil air traffic
- [Groq](https://console.groq.com) key — cloud LLM fallback for AI summaries
- [Ollama](https://ollama.com) running locally — preferred local LLM

### Installation

```bash
# Clone the repo
git clone https://github.com/your-org/france-monitor.git
cd france-monitor

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local
# → Edit .env.local and fill in your keys (see Environment Variables below)
```

### Development

```bash
# Vite dev server only (port 3001)
npm run dev

# Vite + Scrapling proxy (for Cloudflare-protected RSS feeds, port 8080)
npm run dev:full

# Install Python dependencies for Scrapling (first time only)
npm run scrapling:install
```

The app will be available at **http://localhost:3001**.

> Without any API keys, the app still starts — energy, weather, and news panels will show errors or fallback states, but the map, UI, and classification engine are fully functional.

### Build & Type Check

```bash
# Type check (strict, no any)
npm run typecheck

# Production build (outputs to dist/)
npm run build

# Preview production build locally
npm run preview
```

The build applies Brotli pre-compression (quality 11) on all JS/CSS assets. Vercel edge serves `.br` files automatically, reducing transfer size by 60–70% compared to gzip.

### Deployment

```bash
# Deploy to Vercel (first time: follow the CLI prompts)
vercel

# Set environment variables
vercel env add UPSTASH_REDIS_REST_URL
vercel env add UPSTASH_REDIS_REST_TOKEN
# … repeat for each required variable (see .env.example for the full list)
```

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env.local` for local development. On Vercel, configure them in **Settings → Environment Variables**.

### Required

| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint — server-side API cache |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |
| `RTE_CLIENT_ID` | RTE Open Data OAuth client ID (Ecowatt, nuclear) |
| `RTE_CLIENT_SECRET` | RTE Open Data OAuth client secret |
| `VITE_METEOFRANCE_API_KEY` | Météo-France vigilance bulletin API key |

### Optional (graceful fallback if absent)

| Variable | Description | Fallback |
|----------|-------------|----------|
| `VITE_AISSTREAM_KEY` | AISstream.io maritime AIS key | Layer silently disabled |
| `VITE_TOMTOM_API_KEY` | TomTom road traffic tile key | Layer disabled |
| `OPENSKY_CLIENT_ID / SECRET` | OpenSky Network credentials | Anonymous quota (400 req/day) |
| `SNCF_API_KEY` | SNCF real-time disruptions API | Layer disabled |
| `NASA_FIRMS_API_KEY` | NASA FIRMS wildfire hotspots | Layer disabled |
| `GROQ_API_KEY` | Groq cloud LLM (AI summaries, server-side only) | Browser model via Transformers.js |
| `CLOUDFLARE_RADAR_TOKEN` | Cloudflare Radar internet anomalies | Layer disabled |
| `CDSE_CLIENT_ID / SECRET` | Copernicus Data Space (Sentinel-2 imagery) | Satellite overlay disabled |

> ⚠️ **Security:** Never prefix server-only secrets with `VITE_` — they would be embedded in the client bundle. The Groq key in particular is server-only and accessed exclusively via `/api/intelligence/v1/*`.

---

## 📡 Data Sources

| Domain | Source | Type |
|--------|--------|------|
| Electricity grid | [RTE Open Data](https://data.rte-france.com) | REST OAuth |
| Gas network | [GRTgaz / GIE](https://www.gie.eu) | REST |
| Weather alerts | [Météo-France](https://portail-api.meteofrance.fr) | REST |
| Flood levels | [Vigicrues / Hub'Eau](https://hubeau.eaufrance.fr) | REST |
| Maritime traffic | [AISstream.io](https://aisstream.io) | WebSocket |
| Civil air traffic | [OpenSky Network](https://opensky-network.org) | REST |
| Military flights | ADS-B + internal callsign database | Internal |
| Wildfires | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) | REST |
| Rail disruptions | [SNCF Open Data](https://numerique.sncf.com/startup/api) | REST |
| Road traffic | [TomTom](https://developer.tomtom.com) | REST + tiles |
| Health metrics | [Santé Publique France / ISS](https://www.santepubliquefrance.fr) | REST |
| Internet outages | [IODA](https://ioda.inetintel.cc.gatech.edu) + [Cloudflare Radar](https://radar.cloudflare.com) | REST |
| Finance | Boursorama (server-side proxy) | HTML scrape |
| Commodities | Public aggregated feed | REST |
| News | 40+ RSS feeds (national + PQR) | RSS (CORS-proxied) |
| Satellite imagery | [Copernicus CDSE](https://dataspace.copernicus.eu) | OData |
| Space weather | [NOAA SWPC](https://www.swpc.noaa.gov) | REST |

All external API calls are **server-side only** (Vercel Functions + Upstash cache). No API key is ever exposed to the browser.

---

## 📁 Project Structure

```
france-monitor/
├── api/                        # Vercel Serverless Functions (/api/* routes in prod)
│   ├── rss-proxy.js            # RSS CORS bypass
│   ├── energy/                 # Ecowatt, Eco2mix, nuclear REMIT
│   ├── health/                 # ISS, SOS Médecins, OSCOUR
│   ├── finance/                # Market data, commodities
│   ├── transport/              # SNCF, air traffic, AIS relay
│   ├── outages/                # ORE Enedis, Cloudflare Radar, IODA
│   └── intelligence/v1/        # LLM summarisation (Groq, server-side)
│
├── services/
│   └── scrapling-proxy/        # FastAPI + Scrapling — Cloudflare bypass for PQR RSS
│
├── src/
│   ├── main.ts                 # Entry point — stale-chunk guard + SW registration
│   ├── App.ts                  # Main orchestrator
│   │
│   ├── components/             # UI panels and map wrappers (40+ files)
│   │   ├── DeckGLMap.ts        # WebGL map (MapLibre + Deck.gl) — lazy-loaded
│   │   ├── Map.ts              # D3/SVG mobile fallback
│   │   ├── MapContainer.ts     # Selects implementation at runtime
│   │   ├── FranceIntelPanel.ts # AI brief — lazy-loaded
│   │   └── …
│   │
│   ├── services/               # Data fetching and processing (60+ files)
│   │   ├── rss.ts              # RSS feed aggregation
│   │   ├── classifier.ts       # Keyword-based news classification
│   │   ├── ai-classifier.ts    # LLM classification override
│   │   ├── situation-engine.ts # Alert detection and severity scoring
│   │   ├── stability-index.ts  # ISNR — France national stability index
│   │   ├── geocoder.ts         # News geocoding (cached, throttled)
│   │   └── …
│   │
│   ├── config/                 # Static datasets (feeds, military callsigns, geo presets)
│   ├── utils/                  # URL state, caches, spatial helpers
│   ├── types/index.ts          # All shared TypeScript types
│   └── styles/main.css         # Global styles — dark mode via CSS custom properties
│
├── vite.config.ts              # Dev proxies, PWA config, Brotli plugin, chunk splitting
├── tsconfig.json               # Strict TS config
└── .env.example                # Environment variable reference
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
| Deployment | Vercel (Serverless Functions + Edge Network) |
| PWA | Vite Plugin PWA (Workbox 7) |
| Compression | Brotli quality 11 (pre-compressed at build time) |

---

## 🛠️ Development Notes

### Scrapling and Cloudflare-protected RSS

Some French regional newspapers serve RSS behind Cloudflare. A lightweight Python sidecar (`services/scrapling-proxy/`) using [Scrapling](https://github.com/D4Vinci/Scrapling) handles these during development, running on port 8080 alongside Vite.

In production (Vercel), `api/rss-proxy.js` handles all RSS. The Scrapling service is not deployed to Vercel — only a strict domain whitelist of PQR sources is proxied.

```bash
npm run scrapling:install   # create venv + install Python deps (first time only)
npm run dev:full            # Vite (3001) + Scrapling (8080) together
```

### Two-stage RSS Pipeline

News items go through two stages per polling cycle:

1. **Stage 1 — immediate:** Keyword classifier assigns category and severity in < 1ms per item. The map and news panel update instantly with the full fresh batch.
2. **Stage 2 — background:** Items with low-confidence classification are sent to the LLM chain (Ollama → Groq → browser model). Geocoding and AI summarisation run in parallel. The UI republishes enriched items progressively while guarding against stale poll results.

Items are shallow-cloned before background enrichment. This prevents the WebGL animation loop from reading partially-geocoded coordinates — which would cause cluster markers to visibly jump during the geocoding pass.

### Shareable Layer State

The active layer set is persisted to `localStorage` and mirrored to the URL (`?layers=…`). Dashboard configurations are shareable: paste the URL and the recipient sees the same layers active.

### Coding Conventions

- **Strict TypeScript** — `noUnusedLocals`, `noUnusedParameters`, no `any`, no unjustified `!`
- **Vanilla DOM** — no JSX, no virtual DOM, no framework
- **Classes** for UI components; **pure functions** for services
- **`PascalCase`** → components · **`kebab-case`** → services · **`camelCase`** → variables/functions · **`UPPER_SNAKE_CASE`** → module-level constants
- **`@/*`** path alias resolves to `./src/*`
- Commit prefixes: `feat:` `fix:` `refactor:` `docs:` `test:`

---

## 🤝 Contributing

Contributions are welcome. France Monitor v1.0 is actively developed — expect rapid iteration.

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
| **New panel** | Extend `src/components/Panel.ts`, register in `App.ts`, wire service |
| **New layer** | Add to `MapLayers` type → `DEFAULT_LAYERS` → `LAYER_CONFIGS` → `_handlePanelVisibility` |
| **New RSS feed** | Add URL to `src/config/feeds.ts` — classifier handles categorisation |
| **Bug report** | Include browser console output, network tab, and reproduction steps |

### Hard constraints

- Do not introduce React, Vue, Svelte, or any virtual DOM framework
- Do not send user data or news content to cloud LLMs without going through the server-side proxy
- Do not add npm dependencies without an issue discussion — bundle size is actively managed

---

## 📋 Roadmap

Planned for upcoming releases. Contributions on any of these are especially welcome:

- [ ] End-to-end tests (Playwright) for critical user flows
- [ ] Unit tests for `situation-engine.ts` and `classifier.ts`
- [ ] Sentry error tracking integration
- [ ] Extended PQR coverage (more regional news sources)
- [ ] Élus overlay — elected officials by commune with political affiliation
- [ ] Historical replay — scrub through past situational snapshots
- [ ] Push notifications via Service Worker for critical alerts
- [ ] Mobile map feature parity (D3/SVG fallback improvements)
- [ ] TypeScript `noUncheckedIndexedAccess` upgrade
- [ ] Panel lazy-loading (OilPanel, CyberPanel, DefensePanel)
- [ ] Self-hostable backend alternative to Vercel Functions

---

## 📄 License

France Monitor is released under the **GNU Affero General Public License v3.0** (AGPL-3.0).

This means:
- You can freely use, study, and modify the code
- If you run a modified version as a network service, you must release your modifications under the same license
- Attribution to the original project is required

Third-party data sources are subject to their own terms of service. Review each provider's documentation before using this software in a commercial context.

---

<div align="center">

Built with public data, for public interest · France, 2026

*Star the repo to follow updates — France Monitor evolves fast.*

</div>
