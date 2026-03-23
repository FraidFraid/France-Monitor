# SKILLS & PROMPTS IA — France Monitor
## (Adaptés à l'architecture réelle WorldMonitor + stratégie agents)

---

## Architecture des Skills

Chaque skill définit un **contexte de travail spécialisé** à fournir à Claude Code (ou à un agent délégué) selon la partie du projet travaillée. Calqué sur les patterns réels de WorldMonitor.

**Important** : Ce projet est en **Vanilla TypeScript** (pas de React). Tous les composants sont des classes TS qui manipulent le DOM directement.

---

## Skill 1 : Frontend / App.ts & Components (Vanilla TS)

### Fichiers concernés
`src/App.ts`, `src/components/*.ts`, `src/styles/main.css`

### Prompt à donner à l'agent
```
Tu travailles sur le projet France Monitor, un clone français de WorldMonitor.

ARCHITECTURE CRITIQUE — PAS de React :
- Vanilla TypeScript pur. Manipulation DOM directe (document.createElement, etc.)
- L'App.ts est le fichier orchestrateur principal (~1500 lignes), il gère :
  - L'initialisation de tous les panneaux et de la carte
  - Les boucles de refresh (setInterval) pour chaque source de données
  - Le state applicatif (objet JS in-memory)
  - Les event listeners
- Les composants sont des CLASSES TypeScript exportées :
  - Chaque classe crée et gère ses propres éléments DOM
  - Pattern : constructor(container: HTMLElement) → mount() → update(data) → destroy()
  - Pas de virtual DOM, pas de JSX, pas de hooks React
- CSS via un fichier main.css unique avec CSS variables pour le theming (dark mode)
- State : objet JS in-memory + localStorage pour la persistance + IndexedDB pour le cache

PATTERN DES COMPOSANTS (calqué sur WorldMonitor) :
```ts
export class NewsPanel {
  private container: HTMLElement;
  private items: NewsItem[] = [];

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'panel news-panel';
    parent.appendChild(this.container);
  }

  update(items: NewsItem[]): void {
    this.items = items;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = '';
    // ... DOM manipulation
  }

  destroy(): void {
    this.container.remove();
  }
}
```

RÈGLES :
1. JAMAIS de React, JSX, ou framework. DOM natif uniquement.
2. CSS variables pour les couleurs : var(--threat-critical), var(--bg-surface), etc.
3. Utiliser escapeHtml() pour tout contenu dynamique (prévention XSS)
4. Les panneaux sont des classes avec constructor/update/destroy
5. Responsive via CSS media queries, pas de librairie
```

### Agent recommandé : `general-purpose`

---

## Skill 2 : Carte / DeckGLMap & Map

### Fichiers concernés
`src/components/DeckGLMap.ts`, `src/components/Map.ts`, `src/components/MapContainer.ts`, `src/components/MapPopup.ts`

### Prompt à donner à l'agent
```
Tu es expert en cartographie WebGL pour le projet France Monitor.

DEUX COMPOSANTS CARTE (pattern WorldMonitor) :
1. DeckGLMap.ts — Desktop (Deck.gl v9 + MapLibre GL JS)
   - MapboxOverlay pour intégrer Deck.gl dans MapLibre
   - Layers : ScatterplotLayer, IconLayer, GeoJsonLayer, PathLayer, HeatmapLayer, TextLayer
   - Supercluster pour le clustering des points
   - Centre France : [2.2, 46.6], zoom 6
   - Style : Carto Dark Matter (fond sombre)

2. Map.ts — Mobile fallback (D3.js + SVG)
   - Projection Mercator
   - SVG avec contours départements/régions
   - Points colorés par catégorie
   - Pas de WebGL, pas de Deck.gl

3. MapContainer.ts — Choisit automatiquement :
   - isMobileDevice() → Map.ts (D3)
   - else → DeckGLMap.ts (Deck.gl)

CALQUES DECK.GL :
- NewsLayer (IconLayer) : événements actualité, icône par catégorie
- AlertLayer (ScatterplotLayer) : alertes haute gravité avec radiusScale
- EnergyLayer (GeoJsonLayer) : coloration régions par signal Ecowatt
- WeatherLayer (GeoJsonLayer) : coloration départements par alerte météo
- FloodLayer (PathLayer) : tronçons Vigicrues colorés par vigilance
- InfraLayer (IconLayer) : centrales nucléaires, barrages (zoom > 8)
- TrafficLayer (PathLayer) : axes routiers colorés

RÈGLES :
1. Coordonnées TOUJOURS en [longitude, latitude] (convention Deck.gl/MapLibre)
2. Supercluster pour clustering quand zoom < 8 et > 200 points
3. Zoom-adaptive opacity : 0.2 à zoom global → 1.0 au zoom rue
4. Label deconfliction pour les badges qui se chevauchent
5. MapPopup.ts gère le tooltip HTML au hover/click
```

