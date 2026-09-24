import type { AirTrafficFlight, AirTrafficAirportScore } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';
import { dedupe } from '../utils/inflight.ts';

// ── Watchdog registration ──
Watchdog.register('air-traffic', {
    label: 'Trafic aérien',
    staleAfterMs: 30 * 1000,
    detail: 'airplanes.live + OpenSky · source publique limitée',
});

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

  // Single-flight : le layer trafic aérien est repollé toutes les 12 s et
  // peut aussi être déclenché en warm-up — un appel concurrent partage la
  // requête en cours plutôt que d'en doubler une (constaté : 4 appels
  // `/api/traffic/air` par chargement, 10,5 s chacun côté MISS amont).
  return dedupe('air-traffic-snapshot', () => fetchAirTrafficSnapshotUncached(now));
}

async function fetchAirTrafficSnapshotUncached(now: number): Promise<AirTrafficApiResponse> {
  Watchdog.report('air-traffic', { type: 'loading' });
  const t0 = Date.now();

  // Le serveur pose déjà `s-maxage=20` (voir api/traffic/air.js) : un cache
  // buster `?t=` annulait ce cache CDN pour chaque visiteur. Le TTL client
  // ci-dessus (5 s) et le cache CDN amont suffisent, plus de contournement.
  try {
    const response = await fetch(AIR_TRAFFIC_ENDPOINT, {
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      Watchdog.report('air-traffic', { type: 'failure', error: `HTTP ${response.status}`, isFallback: !!cachedSnapshot });
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

    Watchdog.report('air-traffic', { type: 'success', responseTimeMs: Date.now() - t0 });
    return snapshot;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Don't double-report if already reported above
    if (!msg.startsWith('Air traffic HTTP')) {
      Watchdog.report('air-traffic', { type: 'failure', error: msg, isFallback: !!cachedSnapshot });
    }
    throw err;
  }
}

export async function fetchAirTraffic(): Promise<AirTrafficFlight[]> {
  const snapshot = await fetchAirTrafficSnapshot();
  return snapshot.flights;
}
