// api/_lib/air-overview.js : réponse du panneau Trafic aérien (spec 2026-10-03 panneaux trafic § 2.3, § 3.2),
// construite sur la collecte serveur partagée (api/_shared/air-traffic.js) et sur les séries gardées dans le
// stockage clé-valeur (journal des urgences 7 jours, volume 8 jours).
import { FRANCE_AIRPORTS } from '../_shared/airports-fr.js';
import { EMERGENCY_LOG_KEY, EMERGENCY_SQUAWKS, VOLUME_KEY, emergenciesFrom, ensureAirFresh, volumeSample } from '../_shared/air-traffic.js';
import { haversineKm } from './geo-fr.js';
import { readLog, readSeries } from './kv-history.js';
import { sourceError } from './source-http.js';

/** Aéroports du panneau : les huit des départs, puis Beauvais (annuaire officiel seulement). */
export const OVERVIEW_AIRPORTS = ['CDG', 'ORY', 'NCE', 'LYS', 'MRS', 'TLS', 'BOD', 'NTE', 'BVA'];
export const GROUND_RADIUS_KM = 4;
export const APPROACH_RADIUS_KM = 40;
export const APPROACH_MAX_ALT_M = 3000;
const DAY_MS = 86_400_000;
const SAME_HOUR_TOLERANCE_MS = 15 * 60_000;

/**
 * Activité d'un aéroport : au sol à moins de 4 km, en approche à moins de 40 km et sous 3 000 m.
 * `lat` et `lon` : point de référence fixe de l'aéroport (api/_shared/airports-fr.js), celui des comptes et de la carte.
 */
export function airportActivity(airport, states, departures, board) {
  let onGround = 0;
  let approaching = 0;
  for (const s of states) {
    const km = haversineKm(s.lat, s.lon, airport.lat, airport.lon);
    if (s.onGround && km < GROUND_RADIUS_KM) onGround += 1;
    const altitude = s.baroAltitudeM ?? s.geoAltitudeM;
    if (!s.onGround && km < APPROACH_RADIUS_KM && altitude !== null && altitude < APPROACH_MAX_ALT_M) approaching += 1;
  }
  const counted = departures?.counts?.[airport.icao];
  return {
    icao: airport.icao,
    iata: airport.iata,
    name: airport.name,
    lat: airport.lat,
    lon: airport.lon,
    departures: departures && counted !== undefined ? counted : null,
    departuresWindow: departures && counted !== undefined ? { begin: departures.begin, end: departures.end } : null,
    onGround,
    approaching,
    board: board ?? null,
  };
}

/**
 * Valeurs « en vol dans la zone » à la même heure les jours précédents (1 à 7 jours avant, à 15 min près),
 * du plus récent au plus ancien ; un jour sans échantillon est sauté (la vue dit « référence en construction »
 * tant qu'il n'y a pas sept valeurs).
 */
export function sameHourValues(samples, now) {
  const out = [];
  for (let k = 1; k <= 7; k += 1) {
    const target = now - k * DAY_MS;
    let best = null;
    for (const s of samples) {
      const gap = Math.abs(Date.parse(s.at) - target);
      if (gap <= SAME_HOUR_TOLERANCE_MS && (!best || gap < best.gap)) best = { gap, value: s.airborneZone };
    }
    if (best) out.push(best.value);
  }
  return out;
}

/** Réponse sans aucune donnée (panne du panneau), erreurs nommées. */
export function emptyAirOverview(errors) {
  return {
    at: null, airborneZone: 0, airborneFrance: 0, onGround: 0, emergencies: [], emergencyLog: [], airports: [],
    volume: { samples: [], sameHourPrevDays: [] }, anomalies: [], credits: { remaining: null }, errors,
  };
}

/** Réponse complète (AirOverviewResponse). Un journal des urgences illisible donne une erreur nommée, pas une panne. */
export async function loadAirOverview(now = Date.now()) {
  const c = await ensureAirFresh(now);
  const errors = [...c.errors];
  let emergencyLog = [];
  try {
    emergencyLog = await readLog(EMERGENCY_LOG_KEY, { dateOf: (e) => e.lastSeen, maxAgeMs: 7 * DAY_MS, now });
  } catch (err) {
    errors.push(sourceError('Journal des urgences', err));
  }
  const samples = await readSeries(VOLUME_KEY, { maxAgeMs: 8 * DAY_MS, now });
  const current = c.at ? volumeSample(c.states, c.at) : { airborneZone: 0, airborneFrance: 0 };
  const airports = OVERVIEW_AIRPORTS.map((iata) => FRANCE_AIRPORTS.find((a) => a.iata === iata))
    .filter(Boolean)
    .map((a) => airportActivity(a, c.states, a.iata === 'BVA' ? null : c.departures, c.boards?.[a.iata]));
  const emergencies = c.at
    ? emergenciesFrom(c.states, c.at).map((e) => emergencyLog.find((l) => l.icao24 === e.icao24 && l.squawk === e.squawk) ?? e)
    : [];
  return {
    at: c.at,
    airborneZone: current.airborneZone,
    airborneFrance: current.airborneFrance,
    onGround: c.states.filter((s) => s.onGround).length,
    emergencies: emergencies.filter((e) => EMERGENCY_SQUAWKS.includes(e.squawk)),
    emergencyLog,
    airports,
    volume: { samples, sameHourPrevDays: sameHourValues(samples, c.at ? Date.parse(c.at) : now) },
    anomalies: c.flights.flatMap((f) => (f.anomalies ?? []).map((a) => ({ callsign: f.callsign ?? null, kind: a.type, airport: a.airportIata ?? null, at: c.at }))),
    credits: { remaining: c.credits },
    errors: [...new Set(errors)], // le journal illisible peut être signalé par la collecte et par la lecture ci-dessus
  };
}
