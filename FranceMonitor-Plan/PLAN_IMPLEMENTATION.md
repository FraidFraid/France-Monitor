# PLAN D'IMPLÉMENTATION — France Monitor
## (Calqué sur l'architecture réelle de WorldMonitor)

---

## Différences clés avec WorldMonitor à garder en tête

| WorldMonitor | France Monitor |
|---|---|
| Scope mondial, 35+ calques | Scope France, ~8 calques ciblés |
| 100+ flux RSS internationaux | 41 flux RSS français (T1-T4 + Cloudflare via Scrapling) |
| 17 services Protobuf | ~6 services Protobuf |
| Vanilla TS (pas de React) | Vanilla TS (même pattern) |
| Vercel serverless + Redis Upstash | Vercel serverless + Redis Upstash |
| Deck.gl + MapLibre + D3 fallback | Deck.gl + MapLibre + D3 fallback |
| Ollama → Groq → Browser T5 | Ollama → Groq → Browser T5 |
| App.ts = 4600 lignes | App.ts = ~1500 lignes (scope réduit) |

---

## Phase 0 : Scaffold & Tooling ✅
**Objectif** : Repo qui build et tourne, structure identique à WorldMonitor.

### Tâches
- [x] `npm create vite@latest france-monitor -- --template vanilla-ts`
- [x] Structure des dossiers : `src/`, `api/`, `server/`, `proto/`, `public/`
- [x] Installer les dépendances core (voir STACK_DEPENDENCIES.md)
- [x] `tsconfig.json` avec `strict: true`, paths alias `@/` → `src/`
- [x] `vite.config.ts` avec :
  - Plugin RSS proxy (comme WorldMonitor `polymarketPlugin` pattern)
  - Plugin sebuf API (comme WorldMonitor `sebufApiPlugin`)
  - Proxy config pour les API gouv françaises
- [x] `vercel.json` basique avec rewrites
- [x] `index.html` avec meta tags FR, dark theme, MapLibre CSS
- [x] `src/main.ts` → importe `App` et l'initialise
- [x] `src/styles/main.css` avec CSS variables dark theme
- [x] ESLint + Prettier
- [x] `.gitignore`, `.env.example`
- [x] Premier commit : `feat: initial scaffold`

### Validation
```bash
npm run dev  # Vite démarre sans erreur ✅ (port 3001)
npm run build  # tsc + vite build passe ✅
```

---

## Phase 1 : La Carte (Frontend Core) ✅
**Objectif** : Carte 3D interactive de la France avec données mockées, comme WorldMonitor mais centré sur la France.

### 1.1 — MapLibre + Deck.gl Setup
- [x] `src/components/DeckGLMap.ts` — Classe qui gère :
  - Initialisation MapLibre avec style Carto Dark Matter
  - Centre : `[2.2, 46.6]`, zoom 6 (France métropolitaine)
  - MapboxOverlay de Deck.gl
  - Gestion du state (zoom, center, pitch, bearing)
  - Event handlers (click, hover, zoom change)
- [x] `src/components/Map.ts` — Fallback D3/SVG pour mobile
  - Projection Mercator centrée France
  - SVG avec les contours départements (GeoJSON)
  - Points colorés par catégorie
- [x] `src/components/MapContainer.ts` — Choisit DeckGL ou D3 selon `isMobileDevice()`
- [x] `src/components/MapPopup.ts` — Tooltip HTML au hover/click

### 1.2 — Données Géo Statiques
- [x] `src/config/geo.ts` — Coordonnées centroïdes des 101 départements + 13 régions + VIEW_PRESETS
- [x] `src/config/infrastructure.ts` — Centrales nucléaires (19), grandes sous-stations RTE, barrages principaux
- [x] `public/data/departements.geojson` — Contours départements (simplifié, bounding boxes)
- [x] `public/data/regions.geojson` — Contours régions (13 régions métropolitaines)

### 1.3 — Calques Deck.gl
- [x] `NewsLayer` — cercles colorés par niveau de menace + stroke par catégorie
- [x] `AlertLayer` — glow pour critical/high (pulse via feature-state)
- [x] `EnergyLayer` — GeoJsonLayer : coloration des régions par signal Ecowatt via ODRE. + alertes réelles d'incidents (ORE).
- [x] `WeatherLayer` — GeoJsonLayer : coloration des départements par alerte météo (Météo-France réelle)
- [x] `FloodLayer` — LineLayer : tronçons Vigicrues colorés par vigilance (mock data)
- [x] `InfraLayer` — CircleLayer + SymbolLayer : centrales nucléaires, barrages, sous-stations (visible zoom > 7)
- [x] `TrafficLayer` — MapLibre RasterLayer/VectorLayer : flux de trafic et incidents routiers temps réel via TomTom API
- [x] `MaritimeLayer` — Deck.gl IconLayer : suivi AIS en temps réel des navires avec typologie (cargo, pêche) et identification de la Marine Nationale
- [x] `AirTrafficLayer` — Deck.gl IconLayer : trafic aérien civil en temps réel (interpolé 60fps), coloré par altitude
- [x] Toggle on/off par calque (boutons overlay sur la carte)

### 1.4 — Données Mockées
- [x] `src/config/mock-data.ts` — 60+ événements fictifs répartis sur la France
- [x] Respectent les types de `src/types/index.ts`
- [x] Catégories variées : social, security, energy, weather, transport, infrastructure, health

### 1.5 — UI Shell
- [x] `src/App.ts` — Orchestrateur principal :
  - Header (titre, heure, point live, presets régionaux)
  - Sidebar gauche : FilterPanel + NewsPanel + StatusPanel
  - Zone centrale : MapContainer
  - Filtres : temps (1h, 6h, 24h, 48h, 7j), catégories, niveaux de menace, recherche
