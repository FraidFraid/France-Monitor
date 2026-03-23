# ARCHITECTURE — France Monitor
## (Calquée sur WorldMonitor réel)

---

## Vue d'ensemble — Comparaison avec WorldMonitor

WorldMonitor est une **SPA Vanilla TypeScript** (pas de React) avec :
- Un **gros fichier `App.ts`** (~4600 lignes) qui orchestre tout
- Des **composants TypeScript** (classes) qui gèrent leur DOM
- Des **services** qui fetch les données et les mettent en cache
- Des **Vercel serverless functions** pour le backend
- Un système **Protobuf (sebuf)** pour les contrats API typés
- **Redis (Upstash)** pour le cache côté serveur
- **IndexedDB** pour le cache côté client
- **Deck.gl + MapLibre** pour la carte desktop, **D3/SVG** pour mobile

France Monitor suit **exactement ce pattern**, adapté au scope France.

---

## Architecture Système

```
┌────────────────────────────────────────────────────────────────────┐
│                     SOURCES DE DONNÉES                              │
│                                                                      │
│  📰 RSS PQR        ⚡ RTE Ecowatt    🌤️ Météo-France               │
│  (via rss-proxy)   (OAuth2)          (API Key)                      │
│                                                                      │
│  🌊 Vigicrues      🚂 SNCF           📍 API Adresse Gouv           │
│  (public)          (API Key)          (public)                       │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────┐
│              VERCEL SERVERLESS FUNCTIONS (api/)                      │
│                                                                      │
│  api/rss-proxy.js     → Proxy CORS pour flux RSS                    │
│  api/energy/ecowatt   → OAuth2 RTE + fetch + cache Redis            │
│  api/weather/alerts   → Fetch Météo-France + cache Redis            │
│  api/floods/vigilance → Fetch Vigicrues + cache Redis               │
│  api/transport/...    → Fetch SNCF + cache Redis                    │
│  api/geocode          → Proxy API Adresse                           │
│                                                                      │
│  api/francemonitor/   → Handlers Protobuf (sebuf)                   │
│    news/v1/summarize  → Ollama → Groq → T5 fallback chain          │
│    intelligence/v1/   → Classification + résumé IA                  │
│                                                                      │
│  api/_shared/redis.ts → Client Upstash Redis                        │
│                                                                      │
│  ┌──────────────────────────────────────────┐                       │
│  │         UPSTASH REDIS (cache)            │                       │
│  │  - Résumés IA (TTL 24h)                  │                       │
│  │  - Données API (TTL 15-30min)            │                       │
│  │  - Dédup cross-users                     │                       │
│  └──────────────────────────────────────────┘                       │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
              En dev : plugins Vite émulent les routes
              En prod : Vercel Edge Network
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────┐
│                   FRONTEND (Vanilla TypeScript)                      │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                      App.ts                              │       │
│  │           (Orchestrateur principal ~1500 lignes)         │       │
│  │                                                           │       │
│  │  ┌─────────┐  ┌──────────────────────────────────┐      │       │
│  │  │ Sidebar │  │         MapContainer              │      │       │
│  │  │         │  │                                    │      │       │
│  │  │ News    │  │  Desktop: DeckGLMap.ts             │      │       │
│  │  │ Panel   │  │  ┌────────────┐ ┌──────────────┐ │      │       │
│  │  │         │  │  │ MapLibre   │ │ Deck.gl      │ │      │       │
│  │  │ Energy  │  │  │ (fond de   │ │ Layers :     │ │      │       │
│  │  │ Panel   │  │  │  carte)    │ │  News        │ │      │       │
│  │  │         │  │  │            │ │  Alert       │ │      │       │
│  │  │ Weather │  │  │            │ │  Energy      │ │      │       │
│  │  │ Panel   │  │  │            │ │  Weather     │ │      │       │
│  │  │         │  │  │            │ │  Flood       │ │      │       │
│  │  │ Floods  │  │  │            │ │  Infra       │ │      │       │
│  │  │ Panel   │  │  │            │ │  Traffic     │ │      │       │
│  │  │         │  │  └────────────┘ └──────────────┘ │      │       │
│  │  │ Status  │  │                                    │      │       │
│  │  │ Panel   │  │  Mobile: Map.ts (D3/SVG fallback) │      │       │
│  │  └─────────┘  └──────────────────────────────────┘      │       │
│  │                                                           │       │
│  │  ┌──────────────────────────────────────────────┐        │       │
│  │  │ Services Layer                                │        │       │
│  │  │  rss.ts, energy.ts, weather.ts, floods.ts,   │        │       │
│  │  │  transport.ts, geocoding.ts, clustering.ts,   │        │       │
│  │  │  threat-classifier.ts, summarization.ts,      │        │       │
│  │  │  persistent-cache.ts, data-freshness.ts       │        │       │
│  │  └──────────────────────────────────────────────┘        │       │
│  │                                                           │       │
│  │  ┌──────────────────────────────────────────────┐        │       │
│  │  │ Cache Layer                                   │        │       │
│  │  │  In-Memory Map (TTL 10min)                   │        │       │
│  │  │  IndexedDB (persistance)                     │        │       │
│  │  │  localStorage (prefs, state)                 │        │       │
│  │  └──────────────────────────────────────────────┘        │       │
│  └─────────────────────────────────────────────────────────┘       │
└────────────────────────────────────────────────────────────────────┘
```

