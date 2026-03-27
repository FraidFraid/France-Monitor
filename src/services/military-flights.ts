/**
 * military-flights.ts — Fetch military flights via adsb.fi (primary)
 * and opensky (fallback), enriched with hexdb.io aircraft details.
 *
 * Sources:
 *   1. opendata.adsb.fi /v2/mil  → communautaire, non filtré, tag militaire natif
 *   2. api.airplanes.live /v2/mil → même format, deuxième chance
 *   3. OpenSky Network (bounding box France) → fallback si les deux premiers échouent
 *   4. hexdb.io /api/v1/aircraft/{hex} → enrichissement modèle/registration/opérateur
 */

import type { MilitaryFlight } from '../types/index.ts';
import {
    determineAircraftInfo,
    identifyFrenchAircraftType,
    FRENCH_OPERATOR_LABELS,
    FRENCH_OPERATOR_COLORS,
    checkSquawk,
} from '../config/military.ts';
import type { FrenchMilitaryOperator, FrenchAircraftType } from '../types/index.ts';

// ─── API endpoints ───
const ADSB_FI_MIL = 'https://opendata.adsb.fi/api/v2/mil';
const AIRPLANES_MIL = 'https://api.airplanes.live/v2/mil';
const HEXDB_BASE = 'https://hexdb.io/api/v1/aircraft/';

// France bounding box (extended to cover DROMs + ops zones)
const FR_LAMIN = 41.3, FR_LAMAX = 51.5;
const FR_LOMIN = -5.5, FR_LOMAX = 10.0;

// ─── Types ───

/** Aircraft record from adsb.fi / airplanes.live (ADSBexchange v2 format) */
interface AdsbFiAircraft {
    hex: string;             // ICAO24 hex
    type?: string;           // source type
    flight?: string;         // callsign
    r?: string;              // registration
    t?: string;              // ICAO type code (e.g. RFAL, ATLA, C30J)
    desc?: string;           // full description (e.g. "Dassault Rafale")
    ownOp?: string;          // owner/operator string
    dbFlags?: number;        // bitmask (1 = military)
    alt_baro?: number | 'ground';
    alt_geom?: number;
    gs?: number;             // ground speed (knots)
    track?: number;          // true track / heading
    geom_rate?: number;      // climb rate ft/min
    squawk?: string;
    lat?: number;
    lon?: number;
    seen?: number;
    on_ground?: boolean;
    // NAC-P : Navigation Accuracy Category – Position (0–11). Présent dans adsb.fi v2.
    nac_p?: number;
}

interface AdsbFiResponse {
    ac: AdsbFiAircraft[];
}

/** Optional enrichment from hexdb.io */
interface HexdbResult {
    ModeS?: string;
    Registration?: string;
    Manufacturer?: string;
    Type?: string;
    RegisteredOwners?: string;
    ICAOTypeCode?: string;
    Country?: string;
}

// ─── In-memory caches ───

// hexdb enrichment cache (TTL 1h per hex)
const hexdbCache = new Map<string, { data: HexdbResult | null; ts: number }>();
const HEXDB_TTL = 60 * 60 * 1000;

// Flight position trail (last 20 positions per hex)
const flightTrails = new Map<string, [number, number][]>();
const TRAIL_MAX = 20;


// ─── Helper functions ───

function isInFranceZone(lat: number, lon: number): boolean {
    return lat >= FR_LAMIN && lat <= FR_LAMAX && lon >= FR_LOMIN && lon <= FR_LOMAX;
}

function altFeet(ac: AdsbFiAircraft): number {
    if (ac.alt_baro === 'ground' || ac.alt_baro === undefined) return 0;
    if (typeof ac.alt_baro === 'number') return Math.round(ac.alt_baro);
    if (ac.alt_geom !== undefined) return Math.round(ac.alt_geom);
    return 0;
}