- [x] `src/components/NewsPanel.ts` — Liste scrollable d'événements avec icônes catégorie
- [x] `src/components/Panel.ts` — Base class pour tous les panneaux (collapsible)
- [x] `src/components/FilterPanel.ts` — Toggles catégories + slider temps + search
- [x] `src/components/StatusPanel.ts` — État de chaque source de données

### Validation Phase 1
- [x] Carte 3D centrée France, fond sombre, navigation fluide
- [x] 60+ points mockés affichés, couleur par niveau + stroke par catégorie
- [x] Click → popup avec détails de l'événement
- [x] Filtres temps et catégorie filtrent les points (carte + sidebar)
- [x] Presets régionaux dans le header (IDF, PACA, Bretagne, Grand Est…)
- [x] Mobile : fallback D3/SVG implémenté et connecté
- [x] TypeScript strict : `npm run typecheck` → 0 erreur
- [x] Serveur dev : `npm run dev` → port 3001

---

## Phase 2 : Backend — Serverless Functions & RSS ✅
**Objectif** : Données réelles via Vercel serverless + plugins Vite dev.

### 2.1 — RSS Proxy & Feed Service ✅
- [x] `api/rss-proxy.js` — Vercel Edge Function : proxy RSS (contourne CORS)
  - User-Agent rotation (Chrome Mac/Win/Linux)
  - `redirect: 'follow'` pour 301/302
- [x] `src/plugins/rss-proxy.ts` — Plugin Vite dev local (même logique)
- [x] `src/config/feeds.ts` — **41 flux RSS français** :
  - **Tier 1 (4)** : France Info, Le Monde, Le Figaro, RFI
  - **Tier 2 (15)** : Libération, BFM, Europe 1, L'Obs, Marianne, Slate, Challenges, Numerama, 01net, Futura, Sciences et Avenir, Courrier Intl, Mediapart
  - **Tier 3 (18)** : PQR régionale + DOM-TOM (NC la 1ère, Zinfos974, Imaz Press, Mayotte Hebdo, Guadeloupe.fr)
  - **Tier 4 (4)** : France Bleu, Actu.fr, Atlantico, Valeurs Actuelles
  - **Cloudflare (3)** : Les Échos, La Voix du Nord, Paris Normandie (via Scrapling)
- [x] `src/services/rss.ts` — Service RSS :
  - Circuit breaker par flux (cooldown 5min après 2 échecs)
  - Cache en mémoire TTL 10min
  - Déduplication par URL
  - `fetchAllFeeds()` en parallèle
  - **Fallback Scrapling** pour domaines Cloudflare

### 2.2 — Classifier & Géocodeur ✅
- [x] `src/services/classifier.ts` — Classification keyword-based :
  - 7 catégories × 3 niveaux (high/medium/low) + détection critical
  - Boost confidence multi-match
  - Source: 'keyword' (prêt pour ML Phase 3)
- [x] `src/services/geocoder.ts` — Géocodage :
  - Extraction regex de lieux depuis les titres
  - API Adresse Gouv (gratuite, pas de clé)
  - 30 villes FR en cache dur
  - Cache en mémoire + batch throttling

### 2.3 — Services API Gouvernementales ✅
- [x] `src/services/ecowatt.ts` — Écowatt RTE via ODRE (open data, cache 30min)
- [x] `src/services/vigilance-meteo.ts` — Météo-France vigilance (API publique, cache 15min)
- [x] `src/services/vigicrues.ts` — Vigicrues GeoJSON (API publique, cache 15min)
- [x] `src/services/transport.ts` — SNCF disruptions (Service prêt, mock temporaire utilisé en attente de clé API)

### 2.4 — Intégration App.ts ✅
- [x] Pipeline RSS : fetch → classify → geocode → merge avec mock → update carte
- [x] Polling automatique toutes les 5 minutes
- [x] API gouv branchées avec fallback mock si erreur
- [x] StatusPanel mis à jour en temps réel (loading/ok/stale/error)


### Validation
- [x] `npm run dev` → les API répondent via les plugins Vite
- [x] `curl localhost:3001/api/rss-proxy?url=...` → retourne du XML
- [x] `curl localhost:3001/api/energy/ecowatt` → retourne du JSON Ecowatt
- [x] Services frontend récupèrent les vraies données
- [ ] Déploiement Vercel : les serverless functions fonctionnent (reporté)

---

## Phase 3 : IA — Classification & Résumé
**Objectif** : Les articles RSS sont classifiés automatiquement et géolocalisés.

### 3.1 — Threat Classifier (pattern WorldMonitor) ✅
- [x] `src/services/classifier.ts` :
  - Types : `ThreatLevel` (critical/high/medium/low/info)
  - Types : `EventCategory` (social/security/energy/weather/transport/infrastructure/health/general)
  - `classifyByKeywords()` — classification instantanée par mots-clés français
  - **Mitigation bruit PQR** : `detectEntities()` + `isFaitDiversNoise()`
    - Exige une institution (police, préfecture, SNCF, EDF...) pour valider `security/low`
    - Sans institution → downgrade en `info/general`
  - Confidence score + source tracking (keyword/ml/llm)
  - [ ] `classifyWithAI()` — override async via Ollama/Groq (Phase 3.3)

### 3.2 — Keyword Maps Françaises ✅
- [x] Dictionnaire de mots-clés FR → catégorie + niveau :
  ```
  grève, manifestation, blocage → social
  accident, agression, cambriolage → security
  coupure, panne, réseau → infrastructure
  tempête, canicule, inondation → weather
  perturbation, retard, annulation → transport
  nucléaire, centrale, Ecowatt → energy
  ```
