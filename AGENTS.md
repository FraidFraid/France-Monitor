# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

---

## Identité du Projet
**France Monitor** — Clone français et ultra-localisé de [WorldMonitor](https://github.com/koala73/worldmonitor). Tableau de bord de conscience situationnelle en temps réel pour la France : carte 3D interactive + flux d'actualités PQR + état des infrastructures critiques (énergie, météo, transports, crues). LLM local (Ollama) pour extraction d'entités et classification des événements.

**Repo source** : L'architecture suit fidèlement les patterns de WorldMonitor — Vanilla TypeScript (pas de React), Vite comme build system + dev server, Vercel Serverless Functions pour le backend, Deck.gl + MapLibre pour la carte, Protobuf pour les contrats API.

**État actuel** : Phase 2 avancée. Services opérationnels : RSS, classification keyword, géocodage, météo (Vigilance), crues (Vigicrues), énergie (Ecowatt), trafic routier, finance, transports SNCF, pannes (outages), vols militaires. La carte fonctionne avec Deck.gl (desktop) et D3/SVG (mobile fallback). Python scrapling-proxy pour contourner Cloudflare. Les proto/ et server/ sont scaffoldés mais pas encore connectés.

---

## Stack Technique (calquée sur WorldMonitor)

### Frontend — Vanilla TypeScript + Vite
- **PAS de React/Vue/Angular** — DOM manipulation directe, comme WorldMonitor
- **Build** : Vite 6+
- **Carte** : MapLibre GL JS (moteur) + Deck.gl v9 (calques haute performance)
- **Carte mobile** : D3.js + SVG (dégradation gracieuse, comme WorldMonitor `Map.ts` vs `DeckGLMap.ts`)
- **Clustering** : Supercluster
- **CSS** : Fichier CSS unique, mode sombre par défaut (thème via CSS variables)
- **i18n** : i18next (FR par défaut, EN en fallback)
- **State** : Objet JavaScript in-memory + localStorage pour la persistance
- **PWA** : vite-plugin-pwa (offline map support)

### Backend — Vercel Serverless Functions
- **Pas d'Express** — Routes `/api/*` sont des Vercel serverless functions
- **En dev** : Plugins Vite qui proxifient les API externes (RSS, données gouv)
- **Cache** : Upstash Redis (cloud) pour la dédup cross-users + IndexedDB côté client
- **RPC** : Protobuf (sebuf) pour les contrats typés entre client et serveur

### IA / NLP
- **LLM local** : Ollama (mistral:instruct ou llama3) — fallback chain comme WorldMonitor
- **Fallback chain** : Ollama → Groq (cloud) → Browser T5 (Transformers.js)
- **Classification** : Hybrid — keyword classifier instantané + override async LLM
- **ML Browser** : @xenova/transformers + onnxruntime-web pour le fallback client-side

### Desktop (optionnel, Phase avancée)
- **Tauri v2** pour app native macOS/Windows/Linux

### Vite Plugins (Dev Proxies)
Les plugins dans `src/plugins/` émulent les API serverless en dev :
- Chaque plugin intercepte les routes `/api/*` via `configureServer()`
- Pattern : lire le body, appeler l'API externe avec auth, retourner le résultat
- En prod : les routes `/api/*` sont gérées par Vercel Functions dans `api/`

### Scrapling Proxy (Cloudflare Bypass)
Microservice Python (FastAPI + Scrapling) pour les flux RSS protégés par Cloudflare :
- **Whitelist** : Seuls `lesechos.fr`, `lavoixdunord.fr`, `paris-normandie.fr` autorisés
- **Cache** : 5 min en mémoire
- **Déploiement** : Docker → Cloud Run ou Lambda container

---

## Architecture du Projet (pattern WorldMonitor)

```
france-monitor/
├── api/                         # Vercel Serverless Functions (prod)
│   ├── rss-proxy.js             # Proxy RSS (évite CORS)
│   ├── energy/ecowatt.js        # Proxy Ecowatt RTE
│   ├── finance/market.js        # Proxy données bourse
│   └── intelligence/v1/         # Summarize endpoint
│
├── services/                    # Microservices externes
│   └── scrapling-proxy/         # Python FastAPI - bypass Cloudflare
│       ├── app.py               # Endpoint /rss?url=... + whitelist
│       ├── Dockerfile           # Pour Cloud Run / Lambda
│       └── start.sh             # npm run scrapling:dev
│
├── src/                         # Frontend (Vanilla TS)
│   ├── main.ts                  # Point d'entrée
│   ├── App.ts                   # Orchestrateur principal (~2000+ lignes)
│   │
│   ├── components/              # Classes UI (DOM manipulation directe)
│   │   ├── Panel.ts             # Base class abstraite
│   │   ├── Map.ts               # D3/SVG (mobile fallback)
│   │   ├── DeckGLMap.ts         # Deck.gl + MapLibre (desktop)
│   │   ├── MapContainer.ts      # Choisit Map vs DeckGLMap
│   │   ├── MapPopup.ts          # Tooltip événements
│   │   ├── NewsPanel.ts         # Flux RSS PQR
│   │   ├── EnergyPanel.ts       # Ecowatt / nucléaire
│   │   ├── WeatherPanel.ts      # Vigilance météo
│   │   ├── FloodsPanel.ts       # Vigicrues
│   │   ├── TransportPanel.ts    # SNCF
│   │   ├── TrafficPanel.ts      # Trafic routier Bison Futé
│   │   ├── FinancePanel.ts      # CAC40, devises
│   │   ├── ISNRPanel.ts         # Indice Stabilité (ISNR)
│   │   ├── FilterPanel.ts       # Filtres temps/catégorie/gravité
│   │   ├── StatusPanel.ts       # État connexion sources
│   │   ├── SearchModal.ts       # Recherche globale
│   │   └── ToastNotification.ts # Notifications temporaires
│   │
│   ├── services/                # Logique métier
│   │   ├── rss.ts               # Fetch + parse RSS, circuit breaker
│   │   ├── classifier.ts        # Classification keyword (PQR filter)
│   │   ├── ai-classifier.ts     # Classification LLM async
│   │   ├── summarization.ts     # Résumé IA (Ollama→Groq→T5)
│   │   ├── ai-worker.ts         # Web Worker pour IA browser
│   │   ├── summarization-worker.ts
│   │   ├── geocoder.ts          # API Adresse gouv + cache
│   │   ├── ecowatt.ts           # Signal Ecowatt RTE
│   │   ├── energy.ts            # État réseau électrique
│   │   ├── vigilance-meteo.ts   # Alertes Météo-France
│   │   ├── vigicrues.ts         # Niveau crues
│   │   ├── transport.ts         # SNCF temps réel
│   │   ├── traffic.ts           # Bison Futé
│   │   ├── finance.ts           # Boursorama/Yahoo Finance
│   │   ├── fires.ts             # Feux de forêt NASA FIRMS
│   │   ├── outages.ts           # Pannes Enedis/Free
│   │   ├── military-flights.ts  # ADSB-Exchange militaire
│   │   ├── metropoles.ts        # Stats métropoles
│   │   └── stability-index.ts   # Calcul ISNR composite
│   │
│   ├── plugins/                 # Vite plugins (proxy dev)
│   │   ├── rss-proxy.ts         # /api/rss → fetchRSS
│   │   ├── sncf-proxy.ts        # /api/sncf
│   │   ├── ecowatt-proxy.ts     # /api/ecowatt
│   │   ├── finance-proxy.ts     # /api/finance
│   │   └── arcep-proxy.ts       # /api/arcep
│   │
│   ├── config/
│   │   ├── feeds.ts             # Définition flux RSS (100+ sources)
│   │   ├── geo.ts               # Centroïdes départements/régions
│   │   ├── infrastructure.ts    # Centrales, barrages, sous-stations
│   │   ├── military.ts          # Bases militaires, callsigns
│   │   ├── webcams.ts           # Webcams trafic
│   │   └── mock-data.ts         # Données de test
│   │
│   ├── utils/
│   │   ├── newsCache.ts         # LRU cache pour actualités
│   │   ├── urlState.ts          # Sync état ↔ URL params
│   │   └── spatial-correlation.ts # Clustering spatial événements
│   │
│   ├── types/index.ts           # Toutes les interfaces
│   └── styles/main.css          # CSS unique, dark mode
│
├── proto/                       # Contrats Protobuf (scaffolded)
├── server/                      # Handlers sebuf (scaffolded)
├── vite.config.ts               # Plugins proxy, PWA, aliases
└── package.json
```

---

## Workflow

### Principes
- **Plan First** : Mode plan pour tâches 3+ étapes ou décisions d'architecture
- **Subagents** : Déléguer recherche/exploration aux agents Explore, implémentation aux agents general-purpose
- **Vérifier** : `npm run build && npm run typecheck` avant de considérer une tâche terminée
- **WorldMonitor** : Référencer le repo source pour les patterns complexes (circuit breaker, fallback chain, etc.)

### Patterns courants
| Tâche | Approche |
|-------|----------|
| Nouvelle feature | Plan → Explore (architecture existante) → Implement → Build |
| Bug fix | Explore (cause root) → Fix → Typecheck |
| Nouveau service | Créer `src/services/X.ts` + `src/plugins/X-proxy.ts` + `api/X.js` |
| Nouveau panel | Étendre `Panel.ts`, ajouter dans `App.ts`, connecter au service |

---

## Core Principles
- **Simplicity First** : Chaque changement aussi simple que possible
- **No Laziness** : Trouver les causes racines, pas de fixes temporaires
- **Minimal Impact** : Ne toucher que le nécessaire
- **Privacy First** : Traitement IA local (Ollama). Aucune donnée perso envoyée en cloud
- **Performance** : 60fps avec des milliers de points (Deck.gl)
- **Vanilla TS** : Pas de framework React/Vue — DOM natif, comme WorldMonitor

---

## Contextes de Développement

### Frontend / App.ts & Components
Vanilla TypeScript, DOM manipulation directe. `App.ts` est l'orchestrateur (~2000+ lignes). Les composants étendent `Panel.ts` et gèrent leur propre DOM. State in-memory + localStorage/IndexedDB. CSS variables pour le theming dark mode.

### Carte / DeckGLMap & Map
- `DeckGLMap.ts` : Deck.gl + MapLibre (desktop, WebGL)
- `Map.ts` : D3/SVG (mobile fallback)
- `MapContainer.ts` : Auto-détection du renderer
- Layers : ScatterplotLayer, IconLayer, GeoJsonLayer, PathLayer, HeatmapLayer
- Clustering : Supercluster
- **Coordonnées : toujours `[lng, lat]`** (pas `[lat, lng]`)

### Classification / classifier.ts
Classification hybride keyword + LLM :
- **Keyword** (`classifier.ts`) : Instantané, détecte entités (institutions, lieux), filtre bruit PQR
- **LLM** (`ai-classifier.ts`) : Async override via Ollama/Groq/T5
- Catégories : `social`, `security`, `energy`, `weather`, `transport`, `finance`, `health`
- Niveaux : `critical`, `high`, `medium`, `low`, `info`
- **Mitigation PQR** : Exige institution pour valider `security/low` (cf. MEMORY.md)

### Services Data
Pattern commun : fetch API → parse → cache → expose via fonction async.
- Circuit breaker : cooldown après 2 échecs consécutifs
- Cache : Map in-memory + IndexedDB
- Déduplication : par URL ou ID unique

---

## Conventions de Code

### TypeScript
- `strict: true`, pas de `any`
- Vanilla TS : pas de JSX, pas de framework
- Types centralisés dans `src/types/index.ts`
- Classes pour les composants, fonctions pour les services

### Nommage (identique WorldMonitor)
- Fichiers : `PascalCase` pour les composants (`DeckGLMap.ts`, `NewsPanel.ts`)
- Fichiers : `kebab-case` pour les services (`threat-classifier.ts`, `persistent-cache.ts`)
- Types/Interfaces : `PascalCase`
- Fonctions/Variables : `camelCase`
- Constants : `UPPER_SNAKE_CASE`

### Git
- Commits conventionnels : `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- Branches : `feat/nom-feature`, `fix/nom-bug`

### Path Alias
- `@/*` → `./src/*` (configuré dans tsconfig.json et vite.config.ts)

---

## Commandes
```bash
# Dev (lance Vite + scrapling-proxy en parallèle)
npm run dev              # concurrently: vite (port 3001) + scrapling-proxy (port 8080)
npm run dev:vite         # Vite seul, sans scrapling

# Scrapling Proxy (bypass Cloudflare pour RSS protégés)
npm run scrapling:install  # Setup Python venv + deps
npm run scrapling:dev      # Lance le proxy Python sur :8080
npm run scrapling:docker   # Build & run Docker container

# Build & Check
npm run build            # tsc && vite build
npm run typecheck        # tsc --noEmit
npm run preview          # Prévisualiser le build de production

# Code Quality
npm run lint             # ESLint sur src/
npm run format           # Prettier sur src/**/*.ts

# Déploiement
vercel                   # Deploy sur Vercel (auto depuis git push)
```

---

## Variables d'Environnement
Voir `.env.example`. Obligatoires pour la prod :
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — cache serverless
- `RTE_CLIENT_ID` / `RTE_CLIENT_SECRET` — API Ecowatt
- `METEO_FRANCE_API_KEY` — alertes météo

Optionnelles :
- `SNCF_API_KEY` — données transport
- `GROQ_API_KEY` — fallback IA cloud

---

## Debugging Courant
- **Carte blanche / pas de tuiles** : Vérifier l'URL tile server dans la config MapLibre (Carto Dark Matter)
- **Points pas affichés** : Coordonnées en `[lng, lat]` (pas `[lat, lng]`)
- **Ollama timeout** : Vérifier `ollama pull mistral`, augmenter timeout dans summarization.ts
- **RSS CORS** : Tout passe par `/api/rss-proxy` — jamais de fetch direct côté client
- **RSS Cloudflare 403** : Les flux protégés passent par scrapling-proxy (`npm run scrapling:dev`)
- **Ecowatt 403** : Token OAuth2 RTE expiré — vérifier le flow d'auth dans `api/energy/`
- **Vercel function timeout** : Max 10s en hobby, 60s en pro — optimiser ou cacher
- **Bruit PQR excessif** : Vérifier que `classifier.ts` filtre bien les faits divers sans institution
