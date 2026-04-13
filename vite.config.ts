import { defineConfig, loadEnv } from 'vite';
import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { VitePWA } from 'vite-plugin-pwa';

import { rssProxyPlugin } from './src/plugins/rss-proxy';
import { rssJsonProxyPlugin } from './src/plugins/rss-json-proxy';
import { jsonProxyPlugin } from './src/plugins/json-proxy';
import { sncfProxyPlugin } from './src/plugins/sncf-proxy';
import { osmRailwaysProxyPlugin } from './src/plugins/osm-railways-proxy';
import { ecowattProxyPlugin } from './src/plugins/ecowatt-proxy';
import { eolienProxyPlugin } from './src/plugins/eolien-proxy';
import { financeProxyPlugin } from './src/plugins/finance-proxy';
import { commoditiesProxyPlugin } from './src/plugins/commodities-proxy';
import { arcepProxyPlugin } from './src/plugins/arcep-proxy';
import { healthProxyPlugin } from './src/plugins/health-proxy';
import { airTrafficProxyPlugin } from './src/plugins/air-traffic-proxy';
import { trafficRoadProxyPlugin } from './src/plugins/traffic-road-proxy';
import { militaryFlightsProxyPlugin } from './src/plugins/military-flights-proxy';
import { oilProxyPlugin } from './src/plugins/oil-proxy';
import { fuelPricesProxyPlugin } from './src/plugins/fuel-prices-proxy';
import { internetOutagesProxyPlugin } from './src/plugins/internet-outages-proxy';
import { infraNetworkProxyPlugin } from './src/plugins/infra-network-proxy';
import { citizenOutagesProxyPlugin } from './src/plugins/citizen-outages-proxy';
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
import { startRelayServer } from './ais-relay.js';

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
      gasPirProxyPlugin(),
      gieProxyPlugin(),
      eolienProxyPlugin(),
      financeProxyPlugin(),
      commoditiesProxyPlugin(),
      arcepProxyPlugin(),
      healthProxyPlugin(),
      airTrafficProxyPlugin(),
      trafficRoadProxyPlugin(),
      militaryFlightsProxyPlugin(),
      oilProxyPlugin(),
      fuelPricesProxyPlugin(),
      internetOutagesProxyPlugin(),
      infraNetworkProxyPlugin(),
      citizenOutagesProxyPlugin(),
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
      aisRelayPlugin(aisApiKey),
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
            // GeoJSON lourds (> 3 MB) : chargés à la demande, pas au démarrage
            'data/eolien-france.geojson',
            'data/departements.geojson',
          ],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          skipWaiting: true,
          runtimeCaching: [
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
          ],
          navigateFallbackDenylist: [/^\/api\//],
          navigateFallback: '/offline.html',
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
            if (id.includes('@xenova/transformers')) return 'transformers';
            if (id.includes('onnxruntime-web')) return 'onnxruntime';
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
