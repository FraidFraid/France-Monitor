/**
 * military-flights.js — Server-side fetch for military ADS-B data
 *
 * Sources (in priority order):
 *   1. opendata.adsb.fi /v2/mil — Open source military feed
 *   2. api.airplanes.live /v2/mil — Fallback military feed
 *   3. OpenSky Network — Fallback with military hex detection
 */

const ADSB_FI_MIL = 'https://opendata.adsb.fi/api/v2/mil';
const AIRPLANES_MIL = 'https://api.airplanes.live/v2/mil';
const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';

// France bounding box
const FRANCE_BOUNDS = {
  minLat: 41.3,
  maxLat: 51.5,
  minLon: -5.5,
  maxLon: 10.0,
};

const CACHE_TTL_MS = 30 * 1000; // 30 seconds for military data (more frequent updates)
let cachedSnapshot = null;

function normalizeSourceLabel(source) {
  if (source === 'adsb') return 'adsb.fi';
  if (source === 'opensky') return 'opensky';
  if (source === 'airplanes.live') return 'airplanes.live';
  return source || 'unknown';
}

function countAircraftBySource(aircraft) {
  return aircraft.reduce((acc, item) => {
    const label = normalizeSourceLabel(item?.source);
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
}

function buildHeaders() {
  return {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  };
}

function toNumber(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isInFranceBounds(lat, lon) {
  return (
    lat >= FRANCE_BOUNDS.minLat &&
    lat <= FRANCE_BOUNDS.maxLat &&
    lon >= FRANCE_BOUNDS.minLon &&
    lon <= FRANCE_BOUNDS.maxLon
  );
}

/**
 * Normalize aircraft from adsb.fi / airplanes.live format
 */
function normalizeAdsbAircraft(ac) {
  const lat = toNumber(ac.lat);
  const lon = toNumber(ac.lon);
  if (lat == null || lon == null) return null;
  if (!isInFranceBounds(lat, lon)) return null;

  const hex = String(ac.hex ?? '').trim().toLowerCase();
  if (!hex) return null;

  const altitude =
    ac.alt_baro === 'ground'
      ? 0
      : Math.round(toNumber(ac.alt_baro) ?? toNumber(ac.alt_geom) ?? 0);

  const onGround = ac.on_ground === true || altitude === 0;
  if (onGround) return null;

  const seenSeconds = Math.max(0, Math.round(toNumber(ac.seen) ?? 0));
  if (seenSeconds > 120) return null; // 2 minutes max age

  return {
    hex,
    callsign: String(ac.flight ?? '').trim() || undefined,
    latitude: lat,
    longitude: lon,
    altitude,
    speed: Math.round(toNumber(ac.gs) ?? 0),
    heading: Math.round(toNumber(ac.track) ?? 0),
    registration: String(ac.r ?? '').trim() || undefined,
    typeCode: String(ac.t ?? '').trim() || undefined,
    description: String(ac.desc ?? '').trim() || undefined,
    operator: String(ac.ownOp ?? '').trim() || undefined,
    squawk: String(ac.squawk ?? '').trim() || undefined,
    dbFlags: ac.dbFlags,
    lastSeen: Date.now() - seenSeconds * 1000,
    source: 'adsb.fi',
  };
}

/**
 * Normalize aircraft from OpenSky format
 */
function normalizeOpenSkyState(state) {
  if (!Array.isArray(state) || state.length < 11) return null;

  const hex = String(state[0] ?? '').trim().toLowerCase();
  const callsign = String(state[1] ?? '').trim();
  const lon = toNumber(state[5]);
  const lat = toNumber(state[6]);

  if (!hex || lat == null || lon == null) return null;
  if (!isInFranceBounds(lat, lon)) return null;

  const altitudeM = toNumber(state[13]) ?? toNumber(state[7]);
  const altitude = altitudeM != null ? Math.round(altitudeM * 3.28084) : 0;
  const onGround = state[8] === true || altitude === 0;
  if (onGround) return null;

  const speedMs = toNumber(state[9]) ?? 0;
  const lastContactSec = toNumber(state[4]);
  const lastSeen = lastContactSec != null ? lastContactSec * 1000 : Date.now();

  // Skip stale data
  if (Date.now() - lastSeen > 2 * 60 * 1000) return null;

  return {
    hex,
    callsign: callsign || undefined,
    latitude: lat,
    longitude: lon,
    altitude,
    speed: Math.round(speedMs * 1.94384), // m/s to knots
    heading: Math.round(toNumber(state[10]) ?? 0),
    squawk: state[14] ? String(state[14]) : undefined,
    lastSeen,
    source: 'opensky',
  };
}

/**
 * Fetch from adsb.fi military endpoint
 */
async function fetchAdsbFi(fetchImpl) {
  const response = await fetchImpl(ADSB_FI_MIL, {
    headers: buildHeaders(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`adsb.fi HTTP ${response.status}`);
  }

  const json = await response.json();
  const aircraft = Array.isArray(json?.ac) ? json.ac : [];
  return aircraft.map(normalizeAdsbAircraft).filter(Boolean);
}

/**
 * Fetch from airplanes.live military endpoint
 */
async function fetchAirplanesLive(fetchImpl) {
  const response = await fetchImpl(AIRPLANES_MIL, {
    headers: buildHeaders(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`airplanes.live HTTP ${response.status}`);
  }

  const json = await response.json();
  const aircraft = Array.isArray(json?.ac) ? json.ac : [];
  return aircraft.map(normalizeAdsbAircraft).filter(Boolean);
}

/**
 * Fetch from OpenSky (all aircraft, will be filtered client-side for military)
 */
async function fetchOpenSky(fetchImpl) {
  const url = `${OPENSKY_STATES_URL}?lamin=${FRANCE_BOUNDS.minLat}&lomin=${FRANCE_BOUNDS.minLon}&lamax=${FRANCE_BOUNDS.maxLat}&lomax=${FRANCE_BOUNDS.maxLon}`;

  const response = await fetchImpl(url, {
    headers: buildHeaders(),
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`OpenSky HTTP ${response.status}`);
  }

  const json = await response.json();
  const states = Array.isArray(json?.states) ? json.states : [];
  return states.map(normalizeOpenSkyState).filter(Boolean);
}

/**
 * Merge aircraft by hex, preferring newer data
 */
function mergeAircraft(aircraft) {
  const byHex = new Map();

  for (const ac of aircraft) {
    if (!ac) continue;
    const existing = byHex.get(ac.hex);
    if (!existing || ac.lastSeen > existing.lastSeen) {
      byHex.set(ac.hex, ac);
    }
  }

  return Array.from(byHex.values());
}

/**
 * Main fetch function - tries sources in order
 */
export async function fetchMilitaryFlightsSnapshot(fetchImpl = fetch) {
  const now = Date.now();
  if (cachedSnapshot && cachedSnapshot.aircraft.length > 0 && now - cachedSnapshot.fetchedAt < CACHE_TTL_MS) {
    return {
      ...cachedSnapshot,
      mode: 'live',
      isStale: false,
    };
  }

  const aircraft = [];
  const errors = [];

  // Try adsb.fi first (dedicated military endpoint)
  try {
    const adsbFlights = await fetchAdsbFi(fetchImpl);
    aircraft.push(...adsbFlights);
  } catch (error) {
    errors.push({
      source: 'adsb.fi',
      message: error instanceof Error ? error.message : 'adsb.fi fetch failed',
    });
  }

  // If adsb.fi failed or returned few results, try airplanes.live
  if (aircraft.length < 5) {
    try {
      const airplanesFlights = await fetchAirplanesLive(fetchImpl);
      aircraft.push(...airplanesFlights);
    } catch (error) {
      errors.push({
        source: 'airplanes.live',
        message: error instanceof Error ? error.message : 'airplanes.live fetch failed',
      });
    }
  }

  // If still not enough, fallback to OpenSky
  if (aircraft.length < 3) {
    try {
      const openSkyFlights = await fetchOpenSky(fetchImpl);
      aircraft.push(...openSkyFlights);
    } catch (error) {
      errors.push({
        source: 'opensky',
        message: error instanceof Error ? error.message : 'OpenSky fetch failed',
      });
    }
  }

  const mergedAircraft = mergeAircraft(aircraft);
  const sourceCounts = countAircraftBySource(mergedAircraft);
  const source = ['adsb.fi', 'airplanes.live', 'opensky']
    .filter((name) => (sourceCounts[name] ?? 0) > 0)
    .join('+') || 'none';
  const snapshot = {
    source,
    fetchedAt: now,
    ttlMs: CACHE_TTL_MS,
    aircraft: mergedAircraft,
    sourceCounts,
    errors,
    mode: mergedAircraft.length > 0 ? 'live' : 'empty',
    isStale: false,
  };

  if (snapshot.aircraft.length > 0) {
    cachedSnapshot = snapshot;
    return snapshot;
  }

  // Return stale cache if available
  if (cachedSnapshot && cachedSnapshot.aircraft.length > 0) {
    return {
      ...cachedSnapshot,
      errors: [...cachedSnapshot.errors, ...errors],
      mode: 'stale-cache',
      isStale: true,
    };
  }

  cachedSnapshot = snapshot;
  return snapshot;
}