/** Try to resolve operator from adsb.fi ownOp or desc fields */
function operatorFromDesc(ownOp?: string, desc?: string): { operator: FrenchMilitaryOperator; label: string } | null {
    const combined = ((ownOp || '') + ' ' + (desc || '')).toUpperCase();
    if (combined.includes('SECURITE CIVILE') || combined.includes('SÉCURITÉ CIVILE') || combined.includes('ZBMH') || combined.includes('F-ZB')) {
        return { operator: 'securite-civile', label: FRENCH_OPERATOR_LABELS['securite-civile'] };
    }
    if (combined.includes('MARINE') || combined.includes('AERONAVALE')) {
        return { operator: 'marine', label: FRENCH_OPERATOR_LABELS['marine'] };
    }
    if (combined.includes('ARMEE DE L AIR') || combined.includes('ARMÉE DE L\'AIR') || combined.includes('FRENCH AIR')) {
        return { operator: 'armee-air', label: FRENCH_OPERATOR_LABELS['armee-air'] };
    }
    if (combined.includes('GENDARMERIE')) {
        return { operator: 'gendarmerie', label: FRENCH_OPERATOR_LABELS['gendarmerie'] };
    }
    if (combined.includes('ALAT') || combined.includes('ARMÉE DE TERRE')) {
        return { operator: 'alat', label: FRENCH_OPERATOR_LABELS['alat'] };
    }
    if (combined.includes('DOUANE')) {
        return { operator: 'douanes', label: FRENCH_OPERATOR_LABELS['douanes'] };
    }
    return null;
}

