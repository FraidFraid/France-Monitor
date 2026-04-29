import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Redis } from '@upstash/redis';

export const FUEL_PRICE_SERIES_CACHE_KEY = 'francemonitor:fuel-price-series:v1';
export const FUEL_PRICE_SERIES_MAX_DAYS = 365;

const STATIC_CACHE_PATH = path.join(process.cwd(), 'public', 'data', 'fuel-price-series.json');
const DAILY_DATASET_PATH = '/api/explore/v2.1/catalog/datasets/prix-carburants-quotidien/records';
const DAILY_DATASET_HOSTS = [
  'https://data.economie.gouv.fr',
  'https://opendatamef.opendatasoft.com',
];

const FUEL_CONFIG = {
  gazole: { dailyName: 'Gazole' },
  sp95: { dailyName: 'SP95' },
  sp98: { dailyName: 'SP98' },
  e10: { dailyName: 'E10' },
  gpl: { dailyName: 'GPLc' },
};

export function createEmptyFuelPriceSeriesCache() {
  return {
    updatedAt: new Date(0).toISOString(),
    source: 'prix-carburants-quotidien (MEF) + cache FranceMonitor',
    series: {
      gazole: [],
      sp95: [],
      sp98: [],
      e10: [],
      gpl: [],
    },
  };
}

function getRedisClient() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  return Redis.fromEnv();
}

function normalizePoint(point) {
  if (!point || typeof point.date !== 'string') return null;
  const avg = point.avg === null ? null : Number(point.avg);
  if (avg !== null && !Number.isFinite(avg)) return null;
  return {
    date: point.date.slice(0, 10),
    avg: avg === null ? null : Math.round(avg * 1000) / 1000,
  };
}

export function normalizeFuelPriceSeriesCache(raw) {
  const normalized = createEmptyFuelPriceSeriesCache();
  if (!raw || typeof raw !== 'object') return normalized;

  normalized.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : normalized.updatedAt;
  normalized.source = typeof raw.source === 'string' ? raw.source : normalized.source;

  for (const key of Object.keys(FUEL_CONFIG)) {
    const points = Array.isArray(raw.series?.[key]) ? raw.series[key] : [];
    normalized.series[key] = points
      .map(normalizePoint)
      .filter(Boolean)
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(-FUEL_PRICE_SERIES_MAX_DAYS);
  }

  return normalized;
}

export async function readFuelPriceSeriesCache() {
  const redis = getRedisClient();
  if (redis) {
    const cached = await redis.get(FUEL_PRICE_SERIES_CACHE_KEY);
    if (cached) return normalizeFuelPriceSeriesCache(cached);
  }

  try {
    const raw = await readFile(STATIC_CACHE_PATH, 'utf8');
    return normalizeFuelPriceSeriesCache(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeFuelPriceSeriesCache(payload) {
  const redis = getRedisClient();
  if (!redis) return false;
  await redis.set(FUEL_PRICE_SERIES_CACHE_KEY, normalizeFuelPriceSeriesCache(payload));
  return true;
}

function buildDailyAggregateUrl(host) {
  const params = new URLSearchParams({
    select: [
      'prix_nom',
      'avg(prix_valeur) as avg_price',
      'max(prix_maj) as latest_update',
    ].join(','),
    where: 'prix_nom in ("Gazole","SP95","SP98","E10","GPLc") and prix_valeur is not null',
    group_by: 'prix_nom',
    limit: '20',
  });

  return `${host}${DAILY_DATASET_PATH}?${params.toString()}`;
}

async function fetchJsonWithFallback(urls) {
  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status} on ${new URL(url).hostname}`);
        continue;
      }

      return response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Fuel daily dataset unavailable');
}

export async function fetchDailyFuelPriceSnapshot() {
  const payload = await fetchJsonWithFallback(DAILY_DATASET_HOSTS.map(buildDailyAggregateUrl));
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const byDailyName = new Map(rows.map((row) => [row.prix_nom, row]));
  const points = {};
  const updateCandidates = [];

  for (const [key, config] of Object.entries(FUEL_CONFIG)) {
    const row = byDailyName.get(config.dailyName);
    const avg = Number(row?.avg_price);
    points[key] = Number.isFinite(avg) ? Math.round(avg * 1000) / 1000 : null;
    if (typeof row?.latest_update === 'string') updateCandidates.push(row.latest_update);
  }

  const latestUpdate = updateCandidates.sort().at(-1) ?? new Date().toISOString();
  return {
    date: latestUpdate.slice(0, 10),
    updatedAt: latestUpdate,
    points,
  };
}

export function mergeFuelPriceSeriesCache(existingCache, snapshot) {
  const merged = normalizeFuelPriceSeriesCache(existingCache ?? createEmptyFuelPriceSeriesCache());
  merged.updatedAt = new Date().toISOString();
  merged.source = 'prix-carburants-quotidien (MEF) + cache FranceMonitor';

  for (const key of Object.keys(FUEL_CONFIG)) {
    const withoutSameDate = merged.series[key].filter((point) => point.date !== snapshot.date);
    withoutSameDate.push({
      date: snapshot.date,
      avg: snapshot.points[key],
    });
    merged.series[key] = withoutSameDate
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(-FUEL_PRICE_SERIES_MAX_DAYS);
  }

  return merged;
}

export async function refreshFuelPriceSeriesCache() {
  const existing = await readFuelPriceSeriesCache();
  const snapshot = await fetchDailyFuelPriceSnapshot();
  const merged = mergeFuelPriceSeriesCache(existing, snapshot);
  const persisted = await writeFuelPriceSeriesCache(merged);
  return { payload: merged, persisted };
}
