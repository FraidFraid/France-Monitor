import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve, dirname } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { brotliCompressSync, constants } from 'zlib';
import { VitePWA } from 'vite-plugin-pwa';

import { rssProxyPlugin } from './src/plugins/rss-proxy';
import { rssJsonProxyPlugin } from './src/plugins/rss-json-proxy';
import { jsonProxyPlugin } from './src/plugins/json-proxy';
import { sncfProxyPlugin } from './src/plugins/sncf-proxy';
import { osmRailwaysProxyPlugin } from './src/plugins/osm-railways-proxy';
import { ecowattProxyPlugin } from './src/plugins/ecowatt-proxy';
import { biogasProxyPlugin } from './src/plugins/biogas-proxy';
import { biogasSitesProxyPlugin } from './src/plugins/biogas-sites-proxy';
import { dromEnergyProxyPlugin } from './src/plugins/drom-energy-proxy';
import { eolienProxyPlugin } from './src/plugins/eolien-proxy';
import { financeProxyPlugin } from './src/plugins/finance-proxy';
import { commoditiesProxyPlugin } from './src/plugins/commodities-proxy';
import { arcepProxyPlugin } from './src/plugins/arcep-proxy';
import { healthProxyPlugin } from './src/plugins/health-proxy';
import { airTrafficProxyPlugin } from './src/plugins/air-traffic-proxy';
import { trafficRoadProxyPlugin } from './src/plugins/traffic-road-proxy';
import { trafficFlowProxyPlugin } from './src/plugins/traffic-flow-proxy';
import { trafficTileProxyPlugin } from './src/plugins/traffic-tile-proxy';
import { weatherVigilanceProxyPlugin } from './src/plugins/weather-vigilance-proxy';
import { militaryFlightsProxyPlugin } from './src/plugins/military-flights-proxy';
import { oilProxyPlugin } from './src/plugins/oil-proxy';
import { fuelPricesProxyPlugin } from './src/plugins/fuel-prices-proxy';
import { internetOutagesProxyPlugin } from './src/plugins/internet-outages-proxy';
import { infraNetworkProxyPlugin } from './src/plugins/infra-network-proxy';
import { citizenOutagesProxyPlugin } from './src/plugins/citizen-outages-proxy';
import { rteIipProxyPlugin } from './src/plugins/rte-iip-proxy';
import { firesProxyPlugin } from './src/plugins/fires-proxy';
import { elusProxyPlugin } from './src/plugins/elus-proxy';
import { synthesisProxyPlugin } from './src/plugins/synthesis-proxy';
import { franceIntelProxyPlugin } from './src/plugins/france-intel-proxy';
import { ministersProxyPlugin } from './src/plugins/ministers-proxy';
import { copernicusProxyPlugin } from './src/plugins/copernicus-proxy';
import { sentinelNdwiProxyPlugin } from './src/plugins/sentinel-ndwi-proxy';
import { nuclearProxyPlugin } from './src/plugins/nuclear-proxy';
import { gasPirProxyPlugin } from './src/plugins/gas-pir-proxy';
import gieProxyPlugin from './src/plugins/gie-proxy';
import { situationHistoryProxyPlugin } from './src/plugins/situation-history-proxy';
import { threatsProxyPlugin } from './src/plugins/threats-proxy';
import { exposureProxyPlugin } from './src/plugins/exposure-proxy';
import { newsProxyPlugin } from './src/plugins/news-proxy';
import { mtgFrpProxyPlugin } from './src/plugins/mtg-frp-proxy';
import { radar2dProxyPlugin } from './src/plugins/radar-2d-proxy';
import { startRelayServer } from './ais-relay.js';

// Brotli precompression — creates .br companion files for all JS/CSS/HTML assets.
// Vercel edge serves .br automatically when the client sends Accept-Encoding: br.
// Quality 11 = maximum compression (~60-70% smaller than gzip on JS).
const brotliPrecompressPlugin = (): Plugin => ({
  name: 'brotli-precompress',
  apply: 'build',
  generateBundle(_, bundle) {
    const compressible = /\.(js|css|html|svg|json|wasm|xml|txt)$/;
    for (const [fileName, chunk] of Object.entries(bundle)) {
      if (!compressible.test(fileName)) continue;
      const raw =
        chunk.type === 'chunk'
          ? chunk.code
          : chunk.source instanceof Uint8Array
            ? chunk.source
            : String(chunk.source);
      try {
        const compressed = brotliCompressSync(raw, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        });
        this.emitFile({ type: 'asset', fileName: `${fileName}.br`, source: compressed });
      } catch {
        // skip files that fail to compress
      }
    }
  },
});

const appVersionPlugin = (): Plugin => {
  const buildId =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.FRANCE_MONITOR_BUILD_ID ||
    String(Date.now());
  const payload = `${JSON.stringify({ version: pkg.version, buildId })}\n`;

  return {
    name: 'app-version',
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(payload);
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: payload,
      });
    },
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(readFileSync(resolve(__dirname, './package.json'), 'utf-8'));
let aisRelayStarted = false;

