# STACK TECHNIQUE & DÉPENDANCES — France Monitor
## (Calquée sur le vrai package.json de WorldMonitor)

---

## package.json

```json
{
  "name": "france-monitor",
  "private": true,
  "version": "0.1.0",
  "license": "AGPL-3.0-only",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "typecheck": "tsc --noEmit",
    "preview": "vite preview",
    "test:data": "node --test tests/*.test.mjs",
    "test:e2e": "playwright test",
    "gen:proto": "buf generate",
    "lint": "eslint src/ --ext .ts",
    "format": "prettier --write 'src/**/*.ts'"
  },
  "dependencies": {
    "@deck.gl/aggregation-layers": "^9.2.0",
    "@deck.gl/core": "^9.2.0",
    "@deck.gl/geo-layers": "^9.2.0",
    "@deck.gl/layers": "^9.2.0",
    "@deck.gl/mapbox": "^9.2.0",
    "@upstash/redis": "^1.36.0",
    "@xenova/transformers": "^2.17.0",
    "d3": "^7.9.0",
    "deck.gl": "^9.2.0",
    "fast-xml-parser": "^5.3.0",
    "i18next": "^25.8.0",
    "i18next-browser-languagedetector": "^8.2.0",
    "maplibre-gl": "^5.16.0",
    "onnxruntime-web": "^1.23.0",
    "supercluster": "^8.0.0",
    "topojson-client": "^3.1.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "@types/d3": "^7.4.0",
    "@types/maplibre-gl": "^1.13.0",
    "@types/supercluster": "^7.1.0",
    "@types/topojson-client": "^3.1.0",
    "@types/topojson-specification": "^1.0.0",
    "esbuild": "^0.27.0",
    "eslint": "^8.57.0",
    "prettier": "^3.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vite-plugin-pwa": "^1.2.0"
  }
}
```

---

## Mapping WorldMonitor → France Monitor

| Dépendance WorldMonitor | Gardé ? | Usage France Monitor |
|---|---|---|
| `deck.gl` + `@deck.gl/*` | ✅ Oui | Calques carte (identique) |
| `maplibre-gl` | ✅ Oui | Moteur carte (identique) |
| `d3` | ✅ Oui | Fallback SVG mobile + graphiques |
| `topojson-client` | ✅ Oui | GeoJSON départements/régions |
| `fast-xml-parser` | ✅ Oui | Parse RSS XML |
| `@upstash/redis` | ✅ Oui | Cache serverless (Vercel) |
| `@xenova/transformers` | ✅ Oui | ML browser fallback (T5) |
| `onnxruntime-web` | ✅ Oui | Runtime ML navigateur |
| `i18next` | ✅ Oui | i18n (FR/EN) |
| `supercluster` | ✅ Ajouté | Clustering des points carte |
| `@sentry/browser` | ❌ Non (Phase 5+) | Pas critique au départ |
| `@vercel/analytics` | ❌ Non | Pas nécessaire |
| `convex` | ❌ Non | Pas de waitlist/community |
| `posthog-js` | ❌ Non | Pas d'analytics |
| `youtubei.js` | ❌ Non | Pas de live webcams |
| `ws` | ❌ Non | Pas de WebSocket (Vigicrues est REST) |

---

## Configuration Files

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "server"],
  "exclude": ["node_modules", "dist"]
}
```

### `vite.config.ts` (structure)
```ts
// Plugins custom (pattern WorldMonitor) :
// 1. rssProxyPlugin()     — Proxy les flux RSS en dev
// 2. apiProxyPlugin()     — Proxy les API gouv en dev
// 3. sebufApiPlugin()     — Routes Protobuf RPC en dev
// 4. brotliPrecompressPlugin() — Compression Brotli en build

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [rssProxyPlugin(), apiProxyPlugin(), sebufApiPlugin(), brotliPrecompressPlugin(), VitePWA({...})],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Identique au pattern WorldMonitor :
          // maplibre, deck-stack, d3, topojson, transformers, onnxruntime, i18n
        }
      }
    }
  },
  server: {
    port: 3000,
    proxy: {
      // Proxies API gouv françaises en dev
    }
  }
});
```

### `vercel.json`
```json
{
  "rewrites": [
    { "source": "/api/rss-proxy", "destination": "/api/rss-proxy" },
    { "source": "/api/energy/(.*)", "destination": "/api/energy/$1" },
    { "source": "/api/weather/(.*)", "destination": "/api/weather/$1" },
    { "source": "/api/floods/(.*)", "destination": "/api/floods/$1" },
    { "source": "/api/transport/(.*)", "destination": "/api/transport/$1" },
    { "source": "/api/geocode", "destination": "/api/geocode" },
    { "source": "/api/francemonitor/(.*)", "destination": "/api/francemonitor/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=120" },
        { "key": "Access-Control-Allow-Origin", "value": "*" }
      ]
    }
  ]
}
```

### `.prettierrc`
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

---

## Outils Externes Requis

| Outil | Version | Usage | Installation |
|---|---|---|---|
| **Node.js** | 20 LTS | Runtime | `nvm install 20` |
| **Ollama** | 0.3+ | LLM local | `curl -fsSL https://ollama.com/install.sh \| sh` |
| **Mistral** | mistral:instruct | Extraction entités | `ollama pull mistral:instruct` |
| **Vercel CLI** | latest | Déploiement | `npm i -g vercel` |
| **buf** | latest | Protobuf generation | `npm i -g @bufbuild/buf` |

---

## Comptes / Inscriptions

| Service | URL | Ce qu'on obtient | Obligatoire ? |
|---|---|---|---|
| **Vercel** | vercel.com | Hébergement + serverless | ✅ Oui |
| **Upstash Redis** | upstash.com | Cache Redis serverless | ✅ Oui (gratuit) |
| **RTE (Ecowatt)** | data.rte-france.com | client_id + client_secret | ✅ Oui |
| **Météo-France** | portail-api.meteofrance.fr | API Key | ✅ Oui |
| **SNCF** | data.sncf.com | API Key | ⚠️ Phase 2+ |
| **Groq** | console.groq.com | API Key (fallback IA) | ❌ Optionnel |

---

## `.env.example`
```env
# ═══ Obligatoire ═══
# Upstash Redis (cache serverless)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# RTE (Ecowatt / Eco2mix)
RTE_CLIENT_ID=
RTE_CLIENT_SECRET=

# Météo-France
METEO_FRANCE_API_KEY=

# ═══ Optionnel ═══
# SNCF
SNCF_API_KEY=

# Groq (fallback IA cloud)
GROQ_API_KEY=

# Ollama (local, pas besoin de clé)
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=mistral:instruct
```