/** Fetch aircraft details from hexdb.io (with cache) */
async function fetchHexdb(hex: string): Promise<HexdbResult | null> {
    const key = hex.toLowerCase();
    const cached = hexdbCache.get(key);
    if (cached && Date.now() - cached.ts < HEXDB_TTL) return cached.data;

    try {
        const res = await fetch(`${HEXDB_BASE}${key}`, {
            signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) {
            hexdbCache.set(key, { data: null, ts: Date.now() });
            return null;
        }
        const data = await res.json() as HexdbResult;
        hexdbCache.set(key, { data, ts: Date.now() });
        return data;
    } catch {
        hexdbCache.set(key, { data: null, ts: Date.now() });
        return null;
    }
}

/** Map an adsb.fi aircraft to MilitaryFlight, with full classification */
function parseFlight(ac: AdsbFiAircraft, hexdbData?: HexdbResult | null): MilitaryFlight | null {
    const lat = ac.lat;
    const lon = ac.lon;
    if (lat == null || lon == null) return null;

    const hex = ac.hex.toUpperCase();
    const callsign = (ac.flight || '').trim();
    const typeCode = ac.t || hexdbData?.ICAOTypeCode || '';
    const registration = ac.r || hexdbData?.Registration || '';
    const descFull = ac.desc || hexdbData?.Type || '';
    const ownOp = ac.ownOp || hexdbData?.RegisteredOwners || '';

    // 1. Classification par callsign (haute confiance)
    const callsignInfo = determineAircraftInfo(callsign, hex);

    // 2. Enrichissement depuis ownOp/desc (override si meilleur)
    const descOperator = operatorFromDesc(ownOp, descFull);

    // 3. Enrichissement depuis type code ICAO
    const typeInfo = typeCode ? identifyFrenchAircraftType(typeCode) : undefined;

    // Fusion : priorité callsign > ownOp > hexrange > typeCode
    let operator: FrenchMilitaryOperator = callsignInfo.operator;
    let operatorLabel: string = callsignInfo.operatorLabel;
    let confidence = callsignInfo.confidence;
    let aircraftType: FrenchAircraftType = callsignInfo.aircraftType;
    let aircraftModel: string | undefined;

    // Si callsign inconnu mais ownOp/desc donne une info → utiliser
    if (operator === 'unknown' && descOperator) {
        operator = descOperator.operator;
        operatorLabel = descOperator.label;
        confidence = 'medium';
    }

    // Le type code ICAO enrichit le modèle
    if (typeInfo) {
        if (aircraftType === 'unknown') aircraftType = typeInfo.type;
        aircraftModel = typeInfo.model;
    }
    // Utiliser la description complète si pas de modèle trouvé
    if (!aircraftModel && descFull && descFull !== '?') {
        aircraftModel = descFull;
    }

    // Enregistrer dans le trail de position
    let trail = flightTrails.get(hex);
    if (!trail) { trail = []; flightTrails.set(hex, trail); }
    trail.push([lon, lat]);  // [lon, lat] for GeoJSON compatibility
    if (trail.length > TRAIL_MAX) trail.shift();

    const altFt = altFeet(ac);
    const speedKts = ac.gs != null ? Math.round(ac.gs) : 0;

    // Check for emergency squawk codes
    const squawkAlert = checkSquawk(ac.squawk);

    return {
        id: hex.toLowerCase(),
        callsign: callsign || `MIL-${hex.substring(0, 4)}`,
        country: 'France',
        longitude: lon,
        latitude: lat,
        altitude: altFt,
        velocity: speedKts / 1.94384, // m/s (internal field)
        speed: speedKts,
        heading: ac.track || 0,
        lastContact: Date.now() / 1000,
        isMilitary: true,
        hexCode: hex,
        registration: registration || undefined,
        aircraftType,
        aircraftModel,
        operator,
        operatorLabel,
        confidence,
        squawk: ac.squawk || undefined,
        squawkAlert,
        trail: [...trail],  // Copy trail array
        nacP: ac.nac_p,
    };
}

// Track CORS errors to avoid console spam
let adsbCorsErrorLogged = false;

/** Fetch from adsb.fi or airplanes.live, filter to France zone */
async function fetchFromAdsbFi(): Promise<MilitaryFlight[]> {
    const sources = [ADSB_FI_MIL, AIRPLANES_MIL];

    for (const url of sources) {
        try {
            const res = await fetch(url, {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(6000),
                mode: 'cors',
            });
            if (!res.ok) continue;

            const data = await res.json() as AdsbFiResponse;
            const ac = data.ac || [];

            // Filtrer sur la zone France
            const inFrance = ac.filter(a =>
                a.lat != null && a.lon != null && isInFranceZone(a.lat!, a.lon!)
            );

            if (inFrance.length === 0) continue;

            adsbCorsErrorLogged = false; // Reset on success
            console.log(`[Military] ${inFrance.length} vols militaires (via ${url.includes('adsb.fi') ? 'adsb.fi' : 'airplanes.live'})`);

            // Enrichir par lot avec hexdb (en parallèle, max 5 requêtes simultanées)
            const flights: MilitaryFlight[] = [];
            const BATCH = 5;
            for (let i = 0; i < inFrance.length; i += BATCH) {
                const batch = inFrance.slice(i, i + BATCH);
                const hexdbs = await Promise.all(
                    batch.map(a => fetchHexdb(a.hex))
                );
                for (let j = 0; j < batch.length; j++) {
                    const flight = parseFlight(batch[j], hexdbs[j]);
                    if (flight) flights.push(flight);
                }
            }

            return flights;
        } catch (err) {
            // Log CORS errors only once
            if (!adsbCorsErrorLogged) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('CORS') || msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
                    console.warn('[Military] CORS bloqué sur APIs ADS-B - fallback OpenSky ou mocks');
                } else {
                    console.warn(`[Military] ${url.split('/')[2]} indisponible`);
                }
                adsbCorsErrorLogged = true;
            }
        }
    }

    return [];
}

// Track OpenSky errors
let openSkyErrorLogged = false;