- [x] **Entités nommées** (`INSTITUTIONS`, `LOCATION_TYPES`, `FAITS_DIVERS_KEYWORDS`)
- [x] Villes françaises connues → extraction de lieu
- [x] Régions/départements → extraction de lieu

### 3.3 — Summarization Service
- [x] `src/services/summarization.ts` — Fallback chain :
  1. Ollama local (mistral:instruct) — timeout 5s
  2. Groq cloud (si clé configurée) — timeout 5s
  3. Browser T5 (@xenova/transformers) — fallback ultime
- [ ] Server handler : `server/francemonitor/intelligence/v1/handler.ts`
- [ ] Redis cache 24h pour les résumés (dédup cross-users)

### 3.4 — Géolocalisation des Articles
- [ ] Extraction du lieu depuis le titre (villes, départements, régions)
- [ ] `src/services/geocoding.ts` : appel API Adresse gouv → [lng, lat]
- [ ] Cache IndexedDB (les adresses ne changent pas)
- [ ] Validation : coordonnées dans la bbox France `[-5.5, 41.3, 9.6, 51.1]`

### Validation
- [ ] 50 articles réels → > 80% classifiés correctement
- [ ] > 70% géolocalisés avec des coordonnées valides
- [ ] Fallback chain : couper Ollama → Groq prend le relais → couper Groq → T5 browser
- [ ] Points sur la carte = articles réels avec lieu et catégorie

---

## Phase 4 : Assemblage Temps Réel
**Objectif** : Tout est connecté, la carte vit.

### 4.1 — App.ts Orchestration ✅
- [x] Boucles de refresh (pattern WorldMonitor `REFRESH_INTERVALS`) :
  - RSS : toutes les 5 min
  - Ecowatt : mock statique auto-géré / chargement des calques
  - Météo : mock statique auto-géré / chargement des calques
  - Vigicrues : mock statique auto-géré / chargement des calques
  - SNCF : mock statique auto-géré / chargement des calques
- [x] State synchronisé : les données alimentent les calques Deck.gl
- [x] StatusPanel : indicateur vert/orange/rouge par source

### 4.2 — Clustering & Performance ✅
- [x] MapLibre native clustering : regroupement des points au dézoom
- [x] Seuils adaptatifs selon le zoom (couleurs par nombre de points)
- [x] Click-to-zoom sur les clusters
- [x] Label deconfliction (les badges BREAKING se chevauchent pas)
- [x] Zoom-adaptive opacity (0.2 en vue globale → 1.0 au zoom rue)

### 4.3 — URL State Sharing ✅
- [x] `src/utils/urlState.ts` : encode/décode la vue dans l'URL
- [x] Paramètres : `?lng=2.2&lat=46.6&z=6&layers=news,energy&time=24h&q=paris`
- [x] Liens partageables — la vue est synchronisée à chaque mouvement de carte

### 4.4 — Persistance ✅
- [x] localStorage : cache instantané des articles RSS (`src/utils/newsCache.ts`)
- [x] localStorage : calques et géométrie encodés dans l'URL (liens partageables)

### Validation
- [ ] L'app tourne 4h sans crash, les données se rafraîchissent
- [ ] Couper le réseau → l'app affiche les données cachées
- [ ] Lien partagé ouvre la même vue
- [ ] Performance : 60fps avec 500+ points

---

## Phase 5 : Finitions & Polish
**Objectif** : UX prête pour une démo.

### 5.1 — Panneaux Avancés
- [x] `EnergyPanel.ts` : Signal Ecowatt (vert/orange/rouge) + mix énergétique
- [x] `WeatherPanel.ts` : Carte des alertes par département, type de risque
- [x] `FloodsPanel.ts` : Tronçons en vigilance, niveaux d'eau
- [x] `TransportPanel.ts` : Perturbations SNCF, lignes affectées

### 5.2 — Recherche & Navigation
- [x] `SearchModal.ts` : Recherche par ville, département, type d'événement
- [x] Clic sur un événement sidebar → zoom carte sur le point
- [x] Presets régionaux : Île-de-France, PACA, Grand Est, etc.

### 5.3 — PWA & Offline
- [x] `vite-plugin-pwa` : manifest, service worker, offline fallback
- [x] Cache des tuiles carte pour mode offline
- [x] `public/offline.html` : page de fallback

### 5.4 — Responsive
- [ ] Mobile : sidebar en bottom sheet, filtres en drawer
- [ ] Tablet : layout adapté
- [ ] Desktop : full layout avec sidebar

### 5.5 — Documentation
- [ ] README avec screenshots

### 5.6 — UX News Feed Avancée
- [x] Animation pulse pour alertes critical/high (CSS overlay)
- [x] Fly-to cinématographique (arc parabolique + easing ease-out)
- [x] Clustering intelligent (couleur par max threat, critical jamais clusterisés)
- [x] Badge "NEW" sur articles < 1h avec glow animé
- [x] Indicateur "Résumé en cours..." dans popup si aiSummary en pending
- [x] Notifications toast pour nouveaux articles critical/high
- [ ] Guide d'installation et configuration
- [ ] CONTRIBUTING.md

### Validation finale
- [ ] Lighthouse > 90 (Performance, Accessibility)
- [ ] Fonctionne Chrome, Firefox, Safari
- [ ] Mobile responsive fonctionnel
- [ ] PWA installable
- [ ] Build prod < 2MB (hors tuiles)
- [ ] 24h sans crash

---

## Phase 6 (Optionnelle) : Desktop App
- [ ] Tauri v2 setup
- [ ] Auto-discovery Ollama local
- [ ] Build macOS, Windows, Linux
- [ ] Auto-update

---

## Phase 7 : Dashboard d'Intelligence (Niveau World Monitor) 🚀
**Objectif** : Passer d'un agrégateur à un outil de situational awareness stratégique.