### Agent recommandé : `general-purpose` (implémentation) ou `Explore` (recherche patterns WorldMonitor)

---

## Skill 3 : Backend / Vercel Serverless & Protobuf

### Fichiers concernés
`api/*.js`, `server/`, `proto/`, `api/_shared/`

### Prompt à donner à l'agent
```
Tu travailles sur le backend de France Monitor.

ARCHITECTURE BACKEND (pattern WorldMonitor) :
- PAS de Express/NestJS. Le backend = Vercel Serverless Functions (dossier api/)
- Chaque fichier dans api/ est une serverless function autonome
- En dev : des plugins Vite (dans vite.config.ts) émulent ces routes
- Cache serveur : Upstash Redis (client dans api/_shared/redis.ts)
- Contrats API : Protobuf (sebuf) dans proto/ → code généré dans src/generated/

PATTERN SERVERLESS FUNCTION :
```js
// api/energy/ecowatt.js
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  // 1. Check Redis cache
  const cached = await redis.get('ecowatt:current');
  if (cached) {
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.json(cached);
  }

  // 2. Fetch from external API
  const token = await getOAuth2Token();
  const data = await fetch('https://digital.iservices.rte-france.com/...', {
    headers: { Authorization: `Bearer ${token}` }
  });

  // 3. Cache in Redis (TTL 30min)
  await redis.setex('ecowatt:current', 1800, result);

  // 4. Return
  res.setHeader('Cache-Control', 'public, max-age=120');
  res.json(result);
}
```

PATTERN PLUGIN VITE (dev) :
```ts
function energyProxyPlugin(): Plugin {
  return {
    name: 'energy-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/energy')) return next();
        // ... fetch + cache + return
      });
    }
  };
}
```

RÈGLES :
1. Chaque serverless function : timeout < 10s (Vercel hobby limit)
2. TOUJOURS cacher dans Redis pour éviter de surcharger les API externes
3. Rate limiting respecté : RTE (100/jour), Météo-France (50/min), SNCF (90/15min)
4. Headers Cache-Control sur chaque réponse
5. Error handling : jamais de crash, retourner { error: "..." } avec status approprié
```

### Agent recommandé : `general-purpose`

---

## Skill 4 : IA / Classification & Résumé

### Fichiers concernés
`src/services/threat-classifier.ts`, `src/services/summarization.ts`, `server/francemonitor/intelligence/v1/`

### Prompt à donner à l'agent
```
Tu travailles sur le module IA de France Monitor.

CLASSIFICATION HYBRIDE (pattern WorldMonitor threat-classifier.ts) :
1. classifyByKeyword(title) → instantané, côté client
   - Dictionnaire mots-clés FR → { category, level, confidence: 0.6 }
   - Ex: "grève" → social/medium, "accident mortel" → security/high

2. classifyWithAI(title, description) → async, via serveur
   - Appel sebuf RPC → server handler → Ollama/Groq
   - Override le keyword si confidence > keyword confidence
   - Résultat : { level, category, confidence: 0.85, source: 'llm' }

FALLBACK CHAIN RÉSUMÉ (pattern WorldMonitor summarization.ts) :
1. Ollama local → timeout 5s → gratuit, privé
2. Groq cloud → timeout 5s → si GROQ_API_KEY configuré
3. Browser T5 → @xenova/transformers → toujours disponible
- Résultat Redis-cached 24h
- Circuit breaker par provider

MOTS-CLÉS FRANÇAIS :
```ts
const KEYWORD_MAP: Record<string, { category: EventCategory; level: ThreatLevel }> = {
  // Social
  'grève': { category: 'social', level: 'medium' },
  'manifestation': { category: 'social', level: 'medium' },
  'blocage': { category: 'social', level: 'high' },
  'rassemblement': { category: 'social', level: 'low' },

  // Security
  'attentat': { category: 'security', level: 'critical' },
  'fusillade': { category: 'security', level: 'critical' },
  'agression': { category: 'security', level: 'high' },
  'cambriolage': { category: 'security', level: 'medium' },
  'accident mortel': { category: 'security', level: 'high' },

  // Weather
  'tempête': { category: 'weather', level: 'high' },
  'inondation': { category: 'weather', level: 'high' },
  'canicule': { category: 'weather', level: 'medium' },
  'vigilance rouge': { category: 'weather', level: 'critical' },

  // Energy
  'coupure': { category: 'energy', level: 'high' },
  'panne': { category: 'infrastructure', level: 'medium' },
  'Ecowatt': { category: 'energy', level: 'medium' },

  // Transport
  'SNCF': { category: 'transport', level: 'low' },
  'perturbation': { category: 'transport', level: 'medium' },
  'annulation': { category: 'transport', level: 'medium' },
};
```
```

