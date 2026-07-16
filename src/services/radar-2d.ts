export interface Radar2dManifest {
  readonly schemaVersion: 1;
  readonly source: 'Météo-France DPRadar';
  readonly observedAt: string;
  readonly generatedAt: string;
  readonly bounds: readonly [number, number, number, number];
  readonly imageUrl: string;
  readonly resolutionMeters: 1000;
  readonly license: 'Licence Ouverte 2.0';
}

export type Radar2dResult =
  | { readonly configured: false }
  | {
      readonly configured: true;
      readonly manifest: Radar2dManifest;
      readonly degraded: boolean;
    };

const API_PATH = '/api/fire-observations/radar-2d';
const CACHE_TTL_MS = 120_000;
const FETCH_TIMEOUT_MS = 10_000;
const ISO_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

let cachedResult: Extract<Radar2dResult, { configured: true }> | null = null;
let cachedAt = 0;

function isIsoInstant(value: string): boolean {
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, fraction = ''] = match;
  const instant = new Date(0);
  instant.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  instant.setUTCHours(Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, '0')));
  return instant.getUTCFullYear() === Number(year)
    && instant.getUTCMonth() === Number(month) - 1
    && instant.getUTCDate() === Number(day)
    && instant.getUTCHours() === Number(hour)
    && instant.getUTCMinutes() === Number(minute)
    && instant.getUTCSeconds() === Number(second)
    && instant.getUTCMilliseconds() === Number(fraction.padEnd(3, '0'));
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isAllowedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHostname(url.hostname));
  } catch {
    return false;
  }
}

export function parseRadar2dManifest(value: unknown): Radar2dManifest | null {
  if (!value || typeof value !== 'object') return null;
  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== 1
    || manifest.source !== 'Météo-France DPRadar'
    || manifest.resolutionMeters !== 1000
    || manifest.license !== 'Licence Ouverte 2.0'
    || typeof manifest.observedAt !== 'string'
    || !isIsoInstant(manifest.observedAt)
    || typeof manifest.generatedAt !== 'string'
    || !isIsoInstant(manifest.generatedAt)
    || typeof manifest.imageUrl !== 'string'
    || !isAllowedImageUrl(manifest.imageUrl)
    || !Array.isArray(manifest.bounds)
    || manifest.bounds.length !== 4
    || manifest.bounds.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))
  ) return null;

  const [west, south, east, north] = manifest.bounds as number[];
  if (
    west < -180 || east > 180 || south < -90 || north > 90
    || west >= east || south >= north
  ) return null;

  return {
    schemaVersion: 1,
    source: 'Météo-France DPRadar',
    observedAt: manifest.observedAt,
    generatedAt: manifest.generatedAt,
    bounds: [west, south, east, north],
    imageUrl: manifest.imageUrl,
    resolutionMeters: 1000,
    license: 'Licence Ouverte 2.0',
  };
}

async function requestManifest(): Promise<Radar2dResult> {
  const response = await fetch(API_PATH, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Radar 2D manifest HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (
    payload
    && typeof payload === 'object'
    && (payload as Record<string, unknown>).configured === false
  ) return { configured: false };

  const manifest = parseRadar2dManifest(payload);
  if (!manifest) throw new Error('Invalid radar 2D manifest response');
  return { configured: true, manifest, degraded: false };
}

export async function fetchRadar2dManifest(force = false): Promise<Radar2dResult> {
  const now = Date.now();
  if (!force && cachedResult && now - cachedAt < CACHE_TTL_MS) return cachedResult;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await requestManifest();
      if (!result.configured) {
        cachedResult = null;
        cachedAt = 0;
        return result;
      }
      cachedResult = result;
      cachedAt = Date.now();
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  if (cachedResult) return { ...cachedResult, degraded: true };
  throw lastError instanceof Error ? lastError : new Error('Radar 2D manifest unavailable');
}