### 7.1 — Volet Militaire (Défense & Sécurité) 🎖️
- [x] **Mouvements Aériens** : Intégration ADS-B via OpenSky Network pour les transpondeurs de l'Armée de l'Air.
- [x] **Bases Militaires** : Cartographie des sites (BA 105, BA 125, ports militaires) et corrélation avec les news PQR locales.
- [x] **Zones Interdites (ZIT)** : Affichage des zones de survol restreintes en temps réel.

### 7.2 — Volet Énergétique Stratégique ⚡
- [x] **Parc Nucléaire** : État de disponibilité des réacteurs (Données RTE/EDF) — Dashboard de maintenance.
- [x] [NOUVEAU] **Mix Énergétique Temps Réel** : Production nationale et régionale par filière (Nucléaire, Éolien, Solaire, Hydro, Thermique) intégrée au Panneau Énergie.
- [x] **Interconnexions Animées (2026-02-28)** : Visualisation des flux d'import/export aux frontières physiques de la France.
  - **Arcs courbés Bézier** du centre France vers 5 frontières (UK, Espagne, Italie, Suisse, All./Bel.)
  - **Animation pulsée** : `requestAnimationFrame` avec `line-dasharray` dynamique pour simuler le flux électrique
  - **Couleurs** : 🔴 Rouge = import (flux vers France), 🟢 Vert = export (flux depuis France)
  - **Épaisseur adaptative** : 3-10px selon magnitude MW (`flowMW / 600`)
  - **Layers MapLibre** : `LYR_INTERCONN_ARC_GLOW` (halo blur), `LYR_INTERCONN_ARC` (arc principal), `LYR_INTERCONN_LINE` (endpoint), `LYR_INTERCONN_LABEL`
  - Fichier : `src/components/DeckGLMap.ts` (fonction `generateArc()`, constante `FRANCE_CENTER`)

### 7.3 — Volet "Élections Présidentielles" (Pivot Stratégique) 🗳️
- [ ] **Agenda des Candidats** : Scraping/Aggregateur des meetings et déplacements pour affichage cartographique.
- [ ] **Google Trends Local** : Intégration de l'intérêt de recherche par candidat et par département.
- [ ] **Analyse de Tension** : Corrélation entre zones de grèves/manifestations et cartes électorales historiques.

### 7.4 — Volet Catastrophes Naturelles 🛰️
- [x] **NASA FIRMS** : Intégration du flux satellite pour la détection des départs de feux de forêt en temps réel.
- [x] **Vigilance Multi-Risques** : Unifier Météo, Crues et Feux sur un seul calque "Impact Environnemental".

### Priorités Immédiates (Next Steps)
- [x] Mise en place d'une "Source Militaire" (Cartographie des bases + News locales corrélées).
- [x] Création du "Dashboard Nucléaire" (Disponibilité des réacteurs via Open Data RTE).
 Penser à elargir la france au Territoires d outre mer et autres dom tom
Penser a prends les rss des agences de press

### Mises à jour : Couverture Étendue & Fiabilité (DOM-TOM & Agences)

- [x] **Géographie Étendue (DOM-TOM)**
  - [x] Ajouter les Bounding Boxes / Centroïdes des 5 DROM (Guadeloupe, Martinique, Guyane, La Réunion, Mayotte) dans `src/config/geo.ts`.
  - [x] Créer des "Camera Presets" (raccourcis UI) pour survoler rapidement les territoires d'outre-mer.
  - [x] Intégrer les contours GeoJSON des territoires d'outre-mer.
- [x] ~~Ajouter le flux AFP~~ → SUPPRIMÉ (URL morte, pas de flux RSS public disponible). Remplacé par RFI tier 1.

- [x] **Intégration des Agences de Presse & PQR**
  - [x] Ajout de 26 flux RSS vérifiés : RFI, France Info, Le Monde, Le Figaro (tier 1) + Europe 1, Mediapart, Courrier International (tier 2) + 13 PQR régionaux (tier 3).
  - [x] DOM-TOM : NC la 1ère, Imaz Press Réunion, Mayotte Hebdo (flux la1ere.francetvinfo.fr cassés → remplacés par médias locaux).
  - [x] Headers anti-bot configurés : User-Agent rotation (Chrome Mac/Win/Linux), redirect follow, Accept-Language FR.

- [x] **Amélioration du Classifieur et du Géo-tagging (Risques locaux)**
  - [x] Implémenter des **regex à frontières de mots (`\b`)** pour la détection de villes afin d'éviter les faux positifs sur des mots communs (ex: la ville d'"Eu", "Cannes", "Pau").
  - [x] Ajuster le dictionnaire de mots-clés : différencier les faits divers locaux (bruit) des incidents critiques (ex: "accident" = faible/ignoré vs "accident + autoroute/centrale" = critique).
  - [x] Gérer les fuseaux horaires multiples dans les timestamps des flux RSS pour l'Outre-mer (convertir tout en heure locale métropole ou afficher le delta).

- [x] **Nouvelles Mitigations de Risques techniques**
  - [x] *Risque* : Bruit excessif de la PQR (Rapport Signal/Bruit). *Mitigation* : `classifier.ts` exige une **institution** (police, préfecture, SNCF, EDF, etc.) pour valider les événements `security/low`. Fonctions `detectEntities()` et `isFaitDiversNoise()` ajoutées.
  - [x] *Risque* : API Adresse Gouv rate-limitée ou lente avec l'Outre-mer. *Mitigation* : Mettre en cache strict (Redis/IndexedDB) chaque ville française résolue.
  - [x] *Risque* : Flux Cloudflare (Les Échos, La Voix du Nord, Paris Normandie). *Mitigation* : Proxy **Scrapling** Python (`services/scrapling-proxy/`) avec bypass Cloudflare via Camoufox. Démarré automatiquement avec `npm run dev`.

