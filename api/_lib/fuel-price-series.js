import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Redis } from '@upstash/redis';

export const FUEL_PRICE_SERIES_CACHE_KEY = 'francemonitor:fuel-price-series:v1';
export const FUEL_PRICE_SERIES_MAX_DAYS = 365;

const STATIC_CACHE_PATH = path.join(process.cwd(), 'public', 'data', 'fuel-price-series.json');
const DAILY_DATASET_EXPORT_PATH = '/api/explore/v2.1/catalog/datasets/prix-carburants-quotidien/exports/csv';
const DAILY_DATASET_HOSTS = [
  'https://data.economie.gouv.fr',
  'https://opendatamef.opendatasoft.com',
];
const HISTORY_DAYS = 90;

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

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function getHistoryStartDate(days = HISTORY_DAYS) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - days);
  start.setUTCHours(0, 0, 0, 0);
  return formatDateKey(start);
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ';' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields.map((field) => field.trim());
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

function buildDailyExportUrl(host, startDate = getHistoryStartDate()) {
  const params = new URLSearchParams({
    select: 'prix_nom,prix_maj,prix_valeur',
    where: `prix_nom in ("Gazole","SP95","SP98","E10","GPLc") and prix_valeur is not null and prix_maj is not null and prix_maj >= "${startDate}"`,
    timezone: 'UTC',
    use_labels: 'false',
    delimiter: ';',
  });

  return `${host}${DAILY_DATASET_EXPORT_PATH}?${params.toString()}`;
}

async function fetchTextWithFallback(urls) {
  let lastError = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status} on ${new URL(url).hostname}`);
        continue;
      }

      return response.text();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Fuel daily CSV export unavailable');
}

function aggregateFuelPriceCsv(csvText) {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) throw new Error('Fuel daily CSV export is empty');

  const headers = parseCsvLine(lines[0]);
  const prixNomIndex = headers.indexOf('prix_nom');
  const prixMajIndex = headers.indexOf('prix_maj');
  const prixValeurIndex = headers.indexOf('prix_valeur');
  if (prixNomIndex < 0 || prixMajIndex < 0 || prixValeurIndex < 0) {
    throw new Error('Fuel daily CSV export schema changed');
  }

  const fuelByDailyName = new Map(Object.entries(FUEL_CONFIG).map(([key, config]) => [config.dailyName, key]));
  const buckets = new Map();
  const updateCandidates = [];

  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    const fuelKey = fuelByDailyName.get(fields[prixNomIndex]);
    if (!fuelKey) continue;

    const timestamp = fields[prixMajIndex];
    const date = timestamp.slice(0, 10);
    const price = Number.parseFloat(fields[prixValeurIndex]?.replace(',', '.') ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(price)) continue;

    const bucketKey = `${fuelKey}:${date}`;
    const bucket = buckets.get(bucketKey) ?? { fuelKey, date, sum: 0, count: 0 };
    bucket.sum += price;
    bucket.count += 1;
    buckets.set(bucketKey, bucket);
    updateCandidates.push(timestamp);
  }

  const payload = createEmptyFuelPriceSeriesCache();
  payload.updatedAt = updateCandidates.sort().at(-1) ?? new Date().toISOString();

  for (const bucket of buckets.values()) {
    payload.series[bucket.fuelKey].push({
      date: bucket.date,
      avg: Math.round((bucket.sum / bucket.count) * 1000) / 1000,
    });
  }

  for (const key of Object.keys(FUEL_CONFIG)) {
    payload.series[key].sort((left, right) => left.date.localeCompare(right.date));
  }

  return normalizeFuelPriceSeriesCache(payload);
}

export async function fetchHistoricalFuelPriceSeries(days = HISTORY_DAYS) {
  const startDate = getHistoryStartDate(days);
  const csvText = await fetchTextWithFallback(DAILY_DATASET_HOSTS.map((host) => buildDailyExportUrl(host, startDate)));
  return aggregateFuelPriceCsv(csvText);
}

export async function refreshFuelPriceSeriesCache() {
  // Cron path: refresh every few hours, but public reads stay cache-only.
  // If MEF/OpenDataSoft fails, this function throws before writing and the previous cache remains active.
  const payload = await fetchHistoricalFuelPriceSeries(HISTORY_DAYS);
  const persisted = await writeFuelPriceSeriesCache(payload);
  return { payload, persisted };
}
