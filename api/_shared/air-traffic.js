// api/_shared/air-traffic.js : trafic aérien civil, collecte serveur unique OpenSky (spec 2026-10-03 panneaux
// trafic § 2.3, T3, T4). OpenSky authentifié seul (airplanes.live répond 403 depuis septembre 2026 : retiré,
// avec l'en-tête de navigateur factice) ; `extended=1` (catégorie) ; `squawk` conservé.
// Une collecte toutes les 2 min au plus, partagée par la carte (/api/traffic/air, relève client de 12 s) et
// le panneau (/api/traffic/air-overview) ; lancée par la relève serveur (server/prod/traffic-collectors.mjs)
// ou à la demande. À chaque collecte : journal des urgences (7 jours), échantillon de volume toutes les 10 min
// (8 jours), départs par aéroport toutes les 4 h (suspendus sous 500 crédits restants), annuaires officiels
// de Beauvais et Bordeaux (retards, annulations ; enrichissement des vols proches), trajectoires inhabituelles.
// Le « score » d'aéroport par densité est supprimé.
import { FRANCE_AIRPORTS, matchFranceAirport } from './airports-fr.js';
import { distanceToMetropoleKm, haversineKm, insideMetropole } from '../_lib/geo-fr.js';
import { appendSample, kvGetJson, kvSetJson, upsertLogEntry } from '../_lib/kv-history.js';
import { parisParts } from '../_lib/paris-time.js';
import { cleanText, fetchStrictHtml, fetchStrictJson, fetchStrictResponse, sourceError } from '../_lib/source-http.js';

const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';
const OPENSKY_DEPARTURES_URL = 'https://opensky-network.org/api/flights/departure';
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

/** Zone suivie (déborde sur les pays voisins : dit dans « Méthode »). */
export const ZONE_BOUNDS = { minLat: 41.0, maxLat: 51.8, minLon: -5.8, maxLon: 10.2 };
export const STATES_INTERVAL_MS = 2 * 60_000;
export const VOLUME_INTERVAL_MS = 10 * 60_000;
export const DEPARTURES_INTERVAL_MS = 4 * 3_600_000;
export const DEPARTURES_WINDOW_SEC = 2 * 3600;
/** Sous ce nombre de crédits restants, les départs (30 crédits par appel) sont suspendus avant les états. */
export const CREDIT_FLOOR = 500;
export const DEPARTURE_AIRPORTS = ['LFPG', 'LFPO', 'LFMN', 'LFLL', 'LFML', 'LFBO', 'LFBD', 'LFRS'];
export const EMERGENCY_SQUAWKS = ['7500', '7600', '7700'];
/** Un 7700 compte s'il est au-dessus du territoire ou à moins de 40 km (approches). */
export const APPROACH_KM = 40;
export const EMERGENCY_LOG_KEY = 'traffic:air:emergencies';
export const VOLUME_KEY = 'traffic:air:volume';
export const DEPARTURES_KEY = 'traffic:air:departures';
const EMERGENCY_KEEP_MS = 7 * 86_400_000;
const VOLUME_KEEP_MS = 8 * 86_400_000;
const STALE_CONTACT_SEC = 300;
const RATE_LIMIT_BACKOFF_MS = 10 * 60_000;
const OFFICIAL_BOARD_TTL_MS = 10 * 60_000;
const FLIGHT_HISTORY_TTL_MS = 20 * 60_000;
const MAX_HISTORY_SAMPLES = 12;

/** Repère du tableau des vols de Bordeaux : la vraie page intègre un formulaire reCAPTCHA, ce n'est pas un défi. */
const BORDEAUX_TABLE_MARKER = 'id="flights-list-table"';