- [x] **Infrastructure Scrapling Proxy (2026-02-27)**
  - [x] `services/scrapling-proxy/app.py` : API Flask avec Scrapling + Camoufox
  - [x] `services/scrapling-proxy/Dockerfile` : Image Docker pour Cloud Run
  - [x] `services/scrapling-proxy/start.sh` : Script de démarrage avec virtualenv
  - [x] `package.json` : Scripts `scrapling:dev`, `scrapling:install`, `scrapling:docker`
  - [x] `npm run dev` : Lance Vite + Scrapling en parallèle via `concurrently`
  - [x] `.env` : `VITE_SCRAPLING_PROXY_URL=http://localhost:8080`
  - [x] `src/services/rss.ts` : Fallback automatique vers Scrapling pour domaines Cloudflare

---

### 7.5 — Volet Trafic Routier 🚗 (2026-02-28)
- [x] **TomTom Traffic Incidents API** : 17 zones métropolitaines couvertes
  - Paris, Lyon, Marseille, Lille, Bordeaux, Toulouse, Strasbourg, Nice, Nantes, Rennes, Montpellier, Rouen, Grenoble, Tours, Dijon, Le Havre, Clermont-Ferrand
- [x] **Optimisation quota** : Cache 10 min (144 refreshes/jour × 17 zones = 2448 req/jour, sous quota 2500 gratuit)
- [x] **TrafficPanel enrichi** : Formatage arrondi (`Math.round(m)m`), source "TomTom Traffic (temps réel)"
- Fichier : `src/services/traffic.ts`, `src/components/TrafficPanel.ts`

### 7.6 — Améliorations Géocodage (2026-02-28)
- [x] **Extension dictionnaire CITIES** : 300+ villes françaises (vs ~40 avant)
  - Top 200 par population + villes fréquentes dans l'actualité
  - DROM-COM avec noms qualifiés ("Saint-Denis de la Réunion" vs "Saint-Denis")
- [x] **Seuil de confiance abaissé** : 0.4 (vs 0.6) pour capter plus de localités
- [x] **Fallback API Adresse** : Retry sans `type=municipality` pour les hameaux/lieux-dits
- [x] **Navigation DROM fixée** : Suppression de `maxBounds` qui bloquait les flyTo vers outre-mer
- Fichiers : `src/config/geo.ts`, `src/services/geocoder.ts`, `src/components/DeckGLMap.ts`

---

 Idées futures :
 - incorporer les flux boursiers
 - [x] web cam embouteillages etc (TomTom API Vector Tiles intégré)
 - en corrélant toutes les informations l'IA prédit des évènements ou les met en rapport via des pop-ups
 - carte des flux massifs de données volées (cyber)
 - carte des epidemies / santé / allergies
 - webcams temps réel

## Risques & Mitigations

| Risque | Impact | Mitigation | Status |
|---|---|---|---|
| API RTE OAuth2 complexe | Pas d'Ecowatt | Données statiques + retry | ✅ |
| RSS PQR bloquent les bots | Pas d'actus | User-Agent rotation + rss-proxy Vercel | ✅ |
| **RSS Cloudflare (403)** | Les Échos, La Voix du Nord, Paris Normandie bloqués | **Scrapling proxy Python** (`npm run dev` le lance auto) | ✅ |
| **Bruit PQR (faits divers)** | Trop de cambriolages/vols locaux | `classifier.ts` exige une institution | ✅ |
| Ollama trop lent | IA bloquée | Fallback chain (Groq → T5 browser) | ✅ |
| Vercel function timeout (10s hobby) | API lentes | Cache Redis agressif | ⏳ |
| Deck.gl perf > 5K points | Carte laggy | Supercluster + LOD | ✅ |
| CORS sur les API gouv | Fetch échoue | Tout passe par les serverless functions | ✅ |
| Vanilla TS = gros App.ts | Maintenabilité | Découper en modules, pattern WorldMonitor | ✅ |

---

## Phase 8 : Refonte Sémiologique (Intégration DSFR)
**Objectif** : Remplacer les ronds/carrés par l'iconographie vectorielle officielle de l'État français.

### Tâches Techniques
- [ ] **8.1 - Création du Sprite DSFR (IconAtlas)**
  - Extraire les icônes SVG clés du DSFR (ex: `fr-icon-ancient-pavilion-fill` pour les institutions, `fr-icon-speak-fill` pour les débats, `fr-icon-warning-fill` pour les alertes).
  - Créer un script Node.js dans `tools/` pour assembler ces SVG en une seule image PNG (`public/assets/dsfr-atlas.png`) et générer le fichier de mapping JSON associé (`dsfr-mapping.json`).
- [ ] **8.2 - Refonte du NewsLayer (Deck.gl)**
  - Dans `src/components/DeckGLMap.ts`, remplacer le `ScatterplotLayer` actuel par un `IconLayer`.
  - Configurer les props : `iconAtlas`, `iconMapping`, et la fonction `getIcon: (d) => d.iconType` basée sur la catégorie de l'événement.
- [x] **2.3 - Intégration Vigicrues (Inondations)**
  - Fichier : `src/services/vigicrues.ts`
  - Fetch l'API `InfoVigiCru.geojson` ou `https://www.vigicrues.gouv.fr/services/1/`.
- [ ] **8.3 - Palette Chromatique Souveraine**
  - Mettre à jour `src/styles/main.css` avec les variables DSFR : `$artwork-major-blue-france`, `$artwork-minor-red-marianne`.

---

## Phase 9 : Couche d'Alerte & Micro-Animations (MapLibre DOM)
**Objectif** : Attirer l'œil de l'analyste sur les événements critiques via le mouvement, sans surcharger le moteur WebGL.

