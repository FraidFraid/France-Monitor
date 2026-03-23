# CLAUDE.md — France Monitor

## Identité du Projet
**France Monitor** — Clone français et ultra-localisé de [WorldMonitor](https://github.com/koala73/worldmonitor). Tableau de bord de conscience situationnelle en temps réel pour la France : carte 3D interactive + flux d'actualités PQR + état des infrastructures critiques (énergie, météo, transports, crues). LLM local (Ollama) pour extraction d'entités et classification des événements.

**Repo source** : L'architecture suit fidèlement les patterns de WorldMonitor — Vanilla TypeScript (pas de React), Vite comme build system + dev server, Vercel Serverless Functions pour le backend, Deck.gl + MapLibre pour la carte, Protobuf pour les contrats API.

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

---

## Architecture du Projet (pattern WorldMonitor)

```
france-monitor/
├── api/                         # Vercel Serverless Functions
│   ├── rss-proxy.js             # Proxy RSS (évite CORS)
│   ├── energy/                  # Routes Ecowatt / Eco2mix
│   ├── weather/                 # Routes Météo-France
│   ├── floods/                  # Routes Vigicrues
│   ├── transport/               # Routes SNCF
│   ├── geocode.js               # Proxy API Adresse gouv
│   └── _shared/                 # Redis client, helpers communs
│
├── server/                      # Handlers sebuf (Protobuf RPC)
│   ├── router.ts
│   ├── cors.ts
│   ├── error-mapper.ts
│   └── francemonitor/
│       ├── news/v1/             # Handler actualités
│       ├── energy/v1/           # Handler énergie
│       ├── weather/v1/          # Handler météo
│       ├── transport/v1/        # Handler transports
│       ├── floods/v1/           # Handler crues
│       └── intelligence/v1/     # Handler IA (classification, brief)
│
├── proto/                       # Contrats Protobuf
│   └── francemonitor/
│       ├── core/v1/             # Types de base (geo, severity, time)
│       ├── news/v1/             # Service actualités
│       ├── energy/v1/           # Service énergie
│       ├── weather/v1/          # Service météo
│       ├── transport/v1/        # Service transports
│       ├── floods/v1/           # Service crues
│       └── intelligence/v1/     # Service IA
│
├── src/                         # Frontend (Vanilla TS)
│   ├── main.ts                  # Point d'entrée
│   ├── App.ts                   # Orchestrateur principal (gros fichier, pattern WorldMonitor)
│   ├── components/
│   │   ├── Map.ts               # Carte D3/SVG (mobile fallback)
│   │   ├── DeckGLMap.ts         # Carte Deck.gl/MapLibre (desktop)
│   │   ├── MapContainer.ts      # Wrapper qui choisit Map vs DeckGLMap
│   │   ├── MapPopup.ts          # Tooltip sur la carte
│   │   ├── NewsPanel.ts         # Flux d'actualités
│   │   ├── EnergyPanel.ts       # État du réseau électrique
│   │   ├── WeatherPanel.ts      # Alertes météo
│   │   ├── TransportPanel.ts    # État SNCF / trafic
│   │   ├── FloodsPanel.ts       # Vigilance crues
│   │   ├── FilterPanel.ts       # Filtres (temps, catégorie, gravité)
│   │   ├── Panel.ts             # Base class des panneaux
│   │   ├── StatusPanel.ts       # État de connexion des sources
│   │   └── SearchModal.ts       # Recherche globale
│   ├── config/
│   │   ├── index.ts             # Re-exports
│   │   ├── feeds.ts             # Définition des flux RSS français
│   │   ├── geo.ts               # Données géo statiques (départements, régions, centroïdes)
│   │   ├── infrastructure.ts    # Centrales nucléaires, barrages, sous-stations RTE
│   │   └── entities.ts          # Entités connues (villes, lieux-dits)
│   ├── services/
│   │   ├── rss.ts               # Fetch + parse RSS avec circuit breaker
│   │   ├── threat-classifier.ts # Classification keyword + LLM
│   │   ├── summarization.ts     # Résumé IA avec fallback chain
│   │   ├── clustering.ts        # Supercluster pour les points carte
│   │   ├── geocoding.ts         # API Adresse gouv + cache
│   │   ├── energy.ts            # Service Ecowatt / Eco2mix
│   │   ├── weather.ts           # Service Météo-France
│   │   ├── floods.ts            # Service Vigicrues
│   │   ├── transport.ts         # Service SNCF
│   │   ├── persistent-cache.ts  # IndexedDB pour cache client
│   │   ├── data-freshness.ts    # Tracking de la fraîcheur des données
│   │   ├── i18n.ts              # Internationalisation
│   │   └── analytics.ts         # Métriques usage
│   ├── types/
│   │   └── index.ts             # Toutes les interfaces TypeScript
│   ├── utils/
│   │   ├── index.ts             # Helpers (debounce, storage, export)
│   │   ├── sanitize.ts          # XSS prevention
│   │   ├── proxy.ts             # Proxy helpers pour Vite dev
│   │   └── circuit-breaker.ts   # Pattern circuit breaker
│   ├── styles/
│   │   └── main.css             # CSS unique, dark mode, CSS variables
│   ├── generated/               # Auto-generated depuis proto/
│   │   ├── client/              # Clients RPC TypeScript
│   │   └── server/              # Serveurs RPC TypeScript
│   └── locales/
│       ├── fr.json              # Français (défaut)
│       └── en.json              # Anglais (fallback)
│
├── index.html
├── vite.config.ts               # Config Vite + plugins (RSS proxy, sebuf, etc.)
├── vercel.json                  # Config déploiement Vercel
├── tsconfig.json
├── package.json
├── CLAUDE.md
└── README.md
```

---

## Workflow Orchestration

### 1. Plan Mode Default
- Entrer en mode plan pour TOUTE tâche non-triviale (3+ étapes ou décisions d'architecture)
- Si quelque chose déraille, STOP et re-planifier — ne pas forcer
- Écrire des specs détaillées avant de coder
- Utiliser le mode plan aussi pour les étapes de vérification

### 2. Subagent Strategy — Délégation par Agents
- Utiliser les subagents **systématiquement** pour garder le contexte principal propre
- Offloader la recherche, l'exploration et l'analyse parallèle aux subagents
- Pour les problèmes complexes (intégration API, debug cartographie), lancer plus de compute via subagents
- **Une tâche = un agent** pour une exécution focalisée

#### Agents disponibles et quand les utiliser :

| Agent | Quand le spawner | Exemples de tâches |
|---|---|---|
| **Explore** (read-only) | Recherche de fichiers, patterns, comprendre le code existant | "Trouve tous les services qui appellent l'API RTE", "Comment WorldMonitor gère le circuit breaker ?", "Quels fichiers sont impactés par ce changement ?" |
| **Plan** (read-only) | Concevoir une stratégie d'implémentation avant de coder | "Planifie l'intégration de l'API Vigicrues", "Quelle architecture pour le fallback IA ?", "Design le système de cache" |
| **general-purpose** (full access) | Implémenter du code, refactorer, corriger des bugs | "Implémente le service RSS", "Ajoute le calque Deck.gl météo", "Fixe le bug de géocodage" |
| **Bash** (terminal) | Opérations git, npm install, lancer des builds/tests | "npm run build", "git status", "ollama pull mistral" |

#### Patterns de délégation recommandés :

**Pattern 1 — Recherche parallèle** (plusieurs agents Explore en parallèle)
```
Quand tu dois comprendre un problème complexe :
→ Agent Explore 1 : "Cherche comment WorldMonitor gère X"
→ Agent Explore 2 : "Trouve les fichiers impactés par Y"
→ Agent Explore 3 : "Vérifie la documentation de l'API Z"
Puis synthétiser les résultats avant de coder.
```

**Pattern 2 — Plan → Implement** (séquentiel)
```
Quand tu dois ajouter une feature :
→ Agent Plan : "Conçois l'architecture pour le service Ecowatt"
→ Revue du plan par l'utilisateur
→ Agent general-purpose : "Implémente le plan approuvé"
→ Agent Bash : "npm run build && npm run test"
```

**Pattern 3 — Multi-file implementation** (parallèle)
```
Quand les changements sont indépendants :
→ Agent 1 (general-purpose) : "Crée le proto energy/v1/service.proto"
→ Agent 2 (general-purpose) : "Crée api/energy/ecowatt.js"
→ Agent 3 (general-purpose) : "Crée src/services/energy.ts"
Puis un dernier agent pour connecter le tout.
```

**Pattern 4 — Debug & Fix** (ciblé)
```
Quand un bug est signalé :
→ Agent Explore : "Trouve la cause root de l'erreur X"
→ Agent general-purpose : "Implémente le fix identifié"
→ Agent Bash : "npm run test pour vérifier"
```

#### Règles de délégation :
- **Toujours donner un contexte complet** à l'agent : quel fichier, quel pattern suivre, quel résultat attendu
- **Référencer le CLAUDE.md** dans le prompt de l'agent : "Suis les conventions décrites dans CLAUDE.md"
- **Référencer WorldMonitor** quand pertinent : "Inspire-toi de comment WorldMonitor fait dans src/services/rss.ts"
- **Un agent ne doit pas avoir besoin de relire tout le contexte** : lui donner les infos clés directement
- **Lancer les agents en parallèle quand possible** pour maximiser la performance
- **Ne pas utiliser d'agent pour les tâches triviales** (1-2 lignes de code, lecture d'un fichier précis)

### 3. Self-Improvement Loop
- Après TOUTE correction : mettre à jour `tasks/lessons.md` avec le pattern
- Écrire des règles qui empêchent la même erreur
- Revoir les leçons au début de chaque session

### 4. Verification Before Done
- Ne jamais marquer une tâche comme terminée sans prouver qu'elle fonctionne
- Lancer les tests, vérifier les logs, démontrer la correction
- Se demander : "Un ingénieur senior approuverait-il ça ?"

### 5. Demand Elegance (Balanced)
- Pour les changements non-triviaux : pause et demander "solution plus élégante ?"
- Skip pour les fixes simples — ne pas over-engineer

### 6. Autonomous Bug Fixing
- Bug signalé → le fixer directement, pas de hand-holding
- Pointer les logs, erreurs, tests en échec → puis les résoudre

---

## Task Management
1. **Plan First** : Écrire le plan dans `tasks/todo.md` avec des items cochables
2. **Verify Plan** : Check-in avant de commencer
3. **Track Progress** : Marquer les items complétés au fur et à mesure
4. **Explain Changes** : Résumé haut niveau à chaque étape
5. **Document Results** : Section review dans `tasks/todo.md`
6. **Capture Lessons** : Mettre à jour `tasks/lessons.md` après corrections

---

## Core Principles
- **Simplicity First** : Chaque changement aussi simple que possible
- **No Laziness** : Trouver les causes racines, pas de fixes temporaires
- **Minimal Impact** : Ne toucher que le nécessaire
- **Privacy First** : Traitement IA local (Ollama). Aucune donnée perso envoyée en cloud
- **Performance** : 60fps avec des milliers de points (Deck.gl)
- **Vanilla TS** : Pas de framework React/Vue — DOM natif, comme WorldMonitor

---

## Skills (Contextes de travail)

### Skill 1 : Frontend / App.ts & Components
> Tu travailles sur un projet Vanilla TypeScript (pas de React). Toute l'UI est construite par manipulation DOM directe. L'App.ts est le fichier orchestrateur principal (plusieurs milliers de lignes, pattern WorldMonitor). Les composants sont des classes TypeScript exportées qui créent et gèrent leurs éléments DOM. Utilise les CSS variables pour le theming. Le state est géré in-memory avec persistance localStorage/IndexedDB.

### Skill 2 : Carte / DeckGLMap & Map
> Tu es expert en cartographie WebGL. Deux composants : `DeckGLMap.ts` (Deck.gl + MapLibre, desktop) et `Map.ts` (D3/SVG, mobile fallback). Deck.gl layers : ScatterplotLayer, IconLayer, GeoJsonLayer, PathLayer, HeatmapLayer, ArcLayer, TextLayer. Supercluster pour le clustering. Coordonnées en [lng, lat]. Le MapContainer choisit automatiquement le renderer selon l'appareil.

### Skill 3 : Backend / Serverless & Protobuf
> Les routes API sont des Vercel Serverless Functions (dossier `api/`). En dev, des plugins Vite émulent les routes. Les services typés utilisent Protobuf (sebuf) pour les contrats client↔serveur. Redis (Upstash) pour le cache. Chaque handler lit les données d'une API externe, les formate selon le proto, et les retourne.

### Skill 4 : IA / Classification & Résumé
> Fallback chain : Ollama → Groq → Browser T5 (Transformers.js). Classification hybride : keyword instantané + override async LLM. Le threat-classifier catégorise les événements (`social`, `security`, `energy`, `weather`, `transport`, etc.) avec un niveau de menace (`critical`, `high`, `medium`, `low`, `info`). Validation stricte des sorties JSON.

### Skill 5 : Data Services / RSS & API Gouv
> Services d'ingestion pour les flux RSS PQR et les API gouvernementales françaises. Circuit breaker pattern par source (cooldown après 2 échecs). Cache en mémoire (Map) + IndexedDB pour la persistance. User-Agent réaliste. Déduplication par URL. Feed scope par langue.

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

---

## Commandes
```bash
# Dev
npm run dev              # Vite dev server (frontend + API plugins)

# Build
npm run build            # tsc && vite build
npm run typecheck        # tsc --noEmit

# Tests
npm run test:data        # Tests des services data
npm run test:e2e         # Tests E2E Playwright

# Protobuf
npm run gen:proto        # Regénérer les clients/serveurs depuis les .proto

# Déploiement
vercel                   # Deploy sur Vercel (auto depuis git push)
```

---

## Debugging Courant
- **Carte blanche / pas de tuiles** : Vérifier l'URL tile server dans la config MapLibre (Carto Dark Matter)
- **Points pas affichés** : Coordonnées en `[lng, lat]` (pas `[lat, lng]`)
- **Ollama timeout** : Vérifier `ollama pull mistral`, augmenter timeout dans summarization.ts
- **RSS CORS** : Tout passe par `/api/rss-proxy` — jamais de fetch direct côté client
- **Ecowatt 403** : Token OAuth2 RTE expiré — vérifier le flow d'auth dans `api/energy/`
- **Vercel function timeout** : Max 10s en hobby, 60s en pro — optimiser ou cacher