const aisRelayPlugin = (apiKey: string) => ({
  name: 'ais-relay-plugin',
  configureServer() {
    if (aisRelayStarted) return;
    aisRelayStarted = true;
    startRelayServer({ aisApiKey: apiKey, mode: 'development' });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const aisApiKey = env.VITE_AISSTREAM_KEY || '';

  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      rssProxyPlugin(),
      rssJsonProxyPlugin(),
      jsonProxyPlugin(),
      sncfProxyPlugin(),
      osmRailwaysProxyPlugin(),
      ecowattProxyPlugin(),
      biogasProxyPlugin(),
      biogasSitesProxyPlugin(),
      dromEnergyProxyPlugin(),
      gasPirProxyPlugin(),
      gieProxyPlugin(),
      eolienProxyPlugin(),
      financeProxyPlugin(),
      commoditiesProxyPlugin(),
      arcepProxyPlugin(),
      healthProxyPlugin(),
      airTrafficProxyPlugin(),
      trafficRoadProxyPlugin(),
      trafficFlowProxyPlugin(),
      trafficTileProxyPlugin(),
      weatherVigilanceProxyPlugin(),
      militaryFlightsProxyPlugin(),
      oilProxyPlugin(),
      fuelPricesProxyPlugin(),
      internetOutagesProxyPlugin(),
      infraNetworkProxyPlugin(),
      citizenOutagesProxyPlugin(),
      rteIipProxyPlugin(),
      firesProxyPlugin(),
      elusProxyPlugin(),
      synthesisProxyPlugin(),
      franceIntelProxyPlugin({
        groqApiKey: env.GROQ_API_KEY ?? '',
      }),
      ministersProxyPlugin(),
      copernicusProxyPlugin(),
      sentinelNdwiProxyPlugin(),
      nuclearProxyPlugin({
        clientId: env.RTE_CLIENT_ID ?? '',
        clientSecret: env.RTE_CLIENT_SECRET ?? '',
      }),
      situationHistoryProxyPlugin(),
      threatsProxyPlugin(),
      exposureProxyPlugin(),
      newsProxyPlugin({
        databaseUrl: env.DATABASE_URL ?? '',
      }),
      mtgFrpProxyPlugin(),
      radar2dProxyPlugin(env.METEO_FRANCE_RADAR_MANIFEST_URL ?? ''),
      aisRelayPlugin(aisApiKey),
      appVersionPlugin(),
      brotliPrecompressPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'data/*.geojson'],
        manifest: {
          name: 'France Monitor',
          short_name: 'FranceMonitor',
          description: "Dashboard d'intelligence et d'actualités françaises en temps réel",
          theme_color: '#0a0a0f',
          background_color: '#0a0a0f',
          display: 'standalone',
          icons: [
            {
              src: 'icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
            },
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,geojson}'],
          // Exclure les workers AI (~800 KB chacun) et les chunks lourds du precache.
          // Ils sont chargés à la demande et mis en cache via runtimeCaching.
          globIgnores: [
            '**/ai-worker-*.js',
            '**/summarization-worker-*.js',
            '**/maplibre-*.js',
            '**/onnxruntime-*.js',
            '**/transformers-*.js',
            'version.json',
            'landing/*.png',
            // GeoJSON lourds (> 3 MB) : chargés à la demande, pas au démarrage
            'data/eolien-france.geojson',
            'data/departements.geojson',
          ],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          skipWaiting: true,
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/api/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-runtime',
                networkTimeoutSeconds: 4,
                expiration: {
                  maxEntries: 80,
                  maxAgeSeconds: 10 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/basemaps\.cartocdn\.com\/.*$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'carto-basemap',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 30 * 24 * 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.(?:gstatic|googleapis)\.com\/.*$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts',
                expiration: {
                  maxEntries: 24,
                  maxAgeSeconds: 365 * 24 * 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                /^\/assets\/(?:maplibre|onnxruntime|transformers|ai-worker|summarization-worker)-.*\.(?:js|css)$/.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'lazy-assets',
                expiration: {
                  maxEntries: 32,
                  maxAgeSeconds: 30 * 24 * 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                (/^\/data\/.*\.(?:geojson|json)$/i.test(url.pathname) || /^\/assets\/.*\.geojson$/i.test(url.pathname)),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'geo-data',
                expiration: {
                  maxEntries: 32,
                  maxAgeSeconds: 24 * 60 * 60,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/about$/,
            /^\/methodology$/,
            /^\/legal$/,
            /^\/contact$/,
            /^\/docs$/,
          ],
          navigateFallback: '/index.html',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('maplibre-gl')) return 'maplibre';
            if (id.includes('node_modules/d3')) return 'd3';
            if (id.includes('@huggingface/transformers')) return 'transformers';
            if (id.includes('onnxruntime-web')) return 'onnxruntime';
            // Deck.gl ecosystem — ~750 KB, cached independently from app code.
            // Covered by the SW CacheFirst rule on lazy-assets.
            if (
              id.includes('@deck.gl') ||
              id.includes('@luma.gl') ||
              id.includes('@loaders.gl') ||
              id.includes('@math.gl')
            ) return 'deck-gl';
          },
        },
      },
    },
    server: {
      port: 3001,
      strictPort: true,
    },
  };
});
