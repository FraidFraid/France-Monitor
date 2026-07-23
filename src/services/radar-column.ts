/**
 * Profil vertical radar (colonne PAM) — parseur strict partagé entre le
 * service client et le plugin de dev. Le proxy edge
 * api/fire-observations/radar-column.js est le MIROIR JS de cette
 * validation : toute évolution se fait dans les deux fichiers.
 */
import type { RadarColumnLevel, RadarColumnProfile, RadarColumnResult } from '../types/index.ts';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MAX_LEVELS = 16;

const CACHE_TTL_MS = 120_000;
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60_000;
const ENDPOINT = '/api/fire-observations/radar-column';

interface CacheEntry {
  readonly at: number;
  readonly result: RadarColumnResult;
}

let cache = new Map<string, CacheEntry>();
let consecutiveFailures = 0;
let breakerOpenedAt = 0;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseLevel(value: unknown): RadarColumnLevel | null {
  if (value === null || typeof value !== 'object') return null;
  const level = value as Record<string, unknown>;
  const { elevationDeg, altitudeM, dbz } = level;
  if (!isFiniteNumber(elevationDeg) || elevationDeg < 0 || elevationDeg > 90) return null;
  if (!isFiniteNumber(altitudeM) || altitudeM < 0 || altitudeM > 30_000) return null;
  if (dbz !== null && (!isFiniteNumber(dbz) || dbz < -35 || dbz > 80)) return null;
  return { elevationDeg, altitudeM, dbz: dbz as number | null };
}

export function _resetRadarColumnStateForTests(): void {
  cache = new Map();
  consecutiveFailures = 0;
  breakerOpenedAt = 0;
}

function cacheKey(lat: number, lon: number): string {
  // ~1 km de granularité : suffisant pour un centroïde d'incident.
  return `${lat.toFixed(2)}|${lon.toFixed(2)}`;
}

export async function fetchRadarColumn(
  lat: number,
  lon: number,
  fetchImplementation: typeof fetch = fetch
): Promise<RadarColumnResult | null> {
  const now = Date.now();
  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.result;
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    if (now - breakerOpenedAt < BREAKER_COOLDOWN_MS) return null;
    consecutiveFailures = 0; // demi-ouverture : une tentative
  }
  try {
    const response = await fetchImplementation(
      `${ENDPOINT}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (response.status === 404) {
      const result: RadarColumnResult = { kind: 'hors-couverture' };
      cache.set(key, { at: now, result });
      consecutiveFailures = 0;
      return result;
    }
    if (!response.ok) throw new Error(`radar column HTTP ${response.status}`);
    const profile = parseRadarColumnProfile((await response.json()) as unknown);
    if (profile === null) throw new Error('radar column payload rejected');
    const result: RadarColumnResult = { kind: 'profile', profile };
    cache.set(key, { at: now, result });
    consecutiveFailures = 0;
    return result;
  } catch {
    consecutiveFailures += 1;
    if (consecutiveFailures >= BREAKER_THRESHOLD) breakerOpenedAt = now;
    return null;
  }
}

export function parseRadarColumnProfile(value: unknown): RadarColumnProfile | null {
  if (value === null || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) return null;
  if (raw.source !== 'Météo-France DPRadar') return null;
  if (raw.license !== 'Licence Ouverte 2.0') return null;
  if (typeof raw.observedAt !== 'string' || !ISO_INSTANT.test(raw.observedAt)) return null;
  if (!isFiniteNumber(raw.distanceKm) || raw.distanceKm < 0 || raw.distanceKm > 200) return null;
  const station = raw.station as Record<string, unknown> | null;
  if (
    station === null || typeof station !== 'object'
    || !isFiniteNumber(station.id) || !Number.isInteger(station.id)
    || typeof station.name !== 'string' || station.name.length === 0 || station.name.length > 40
    || !isFiniteNumber(station.lat) || station.lat < 41 || station.lat > 52
    || !isFiniteNumber(station.lon) || station.lon < -6 || station.lon > 10
  ) return null;
  if (!Array.isArray(raw.levels) || raw.levels.length > MAX_LEVELS) return null;
  const levels: RadarColumnLevel[] = [];
  for (const entry of raw.levels) {
    const level = parseLevel(entry);
    if (level === null) return null;
    if (levels.length > 0 && level.altitudeM < levels[levels.length - 1].altitudeM) return null;
    levels.push(level);
  }
  return {
    schemaVersion: 1,
    source: 'Météo-France DPRadar',
    license: 'Licence Ouverte 2.0',
    station: {
      id: station.id,
      name: station.name,
      lat: station.lat,
      lon: station.lon,
    },
    distanceKm: raw.distanceKm,
    observedAt: raw.observedAt,
    levels,
  };
}