---

## Pattern RSS — Identique à WorldMonitor

```
Flux RSS PQR (Ouest-France, Le Monde, etc.)
         │
    ┌────▼────┐
    │ Client  │  src/services/rss.ts
    │ fetch   │  fetchWithProxy('/api/rss-proxy?url=...')
    └────┬────┘
         │
    ┌────▼────┐
    │ Parse   │  fast-xml-parser
    │ XML     │  → titre, description, URL, date
    └────┬────┘
         │
    ┌────▼────┐
    │ Dédup   │  Par URL (Set en mémoire)
    └────┬────┘
         │
    ┌────▼────────────┐
    │ Classification  │  1. classifyByKeyword() → instantané
    │ Hybride         │  2. classifyWithAI() → async LLM override
    └────┬────────────┘
         │
    ┌────▼────────────┐
    │ Géolocalisation │  Extraction ville du titre
    │                 │  → API Adresse gouv → [lng, lat]
    │                 │  → Cache IndexedDB
    └────┬────────────┘
         │
    ┌────▼────────┐
    │ NewsItem    │  { source, title, link, pubDate, isAlert,
    │             │    threat: { level, category, confidence, source },
    │             │    lat, lon, locationName }
    └────┬────────┘
         │
    ┌────▼────────────┐
    │ Cache           │  In-Memory Map (10min TTL)
    │                 │  + IndexedDB (persistance)
    └────┬────────────┘
         │
         ▼
    NewsPanel (sidebar) + Deck.gl NewsLayer (carte)
```

---

## Types Principaux (src/types/index.ts)

```typescript
// Pattern identique à WorldMonitor

export type ThreatLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type EventCategory =
  | 'social' | 'security' | 'energy' | 'weather'
  | 'transport' | 'infrastructure' | 'health' | 'general';

export interface ThreatClassification {
  level: ThreatLevel;
  category: EventCategory;
  confidence: number;
  source: 'keyword' | 'ml' | 'llm';
}

export interface Feed {
  name: string;
  url: string;
  type?: string;
  region?: string;
  tier?: number;
}

export interface NewsItem {
  source: string;
  title: string;
  link: string;
  pubDate: Date;
  isAlert: boolean;
  tier?: number;
  threat?: ThreatClassification;
  lat?: number;
  lon?: number;
  locationName?: string;
}

export type TimeRange = '1h' | '6h' | '24h' | '48h' | '7d';

export interface MapLayers {
  news: boolean;
  alerts: boolean;
  energy: boolean;
  weather: boolean;
  floods: boolean;
  infrastructure: boolean;
  traffic: boolean;
}

export type EcowattSignal = 'green' | 'orange' | 'red';
export type MeteoVigilanceLevel = 'green' | 'yellow' | 'orange' | 'red' | 'violet';
export type FloodVigilanceLevel = 'green' | 'yellow' | 'orange' | 'red';
```

---

## Circuit Breaker (identique WorldMonitor)

```typescript
const feedFailures = new Map<string, { count: number; cooldownUntil: number }>();
const FEED_COOLDOWN_MS = 5 * 60 * 1000;  // 5 min
const MAX_FAILURES = 2;
```

---

## Fallback Chain IA (identique WorldMonitor)

```
1. Ollama local (mistral) → timeout 5s → gratuit, privé
         │ échec
2. Groq cloud (si clé)    → timeout 5s → rapide, gratuit
         │ échec
3. Browser T5 (WASM)      → @xenova/transformers → toujours dispo
```

---

## Presets Régionaux

```typescript
const VIEW_PRESETS = {
  france:            { center: [2.2, 46.6], zoom: 6 },
  idf:               { center: [2.35, 48.86], zoom: 10 },
  paca:              { center: [5.4, 43.6], zoom: 9 },
  bretagne:          { center: [-3.0, 48.2], zoom: 8 },
  grandest:          { center: [6.2, 48.6], zoom: 8 },
  occitanie:         { center: [2.0, 43.6], zoom: 8 },
  aura:              { center: [4.8, 45.7], zoom: 8 },
  nouvelleaquitaine: { center: [0.5, 44.8], zoom: 8 },
  hautsdefrance:     { center: [2.8, 49.9], zoom: 8 },
  normandie:         { center: [-0.4, 49.1], zoom: 8 },
};
```

---

## Refresh Intervals (App.ts)

```typescript
const REFRESH_INTERVALS = {
  rss: 5 * 60 * 1000,          // 5 min
  ecowatt: 30 * 60 * 1000,     // 30 min
  weather: 15 * 60 * 1000,     // 15 min
  floods: 30 * 60 * 1000,      // 30 min
  transport: 15 * 60 * 1000,   // 15 min
};
// Pause quand document.hidden, resume quand onglet visible
```