/** Fallback: OpenSky bounding box France */
async function fetchFromOpenSky(): Promise<MilitaryFlight[]> {
    try {
        const url = `https://opensky-network.org/api/states/all?lamin=${FR_LAMIN}&lomin=${FR_LOMIN}&lamax=${FR_LAMAX}&lomax=${FR_LOMAX}`;
        const res = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(6000),
            mode: 'cors',
        });
        if (!res.ok) {
            if (!openSkyErrorLogged) {
                console.warn(`[Military] OpenSky HTTP ${res.status}`);
                openSkyErrorLogged = true;
            }
            return [];
        }

        const data = await res.json();
        if (!data.states) return [];

        openSkyErrorLogged = false; // Reset on success

        const flights: MilitaryFlight[] = [];

        for (const state of data.states) {
            const icao24 = (state[0] as string).toUpperCase();
            const callsign = typeof state[1] === 'string' ? state[1].trim() : '';
            const lon = state[5] as number | null;
            const lat = state[6] as number | null;
            if (lon == null || lat == null) continue;

            const info = determineAircraftInfo(callsign, icao24);

            // Garder uniquement high (callsign) ou medium (hex range connu)
            if (info.confidence === 'low') continue;

            const altM = (state[13] || state[7]) as number | null;
            const altFt = altM != null ? Math.round(altM * 3.28084) : 0;
            const velMs = state[9] as number | null;
            const speedKts = velMs != null ? Math.round(velMs * 1.94384) : 0;

            // Enregistrer dans le trail
            let trail = flightTrails.get(icao24);
            if (!trail) { trail = []; flightTrails.set(icao24, trail); }
            trail.push([lon, lat]);  // [lon, lat] for GeoJSON
            if (trail.length > TRAIL_MAX) trail.shift();

            const squawk = state[14] as string | undefined;
            const squawkAlert = checkSquawk(squawk);

            flights.push({
                id: icao24.toLowerCase(),
                callsign: callsign || `MIL-${icao24.substring(0, 4)}`,
                country: state[2] as string,
                longitude: lon,
                latitude: lat,
                altitude: altFt,
                velocity: velMs || 0,
                speed: speedKts,
                heading: (state[10] as number) || 0,
                lastContact: (state[3] as number) || Date.now() / 1000,
                isMilitary: true,
                hexCode: icao24,
                aircraftType: info.aircraftType,
                operator: info.operator,
                operatorLabel: info.operatorLabel,
                confidence: info.confidence,
                squawk,
                squawkAlert,
                trail: [...trail],
            });
        }

        return flights;
    } catch (err) {
        if (!openSkyErrorLogged) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('CORS') || msg.includes('Failed to fetch')) {
                console.warn('[Military] OpenSky CORS bloqué');
            } else {
                console.warn('[Military] OpenSky indisponible');
            }
            openSkyErrorLogged = true;
        }
        return [];
    }
}

// ─── Mock flights enrichis (affichés si aucune source réelle ne répond) ───
const MOCK_FLIGHTS: MilitaryFlight[] = (() => {
    const raw = [
        { id: '3b7b63', callsign: 'MILAN7V', lon: 1.22, lat: 49.03, altitude: 1100, speed: 180, heading: 180, t: 'DH8D', desc: 'De Havilland DHC-8-400 Dash 8', reg: 'F-ZBMH' },
        { id: '3b9bd6', callsign: 'FNY5627', lon: 4.92, lat: 43.52, altitude: 23000, speed: 280, heading: 90, t: 'ATLA', desc: 'Breguet Atlantique 2', reg: '18' },
        { id: '3aabf8', callsign: 'FMY8030', lon: 5.92, lat: 43.12, altitude: 16000, speed: 220, heading: 45, t: 'TBM7', desc: 'Socata TBM-700', reg: '160' },
        { id: '3b75ec', callsign: 'CTM2081', lon: -0.51, lat: 43.91, altitude: 26000, speed: 310, heading: 320, t: 'C30J', desc: 'Lockheed Martin KC-130J Hercules', reg: '5890' },
        { id: '3a9f12', callsign: 'FAF4503', lon: 4.90, lat: 48.64, altitude: 8000, speed: 480, heading: 270, t: 'RFAL', desc: 'Dassault Rafale', reg: '' },
        { id: '3b8901', callsign: 'FGN221', lon: -4.50, lat: 48.38, altitude: 500, speed: 80, heading: 200, t: 'EC45', desc: 'Airbus Helicopters EC-145', reg: 'F-MFGC' },
        { id: '3b7b89', callsign: 'DRAGO06', lon: 2.36, lat: 48.85, altitude: 150, speed: 70, heading: 220, t: 'EC45', desc: 'Airbus Helicopters EC-145 (Séc. Civile)', reg: 'F-ZBQU' },
        { id: '3a8021', callsign: 'FAT501', lon: 3.87, lat: 43.60, altitude: 800, speed: 130, heading: 110, t: 'AS3', desc: 'Eurocopter AS332 Cougar', reg: '' },
    ];
    return raw.map(r => {
        const info = determineAircraftInfo(r.callsign, r.id);
        const typeInfo = identifyFrenchAircraftType(r.t);
        // Check securite civile by registration
        let operator = info.operator;
        let operatorLabel = info.operatorLabel;
        if (r.reg.startsWith('F-ZB')) {
            operator = 'securite-civile';
            operatorLabel = FRENCH_OPERATOR_LABELS['securite-civile'];
        }
        return {
            id: r.id,
            callsign: r.callsign,
            country: 'France',
            longitude: r.lon,
            latitude: r.lat,
            altitude: r.altitude,
            velocity: r.speed / 1.94384,
            speed: r.speed,
            heading: r.heading,
            lastContact: Date.now() / 1000,
            isMilitary: true,
            hexCode: r.id.toUpperCase(),
            registration: r.reg || undefined,
            aircraftType: typeInfo?.type ?? info.aircraftType,
            aircraftModel: r.desc,
            operator,
            operatorLabel,
            confidence: info.confidence,
        };
    });
})();

