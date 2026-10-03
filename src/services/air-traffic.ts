import type { AirTrafficFlight, AirTrafficAirportScore } from '../types/index.ts';
import { dedupe } from '../utils/inflight.ts';

// Positions de la carte : plus de source Watchdog (elle datait « Trafic aérien » à l'heure de lecture et écrasait toutes les 30 s
// la ligne datée par l'aperçu du panneau, spec 2026-10-03 trafics S1). App.ts tient la ligne « Positions aériennes (carte) »,
// datée par `fetchedAt` (heure des états OpenSky servis par /api/traffic/air).

export interface AirTrafficApiResponse {
  source: string;
  /** Heure des états OpenSky servis (ms) ; null si le serveur ne la donne pas, jamais l'heure de lecture. */
  fetchedAt: number | null;
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

  // Single-flight : le layer trafic aérien est repollé toutes les 12 s et
  // peut aussi être déclenché en warm-up — un appel concurrent partage la
  // requête en cours plutôt que d'en doubler une (constaté : 4 appels
  // `/api/traffic/air` par chargement, 10,5 s chacun côté MISS amont).
  return dedupe('air-traffic-snapshot', () => fetchAirTrafficSnapshotUncached(now));
}

async function fetchAirTrafficSnapshotUncached(now: number): Promise<AirTrafficApiResponse> {
  // Le serveur pose déjà `s-maxage=20` (voir api/traffic/air.js) : un cache
  // buster `?t=` annulait ce cache CDN pour chaque visiteur. Le TTL client
  // ci-dessus (5 s) et le cache CDN amont suffisent, plus de contournement.
  const response = await fetch(AIR_TRAFFIC_ENDPOINT, {
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`Air traffic HTTP ${response.status}`);

  const data = (await response.json()) as AirTrafficApiResponse;
  const snapshot: AirTrafficApiResponse = {
    source: data.source || 'airplanes.live+opensky',
    fetchedAt: typeof data.fetchedAt === 'number' && Number.isFinite(data.fetchedAt) ? data.fetchedAt : null,
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
