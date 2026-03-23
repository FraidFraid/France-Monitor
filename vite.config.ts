import { defineConfig, loadEnv } from 'vite';
import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { VitePWA } from 'vite-plugin-pwa';

import { rssProxyPlugin } from './src/plugins/rss-proxy';
import { rssJsonProxyPlugin } from './src/plugins/rss-json-proxy';
import { jsonProxyPlugin } from './src/plugins/json-proxy';
import { sncfProxyPlugin } from './src/plugins/sncf-proxy';
import { ecowattProxyPlugin } from './src/plugins/ecowatt-proxy';
import { financeProxyPlugin } from './src/plugins/finance-proxy';
import { arcepProxyPlugin } from './src/plugins/arcep-proxy';
import { healthProxyPlugin } from './src/plugins/health-proxy';
import { airTrafficProxyPlugin } from './src/plugins/air-traffic-proxy';
import { militaryFlightsProxyPlugin } from './src/plugins/military-flights-proxy';
import { oilProxyPlugin } from './src/plugins/oil-proxy';
import { internetOutagesProxyPlugin } from './src/plugins/internet-outages-proxy';
import { infraNetworkProxyPlugin } from './src/plugins/infra-network-proxy';
import { citizenOutagesProxyPlugin } from './src/plugins/citizen-outages-proxy';
import { firesProxyPlugin } from './src/plugins/fires-proxy';
import { elusProxyPlugin } from './src/plugins/elus-proxy';
import { synthesisProxyPlugin } from './src/plugins/synthesis-proxy';
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
      ecowattProxyPlugin(),
      financeProxyPlugin(),
      arcepProxyPlugin(),
      healthProxyPlugin(),
      airTrafficProxyPlugin(),
      militaryFlightsProxyPlugin(),
      oilProxyPlugin(),
      internetOutagesProxyPlugin(),
      infraNetworkProxyPlugin(),
      citizenOutagesProxyPlugin(),
      firesProxyPlugin(),
      elusProxyPlugin(),
      synthesisProxyPlugin(),
      aisRelayPlugin(aisApiKey),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['vite.svg', 'data/*.geojson'],
        manifest: {
          name: 'France Monitor',
          short_name: 'FranceMonitor',
          description: "Dashboard d'intelligence et d'actualités françaises en temps réel",
          theme_color: '#0a0a0f',
          background_color: '#0a0a0f',
          display: 'standalone',
          icons: [
            {
              src: 'vite.svg',
              sizes: 'any',
              type: 'image/svg+xml',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,geojson}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
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
    },
  };
});