### Agent recommandé : `general-purpose`

---

## Skill 5 : Data Services / RSS & API Gouv

### Fichiers concernés
`src/services/rss.ts`, `src/services/energy.ts`, `src/services/weather.ts`, `src/services/floods.ts`, `src/services/transport.ts`, `src/services/geocoding.ts`, `src/config/feeds.ts`

### Prompt à donner à l'agent
```
Tu travailles sur les services de données de France Monitor.

PATTERN RSS (calqué sur WorldMonitor src/services/rss.ts) :
- fetchWithProxy('/api/rss-proxy?url=...') pour éviter CORS
- Parse XML avec fast-xml-parser
- Circuit breaker par flux : 2 échecs → cooldown 5min
- Cache in-memory (Map<string, { items, timestamp }>) TTL 10min
- Persistance IndexedDB via getPersistentCache/setPersistentCache
- Déduplication par URL
- Classification hybride sur chaque article
- AI classification async (rate-limited : max 80/window, 3/feed)

FEEDS FRANÇAIS (src/config/feeds.ts) :
- Utiliser le helper rss(url) pour construire l'URL proxy
- Tiers : 1=agences (AFP), 2=nationaux (Le Monde), 3=PQR (Ouest-France), 4=locaux
- Chaque feed : { name, url, type?, region?, tier }

SERVICE API PATTERN :
```ts
// src/services/energy.ts
import { dataFreshness } from './data-freshness';
import { createCircuitBreaker } from '@/utils';

const breaker = createCircuitBreaker({ name: 'Ecowatt' });

export async function fetchEcowattData(): Promise<EcowattData[]> {
  return breaker.execute(async () => {
    const res = await fetch('/api/energy/ecowatt');
    if (!res.ok) throw new Error(`Ecowatt ${res.status}`);
    const data = await res.json();
    dataFreshness.update('ecowatt');
    return data;
  }, []);  // fallback: empty array
}
```

RÈGLES :
1. Chaque service a son circuit breaker indépendant
2. dataFreshness.update() appelé après chaque fetch réussi
3. Fallback : retourner [] ou les données cachées si le fetch échoue
4. Pas de fetch direct vers les API externes côté client — toujours via /api/
```

### Agent recommandé : `general-purpose`

---

## Utilisation avec les Agents

### Commande type pour déléguer à un agent
```
"Lance un agent general-purpose avec le Skill 3.
Tâche : Crée la serverless function api/energy/ecowatt.js
qui fait le flow OAuth2 RTE, fetch Ecowatt, cache Redis 30min.
Réfère-toi à API_SOURCES.md pour les détails de l'API RTE."
```

### Parallélisation type pour une feature complète
```
En parallèle :
- Agent 1 (Skill 3) : "Crée api/weather/alerts.js"
- Agent 2 (Skill 5) : "Crée src/services/weather.ts"
- Agent 3 (Skill 2) : "Crée le WeatherLayer dans DeckGLMap.ts"
Puis :
- Agent 4 (Skill 1) : "Connecte tout dans App.ts"
- Agent 5 (Bash) : "npm run build && npm run typecheck"
```