// ─── Main export ───

// Proxy endpoint for military flights (bypasses CORS)
const MILITARY_PROXY_URL = '/api/traffic/military';

// Track if we've logged the mock fallback
let mockFallbackLogged = false;
let proxyErrorLogged = false;

interface ProxyAircraft {
    hex: string;
    callsign?: string;
    latitude: number;
    longitude: number;
    altitude: number;
    speed: number;
    heading: number;
    registration?: string;
    typeCode?: string;
    description?: string;
    operator?: string;
    squawk?: string;
    dbFlags?: number;
    lastSeen: number;
    source: string;
}

interface ProxyResponse {
    source: string;
    fetchedAt: number;
    ttlMs: number;
    aircraft: ProxyAircraft[];
    errors: Array<{ source: string; message: string }>;
}

/**
 * Parse aircraft from proxy response into MilitaryFlight
 */
function parseProxyAircraft(ac: ProxyAircraft): MilitaryFlight | null {
    const hex = ac.hex.toUpperCase();
    const callsign = ac.callsign?.trim() || '';

    // Classification by callsign and hex range
    const info = determineAircraftInfo(callsign, hex);

    // For OpenSky data without military flag, only keep high/medium confidence
    if (ac.source === 'opensky' && info.confidence === 'low') {
        return null;
    }

    // Enrichment from description/operator fields
    const descOperator = operatorFromDesc(ac.operator, ac.description);
    const typeInfo = ac.typeCode ? identifyFrenchAircraftType(ac.typeCode) : undefined;

    let operator: FrenchMilitaryOperator = info.operator;
    let operatorLabel: string = info.operatorLabel;
    let confidence = info.confidence;
    let aircraftType: FrenchAircraftType = info.aircraftType;
    let aircraftModel: string | undefined;

    if (operator === 'unknown' && descOperator) {
        operator = descOperator.operator;
        operatorLabel = descOperator.label;
        confidence = 'medium';
    }

    if (typeInfo) {
        if (aircraftType === 'unknown') aircraftType = typeInfo.type;
        aircraftModel = typeInfo.model;
    }
    if (!aircraftModel && ac.description) {
        aircraftModel = ac.description;
    }

    // Update flight trail
    let trail = flightTrails.get(hex);
    if (!trail) { trail = []; flightTrails.set(hex, trail); }
    trail.push([ac.longitude, ac.latitude]);
    if (trail.length > TRAIL_MAX) trail.shift();

    const squawkAlert = checkSquawk(ac.squawk);

    return {
        id: hex.toLowerCase(),
        callsign: callsign || `MIL-${hex.substring(0, 4)}`,
        country: 'France',
        longitude: ac.longitude,
        latitude: ac.latitude,
        altitude: ac.altitude,
        velocity: ac.speed / 1.94384,
        speed: ac.speed,
        heading: ac.heading,
        lastContact: ac.lastSeen / 1000,
        isMilitary: true,
        hexCode: hex,
        registration: ac.registration,
        aircraftType,
        aircraftModel,
        operator,
        operatorLabel,
        confidence,
        squawk: ac.squawk,
        squawkAlert,
        trail: [...trail],
        // NAC-P non disponible via le proxy — détection en mode best-effort
        nacP: undefined,
    };
}

