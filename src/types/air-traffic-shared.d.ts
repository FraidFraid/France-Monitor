declare module '../../api/_shared/air-traffic.js' {
  export interface SharedAirTrafficSnapshot {
    source: 'opensky+airplanes.live' | 'opensky' | 'airplanes.live';
    fetchedAt: number;
    ttlMs: number;
    areas: Array<{ id: string; lat: number; lon: number; radiusNm: number }>;
    flights: Array<{
      id: string;
      callsign: string;
      latitude: number;
      longitude: number;
      altitude: number;
      speed: number;
      heading: number;
      registration?: string;
      aircraftType?: string;
      aircraftModel?: string;
      operator?: string;
      category?: string;
      originAirport?: string;
      destinationAirport?: string;
      eta?: number;
      lastSeen?: number;
      onGround?: boolean;
      source: 'airplanes.live' | 'opensky';
    }>;
    errors: Array<{ area: string; message: string }>;
  }

  export function fetchAirTrafficSnapshot(fetchImpl?: typeof fetch): Promise<SharedAirTrafficSnapshot>;
}
