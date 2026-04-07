import { FRANCE_AIRPORTS, matchFranceAirport } from './airports-fr.js';

const AIRPLANES_LIVE_POINT_BASE = 'https://api.airplanes.live/v2/point';
const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const CACHE_TTL_MS = 20 * 1000;
const OFFICIAL_AIRPORT_CACHE_TTL_MS = 10 * 60 * 1000;
const FLIGHT_HISTORY_TTL_MS = 20 * 60 * 1000;
const MAX_HISTORY_SAMPLES = 12;
const FRANCE_BOUNDS = {
  minLat: 41.0,
  maxLat: 51.8,
  minLon: -5.8,
  maxLon: 10.2,
};

const AIR_TRAFFIC_AREAS = [
  { id: 'northwest', lat: 48.9, lon: -2.4, radiusNm: 240 },
  { id: 'northeast', lat: 48.9, lon: 4.8, radiusNm: 240 },
  { id: 'center', lat: 46.5, lon: 2.5, radiusNm: 240 },
  { id: 'southwest', lat: 44.4, lon: -0.9, radiusNm: 240 },
  { id: 'southeast', lat: 43.9, lon: 5.7, radiusNm: 240 },
];

let cachedSnapshot = null;
let cachedOpenSkyToken = null;
const cachedOfficialFlightDirectories = new Map();
const flightHistory = new Map();

// ── Rate-limit backoff tracker (warm-instance protection) ──
const rateLimitedUntil = new Map(); // source → timestamp
const RATE_LIMIT_BACKOFF_MS = 60_000; // 1 min cooldown after 429

function isRateLimited(source) {
  const until = rateLimitedUntil.get(source);
  if (!until) return false;
  if (Date.now() < until) return true;
  rateLimitedUntil.delete(source);
  return false;
}

function markRateLimited(source) {
  rateLimitedUntil.set(source, Date.now() + RATE_LIMIT_BACKOFF_MS);
  console.warn(`[air-traffic] ${source} rate-limited, backoff ${RATE_LIMIT_BACKOFF_MS / 1000}s`);
}

const OFFICIAL_AIRPORT_PROVIDERS = {
  BVA: {
    airportIata: 'BVA',
    airportName: 'Paris Beauvais',
    urls: ['https://www.aeroportparisbeauvais.com/en/flights/live-flight-information/find-your-flight'],
  },
  BOD: {
    airportIata: 'BOD',
    airportName: 'Bordeaux Merignac',
    urls: [
      'https://www.bordeaux.aeroport.fr/vols-destinations/arrivees-departs-du-jour',
      'https://www.bordeaux.aeroport.fr/vols-destinations/arrivees-departs-du-jour?w=out',
    ],
  },
};

const CALLSIGN_OPERATOR_HINTS = {
  AFR: { commercialCode: 'AF', operator: 'Air France' },
  RYR: { commercialCode: 'FR', operator: 'Ryanair' },
  TVF: { commercialCode: 'TO', operator: 'Transavia France' },
  VLG: { commercialCode: 'VY', operator: 'Vueling' },
  VOE: { commercialCode: 'V7', operator: 'Volotea' },
  EZY: { commercialCode: 'U2', operator: 'easyJet' },
  EJU: { commercialCode: 'EJU', operator: 'easyJet' },
  IBE: { commercialCode: 'IB', operator: 'Iberia' },
  KLM: { commercialCode: 'KL', operator: 'KLM' },
};

function getOpenSkyCredentials() {
  const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function buildGenericHeaders() {
  return {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  };
}

async function fetchOpenSkyAccessToken(fetchImpl) {
  const credentials = getOpenSkyCredentials();
  if (!credentials) return null;

  const now = Date.now();
  if (cachedOpenSkyToken && cachedOpenSkyToken.expiresAt > now + 30_000) {
    return cachedOpenSkyToken.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });

  const response = await fetchImpl(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`OpenSky token HTTP ${response.status}`);
  }

  const json = await response.json();
  const accessToken = typeof json?.access_token === 'string' ? json.access_token : '';
  const expiresIn = Number(json?.expires_in);
  if (!accessToken) {
    throw new Error('OpenSky token missing access_token');
  }

  cachedOpenSkyToken = {
    accessToken,
    expiresAt: now + (Number.isFinite(expiresIn) ? expiresIn : 300) * 1000,
  };
  return accessToken;
}

async function buildOpenSkyHeaders(fetchImpl) {
  const headers = buildGenericHeaders();
  const accessToken = await fetchOpenSkyAccessToken(fetchImpl);
  if (!accessToken) return headers;

  return {
    ...headers,
    Authorization: `Bearer ${accessToken}`,
  };
}

