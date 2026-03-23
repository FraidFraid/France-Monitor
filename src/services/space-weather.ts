/**
 * space-weather.ts — Météo spatiale NOAA SWPC
 *
 * Sources :
 *  - NOAA SWPC Kp index (1 min) : https://services.swpc.noaa.gov
 *
 * Exports :
 *  - fetchSpaceWeather()        → Kp courant + niveau d'alerte
 *  - computeTerminatorGeoJSON() → Polygone GeoJSON côté nuit (layer carte)
 */

import type * as GeoJSON from 'geojson';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpaceWeatherData {
    kpIndex:    number;
    level:      'quiet' | 'unsettled' | 'active' | 'storm-g1' | 'storm-g2' | 'storm-g3' | 'extreme';
    levelLabel: string;
    riskFrance: string;
    color:      string;
    fetchedAt:  Date;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 15 * 60_000; // 15 min (données Kp : update toutes les 3 min)
let _cache: { data: SpaceWeatherData; ts: number } | null = null;

// ── Classification Kp ─────────────────────────────────────────────────────────

function classifyKp(kp: number): Omit<SpaceWeatherData, 'kpIndex' | 'fetchedAt'> {
    if (kp >= 8) return {
        level: 'extreme',   levelLabel: 'Extrême G4-G5',
        color: '#7C3AED',
        riskFrance: 'Coupures HTA possibles en France, dommages transformateurs',
    };
    if (kp >= 7) return {
        level: 'storm-g3',  levelLabel: 'Tempête G3',
        color: '#DC2626',
        riskFrance: 'Perturbations réseau haute tension, GPS et HF dégradés',
    };
    if (kp >= 6) return {
        level: 'storm-g2',  levelLabel: 'Tempête G2',
        color: '#EA580C',
        riskFrance: 'Corrections orbitales satellites, radio HF perturbée',
    };
    if (kp >= 5) return {
        level: 'storm-g1',  levelLabel: 'Tempête G1',
        color: '#D97706',
        riskFrance: 'Faibles fluctuations réseau électrique haute tension',
    };
    if (kp >= 4) return {
        level: 'active',    levelLabel: 'Active',
        color: '#CA8A04',
        riskFrance: 'Activité géomagnétique modérée — surveillance recommandée',
    };
    if (kp >= 2) return {
        level: 'unsettled', levelLabel: 'Agitée',
        color: '#16A34A',
        riskFrance: 'Aucun risque infrastructure',
    };
    return {
        level: 'quiet',     levelLabel: 'Calme',
        color: '#15803D',
        riskFrance: 'Aucun risque infrastructure',
    };
}

// ── Fetch NOAA SWPC ───────────────────────────────────────────────────────────

export async function fetchSpaceWeather(): Promise<SpaceWeatherData> {
    if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.data;

    try {
        const res = await fetch(
            'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
            { signal: AbortSignal.timeout(8_000) }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json() as Array<{ time_tag: string; kp_index: number }>;
        const last = json[json.length - 1];
        const kp = Math.round(last?.kp_index ?? 0);

        const data: SpaceWeatherData = { kpIndex: kp, ...classifyKp(kp), fetchedAt: new Date() };
        _cache = { data, ts: Date.now() };
        return data;

    } catch {
        return _cache?.data ?? { kpIndex: 0, ...classifyKp(0), fetchedAt: new Date() };
    }
}

// ── Terminateur jour/nuit ─────────────────────────────────────────────────────

const DEG = Math.PI / 180;

/** Calcule la position du point subsolaire (approx. 0.01° de précision). */
function subsolarPoint(date: Date): { lat: number; lon: number } {
    const JD     = date.getTime() / 86_400_000 + 2_440_587.5;
    const n      = JD - 2_451_545.0;

    const L      = (280.46 + 0.9856474 * n) % 360;
    const g      = ((357.528 + 0.9856003 * n) % 360) * DEG;
    const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;

    const epsilon = 23.439 * DEG;
    const lat     = Math.asin(Math.sin(epsilon) * Math.sin(lambda)) / DEG;

    const GMST   = (18.697375 + 24.065709824279 * n) % 24;
    const RA_deg = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) / DEG;
    const lon    = ((RA_deg - GMST * 15 + 540) % 360) - 180;

    return { lat, lon };
}

/**
 * Calcule le polygone GeoJSON représentant la zone de nuit.
 * Prêt à être injecté dans une source MapLibre via `source.setData()`.
 *
 * Algorithme : pour chaque longitude θ, la latitude du terminateur est
 *   φ = atan(-cos(θ − θ☉) / tan(δ☉))
 * où δ☉ = déclinaison solaire et θ☉ = longitude subsolaire.
 */
export function computeTerminatorGeoJSON(date: Date = new Date()): GeoJSON.FeatureCollection {
    const { lat: sunLat, lon: sunLon } = subsolarPoint(date);

    // Évite la division par zéro à l'équinoxe (tan(0°) = 0)
    const safeDec = Math.abs(sunLat) < 0.5 ? (sunLat >= 0 ? 0.5 : -0.5) : sunLat;
    const decRad  = safeDec * DEG;

    const pts: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon++) {
        const H   = (lon - sunLon) * DEG;
        const lat = Math.atan2(-Math.cos(H), Math.tan(decRad)) / DEG;
        pts.push([lon, Math.max(-89.9, Math.min(89.9, lat))]);
    }

    // Le pôle en nuit dépend de l'hémisphère du soleil
    // sunLat > 0 (été boréal) → pôle nord éclairé → on ferme par le pôle SUD (nuit)
    // mais la ligne du terminateur part de -180 vers +180, donc le cap doit fermer
    // du côté OPPOSÉ au soleil pour enclore la bonne moitié
    const nightCap: [number, number][] = sunLat >= 0
        ? [[180,  90], [-180,  90]]   // soleil nord → fermer par pôle nord (côté nuit)
        : [[180, -90], [-180, -90]];  // soleil sud → fermer par pôle sud (côté nuit)

    const ring: [number, number][] = [...pts, ...nightCap, pts[0]];

    return {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [ring] },
            properties: { sunLat, sunLon },
        }],
    };
}
