import type { AirTrafficFlight, AirTrafficAirportScore } from '../types/index.ts';

interface AirTrafficApiResponse {
  source: string;
  fetchedAt: number;
  ttlMs: number;
  flights: AirTrafficFlight[];
  sourceCounts?: Record<string, number>;
  errors?: Array<{ area: string; message: string }>;
  anomalyCount?: number;
  signalCount?: number;
  topAirports?: AirTrafficAirportScore[];
}

const AIR_TRAFFIC_ENDPOINT = '/api/traffic/air';
const CLIENT_CACHE_TTL_MS = 5 * 1000;

let cachedSnapshot: AirTrafficApiResponse | null = null;
let cachedAt = 0;

export async function fetchAirTrafficSnapshot(): Promise<AirTrafficApiResponse> {
  const now = Date.now();
  if (cachedSnapshot && cachedSnapshot.flights.length > 0 && now - cachedAt < CLIENT_CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  // Append cache busting parameter to bypass aggressive browser caching
  const cacheBuster = `?t=${now}`;
  const response = await fetch(`${AIR_TRAFFIC_ENDPOINT}${cacheBuster}`, {
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Air traffic HTTP ${response.status}`);
  }

  const data = (await response.json()) as AirTrafficApiResponse;
  const snapshot: AirTrafficApiResponse = {
    source: data.source || 'airplanes.live+opensky',
    fetchedAt: data.fetchedAt || now,
    ttlMs: data.ttlMs || CLIENT_CACHE_TTL_MS,
    flights: Array.isArray(data.flights) ? data.flights : [],
    sourceCounts: data.sourceCounts && typeof data.sourceCounts === 'object' ? data.sourceCounts : {},
    errors: Array.isArray(data.errors) ? data.errors : [],
    anomalyCount: Number.isFinite(data.anomalyCount) ? data.anomalyCount : 0,
    signalCount: Number.isFinite(data.signalCount) ? data.signalCount : 0,
    topAirports: Array.isArray(data.topAirports) ? data.topAirports : [],
  };

  if (snapshot.flights.length > 0) {
    cachedSnapshot = snapshot;
    cachedAt = now;
  }

  return snapshot;
}

export async function fetchAirTraffic(): Promise<AirTrafficFlight[]> {
  const snapshot = await fetchAirTrafficSnapshot();
  return snapshot.flights;
}