function toNumber(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeCallsign(value, fallback) {
  const trimmed = String(value ?? '').trim();
  return trimmed || fallback;
}

function normalizeText(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || undefined;
}

function normalizeFlightDesignator(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function getCallsignOperatorHint(value) {
  const normalized = normalizeFlightDesignator(value);
  if (normalized.length < 3) return null;
  return CALLSIGN_OPERATOR_HINTS[normalized.slice(0, 3)] ?? null;
}

function deriveFlightLookupKeys(value) {
  const normalized = normalizeFlightDesignator(value);
  if (!normalized) return [];

  const keys = new Set([normalized]);
  const hint = getCallsignOperatorHint(normalized);
  if (hint && normalized.length > 3) {
    const suffix = normalized.slice(3);
    if (/^\d+$/.test(suffix)) {
      keys.add(`${hint.commercialCode}${suffix}`);
    }
  }

  return Array.from(keys);
}

function normalizeOperatorName(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-f]+);/gi, (_, num) => String.fromCharCode(parseInt(num, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&eacute;/gi, 'e')
    .replace(/&egrave;/gi, 'e')
    .replace(/&ecirc;/gi, 'e')
    .replace(/&agrave;/gi, 'a')
    .replace(/&acirc;/gi, 'a')
    .replace(/&ocirc;/gi, 'o')
    .replace(/&uuml;/gi, 'u')
    .replace(/&ccedil;/gi, 'c');
}

function stripHtml(value) {
  return decodeHtmlEntities(
    String(value ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function normalizeEta(value) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.round(value) : Math.round(value * 1000);
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber > 1e12 ? Math.round(asNumber) : Math.round(asNumber * 1000);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatParisDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function getParisMinutesOfDay(epochMs = Date.now()) {
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [hours, minutes] = formatter.format(new Date(epochMs)).split(':').map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

function parseTimeToMinutes(value) {
  const match = String(value ?? '').match(/(\d{2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function isInFranceBounds(lat, lon) {
  return (
    lat >= FRANCE_BOUNDS.minLat &&
    lat <= FRANCE_BOUNDS.maxLat &&
    lon >= FRANCE_BOUNDS.minLon &&
    lon <= FRANCE_BOUNDS.maxLon
  );
}

function buildUrl(area) {
  return `${AIRPLANES_LIVE_POINT_BASE}/${area.lat}/${area.lon}/${area.radiusNm}`;
}

function normalizeAircraft(ac) {
  const lat = toNumber(ac.lat);
  const lon = toNumber(ac.lon);
  if (lat == null || lon == null || !isInFranceBounds(lat, lon)) return null;

  const hex = String(ac.hex ?? '').trim().toLowerCase();
  if (!hex) return null;

  const altitude =
    ac.alt_baro === 'ground'
      ? 0
      : Math.round(toNumber(ac.alt_baro) ?? toNumber(ac.alt_geom) ?? 0);
  const speed = Math.round(toNumber(ac.gs) ?? 0);
  const heading = Math.round(toNumber(ac.track) ?? 0);
  const seenSeconds = Math.max(0, Math.round(toNumber(ac.seen) ?? 0));
  const lastSeen = Date.now() - seenSeconds * 1000;
  const onGround = ac.on_ground === true || altitude === 0;

  if (onGround) return null;
  if (seenSeconds > 180) return null;

  return {
    id: hex,
    callsign: normalizeCallsign(ac.flight, `HEX-${hex.slice(0, 4).toUpperCase()}`),
    latitude: lat,
    longitude: lon,
    altitude,
    speed,
    heading,
    registration: String(ac.r ?? '').trim() || undefined,
    aircraftType: String(ac.t ?? '').trim() || undefined,
    aircraftModel: String(ac.desc ?? '').trim() || undefined,
    operator: String(ac.ownOp ?? '').trim() || getCallsignOperatorHint(ac.flight)?.operator || undefined,
    category: String(ac.category ?? ac.type ?? '').trim() || undefined,
    originAirport: normalizeText(ac.from ?? ac.dep ?? ac.departure ?? ac.origin),
    destinationAirport: normalizeText(ac.to ?? ac.arr ?? ac.arrival ?? ac.destination),
    eta: normalizeEta(ac.eta ?? ac.eta_epoch ?? ac.arrival_epoch ?? ac.estArrival),
    lastSeen,
    onGround,
    source: 'airplanes.live',
  };
}

function isAlreadyNormalized(obj) {
  return obj && typeof obj.id === 'string' && typeof obj.latitude === 'number';
}

function mergeAircraft(aircraft) {
  const byId = new Map();

  for (const raw of aircraft) {
    const normalized = isAlreadyNormalized(raw) ? raw : normalizeAircraft(raw);
    if (!normalized) continue;

    const existing = byId.get(normalized.id);
    if (!existing || normalized.lastSeen > existing.lastSeen) {
      byId.set(normalized.id, normalized);
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (b.altitude !== a.altitude) return b.altitude - a.altitude;
    return a.callsign.localeCompare(b.callsign);
  });
}

function countFlightsBySource(flights) {
  const counts = {};
  for (const flight of flights) {
    const source = String(flight?.source ?? '').trim() || 'unknown';
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

function parseTableRows(html) {
  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html))) {
    const cells = [];
    const cellRegex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      cells.push(stripHtml(cellMatch[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }

  return rows;
}

function parseBeauvaisDirectory(html, todayDate) {
  const records = [];
  const arrivalsStart = html.indexOf('Arriving flights');
  const departuresStart = html.indexOf('Departing flights');
  if (arrivalsStart < 0 || departuresStart < 0) return records;

  const arrivalsSection = html.slice(arrivalsStart, departuresStart);
  const departuresSection = html.slice(departuresStart);

  for (const cells of parseTableRows(arrivalsSection)) {
    if (cells.length < 7) continue;
    const dateCell = cells[0];
    const dateMatch = dateCell.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (dateMatch && dateMatch[1] !== todayDate) continue;
    const flightNumber = normalizeFlightDesignator(cells[1]);
    if (!flightNumber) continue;

    records.push({
      airportIata: 'BVA',
      flightNumber,
      direction: 'arrival',
      scheduledMinutes: parseTimeToMinutes(dateCell),
      originAirport: normalizeText(cells[2]),
      destinationAirport: 'Paris Beauvais',
      operator: normalizeText(cells[3]),
      terminal: normalizeText(cells[4]),
      status: normalizeText(cells[5]),
      sourceLabel: 'Aeroport Paris-Beauvais',
    });
  }

  for (const cells of parseTableRows(departuresSection)) {
    if (cells.length < 7) continue;
    const dateCell = cells[0];
    const dateMatch = dateCell.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (dateMatch && dateMatch[1] !== todayDate) continue;
    const flightNumber = normalizeFlightDesignator(cells[1]);
    if (!flightNumber) continue;

    records.push({
      airportIata: 'BVA',
      flightNumber,
      direction: 'departure',
      scheduledMinutes: parseTimeToMinutes(dateCell),
      originAirport: 'Paris Beauvais',
      destinationAirport: normalizeText(cells[2]),
      operator: normalizeText(cells[3]),
      terminal: normalizeText(cells[4]),
      status: normalizeText(cells[5]),
      sourceLabel: 'Aeroport Paris-Beauvais',
    });
  }

  return records;
}

function parseBordeauxDirectory(html, direction) {
  const records = [];
  const tableStart = html.indexOf('id="flights-list-table"');
  const scopedHtml = tableStart >= 0 ? html.slice(tableStart) : html;

  for (const cells of parseTableRows(scopedHtml)) {
    if (direction === 'arrival' && cells.length < 5) continue;
    if (direction === 'departure' && cells.length < 6) continue;
    const flightNumber = normalizeFlightDesignator(cells[2]);
    if (!flightNumber) continue;

    records.push({
      airportIata: 'BOD',
      flightNumber,
      direction,
      scheduledMinutes: parseTimeToMinutes(cells[0]),
      originAirport: direction === 'arrival' ? normalizeText(cells[1]) : 'Bordeaux Merignac',
      destinationAirport: direction === 'departure' ? normalizeText(cells[1]) : 'Bordeaux Merignac',
      operator: normalizeText(cells[3]),
      terminal: direction === 'departure' ? normalizeText(cells[4]) : undefined,
      status: normalizeText(cells[cells.length - 1]),
      sourceLabel: 'Bordeaux Aeroport',
    });
  }

  return records;
}

async function fetchOfficialAirportDirectory(fetchImpl, airportIata, now = Date.now()) {
  const cached = cachedOfficialFlightDirectories.get(airportIata);
  if (cached && now - cached.fetchedAt < OFFICIAL_AIRPORT_CACHE_TTL_MS) {
    return cached.records;
  }

  const provider = OFFICIAL_AIRPORT_PROVIDERS[airportIata];
  if (!provider) return [];

  const headers = buildGenericHeaders();
  const todayDate = formatParisDate(new Date(now));
  const records = [];

  for (const url of provider.urls) {
    const response = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(`${airportIata} official page HTTP ${response.status}`);
    }

    const html = await response.text();

    if (airportIata === 'BVA') {
      records.push(...parseBeauvaisDirectory(html, todayDate));
    } else if (airportIata === 'BOD') {
      const direction = url.includes('w=out') ? 'departure' : 'arrival';
      records.push(...parseBordeauxDirectory(html, direction));
    }
  }

  cachedOfficialFlightDirectories.set(airportIata, {
    fetchedAt: now,
    records,
  });

  return records;
}

function collectOfficialAirportCandidates(flights) {
  const candidates = new Set();

  for (const flight of flights) {
    const nearestAirport = findNearestAirport(flight.latitude, flight.longitude, 90);
    const linkedAirport =
      nearestAirport?.airport ??
      matchFranceAirport(flight.destinationAirport) ??
      matchFranceAirport(flight.originAirport);
    if (linkedAirport && OFFICIAL_AIRPORT_PROVIDERS[linkedAirport.iata]) {
      candidates.add(linkedAirport.iata);
    }
  }

  return Array.from(candidates);
}

function applyOfficialFlightDirectory(flights, directoryRecords) {
  if (!Array.isArray(directoryRecords) || directoryRecords.length === 0) return flights;

  const recordsByFlight = new Map();
  for (const record of directoryRecords) {
    const key = normalizeFlightDesignator(record.flightNumber);
    if (!key) continue;
    const current = recordsByFlight.get(key) ?? [];
    current.push(record);
    recordsByFlight.set(key, current);
  }

  const nowMinutes = getParisMinutesOfDay();

  return flights.map((flight) => {
    const nearestAirport = findNearestAirport(flight.latitude, flight.longitude, 90);
    const linkedAirport =
      nearestAirport?.airport ??
      matchFranceAirport(flight.destinationAirport) ??
      matchFranceAirport(flight.originAirport);
    const likelyDirection = linkedAirport ? inferAirportDirection(flight, linkedAirport) : null;
    const directCandidates = deriveFlightLookupKeys(flight.callsign).flatMap((key) => recordsByFlight.get(key) ?? []);

    const fallbackOperator =
      normalizeOperatorName(flight.operator) ||
      normalizeOperatorName(getCallsignOperatorHint(flight.callsign)?.operator);
    const fallbackCandidates =
      linkedAirport && fallbackOperator
        ? directoryRecords.filter((record) => {
            if (record.airportIata !== linkedAirport.iata) return false;
            if (normalizeOperatorName(record.operator) !== fallbackOperator) return false;
            if (likelyDirection && record.direction !== likelyDirection) return false;
            if (!Number.isFinite(record.scheduledMinutes)) return true;
            return Math.abs(record.scheduledMinutes - nowMinutes) <= 180;
          })
        : [];

    const scoredCandidates = [...new Set([...directCandidates, ...fallbackCandidates])]
      .map((record) => {
        let score = 0;
        if (directCandidates.includes(record)) score += 100;
        if (linkedAirport && record.airportIata === linkedAirport.iata) score += 20;
        if (likelyDirection && record.direction === likelyDirection) score += 25;
        if (
          fallbackOperator &&
          normalizeOperatorName(record.operator) === fallbackOperator
        ) {
          score += 30;
        }
        if (Number.isFinite(record.scheduledMinutes)) {
          score += Math.max(0, 25 - Math.round(Math.abs(record.scheduledMinutes - nowMinutes) / 10));
        }
        return { record, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = scoredCandidates[0];
    const second = scoredCandidates[1];
    const record =
      best &&
      (best.score >= 100 || (best.score >= 70 && (!second || best.score - second.score >= 15)))
        ? best.record
        : null;
    if (!record) return flight;

    return {
      ...flight,
      originAirport: flight.originAirport ?? record.originAirport,
      destinationAirport: flight.destinationAirport ?? record.destinationAirport,
      operator:
        flight.operator ??
        record.operator ??
        getCallsignOperatorHint(flight.callsign)?.operator,
    };
  });
}

function normalizeOpenSkyState(state) {
  if (!Array.isArray(state) || state.length < 11) return null;

  const hex = String(state[0] ?? '').trim().toLowerCase();
  const callsign = normalizeCallsign(state[1], `HEX-${hex.slice(0, 4).toUpperCase()}`);
  const lon = toNumber(state[5]);
  const lat = toNumber(state[6]);
  const altitudeMeters = toNumber(state[7]) ?? toNumber(state[13]) ?? 0;
  const altitude = Math.round(altitudeMeters * 3.28084);
  const onGround = state[8] === true || altitude === 0;
  const speedMs = toNumber(state[9]) ?? 0;
  const heading = Math.round(toNumber(state[10]) ?? 0);
  const lastContactSec = toNumber(state[4]);
  const lastSeen = lastContactSec != null ? lastContactSec * 1000 : Date.now();

  if (!hex || lat == null || lon == null || !isInFranceBounds(lat, lon)) return null;
  if (onGround) return null;
  if (Date.now() - lastSeen > 5 * 60 * 1000) return null;

  return {
    id: hex,
    callsign,
    latitude: lat,
    longitude: lon,
    altitude,
    speed: Math.round(speedMs * 1.94384),
    heading,
    registration: undefined,
    aircraftType: undefined,
    aircraftModel: undefined,
    operator: String(state[2] ?? '').trim() || getCallsignOperatorHint(callsign)?.operator || undefined,
    category: undefined,
    originAirport: undefined,
    destinationAirport: undefined,
    eta: undefined,
    lastSeen,
    onGround,
    source: 'opensky',
  };
}

async function fetchArea(fetchImpl, area) {
  const source = `airplanes.live:${area.id}`;
  if (isRateLimited(source)) {
    throw new Error(`Air traffic upstream rate-limited (429) for ${area.id}`);
  }

  const response = await fetchImpl(buildUrl(area), {
    headers: buildGenericHeaders(),
    signal: AbortSignal.timeout(12_000),
  });

  if (response.status === 429) {
    markRateLimited(source);
    throw new Error(`Air traffic upstream rate-limited (429) for ${area.id}`);
  }

  if (!response.ok) {
    throw new Error(`Air traffic upstream HTTP ${response.status} for ${area.id}`);
  }

  const json = await response.json();
  return Array.isArray(json?.ac) ? json.ac : [];
}

async function fetchOpenSky(fetchImpl) {
  const source = 'opensky';
  if (isRateLimited(source)) {
    throw new Error('OpenSky rate-limited (429) — backoff actif');
  }

  const url = `${OPENSKY_STATES_URL}?lamin=${FRANCE_BOUNDS.minLat}&lomin=${FRANCE_BOUNDS.minLon}&lamax=${FRANCE_BOUNDS.maxLat}&lomax=${FRANCE_BOUNDS.maxLon}`;
  const response = await fetchImpl(url, {
    headers: await buildOpenSkyHeaders(fetchImpl),
    signal: AbortSignal.timeout(12_000),
  });

  if (response.status === 429) {
    markRateLimited(source);
    throw new Error('OpenSky rate-limited (429) — backoff actif');
  }

  if (!response.ok) {
    throw new Error(`OpenSky HTTP ${response.status}`);
  }

  const json = await response.json();
  const states = Array.isArray(json?.states) ? json.states : [];
  return states.map(normalizeOpenSkyState).filter(Boolean);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeHeading(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const normalized = num % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function headingDiff(a, b) {
  const diff = Math.abs(normalizeHeading(a) - normalizeHeading(b));
  return diff > 180 ? 360 - diff : diff;
}

function findNearestAirport(lat, lon, maxDistanceKm = 90) {
  let best = null;
  for (const airport of FRANCE_AIRPORTS) {
    const distanceKm = haversineKm(lat, lon, airport.lat, airport.lon);
    if (distanceKm > maxDistanceKm) continue;
    if (!best || distanceKm < best.distanceKm) {
      best = { airport, distanceKm };
    }
  }
  return best;
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const toDeg = (value) => (value * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const lambda1 = toRad(lon1);
  const lambda2 = toRad(lon2);
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return normalizeHeading(toDeg(Math.atan2(y, x)));
}

function inferAirportDirection(flight, airport) {
  if (!flight || !airport) return null;
  const airportToFlightBearing = bearingDegrees(airport.lat, airport.lon, flight.latitude, flight.longitude);
  const outboundDiff = headingDiff(flight.heading, airportToFlightBearing);
  const inboundDiff = headingDiff(flight.heading, normalizeHeading(airportToFlightBearing + 180));

  if (outboundDiff <= 65) return 'departure';
  if (inboundDiff <= 65) return 'arrival';
  return null;
}

function pruneFlightHistory(now) {
  for (const [flightId, samples] of flightHistory) {
    const filtered = samples.filter((sample) => now - sample.ts <= FLIGHT_HISTORY_TTL_MS);
    if (filtered.length === 0) {
      flightHistory.delete(flightId);
      continue;
    }
    flightHistory.set(flightId, filtered.slice(-MAX_HISTORY_SAMPLES));
  }
}

function updateFlightHistory(flights, now) {
  pruneFlightHistory(now);
  for (const flight of flights) {
    const history = flightHistory.get(flight.id) ?? [];
    const lastSample = history[history.length - 1];
    const nextSample = {
      ts: now,
      lat: flight.latitude,
      lon: flight.longitude,
      altitude: flight.altitude,
      speed: flight.speed,
      heading: normalizeHeading(flight.heading),
    };

    if (
      !lastSample ||
      now - lastSample.ts > 4_000 ||
      haversineKm(lastSample.lat, lastSample.lon, nextSample.lat, nextSample.lon) > 0.5 ||
      headingDiff(lastSample.heading, nextSample.heading) > 5 ||
      Math.abs(lastSample.altitude - nextSample.altitude) > 250
    ) {
      history.push(nextSample);
    }

    flightHistory.set(flight.id, history.slice(-MAX_HISTORY_SAMPLES));
  }
}

function getFlightHistory(flightId, now) {
  const samples = flightHistory.get(flightId) ?? [];
  return samples.filter((sample) => now - sample.ts <= 15 * 60 * 1000);
}

function computeCumulativeTurn(samples) {
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    total += headingDiff(samples[i - 1].heading, samples[i].heading);
  }
  return total;
}

function detectTrajectoryAnomalies(flight, nearestAirport, now) {
  const samples = getFlightHistory(flight.id, now);
  const anomalies = [];
  const last = samples[samples.length - 1];
  const previous = samples[samples.length - 2];
  const airportRef = nearestAirport?.airport ?? matchFranceAirport(flight.destinationAirport) ?? matchFranceAirport(flight.originAirport);
  const destinationAirport = matchFranceAirport(flight.destinationAirport);

  if (
    destinationAirport &&
    nearestAirport?.airport &&
    nearestAirport.airport.iata !== destinationAirport.iata &&
    nearestAirport.distanceKm <= 30 &&
    flight.altitude <= 12000 &&
    flight.speed >= 120 &&
    flight.speed <= 320
  ) {
    anomalies.push({
      type: 'reroute-probable',
      label: 'Deroutement probable',
      severity: 'medium',
      details: `${destinationAirport.iata} cible, approche vers ${nearestAirport.airport.iata}`,
      airportIata: destinationAirport.iata,
    });
  }

  if (samples.length < 2) return anomalies;

  if (
    headingDiff(last.heading, previous.heading) >= 85 &&
    last.speed >= 180 &&
    last.altitude >= 5000
  ) {
    anomalies.push({
      type: 'rapid-manoeuvre',
      label: 'Manoeuvre brusque',
      severity: 'medium',
      details: `Variation cap ${Math.round(headingDiff(last.heading, previous.heading))} deg`,
      airportIata: airportRef?.iata,
    });
  }

  if (airportRef) {
    const airportSamples = samples.filter((sample) =>
      haversineKm(sample.lat, sample.lon, airportRef.lat, airportRef.lon) <= 80
    );

    if (airportSamples.length >= 4) {
      const lowAltitudeCount = airportSamples.filter((sample) => sample.altitude >= 2000 && sample.altitude <= 12000).length;
      const cumulativeTurn = computeCumulativeTurn(airportSamples);
      const first = airportSamples[0];
      const lastAirportSample = airportSamples[airportSamples.length - 1];
      const spanKm = haversineKm(first.lat, first.lon, lastAirportSample.lat, lastAirportSample.lon);
      const avgSpeed = airportSamples.reduce((sum, sample) => sum + sample.speed, 0) / airportSamples.length;

      if (
        lowAltitudeCount >= 3 &&
        cumulativeTurn >= 160 &&
        spanKm <= 60 &&
        avgSpeed >= 140 &&
        avgSpeed <= 300
      ) {
        anomalies.push({
          type: 'holding',
          label: 'Circuit d attente',
          severity: 'medium',
          details: `${airportRef.iata} · virages repetes en zone terminale`,
          airportIata: airportRef.iata,
        });
      }
    }

    if (airportSamples.length >= 3) {
      const minAltitude = Math.min(...airportSamples.map((sample) => sample.altitude));
      const nearFinal = airportSamples.some((sample) =>
        haversineKm(sample.lat, sample.lon, airportRef.lat, airportRef.lon) <= 14 && sample.altitude <= 2500
      );
      if (
        nearFinal &&
        last.altitude - minAltitude >= 1200 &&
        last.altitude > previous.altitude + 500 &&
        headingDiff(last.heading, previous.heading) >= 20
      ) {
        anomalies.push({
          type: 'go-around',
          label: 'Approche interrompue',
          severity: 'high',
          details: `${airportRef.iata} · remise des gaz probable`,
          airportIata: airportRef.iata,
        });
      }
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const anomaly of anomalies) {
    if (seen.has(anomaly.type)) continue;
    seen.add(anomaly.type);
    deduped.push(anomaly);
  }
  return deduped;
}

function severityFromAirportScore(score) {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  if (score >= 15) return 'low';
  return 'info';
}

function buildAirportSummaries(flights) {
  const summaries = [];

  for (const airport of FRANCE_AIRPORTS) {
    const nearbyFlights = flights.filter((flight) =>
      haversineKm(flight.latitude, flight.longitude, airport.lat, airport.lon) <= 120
    );
    const terminalFlights = nearbyFlights.filter((flight) =>
      haversineKm(flight.latitude, flight.longitude, airport.lat, airport.lon) <= 60 &&
      flight.altitude <= 12000
    );
    const anomalyCount = nearbyFlights.reduce(
      (total, flight) => total + (Array.isArray(flight.anomalies) ? flight.anomalies.length : 0),
      0
    );
    const highSeverityAnomalies = nearbyFlights.reduce(
      (total, flight) =>
        total +
        (Array.isArray(flight.anomalies)
          ? flight.anomalies.filter((anomaly) => anomaly.severity === 'high' || anomaly.severity === 'critical').length
          : 0),
      0
    );
    const airportAnomalies = flights.flatMap((flight) =>
      Array.isArray(flight.anomalies)
        ? flight.anomalies.filter((anomaly) => anomaly.airportIata === airport.iata)
        : []
    );
    const holdingCount = airportAnomalies.filter((anomaly) => anomaly.type === 'holding').length;
    const goAroundCount = airportAnomalies.filter((anomaly) => anomaly.type === 'go-around').length;
    const rerouteCount = airportAnomalies.filter((anomaly) => anomaly.type === 'reroute-probable').length;
    const congestion = airport.expectedTerminal > 0 && terminalFlights.length >= airport.expectedTerminal * 2;
    const lowActivity = airport.expectedNearby >= 3 && nearbyFlights.length <= Math.floor(airport.expectedNearby * 0.35);
    const terminalSilence =
      airport.expectedTerminal >= 2 &&
      terminalFlights.length === 0 &&
      nearbyFlights.length <= Math.max(1, Math.floor(airport.expectedNearby * 0.5));
    const signals = [];
    if (terminalSilence) signals.push('Silence radar terminal');
    else if (lowActivity) signals.push('Activite anormalement faible');
    if (congestion) signals.push("Trafic d'approche dense");
    if (goAroundCount > 0) signals.push('Approches interrompues');
    if (holdingCount > 0) signals.push('Circuits d attente');
    if (rerouteCount > 0) signals.push('Deroutements probables');

    let score = 0;
    if (terminalSilence) score += 24;
    else if (lowActivity) score += 12;
    if (congestion) score += 18;
    score += Math.min(30, highSeverityAnomalies * 12 + Math.max(0, anomalyCount - highSeverityAnomalies) * 6);
    score += Math.min(18, holdingCount * 6);
    score += Math.min(28, goAroundCount * 14);
    score += Math.min(24, rerouteCount * 12);
    score = Math.min(100, Math.round(score));

    const reasons = [];
    if (terminalSilence) reasons.push('Silence radar terminal');
    else if (lowActivity) reasons.push('Activite anormalement faible');
    if (congestion) reasons.push(`${terminalFlights.length} vol(s) en approche/depart`);
    else if (terminalFlights.length > 0) reasons.push(`${terminalFlights.length} vol(s) en zone terminale`);
    if (anomalyCount > 0) reasons.push(`${anomalyCount} anomalie(s) de trajectoire`);
    if (holdingCount > 0) reasons.push(`${holdingCount} circuit(s) d attente`);
    if (goAroundCount > 0) reasons.push(`${goAroundCount} approche(s) interrompue(s)`);
    if (rerouteCount > 0) reasons.push(`${rerouteCount} deroutement(s) probable(s)`);
    if (nearbyFlights.length > 8) reasons.push(`${nearbyFlights.length} vols a proximite`);

    summaries.push({
      iata: airport.iata,
      icao: airport.icao,
      name: airport.name,
      city: airport.city,
      score,
      severity: severityFromAirportScore(score),
      activeFlights: nearbyFlights.length,
      terminalFlights: terminalFlights.length,
      anomalyCount,
      signals,
      reasons,
    });
  }

  return summaries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.anomalyCount !== a.anomalyCount) return b.anomalyCount - a.anomalyCount;
    return b.terminalFlights - a.terminalFlights;
  });
}

function enrichFlights(flights, airportSummaries, now) {
  const summaryByIata = new Map(airportSummaries.map((summary) => [summary.iata, summary]));

  return flights.map((flight) => {
    const nearbyAirport = findNearestAirport(flight.latitude, flight.longitude, 90);
    const linkedAirport =
      nearbyAirport?.airport ??
      matchFranceAirport(flight.destinationAirport) ??
      matchFranceAirport(flight.originAirport);
    const anomalies = detectTrajectoryAnomalies(flight, nearbyAirport, now);
    const airportSummary = linkedAirport ? summaryByIata.get(linkedAirport.iata) : undefined;

    return {
      ...flight,
      anomalies,
      nearbyAirportIata: linkedAirport?.iata,
      nearbyAirportName: linkedAirport?.name,
      nearbyAirportDistanceKm: nearbyAirport ? Math.round(nearbyAirport.distanceKm) : undefined,
      airportScore: airportSummary?.score,
      airportSeverity: airportSummary?.severity,
      airportSignals: airportSummary?.signals ?? [],
    };
  });
}

export async function fetchAirTrafficSnapshot(fetchImpl = fetch) {
  const now = Date.now();
  if (cachedSnapshot && cachedSnapshot.flights.length > 0 && now - cachedSnapshot.fetchedAt < CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  const aircraft = [];
  const errors = [];
  let usedOpenSky = false;
  let usedAirplanesLive = false;

  try {
    const openSkyFlights = await fetchOpenSky(fetchImpl);
    aircraft.push(...openSkyFlights);
    usedOpenSky = openSkyFlights.length > 0;
  } catch (error) {
    errors.push({
      area: 'opensky',
      message: error instanceof Error ? error.message : 'OpenSky fetch failed',
    });
  }

  const areaResults = await Promise.allSettled(
    AIR_TRAFFIC_AREAS.map((area) => fetchArea(fetchImpl, area))
  );
  for (let i = 0; i < areaResults.length; i += 1) {
    const area = AIR_TRAFFIC_AREAS[i];
    const result = areaResults[i];
    if (result.status === 'fulfilled') {
      const areaAircraft = result.value;
      aircraft.push(...areaAircraft);
      if (areaAircraft.length > 0) usedAirplanesLive = true;
    } else {
      errors.push({
        area: area.id,
        message: result.reason instanceof Error ? result.reason.message : 'Fetch failed',
      });
    }
  }

  const mergedFlights = mergeAircraft(aircraft);
  let officialDirectory = [];
  const officialAirports = collectOfficialAirportCandidates(mergedFlights);
  if (officialAirports.length > 0) {
    const officialResults = await Promise.allSettled(
      officialAirports.map((airportIata) => fetchOfficialAirportDirectory(fetchImpl, airportIata, now))
    );

    for (let i = 0; i < officialResults.length; i += 1) {
      const airportIata = officialAirports[i];
      const result = officialResults[i];
      if (result.status === 'fulfilled') {
        officialDirectory.push(...result.value);
      } else {
        errors.push({
          area: `${airportIata.toLowerCase()}-official`,
          message: result.reason instanceof Error ? result.reason.message : 'Official airport page fetch failed',
        });
      }
    }
  }

  const routeEnrichedFlights = applyOfficialFlightDirectory(mergedFlights, officialDirectory);
  updateFlightHistory(routeEnrichedFlights, now);

  const preEnrichedFlights = routeEnrichedFlights.map((flight) => {
    const nearbyAirport = findNearestAirport(flight.latitude, flight.longitude, 90);
    return {
      ...flight,
      anomalies: detectTrajectoryAnomalies(flight, nearbyAirport, now),
    };
  });

  const airportSummaries = buildAirportSummaries(preEnrichedFlights);
  const enrichedFlights = enrichFlights(routeEnrichedFlights, airportSummaries, now);

  const source =
    usedOpenSky && usedAirplanesLive
      ? 'opensky+airplanes.live'
      : usedOpenSky
        ? 'opensky'
        : 'airplanes.live';
  const snapshot = {
    source,
    fetchedAt: now,
    ttlMs: CACHE_TTL_MS,
    areas: AIR_TRAFFIC_AREAS.map(({ id, lat, lon, radiusNm }) => ({ id, lat, lon, radiusNm })),
    flights: enrichedFlights,
    sourceCounts: countFlightsBySource(enrichedFlights),
    topAirports: airportSummaries.filter((summary) => summary.score > 0 || summary.signals.length > 0).slice(0, 10),
    anomalyCount: enrichedFlights.reduce(
      (total, flight) => total + (Array.isArray(flight.anomalies) ? flight.anomalies.length : 0),
      0
    ),
    signalCount: airportSummaries.reduce((total, summary) => total + summary.signals.length, 0),
    errors,
  };

  if (snapshot.flights.length > 0) {
    cachedSnapshot = snapshot;
    return snapshot;
  }

  if (cachedSnapshot && cachedSnapshot.flights.length > 0) {
    return {
      ...cachedSnapshot,
      errors: [...cachedSnapshot.errors, ...errors],
    };
  }

  cachedSnapshot = snapshot;
  return snapshot;
}