const OFFICIAL_AIRPORT_PROVIDERS = {
  BVA: { name: 'Paris Beauvais', urls: ['https://www.aeroportparisbeauvais.com/en/flights/live-flight-information/find-your-flight'] },
  BOD: {
    name: 'Bordeaux Mérignac',
    contentMarker: BORDEAUX_TABLE_MARKER,
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

// ── État du processus (une seule collecte, partagée) ──
let collection = null;
let inflight = null;
let cachedToken = null;
let rateLimitedUntil = 0;
const boards = new Map();
const boardFailures = new Map();
const flightHistory = new Map();

/** Réservé aux tests. */
export function __resetAirStateForTests() {
  collection = null;
  inflight = null;
  cachedToken = null;
  rateLimitedUntil = 0;
  boards.clear();
  boardFailures.clear();
  flightHistory.clear();
}

/** URL des états de la zone suivie, catégorie comprise. */
export function statesUrl() {
  const b = ZONE_BOUNDS;
  return `${OPENSKY_STATES_URL}?lamin=${b.minLat}&lomin=${b.minLon}&lamax=${b.maxLat}&lomax=${b.maxLon}&extended=1`;
}

/** URL des départs détectés d'un aéroport (ICAO) sur une fenêtre (secondes Unix). */
export function departuresUrl(icao, begin, end) {
  return `${OPENSKY_DEPARTURES_URL}?airport=${icao}&begin=${begin}&end=${end}`;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * État OpenSky (tableau de 18 éléments) → objet ; null sans position ou vu il y a plus de 5 min.
 * @param {unknown[]} s
 * @param {number} timeSec instant de la réponse (`time`)
 */
export function normalizeOpenSkyState(s, timeSec) {
  if (!Array.isArray(s) || s.length < 17) return null;
  const lon = toNumber(s[5]);
  const lat = toNumber(s[6]);
  const lastContact = toNumber(s[4]);
  const icao24 = String(s[0] ?? '').trim().toLowerCase();
  if (!icao24 || lat === null || lon === null) return null;
  if (lastContact !== null && timeSec - lastContact > STALE_CONTACT_SEC) return null;
  const squawk = s[14] === null || s[14] === undefined ? null : String(s[14]).trim() || null;
  return {
    icao24,
    callsign: String(s[1] ?? '').trim() || null,
    originCountry: String(s[2] ?? '').trim() || null,
    lastContact,
    lat,
    lon,
    baroAltitudeM: toNumber(s[7]),
    onGround: s[8] === true,
    velocityMs: toNumber(s[9]),
    heading: toNumber(s[10]),
    verticalRate: toNumber(s[11]),
    geoAltitudeM: toNumber(s[13]),
    squawk,
    category: toNumber(s[17]),
  };
}

function normalizeHeading(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const r = n % 360;
  return r < 0 ? r + 360 : r;
}

function headingDiff(a, b) {
  const d = Math.abs(normalizeHeading(a) - normalizeHeading(b));
  return d > 180 ? 360 - d : d;
}

function normalizeFlightDesignator(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9]/g, '');
}

function getCallsignOperatorHint(value) {
  const n = normalizeFlightDesignator(value);
  return n.length < 3 ? null : CALLSIGN_OPERATOR_HINTS[n.slice(0, 3)] ?? null;
}

/** Vol pour la carte (forme historique de /api/traffic/air ; altitude en pieds, vitesse en nœuds). */
export function toMapFlight(state) {
  const altitudeM = state.baroAltitudeM ?? state.geoAltitudeM ?? 0;
  return {
    id: state.icao24,
    callsign: state.callsign ?? `HEX-${state.icao24.slice(0, 4).toUpperCase()}`,
    latitude: state.lat,
    longitude: state.lon,
    altitude: Math.round(altitudeM * 3.28084),
    speed: Math.round((state.velocityMs ?? 0) * 1.94384),
    heading: Math.round(state.heading ?? 0),
    operator: getCallsignOperatorHint(state.callsign)?.operator ?? state.originCountry ?? undefined,
    category: state.category === null ? undefined : String(state.category),
    squawk: state.squawk ?? undefined,
    lastSeen: (state.lastContact ?? 0) * 1000,
    onGround: state.onGround,
    source: 'opensky',
  };
}

function findNearestAirport(lat, lon, maxKm = 90) {
  let best = null;
  for (const airport of FRANCE_AIRPORTS) {
    const distanceKm = haversineKm(lat, lon, airport.lat, airport.lon);
    if (distanceKm <= maxKm && (!best || distanceKm < best.distanceKm)) best = { airport, distanceKm };
  }
  return best;
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

function inferAirportDirection(flight, airport) {
  const outward = bearingDegrees(airport.lat, airport.lon, flight.latitude, flight.longitude);
  if (headingDiff(flight.heading, outward) <= 65) return 'departure';
  if (headingDiff(flight.heading, normalizeHeading(outward + 180)) <= 65) return 'arrival';
  return null;
}

function updateFlightHistory(flights, now) {
  for (const [id, samples] of flightHistory) {
    const kept = samples.filter((s) => now - s.ts <= FLIGHT_HISTORY_TTL_MS);
    if (kept.length === 0) flightHistory.delete(id);
    else flightHistory.set(id, kept.slice(-MAX_HISTORY_SAMPLES));
  }
  for (const f of flights) {
    const history = flightHistory.get(f.id) ?? [];
    history.push({ ts: now, lat: f.latitude, lon: f.longitude, altitude: f.altitude, speed: f.speed, heading: normalizeHeading(f.heading) });
    flightHistory.set(f.id, history.slice(-MAX_HISTORY_SAMPLES));
  }
}

function cumulativeTurn(samples) {
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) total += headingDiff(samples[i - 1].heading, samples[i].heading);
  return total;
}

/**
 * Trajectoires inhabituelles (détection automatique, information, jamais une alerte) : déroutement probable,
 * manœuvre brusque, circuit d'attente, approche interrompue ; sur l'historique des collectes (2 min).
 */
export function detectTrajectoryAnomalies(flight, now) {
  const samples = (flightHistory.get(flight.id) ?? []).filter((s) => now - s.ts <= 15 * 60_000);
  const nearest = findNearestAirport(flight.latitude, flight.longitude, 90);
  const airportRef = nearest?.airport ?? matchFranceAirport(flight.destinationAirport) ?? matchFranceAirport(flight.originAirport);
  const destination = matchFranceAirport(flight.destinationAirport);
  const out = [];
  if (destination && nearest && nearest.airport.iata !== destination.iata && nearest.distanceKm <= 30
    && flight.altitude <= 12000 && flight.speed >= 120 && flight.speed <= 320) {
    out.push({ type: 'reroute-probable', label: 'Déroutement probable', severity: 'medium', airportIata: destination.iata });
  }
  if (samples.length < 2) return out;
  const last = samples.at(-1);
  const previous = samples.at(-2);
  if (headingDiff(last.heading, previous.heading) >= 85 && last.speed >= 180 && last.altitude >= 5000) {
    out.push({ type: 'rapid-manoeuvre', label: 'Manœuvre brusque', severity: 'medium', airportIata: airportRef?.iata });
  }
  if (airportRef) {
    const near = samples.filter((s) => haversineKm(s.lat, s.lon, airportRef.lat, airportRef.lon) <= 80);
    if (near.length >= 4) {
      const low = near.filter((s) => s.altitude >= 2000 && s.altitude <= 12000).length;
      const span = haversineKm(near[0].lat, near[0].lon, near.at(-1).lat, near.at(-1).lon);
      const avgSpeed = near.reduce((sum, s) => sum + s.speed, 0) / near.length;
      if (low >= 3 && cumulativeTurn(near) >= 160 && span <= 60 && avgSpeed >= 140 && avgSpeed <= 300) {
        out.push({ type: 'holding', label: 'Circuit d’attente', severity: 'medium', airportIata: airportRef.iata });
      }
    }
    if (near.length >= 3) {
      const minAltitude = Math.min(...near.map((s) => s.altitude));
      const nearFinal = near.some((s) => haversineKm(s.lat, s.lon, airportRef.lat, airportRef.lon) <= 14 && s.altitude <= 2500);
      if (nearFinal && last.altitude - minAltitude >= 1200 && last.altitude > previous.altitude + 500 && headingDiff(last.heading, previous.heading) >= 20) {
        out.push({ type: 'go-around', label: 'Approche interrompue', severity: 'high', airportIata: airportRef.iata });
      }
    }
  }
  return out.filter((a, i) => out.findIndex((b) => b.type === a.type) === i);
}

// ── Annuaires officiels de Beauvais et Bordeaux ──

function parseTableRows(html) {
  const rows = [];
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cleanText(c[1]));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function parseTimeToMinutes(value) {
  const m = /(\d{2}):(\d{2})/.exec(String(value ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** « 03/10/2026 » : jour à Paris au format de l'annuaire de Beauvais. */
export function parisDateFr(instant) {
  const p = parisParts(instant);
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year}`;
}

/** Annuaire de Beauvais (anglais) : vols du jour, arrivées et départs. */
export function parseBeauvaisDirectory(html, todayDate) {
  const records = [];
  const arrivals = html.indexOf('Arriving flights');
  const departures = html.indexOf('Departing flights');
  if (arrivals < 0 || departures < 0) throw new SyntaxError('annuaire de Beauvais : tableaux introuvables');
  const sections = [['arrival', html.slice(arrivals, departures)], ['departure', html.slice(departures)]];
  for (const [direction, section] of sections) {
    for (const cells of parseTableRows(section)) {
      if (cells.length < 7) continue;
      const date = /(\d{2}\/\d{2}\/\d{4})/.exec(cells[0]);
      if (date && date[1] !== todayDate) continue;
      const flightNumber = normalizeFlightDesignator(cells[1]);
      if (!flightNumber) continue;
      records.push({
        airportIata: 'BVA', flightNumber, direction, scheduledMinutes: parseTimeToMinutes(cells[0]),
        originAirport: direction === 'arrival' ? cells[2] || undefined : 'Paris Beauvais',
        destinationAirport: direction === 'departure' ? cells[2] || undefined : 'Paris Beauvais',
        operator: cells[3] || undefined, status: cells[5] || '',
      });
    }
  }
  return records;
}

/** Annuaire de Bordeaux (français), une page par sens. */
export function parseBordeauxDirectory(html, direction) {
  const start = html.indexOf(BORDEAUX_TABLE_MARKER);
  if (start < 0) throw new SyntaxError('annuaire de Bordeaux : tableau introuvable');
  const records = [];
  for (const cells of parseTableRows(html.slice(start))) {
    if (cells.length < (direction === 'arrival' ? 5 : 6)) continue;
    const flightNumber = normalizeFlightDesignator(cells[2]);
    if (!flightNumber) continue;
    records.push({
      airportIata: 'BOD', flightNumber, direction, scheduledMinutes: parseTimeToMinutes(cells[0]),
      originAirport: direction === 'arrival' ? cells[1] || undefined : 'Bordeaux Mérignac',
      destinationAirport: direction === 'departure' ? cells[1] || undefined : 'Bordeaux Mérignac',
      operator: cells[3] || undefined, status: cells[cells.length - 1] || '',
    });
  }
  return records;
}

/** Retards et annulations du jour d'un annuaire (statuts « Delayed », « Retardé », « Cancelled », « Annulé »). */
export function boardCounts(records) {
  return {
    delayed: records.filter((r) => /retard|delay/i.test(r.status)).length,
    cancelled: records.filter((r) => /annul|cancel/i.test(r.status)).length,
  };
}

/** Annuaire du jour d'un aéroport, relu toutes les 10 min ; un échec est mémorisé 10 min (S3 : pas de relance à chaque collecte). */
async function readBoard(iata, now) {
  const cached = boards.get(iata);
  if (cached && now - cached.readAt < OFFICIAL_BOARD_TTL_MS) return cached;
  const failure = boardFailures.get(iata);
  if (failure && now - failure.at < OFFICIAL_BOARD_TTL_MS) throw failure.error;
  const provider = OFFICIAL_AIRPORT_PROVIDERS[iata];
  try {
    const records = [];
    for (const url of provider.urls) {
      const html = await fetchStrictHtml(url, { timeoutMs: 20_000, contentMarker: provider.contentMarker });
      if (iata === 'BVA') records.push(...parseBeauvaisDirectory(html, parisDateFr(now)));
      else records.push(...parseBordeauxDirectory(html, url.includes('w=out') ? 'departure' : 'arrival'));
    }
    const entry = { readAt: now, at: new Date(now).toISOString(), records, ...boardCounts(records) };
    boards.set(iata, entry);
    boardFailures.delete(iata);
    return entry;
  } catch (error) {
    boardFailures.set(iata, { at: now, error });
    throw error;
  }
}

function applyOfficialDirectory(flights, records, now) {
  if (records.length === 0) return flights;
  const byFlight = new Map();
  for (const r of records) {
    const list = byFlight.get(r.flightNumber) ?? [];
    list.push(r);
    byFlight.set(r.flightNumber, list);
  }
  const p = parisParts(now);
  const nowMinutes = p.hour * 60 + p.minute;
  return flights.map((flight) => {
    const nearest = findNearestAirport(flight.latitude, flight.longitude, 90);
    if (!nearest || !OFFICIAL_AIRPORT_PROVIDERS[nearest.airport.iata]) return flight;
    const keys = new Set([normalizeFlightDesignator(flight.callsign)]);
    const hint = getCallsignOperatorHint(flight.callsign);
    const suffix = normalizeFlightDesignator(flight.callsign).slice(3);
    if (hint && /^\d+$/.test(suffix)) keys.add(`${hint.commercialCode}${suffix}`);
    const direction = inferAirportDirection(flight, nearest.airport);
    const candidates = [...keys].flatMap((k) => byFlight.get(k) ?? [])
      .filter((r) => r.airportIata === nearest.airport.iata && (!direction || r.direction === direction))
      .filter((r) => r.scheduledMinutes === null || Math.abs(r.scheduledMinutes - nowMinutes) <= 180);
    const record = candidates[0];
    if (!record) return flight;
    return { ...flight, originAirport: record.originAirport, destinationAirport: record.destinationAirport, operator: flight.operator ?? record.operator };
  });
}

// ── OpenSky ──

function openSkyCredentials() {
  const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function openSkyToken(now) {
  const credentials = openSkyCredentials();
  if (!credentials) throw new Error('identifiants OpenSky absents (OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET)');
  if (cachedToken && cachedToken.expiresAt > now + 30_000) return cachedToken.value;
  const json = await fetchStrictJson(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.clientId, client_secret: credentials.clientSecret }),
    timeoutMs: 12_000,
  });
  if (typeof json?.access_token !== 'string' || !json.access_token) throw new Error('jeton OpenSky absent de la réponse');
  cachedToken = { value: json.access_token, expiresAt: now + (Number(json.expires_in) || 300) * 1000 };
  return cachedToken.value;
}

async function readStates(now) {
  if (now < rateLimitedUntil) throw new Error(`limite de débit, reprise à ${new Date(rateLimitedUntil).toISOString()}`);
  const token = await openSkyToken(now);
  try {
    const r = await fetchStrictResponse(statesUrl(), { expect: 'json', headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15_000 });
    const json = JSON.parse(r.text);
    if (!Number.isFinite(json?.time)) throw new SyntaxError('réponse OpenSky sans « time »');
    const remaining = toNumber(r.header('x-rate-limit-remaining'));
    const states = (Array.isArray(json.states) ? json.states : []).map((s) => normalizeOpenSkyState(s, json.time)).filter(Boolean);
    return { time: json.time, states, remaining };
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && err.status === 429) rateLimitedUntil = now + RATE_LIMIT_BACKOFF_MS;
    throw err;
  }
}

async function readDepartures(now, token) {
  const end = Math.floor(now / 1000);
  const begin = end - DEPARTURES_WINDOW_SEC;
  const counts = {};
  const errors = [];
  for (const icao of DEPARTURE_AIRPORTS) {
    try {
      const list = await fetchStrictJson(departuresUrl(icao, begin, end), { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 20_000 });
      counts[icao] = Array.isArray(list) ? list.length : null;
    } catch (err) {
      // OpenSky répond 404 quand aucun vol n'est trouvé sur la fenêtre (documentation de l'API) : zéro départ.
      if (err && typeof err === 'object' && 'status' in err && err.status === 404) counts[icao] = 0;
      else { counts[icao] = null; errors.push(sourceError(`OpenSky, départs ${icao}`, err)); }
    }
  }
  return {
    value: { at: new Date(now).toISOString(), begin: new Date(begin * 1000).toISOString(), end: new Date(end * 1000).toISOString(), counts },
    errors,
  };
}

function inZone(s) {
  const b = ZONE_BOUNDS;
  return s.lat >= b.minLat && s.lat <= b.maxLat && s.lon >= b.minLon && s.lon <= b.maxLon;
}

/** Urgences en cours (squawk 7500, 7600, 7700) ; `overFrance` : territoire ou moins de 40 km (approches). */
export function emergenciesFrom(states, atIso) {
  return states
    .filter((s) => EMERGENCY_SQUAWKS.includes(s.squawk ?? ''))
    .map((s) => ({
      icao24: s.icao24, callsign: s.callsign, squawk: s.squawk, lat: s.lat, lon: s.lon,
      altitudeM: s.baroAltitudeM ?? s.geoAltitudeM, firstSeen: atIso, lastSeen: atIso,
      overFrance: distanceToMetropoleKm(s.lat, s.lon, APPROACH_KM) <= APPROACH_KM,
    }));
}

/** Échantillon de volume : en vol dans la zone suivie et au-dessus du territoire métropolitain. */
export function volumeSample(states, atIso) {
  const airborne = states.filter((s) => !s.onGround && inZone(s));
  return { at: atIso, airborneZone: airborne.length, airborneFrance: airborne.filter((s) => insideMetropole(s.lat, s.lon)).length };
}

/** Journal des urgences : première vue gardée, dernière vue et position mises à jour. */
export async function recordEmergencies(emergencies, now) {
  for (const e of emergencies) {
    await upsertLogEntry(EMERGENCY_LOG_KEY, e, {
      idOf: (x) => `${x.icao24}:${x.squawk}`,
      dateOf: (x) => x.lastSeen,
      merge: (old, next) => ({ ...next, firstSeen: old.firstSeen }),
      maxAgeMs: EMERGENCY_KEEP_MS,
      now,
    });
  }
}

/** Tentative sans nouvelle donnée : dernière collecte gardée avec sa date (S1), ou collecte vide (`at` null). */
function keepPrevious(now, errors) {
  collection = collection
    ? { ...collection, attemptedAt: now, errors }
    : { at: null, attemptedAt: now, states: [], flights: [], credits: null, errors, departures: null, boards: {} };
  return collection;
}

async function refresh(now) {
  const errors = [];
  let states;
  try {
    states = await readStates(now);
  } catch (err) {
    errors.push(sourceError('OpenSky', err));
    return keepPrevious(now, errors);
  }
  const atIso = new Date(states.time * 1000).toISOString();
  const zoneStates = states.states.filter(inZone);
  let flights = zoneStates.filter((s) => !s.onGround).map(toMapFlight);

  const boardResults = {};
  const records = [];
  for (const iata of Object.keys(OFFICIAL_AIRPORT_PROVIDERS)) {
    try {
      const board = await readBoard(iata, now);
      boardResults[iata] = { delayed: board.delayed, cancelled: board.cancelled, at: board.at };
      records.push(...board.records);
    } catch (err) {
      boardResults[iata] = null;
      errors.push(sourceError(`Annuaire ${OFFICIAL_AIRPORT_PROVIDERS[iata].name}`, err));
    }
  }
  flights = applyOfficialDirectory(flights, records, now);
  updateFlightHistory(flights, now);
  flights = flights.map((f) => {
    const nearest = findNearestAirport(f.latitude, f.longitude, 90);
    return { ...f, anomalies: detectTrajectoryAnomalies(f, now), nearbyAirportIata: nearest?.airport.iata, nearbyAirportName: nearest?.airport.name, nearbyAirportDistanceKm: nearest ? Math.round(nearest.distanceKm) : undefined };
  });

  await recordEmergencies(emergenciesFrom(zoneStates, atIso), now);
  await appendSample(VOLUME_KEY, volumeSample(zoneStates, atIso), { maxAgeMs: VOLUME_KEEP_MS, minIntervalMs: VOLUME_INTERVAL_MS - 30_000, now });

  let departures = await kvGetJson(DEPARTURES_KEY, now);
  const departuresDue = !departures || now - Date.parse(departures.at) >= DEPARTURES_INTERVAL_MS;
  if (departuresDue) {
    if (states.remaining !== null && states.remaining < CREDIT_FLOOR) {
      errors.push(`OpenSky : départs suspendus (${states.remaining} crédits restants, seuil ${CREDIT_FLOOR})`);
    } else {
      const read = await readDepartures(now, await openSkyToken(now));
      errors.push(...read.errors);
      departures = read.value;
      await kvSetJson(DEPARTURES_KEY, departures, 86_400, now);
    }
  }

  collection = { at: atIso, attemptedAt: now, states: zoneStates, flights, credits: states.remaining, errors, departures: departures ?? null, boards: boardResults };
  return collection;
}

/**
 * Collecte à jour : nouvelle lecture si la dernière tentative a 2 min ou plus. Une seule à la fois : la relève,
 * la carte et le panneau partagent la collecte en cours, qui est le seul écrivain du journal des urgences, du
 * volume et des départs (aucune mise à jour perdue entre appels simultanés). Une erreur imprévue après la
 * lecture des états date quand même la tentative : sinon chaque requête de la carte (12 s) relancerait OpenSky
 * et viderait les crédits (T4).
 */
export async function ensureAirFresh(now = Date.now()) {
  if (collection && now - collection.attemptedAt < STATES_INTERVAL_MS) return collection;
  inflight ??= refresh(now)
    .catch((err) => keepPrevious(now, [sourceError('Collecte aérienne interrompue', err)]))
    .finally(() => { inflight = null; });
  return inflight;
}

/** Instantané de la carte (/api/traffic/air) : vols en vol de la zone suivie, date réelle des états. */
export async function fetchAirTrafficSnapshot(now = Date.now()) {
  const c = await ensureAirFresh(now);
  if (c.at === null) throw new Error(c.errors[0] ?? 'OpenSky indisponible');
  return {
    source: 'opensky',
    fetchedAt: Date.parse(c.at),
    ttlMs: STATES_INTERVAL_MS,
    areas: [],
    flights: c.flights,
    sourceCounts: { opensky: c.flights.length },
    anomalyCount: c.flights.reduce((n, f) => n + f.anomalies.length, 0),
    errors: c.errors.map((message) => ({ area: 'opensky', message })),
  };
}