### Tâches Techniques
- [ ] **9.1 - Implémentation du CSS Keyframes**
  - Dans `src/styles/animations.css`, créer trois classes de micro-animations :
    - `.marker-pulse` : Animation d'urgence (`transform: scale` + `opacity` cyclique) pour les incidents critiques.
    - `.marker-ripple` : Onde de choc concentrique (pseudo-éléments `::after` avec un border qui s'étend).
    - `.marker-wiggle` : Tremblement rapide pour les anomalies statistiques.
- [ ] **9.2 - Hybridation WebGL / HTML Markers**
  - Créer un `AlertManager.ts` qui identifie les événements de niveau "Critical" ou "Breaking".
  - Pour ces seuls événements, instancier un `maplibregl.Marker({ element: customDiv })` injecté directement dans le DOM de la carte, permettant aux classes CSS d'animation de s'exécuter par-dessus Deck.gl.
- [ ] **9.3 - Interpolation de Caméra (FlyTo)**
  - Configurer `transitionInterpolator: new FlyToInterpolator()` dans Deck.gl pour que les clics dans la barre latérale déclenchent un vol cinématographique vers le département concerné.

---

## Phase 10 : Intelligence Politique & Sociale
**Objectif** : Ingérer et classifier le calendrier électoral, parlementaire et social.

### Tâches Techniques
- [ ] **10.1 - Extension du Classifieur (`src/services/classifier.ts`)**
  - Ajouter deux catégories principales : `Political` (Institutions, Élections) et `Social` (Grèves, Manifestations).
  - Enrichir le dictionnaire de mots-clés : "motion de censure", "loi de finances", "49.3", "sénatoriales".
- [ ] **10.2 - Module de Calendrier Prédictif (Sources de Données)**
  - Créer un flux de données statique/mock pour les échéances répertoriées :
    - Septembre/Octobre 2025 : Élections législatives partielles (ex: circonscription de Montauban).
    - Automne 2025/Hiver 2026 : Débats et votes décisifs sur la Loi de Finances 2026.
    - Septembre 2026 : Élections Sénatoriales (Série 2 - 63 circonscriptions concernées).
- [ ] **10.3 - Géo-tagging Institutionnel**
  - Ajouter une règle stricte dans `geocoder.ts` : forcer les coordonnées sur le Palais Bourbon ou le Palais du Luxembourg pour tout événement parlementaire majeur.

---

## Phase 11 : Conscience Situationnelle Visuelle (Webcams & Bourse)
**Objectif** : Confirmer les signaux d'alerte par l'image en direct et suivre l'impact macro-économique.

### Tâches Techniques
- [ ] **11.1 - Flux Vidéo Webcams (MapLibre Popups)**
  - Lister les URLs publiques (HLS `.m3u8` ou iframes) de réseaux comme Skaping (haute résolution/panoramique) ou Vision-Environnement.
  - Mettre à jour `MapPopup.ts` : Lorsqu'un utilisateur clique sur une ville disposant d'une webcam, utiliser `document.createElement('video')` avec la librairie `hls.js` pour injecter et lire le flux vidéo directement dans l'infobulle (popup) MapLibre.
- [x] **11.2 - Intégration Marketstack API (CAC 40 Temps Réel)**
  - Créer un Vercel Edge Function (`api/finance/market.ts`) pour interroger l'API gratuite de Marketstack (format JSON) tout en sécurisant la clé d'API.
  - Cibler l'indice CAC 40 et des valeurs stratégiques (ex: EDF, TotalEnergies).
- [x] **11.3 - Composant UI FinancePanel.ts**
  - Créer un panneau latéral affichant les tickers boursiers avec des variations de couleurs (vert/rouge) et des mini-graphiques (sparklines).
  - Configurer un polling silencieux toutes les 5 minutes sur la route `/api/finance/market`.

---

## Phase 12 : Indice de Stabilité Nationale & Régionale (ISNR) 📊 ✅
**Objectif** : Implémenter un indicateur de stabilité global (0-100) inspiré du `CII` (Country Instability Index) du projet original World Monitor, mais adapté aux régions et départements français.

### Tâches Techniques
- [x] **12.1 - Algorithme de Calcul de Stabilité (`src/services/stability-index.ts`)**
  - Service de calcul de score agrégeant 4 dimensions clés :
    - **Social (30%)** : Volume des grèves, manifestations, blocages.
    - **Sécuritaire (30%)** : Incidents majeurs, interventions des forces de l'ordre.
    - **Infrastructures / Environnement (20%)** : Alertes météo, crues, pannes réseau (Ecowatt).
    - **Vélocité de l'Information (20%)** : Densité des articles/dépêches ciblés sur un département.
  - Formule : `(Social * 0.3) + (Sécuritaire * 0.3) + (Infra * 0.2) + (Vélocité * 0.2)`.
  - Mapping des 101 départements + DOM-TOM avec codes région.
  - Fonctions : `computeISNR()`, `aggregateByDepartment()`, `scoreToEmoji()`, `trendToArrow()`.
- [x] **12.2 - Panneau ISNR UI (`src/components/ISNRPanel.ts`)**
  - Floating modal à droite (pattern WeatherPanel).
  - Affiche le score national + liste top 15 départements instables.
  - Jauge colorée (0-100), émoji d'état (🔴 🟠 🟡 🟢 ⚪), flèche de tendance (↗ ↘ →).
  - Détail du score : `Soc:30 Sec:50 Inf:20 Vel:10`.
  - Interactions : hover → highlight carte, click → flyTo département.
- [x] **12.3 - Intégration Cartographique (ISNRLayer)**
  - Layer MapLibre fill + line pour colorer les départements par score.
  - Couleurs : stable (vert clair) → critical (rouge).
  - Toggle "📊 Stabilité" dans la toolbar des calques.
  - Méthodes : `updateISNR()`, `highlightISNRDepartment()` dans DeckGLMap.ts.
- [x] **12.4 - Intégration App.ts**
  - Calcul ISNR dans `loadAllLayers()` après chargement des données.
  - Panel affiché automatiquement quand layer stability activé.

---

## Phase 13 : Sources de Données Étendues 📡
**Objectif** : Enrichir la conscience situationnelle avec de nouvelles sources de données temps réel (télécoms, énergie étendue, open data).

### 13.1 — API ORE (Incidents Réseau Électricité/Gaz) ⚡
- [ ] **Service `src/services/ore-incidents.ts`**
  - Fetch API Open Data Agence ORE : `https://opendata.agenceore.fr/api/`
  - Incidents réseau électricité et gaz en temps réel
  - Cache 15 min, circuit breaker pattern
- [ ] **Intégration EnergyPanel**
  - Section "Incidents Réseau" avec liste des pannes actives
  - Icônes différenciées : ⚡ électricité, 🔥 gaz
- [ ] **Layer carte `LYR_ORE_INCIDENTS`**
  - Points orange/rouge selon gravité
  - Visible zoom > 8

### 13.2 — Bornes de Recharge IRVE 🔌
- [ ] **Service `src/services/irve.ts`**
  - Source : data.gouv.fr IRVE consolidé ou API ORE
  - Filtrage : rapide (>50kW), normale (<50kW)
  - Cache 24h (données statiques)
- [ ] **Layer carte `LYR_IRVE`**
  - Points verts (disponible) / gris (hors service)
  - Visible zoom > 10
  - Clustering à zoom < 10
- [ ] **Popup enrichie**
  - Puissance, opérateur, disponibilité

### 13.3 — Pannes Internet & Télécoms 📶
- [ ] **Scraper free-reseau.fr via Scrapling proxy**
  - Données DSLAM/NRO (infrastructure Orange/Free)
  - Extraction des zones affectées
  - Fichier : `src/services/internet-outages.ts`
- [ ] **TelecomPanel (`src/components/TelecomPanel.ts`)**
  - Floating modal avec liste des pannes actives
  - FAI concerné, zone géographique, début panne
- [ ] **Layer carte `LYR_TELECOM_OUTAGE`**
  - Zones affectées en overlay semi-transparent
  - Couleur par gravité (jaune/orange/rouge)
- [ ] **Nouvelle catégorie classifier**
  - `infrastructure/telecom` dans `classifier.ts`
  - Mots-clés : "panne internet", "coupure fibre", "incident réseau", "DSLAM"

### 13.4 — Corrélation Spatiale (Turf.js) 🗺️
- [ ] **Module `src/utils/spatial-correlation.ts`**
  ```typescript
  import * as turf from '@turf/turf';

  export function findNearbyIncidents(
    point: [number, number],
    incidents: GeoJSON.Feature[],
    radiusKm = 0.5
  ): GeoJSON.Feature[];

  export function correlateIncidents(
    internetOutage: Incident,
    electricIncidents: Incident[],
    constructionWorks: Incident[]
  ): CorrelationResult;
  ```
- [ ] **Enrichissement tooltips**
  - "Cause probable" si incident corrélé détecté
  - Score de fiabilité basé sur la proximité
- [ ] **Dépendance** : `npm install @turf/turf`

### 13.5 — Open Data Travaux & Voirie 🚧
- [ ] **Service `src/services/travaux-voirie.ts`**
  - Source : data.gouv.fr API datasets travaux
  - Formats : GeoJSON des chantiers déclarés
  - Cache 6h (données peu volatiles)
- [ ] **Layer carte `LYR_TRAVAUX`**
  - Polygones orange pour zones de travaux
  - Visible zoom > 12
- [ ] **Corrélation avec pannes**
  - Si panne télécom + travaux < 500m → cause probable affichée

### 13.6 — Hub'Eau Étendu (Nappes Phréatiques) 💧
- [ ] **Enrichissement service existant**
  - Ajouter les chroniques de niveau des nappes
  - Source : `https://hubeau.eaufrance.fr/api/v1/niveaux_nappes/`
- [ ] **Indicateur sécheresse**
  - Niveau bas → alerte jaune
  - Niveau critique → alerte orange
- [ ] **Intégration FloodsPanel**
  - Section "Nappes phréatiques" sous les crues

### Architecture Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    NOUVELLES SOURCES                         │
├──────────────┬──────────────┬──────────────┬───────────────┤
│  ORE API     │  IRVE        │  free-reseau │  data.gouv    │
│  (incidents) │  (bornes)    │  (scraping)  │  (travaux)    │
└──────┬───────┴──────┬───────┴──────┬───────┴───────┬───────┘
       │              │              │               │
       ▼              ### Priorités d'implémentation

| Sous-phase | Effort | Valeur | Priorité |
|------------|--------|--------|----------|
| 13.1 API ORE | Faible | Haute | P1 |
| 13.4 Turf.js | Faible | Haute | P1 |
| 13.2 IRVE | Faible | Moyenne | P2 |
| 13.3 Pannes Internet | Moyen | Haute | P2 |
| 13.5 Travaux | Moyen | Moyenne | P3 |
| 13.6 Hub'Eau | Faible | Faible | P3 |

---

## Phase 14 : Volet Santé & Épidémies 🏥 ✅
**Objectif** : Suivre l'état des urgences, pénuries de médicaments, et épidémies en temps réel.

### 14.1 — Indicateurs de Santé & Épidémies
- [x] **Réseau Sentinelles** (`src/services/sentinellesService.ts`) : Suivi des épidémies saisonnières (grippe, gastro, varicelle, etc.).
- [x] **Urgences Hospitalières** (`src/services/hospitals.ts`) : Tension des urgences hospitalières, suivi OSCOUR & SOS Médecins.
- [x] **Disponibilité des Médicaments** : Suivi des tensions d'approvisionnement des pharmacies et hôpitaux.
- [x] **Panneaux UI Dédiés** : 
  - `HealthBarometerPanel.ts` : Floating component interactif affichant le baromètre des risques ("Baromètre Santé").
  - `NationalHealthPanel.ts` : Synthèse nationale des indicateurs clés (Sentinelles, Médicaments).

### 14.2 — Calques Cartographiques Santé
- [x] **Layer APL (Accessibilité Potentielle Localisée)** : Affichage spatial des déserts médicaux.
- [x] **Layer OSCOUR / SOS Médecins** : Visualisation en temps réel de la pression sur les services de santé par territoire.
- [x] Clustering et styling distinctif pour une identification claire des crises sanitaires régionales.

---

## Phase 15 : Volet Cyber & Menaces Hybrides 💻 ✅
**Objectif** : Agrégation des risques cyber et physiques touchant à l'infrastructure vitale d'information.

### 15.1 — Cybersécurité et Menaces Numériques
- [x] **Surveillance Cyber** (`src/services/cyber.ts`) : Visualisation des attaques majeures et risques sur les flux de données (ex: fuites, failles critiques en France).
- [x] **Câbles Sous-Marins** (`src/services/cable-threats.ts`) : Cartographie et surveillance de l'intégrité des raccordements vitaux transatlantiques/méditerranéens d'infrastructures télécom.
- [x] **Panneau UI Cyber** (`src/components/CyberPanel.ts`) : Agrégation spatiale des incidents cybernétiques en temps réel sur le tableau de bord.

---

## Phase 16 : Volet Défense Intégrale 🛡️ ✅
**Objectif** : Surveillance unifiée des actifs militaires (terre/air/mer).

### 16.1 — Suivi Multi-Domaines
- [x] **Trafic Aérien Militaire** (`src/services/military-flights.ts`, `air-traffic.ts`) : Suivi étendu du trafic aérien ADS-B pour l'aéronautique de défense.
- [x] **Bases Militaires & Installations** (`src/services/military-osm.ts`) : Apport OpenStreetMap enrichi pour les zones Défense.
- [x] **Marine Militaire** (`src/services/military-ships.ts`) : Identification et localisation des assets navals stratégiques via AIS / OpenSky naval.
- [x] **Panneau UI Défense** (`src/components/DefensePanel.ts`) : Command-center unifié pour surveiller tout le dispositif de sécurité militaire (avions, bases et navires).

---

### Note technique : MCP vs API directes

L'approche **MCP (Model Context Protocol)** a été évaluée pour les requêtes data.gouv.fr. Conclusion :
- MCP est conçu pour l'accès IA aux outils (Claude, GPT)
- Pour une app temps réel comme FranceMonitor, les **API REST directes** sont plus simples et performantes
- Possibilité future : mode "recherche naturelle" via LLM qui utiliserait MCP pour interroger data.gouv.fr

---

> **🚀 RECOMMANDATIONS DE PROMPTING POUR L'IA (À lire par l'assistant)**
> Cher Assistant, lors de l'implémentation de la Phase 9 (Animations), fais très attention à ne pas instancier des centaines de `maplibregl.Marker` DOM, car cela détruirait les performances du navigateur. Limite l'usage des marqueurs HTML animés aux 10-15 alertes les plus urgentes, le reste doit rester géré par le WebGL d'`IconLayer`.
> Pour la Phase 11, assure-toi d'utiliser un cache (Redis Upstash ou Vercel KV) dans le handler API Marketstack pour ne pas épuiser le quota gratuit de l'API financière.
> ✅ **FLUX RSS TESTÉS (2026-02-27)** : Tous les 41 flux ont été testés individuellement. AFP supprimé. Les Échos, La Voix, Paris Normandie passent par Scrapling (Cloudflare). DOM-TOM la1ere.francetvinfo.fr cassés → remplacés par médias locaux.
> ✅ **PHASE 12 ISNR TERMINÉE (2026-02-28)** : Indice de Stabilité implémenté.
> ✅ **INTERCONNEXIONS ANIMÉES (2026-02-28)** : Flux électriques transfrontaliers (import/export).
> ✅ **TRAFIC ÉTENDU (2026-02-28)** : TomTom 17 métropoles.
> ✅ **GÉOCODAGE AMÉLIORÉ (2026-02-28)** : Dictionnaire CITIES étendu à 300+ villes.
> ✅ **PHASE 14, 15, 16 INTÉGRÉS (2026-03)** : Infrastructures critiques Santé intégrées (Sentinelles/OSCOUR), Cyber/Câbles implémentés, Défense unifiée avec avions, bases et navires.
> ✅ **FIXES VISUELS & FIABILISATION DATA (2026-04)** : Intégration stabilisée du réseau Gaz (ODRÉ Ecogaz / PEG NaTran), dé-clusterisation intelligente des labels AIS Maritimes, correction d'affichage des "Pulse Markers" (conflit WebGL/DOM), et clarification des sources (Historique vs Temps Réel) pour les pannes réseau.
---

### Idées futures :
-  incorporer les flux boursiers détaillés
-  en corrélant toutes les informations l'IA prédit des évènements ou les met en rapport via des pop-ups
-  webcams temps réel (Skaping / Vision Environnement)
-  heatmap prix essence et niveaux d'approvisionnement en temps réel
-  suivi spécifique des réserves d'eau (Nappes phréatiques, pipelines d'eau potable)