export async function fetchMilitaryFlights(): Promise<MilitaryFlight[]> {
    try {
        // Use proxy to bypass CORS
        const response = await fetch(MILITARY_PROXY_URL, {
            signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
            throw new Error(`Proxy HTTP ${response.status}`);
        }

        const data = await response.json() as ProxyResponse;

        if (data.errors?.length > 0 && !proxyErrorLogged) {
            const sources = data.errors.map(e => e.source).join(', ');
            console.warn(`[Military] Upstream errors: ${sources}`);
            proxyErrorLogged = true;
        }

        if (data.aircraft?.length > 0) {
            proxyErrorLogged = false;
            mockFallbackLogged = false;

            const flights = data.aircraft
                .map(parseProxyAircraft)
                .filter((f): f is MilitaryFlight => f !== null);

            if (flights.length > 0) {
                console.log(`[Military] ${flights.length} vols via proxy (${data.source})`);
                return flights;
            }
        }
    } catch (err) {
        if (!proxyErrorLogged) {
            console.warn('[Military] Proxy indisponible, fallback données démo');
            proxyErrorLogged = true;
        }
    }

    // Fallback: try legacy direct calls (may fail with CORS in browser)
    const adsbFlights = await fetchFromAdsbFi();
    if (adsbFlights.length > 0) {
        mockFallbackLogged = false;
        return adsbFlights;
    }

    const oskyFlights = await fetchFromOpenSky();
    if (oskyFlights.length > 0) {
        mockFallbackLogged = false;
        console.log(`[Military] ${oskyFlights.length} vols via OpenSky direct`);
        return oskyFlights;
    }

    // Mock data as last resort
    if (!mockFallbackLogged) {
        console.log('[Military] Utilisation des données de démonstration');
        mockFallbackLogged = true;
    }
    return MOCK_FLIGHTS;
}

/**
 * Interpole la position d'un vol entre deux updates API.
 *
 * Projette la position actuelle en avant selon le cap et la vitesse,
 * en fonction du temps écoulé depuis `lastContact`.
 * Utilisé pour animer les icônes avions de façon fluide côté client.
 *
 * @param flight  MilitaryFlight avec longitude, latitude, heading, speed, lastContact
 * @param now     Timestamp courant en secondes (défaut : Date.now() / 1000)
 * @returns       { latitude, longitude } interpolés
 */
export function interpolateFlightPosition(
    flight: MilitaryFlight,
    now: number = Date.now() / 1000
): { latitude: number; longitude: number } {
    const elapsedSec = Math.max(0, Math.min(now - flight.lastContact, 60)); // cap à 60s
    if (elapsedSec === 0 || flight.speed === 0) {
        return { latitude: flight.latitude, longitude: flight.longitude };
    }

    // Conversion : knots → m/s, puis distance en mètres
    const speedMs = flight.speed * 0.514444;
    const distanceM = speedMs * elapsedSec;

    // Projection sphérique simplifiée (précision suffisante à l'échelle France)
    const headingRad = (flight.heading * Math.PI) / 180;
    const latRad = (flight.latitude * Math.PI) / 180;

    const dLat = (distanceM * Math.cos(headingRad)) / 111_320;
    const dLon = (distanceM * Math.sin(headingRad)) / (111_320 * Math.cos(latRad));

    return {
        latitude:  flight.latitude  + dLat,
        longitude: flight.longitude + dLon,
    };
}

/** Get all operator colors (for legend/UI) */
export { FRENCH_OPERATOR_COLORS };
