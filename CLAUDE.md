Voici une version réécrite, plus compacte et plus « harness‑friendly ». Tu peux la copier telle quelle dans CLAUDE.md et garder les détails fins dans MEMORY.md / docs/.

CLAUDE.md — France Monitor
Ce fichier oriente Claude Code pour travailler sur ce dépôt.

1. Projet
France Monitor est un clone français ultra‑localisé de WorldMonitor : tableau de bord de conscience situationnelle temps réel pour la France (carte 3D + PQR + état des infrastructures critiques : énergie, météo, transports, crues, pannes, finance, vols militaires).

Objectifs clés :

Vue unifiée des événements et signaux faibles, à l’échelle France / régions / métropoles.

Priorité à la lisibilité opérationnelle (OSINT / monitoring), pas aux effets graphiques.

Traitement IA local d’abord (Ollama) ; aucun PII ne doit partir vers le cloud.

Source d’inspiration principale : WorldMonitor (mêmes patterns d’architecture, sans React).

2. Stack & contraintes non négociables
Frontend
Langage : TypeScript strict, Vanilla DOM (aucun React/Vue/Angular).

Build / Dev : Vite 6+.

Carte desktop : MapLibre GL + Deck.gl.

Carte mobile fallback : D3 + SVG.

Clustering : Supercluster.

State : objet in‑memory + localStorage/IndexedDB (pas de Redux‑like).

CSS : src/styles/main.css, dark mode par défaut via variables CSS.

