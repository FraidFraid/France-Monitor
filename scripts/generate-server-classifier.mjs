/**
 * generate-server-classifier.mjs — Génère les copies serveur (JS, Node 18+) des
 * modules TS browser, via esbuild (même pattern que api/_shared/*-snapshot.js) :
 *
 *   src/services/classifier.ts  →  api/_lib/server-classifier.js
 *   src/services/geocoder.ts +
 *   src/config/geo.ts           →  api/_lib/server-geocoder.js
 *
 * Pourquoi pas un import direct depuis api/ingest/news.ts ?
 * - geocoder.ts importe `idb` (browser-only) → stub esbuild requis ;
 * - le bundling garantit zéro dépendance src/ au runtime Vercel.
 * La source de vérité RESTE src/services/*.ts : ne jamais éditer les fichiers
 * générés, relancer ce script après toute modification du classifier/geocoder :
 *
 *   npm run generate:server-libs
 */

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Version du classifier keyword — bump si la logique de src/services/classifier.ts change de sémantique. */
const CLASSIFIER_VERSION = 'kw-1';

const BANNER = (source) => `/**
 * GENERATED FILE — DO NOT EDIT.
 * Généré par scripts/generate-server-classifier.mjs depuis ${source}.
 * Régénération : npm run generate:server-libs
 */`;

const CLASSIFIER_ENTRY = `
export { classifyByKeywords, detectEntities, isFaitDiversNoise, isDomesticAccident } from './src/services/classifier.ts';
import { classifyByKeywords } from './src/services/classifier.ts';

export const CLASSIFIER_VERSION = ${JSON.stringify(CLASSIFIER_VERSION)};

/**
 * API serveur : classification keyword d'un item news.
 * Retourne toujours un résultat ({category, severity, confidence}) —
 * fallback general/info si aucun mot-clé ne matche.
 */
export function classify(title: string, description?: string): { category: string; severity: string; confidence: number } {
  const result = classifyByKeywords(title, description);
  if (!result) {
    return { category: 'general', severity: 'info', confidence: 0.2 };
  }
  return { category: result.category, severity: result.level, confidence: result.confidence };
}
`;

const GEOCODER_ENTRY = `
import { extractLocations } from './src/services/geocoder.ts';
import { CITIES, REGIONS } from './src/config/geo.ts';

export { extractLocations };

export interface ServerGeoResult {
  lat: number;
  lon: number;
  locationName: string;
  confidence: number;
  source: string;
}

// Cache in-memory (remplace IndexedDB, browser-only) — persiste le temps de vie
// de l'instance serverless, suffisant pour dédupliquer au sein d'un tick.
const geoCache = new Map<string, ServerGeoResult | null>();

const GEOCODE_TIMEOUT_MS = 3000;

function norm(value: string): string {
  return value.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').trim().toLowerCase();
}

interface AdresseResponse {
  features?: Array<{
    geometry: { coordinates: [number, number] };
    properties: { label: string; score: number; city?: string };
  }>;
}

async function fetchAdresse(query: string, municipalityOnly: boolean): Promise<AdresseResponse | null> {
  const typeFilter = municipalityOnly ? '&type=municipality' : '';
  const url = 'https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(query) + '&limit=1' + typeFilter;
  const resp = await fetch(url, { signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS) });
  if (!resp.ok) return null;
  return await resp.json() as AdresseResponse;
}

/**
 * Géocode une requête : villes connues → régions → API Adresse Gouv (timeout 3 s).
 * Best-effort : retourne null si introuvable ou en erreur. Résultats mis en cache.
 */
export async function geocodeQuery(query: string): Promise<ServerGeoResult | null> {
  const key = norm(query);
  if (geoCache.has(key)) return geoCache.get(key) ?? null;

  for (const [cityName, [lon, lat]] of Object.entries(CITIES)) {
    if (norm(cityName) === key) {
      const result: ServerGeoResult = { lat, lon, locationName: cityName, confidence: 1.0, source: 'cities' };
      geoCache.set(key, result);
      return result;
    }
  }

  for (const region of Object.values(REGIONS)) {
    if (norm(region.name) === key) {
      const result: ServerGeoResult = {
        lat: region.center[1],
        lon: region.center[0],
        locationName: region.name,
        confidence: 0.9,
        source: 'regions',
      };
      geoCache.set(key, result);
      return result;
    }
  }

  try {
    let data = await fetchAdresse(query, true);
    if (!data?.features?.length) {
      data = await fetchAdresse(query, false);
    }
    if (!data?.features?.length) {
      geoCache.set(key, null);
      return null;
    }
    const feat = data.features[0];
    const [lon, lat] = feat.geometry.coordinates;
    const result: ServerGeoResult = {
      lat,
      lon,
      locationName: feat.properties.city ?? feat.properties.label,
      confidence: feat.properties.score,
      source: 'api-adresse',
    };
    geoCache.set(key, result);
    return result;
  } catch {
    geoCache.set(key, null);
    return null;
  }
}

/**
 * Géocode un item news : extraction de lieux depuis le titre (mêmes heuristiques
 * que src/services/geocoder.ts), puis fallback région du feed (confiance 0.3).
 */
export async function geocodeNewsItem(title: string, feedRegion?: string | null): Promise<ServerGeoResult | null> {
  const locations = extractLocations(title);
  for (const loc of locations) {
    const result = await geocodeQuery(loc);
    if (result && result.confidence > 0.4) return result;
  }
  if (feedRegion) {
    const result = await geocodeQuery(feedRegion);
    if (result) return { ...result, confidence: 0.3, source: 'region-fallback' };
  }
  return null;
}
`;

async function bundleEntry(entryContents, outfile, sourceLabel) {
  await build({
    stdin: {
      contents: entryContents,
      loader: 'ts',
      resolveDir: ROOT,
      sourcefile: `generated-entry-${path.basename(outfile)}.ts`,
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node18'],
    outfile,
    banner: { js: BANNER(sourceLabel) },
    alias: {
      // idb est browser-only ; jamais appelé côté serveur (garde typeof window).
      idb: path.join(ROOT, 'scripts/fixtures/idb-stub.mjs'),
    },
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    logLevel: 'warning',
  });
  console.log(`[generate-server-libs] wrote ${path.relative(ROOT, outfile)}`);
}

await bundleEntry(
  CLASSIFIER_ENTRY,
  path.join(ROOT, 'api/_lib/server-classifier.js'),
  'src/services/classifier.ts',
);

await bundleEntry(
  GEOCODER_ENTRY,
  path.join(ROOT, 'api/_lib/server-geocoder.js'),
  'src/services/geocoder.ts + src/config/geo.ts',
);

console.log('[generate-server-libs] done');