Backend
Pas d’Express : routes /api/* = Vercel Serverless Functions (dossier api/).

Dev : Vite plugins (src/plugins/*) qui proxifient les APIs externes.

Cache serveur : Upstash Redis (dédoublonnage cross‑users).

IA / NLP
LLM principal : Ollama (ex : mistral:instruct, llama3), exécuté localement.

Fallback chain (ordre fixe) : Ollama → Groq (cloud) → modèle browser (Transformers.js).

Classification : hybride keyword + override LLM.

Règles globales
Toujours TypeScript strict, aucun any toléré.

Vanilla TS uniquement (DOM natif, pas de JSX).

Aucune donnée personnelle envoyée à des APIs tierces ou à des LLM cloud.

3. Structure du dépôt (vue utile pour Claude)
Ne retenir que les zones suivantes (le reste peut être découvert à la demande) :

text
france-monitor/
├── api/                    # Vercel functions (prod) pour /api/*
│   ├── rss-proxy.js        # Proxy RSS (contourne CORS)
│   ├── energy/…            # Ecowatt, réseau électrique
│   ├── finance/…           # Marchés, devises
│   └── intelligence/v1/    # Résumés IA, classification
│
├── services/
│   └── scrapling-proxy/    # FastAPI + Scrapling, bypass Cloudflare pour RSS
│
├── src/
│   ├── main.ts             # Entrée Vite
│   ├── App.ts              # Orchestrateur principal (~2000 lignes)
│   ├── components/         # UI panels + cartes
│   ├── services/           # Logique métier par source (rss, ecowatt, vigicrues…)
│   ├── plugins/            # Vite dev proxies (mirroir des routes /api/*)
│   ├── config/             # Feeds, géo, infrastructure, mock data
│   ├── utils/              # Caches, URL state, helpers spatiaux
│   ├── types/index.ts      # Types partagés
│   └── styles/main.css     # Style global + dark mode
│
├── proto/                  # Contrats Protobuf (RPC client↔serveur)
├── server/                 # Handlers sebuf (RPC)
├── vite.config.ts
└── package.json
Règle de navigation pour Claude :

Pour UI → commencer par App.ts puis src/components/*.ts.

Pour accès données → src/services/*.ts puis api/*.js.

Pour sources externes → src/config/*.ts et plugins Vite associés.

4. Patterns d’architecture à respecter
Carte & géo
Coordonnées toujours au format [lng, lat].

DeckGLMap.ts = carte WebGL desktop (Deck.gl + MapLibre).

Map.ts = fallback D3/SVG mobile.

MapContainer.ts choisit dynamiquement quelle implémentation utiliser.

Services data (src/services/*.ts)
Pattern standard :

Fonction(s) async de fetch d’API externe.

Parsing + normalisation vers des types partagés (src/types/index.ts).

Circuit breaker : cooldown après plusieurs erreurs consécutives.

Cache : in‑memory +, si pertinent, persistance côté client (IndexedDB / localStorage).

Chaque nouvelle source doit :

Exposer une fonction claire du style fetchXxx() ou getXxxState().

Être consommée par un panel ou un composant explicitement identifié.

RSS & proxy
Jamais de fetch direct vers des RSS depuis le frontend.

Tous les flux passent par /api/rss-proxy (ou via scrapling-proxy si Cloudflare).

Le microservice services/scrapling-proxy ne doit whitelister que quelques domaines (PQR ciblée).

Classification & IA
classifier.ts : classification keyword rapide, filtre bruit PQR, logique déterministe.

ai-classifier.ts : override LLM asynchrone (Ollama → Groq → T5) pour les cas ambigus.

Catégories principales : social, security, energy, weather, transport, finance, health.

Niveaux de sévérité : critical, high, medium, low, info.

Principe : si le keyword classifier est suffisant, ne pas faire d’appel LLM.

5. Workflow de développement (Claude)
Règles générales
Toujours planifier avant de coder (mode Plan ou agent dédié) pour les tâches > 3 étapes.

Ne jamais marquer une tâche comme terminée sans :

npm run build

npm run typecheck

Utiliser WorldMonitor comme référence quand un pattern existe déjà (circuit breaker, fallback chain, panels complexes).

Patterns de tâches
Tâche	Pattern Claude suggéré
Nouvelle feature	Plan → Explore (code existant) → Implémentation → Build
Bug fix	Explore (root cause) → Fix ciblé → Typecheck + tests
Nouveau service data	src/services/X.ts + src/plugins/X-proxy.ts + api/X.js
Nouveau panel UI	Étendre Panel.ts, l’enregistrer dans App.ts, le relier au service correspondant
Sub‑agents (Claude Code)
Explore (read‑only) : trouver les fichiers et patterns pertinents, ne pas modifier le code.

Plan (read‑only) : proposer une architecture et un plan d’implémentation détaillé.

general‑purpose (full access) : implémenter / refactorer / corriger selon un plan validé.

Guidelines :

Donner à chaque sous‑agent le contexte minimal suffisant (fichiers, but, contraintes).

Lancer des agents en parallèle uniquement pour des tâches indépendantes (ex : créer en parallèle api/X.js, src/services/X.ts, src/plugins/X-proxy.ts).

Ne pas invoquer d’agent pour des modifications triviales (1‑2 lignes dans un fichier unique).

6. Conventions de code
TypeScript
strict: true, pas de any ni de ! non justifié.

Types partagés centralisés dans src/types/index.ts.

Composants UI = classes (héritent souvent de Panel.ts).

Services data / utilitaires = fonctions pures autant que possible.

Nommage
Composants UI : PascalCase (NewsPanel.ts, DeckGLMap.ts).

Services : kebab-case (vigilance-meteo.ts, military-flights.ts).

Types / interfaces : PascalCase.

Variables / fonctions : camelCase.

Constantes : UPPER_SNAKE_CASE.

Alias de chemin : @/* → ./src/* (tsconfig + vite).

Git
Commits : feat:, fix:, refactor:, docs:, test:.

Branches : feat/nouvelle-feature, fix/nom-bug.

7. Commandes importantes
bash
# Dev
npm run dev              # Vite (port 3001) + scrapling-proxy (port 8080)
npm run dev:vite         # Vite seul

# Scrapling (RSS Cloudflare)
npm run scrapling:install  # Setup venv + deps Python
npm run scrapling:dev      # Proxy sur :8080
npm run scrapling:docker   # Build & run Docker

# Qualité
npm run build            # tsc && vite build
npm run typecheck        # tsc --noEmit
npm run lint             # ESLint sur src/
npm run format           # Prettier sur src/**/*.ts

# Déploiement
vercel                   # Déploiement sur Vercel
Avant de conclure une tâche significative, Claude doit au minimum lancer :

bash
npm run build
npm run typecheck
8. Variables d’environnement (rappel rapide)
Voir .env.example pour la liste complète.

Obligatoires prod :

UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN

RTE_CLIENT_ID / RTE_CLIENT_SECRET

METEO_FRANCE_API_KEY

Optionnelles :

SNCF_API_KEY

GROQ_API_KEY

9. Debug & mémoire (où chercher)
Ne pas surcharger ce fichier avec l’historique de bugs.

Pour :

Cas de debug récurrents (ex : carte blanche, RSS bloqués, bruit PQR) → voir MEMORY.md ou docs/troubleshooting.md.

Leçons apprises / patterns anti‑bugs → mettre à jour MEMORY.md après chaque correction non triviale.

