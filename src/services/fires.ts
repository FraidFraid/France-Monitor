import type { ActiveFire } from '../types/index.ts';
import type { FireIncident } from '../types/index.ts';
import { clusterFireDetections } from './fire-clustering.ts';

/**
 * fires.ts — NASA FIRMS Active Fire Data
 *
 * Fetche les détections VIIRS via /api/fires (JSON depuis api/fires.js).
 * - Avec clé NASA_FIRMS_API_KEY : 3 sources VIIRS SNPP + NOAA-20 + NOAA-21
 * - Sans clé : CSV public SUOMI VIIRS Europe, filtré France côté serveur
 *
 * Filtre géographiquement sur la France + Corse (sécurité côté client).
 * Expose des utilitaires de filtrage avancé (confiance, zone urbaine, persistance).
 * Expose `fetchFiresData()` qui retourne détections + incidents DBSCAN.
 */

// ─── Types & constantes de filtre ────────────────────────────────────────────

export interface FiresFilterState {
    minConfidence: 'low' | 'nominal' | 'high';
    hideUrban: boolean;
    minPersistence: number; // 1 = toutes, 2 = ≥2 passes, 3 = ≥3 passes
}

export const DEFAULT_FIRES_FILTER: FiresFilterState = {
    minConfidence: 'nominal',
    hideUrban: false,
    minPersistence: 1,
};

// Zones urbaines et industrielles françaises [lat, lon, rayon_en_degrés]
// ~0.10° ≈ 10-11 km à la latitude de la France
const URBAN_AREAS: [number, number, number][] = [
    [48.86, 2.35,  0.35], // Paris Île-de-France
    [45.75, 4.84,  0.15], // Lyon
    [43.30, 5.37,  0.15], // Marseille
    [43.60, 1.44,  0.12], // Toulouse
    [43.70, 7.27,  0.10], // Nice
    [47.22, -1.55, 0.14], // Nantes / Saint-Nazaire (port)
    [48.58, 7.75,  0.10], // Strasbourg
    [43.61, 3.87,  0.10], // Montpellier
    [44.84, -0.58, 0.12], // Bordeaux
    [50.63, 3.07,  0.12], // Lille
    [51.03, 2.38,  0.10], // Dunkerque (port + aciéries ArcelorMittal)
    [48.11, -1.68, 0.10], // Rennes
    [49.49, 0.11,  0.10], // Le Havre (grand port + raffineries TotalEnergies)
    [45.43, 4.39,  0.10], // Saint-Étienne
    [43.12, 5.93,  0.10], // Toulon (port militaire)
    [45.19, 5.72,  0.10], // Grenoble
    [49.44, 1.10,  0.10], // Rouen (industrie pétrochimique)
    [49.12, 6.18,  0.08], // Metz
    [47.32, 5.04,  0.08], // Dijon
    [48.31, -4.44, 0.10], // Brest (arsenal naval)
    [50.95, 1.86,  0.08], // Calais (port)
    [48.69, 6.18,  0.10], // Nancy
    [47.75, 7.34,  0.08], // Mulhouse (zone industrielle)
    [43.84, 4.36,  0.10], // Nîmes
    [47.39, 0.69,  0.10], // Tours
    [48.39, -4.49, 0.08], // Brest sud
    [43.95, 4.81,  0.08], // Avignon
];

function isInUrbanArea(lat: number, lon: number): boolean {
    return URBAN_AREAS.some(([clat, clon, r]) => {
        const dl = lat - clat;
        const dL = lon - clon;
        return dl * dl + dL * dL < r * r;
    });
}

/**
 * Calcule la persistance de chaque feu : nombre de fenêtres d'acquisition
 * distinctes détectées à la même maille ~0.05° (~5 km).
 * Un feu persistant a été vu lors de plusieurs passages satellites.
 */
function computePersistenceMap(fires: ActiveFire[]): Map<string, number> {
    // cellKey → Set<acq_date_time>
    const cellTimes = new Map<string, Set<string>>();
    for (const f of fires) {
        const gridLat = (Math.round(f.latitude  / 0.05) * 0.05).toFixed(2);
        const gridLon = (Math.round(f.longitude / 0.05) * 0.05).toFixed(2);
        const cell = `${gridLat}_${gridLon}`;
        if (!cellTimes.has(cell)) cellTimes.set(cell, new Set());
        cellTimes.get(cell)!.add(`${f.acq_date}_${f.acq_time}`);
    }
    // fireId → nb de passages distincts dans sa maille
    const result = new Map<string, number>();
    for (const f of fires) {
        const gridLat = (Math.round(f.latitude  / 0.05) * 0.05).toFixed(2);
        const gridLon = (Math.round(f.longitude / 0.05) * 0.05).toFixed(2);
        const cell = `${gridLat}_${gridLon}`;
        result.set(f.id, cellTimes.get(cell)?.size ?? 1);
    }
    return result;
}

export function applyFiresFilter(fires: ActiveFire[], filter: FiresFilterState): ActiveFire[] {
    const CONF_ORDER: Record<string, number> = { low: 0, nominal: 1, high: 2 };
    const minOrder = CONF_ORDER[filter.minConfidence] ?? 0;

    // Persistance calculée sur l'ensemble brut (avant les autres filtres)
    const persistMap = filter.minPersistence > 1
        ? computePersistenceMap(fires)
        : null;

    return fires.filter(f => {
        if ((CONF_ORDER[f.confidence] ?? 0) < minOrder) return false;
        if (filter.hideUrban && isInUrbanArea(f.latitude, f.longitude)) return false;
        if (persistMap && (persistMap.get(f.id) ?? 1) < filter.minPersistence) return false;
        return true;
    });
}

// ─── Réponse API ──────────────────────────────────────────────────────────────

export interface FiresApiResponse {
    /** Détections brutes VIIRS filtrées France */
    detections: ActiveFire[];
    /** Incidents DBSCAN calculés côté client */
    incidents: FireIncident[];
    /** Sources satellites utilisées (ex: ['SNPP', 'NOAA-20']) */
    sources: string[];
    /** Timestamp de la requête upstream (ms) */
    fetchedAt: number;
    /** true si une clé API NASA FIRMS a été utilisée */
    apiKeyUsed: boolean;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let _cache: { data: FiresApiResponse; timestamp: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h (FIRMS se met à jour toutes les ~3h)

// ─── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Fetche les détections feux actifs et calcule les incidents DBSCAN.
 *
 * Rétro-compatible : retourne `detections` (= ancien retour de fetchActiveFires).
 * Les incidents sont calculés côté client sur les données brutes.
 */
export async function fetchFiresData(): Promise<FiresApiResponse> {
    if (_cache && Date.now() - _cache.timestamp < CACHE_TTL_MS) {
        return _cache.data;
    }

    try {
        const response = await fetch('/api/fires', { signal: AbortSignal.timeout(20_000) });

        if (!response.ok) {
            console.warn(`[FIRMS] HTTP ${response.status} - retour cache`);
            return _cache?.data ?? { detections: [], incidents: [], sources: [], fetchedAt: 0, apiKeyUsed: false };
        }

        const json = await response.json() as {
            detections?: unknown[];
            sources?: string[];
            fetchedAt?: number;
            apiKeyUsed?: boolean;
        };

        // Validation + normalisation des détections
        const rawDetections = Array.isArray(json.detections) ? json.detections : [];
        const detections: ActiveFire[] = [];

        for (const row of rawDetections) {
            if (typeof row !== 'object' || row === null) continue;
            const r = row as Record<string, unknown>;

            const lat = Number(r.latitude  ?? 0);
            const lon = Number(r.longitude ?? 0);

            // Sécurité : bbox France côté client (double check)
            if (lon < -5.5 || lon > 10.0 || lat < 41.0 || lat > 51.5) continue;
            if (!isFinite(lat) || !isFinite(lon)) continue;

            const acqDate = String(r.acq_date ?? '');
            const acqTime = String(r.acq_time ?? '0000');
            const id = r.id ? String(r.id) : `${lat.toFixed(4)}_${lon.toFixed(4)}_${acqDate}_${acqTime}`;

            detections.push({
                id,
                latitude:   lat,
                longitude:  lon,
                bright_ti4: Number(r.bright_ti4 ?? 0),
                bright_ti5: Number(r.bright_ti5 ?? 0),
                scan:       Number(r.scan       ?? 0),
                track:      Number(r.track      ?? 0),
                frp:        Number(r.frp        ?? 0),
                acq_date:   acqDate,
                acq_time:   acqTime,
                satellite:  String(r.satellite  ?? ''),
                confidence: String(r.confidence ?? 'nominal'),
                version:    String(r.version    ?? ''),
                daynight:   String(r.daynight   ?? 'D'),
            });
        }

        // Clustering DBSCAN côté client (eps = 3 km, minPoints = 2)
        const incidents = clusterFireDetections(detections, { epsKm: 3, minPoints: 2 });

        const result: FiresApiResponse = {
            detections,
            incidents,
            sources:    Array.isArray(json.sources) ? json.sources as string[] : ['SNPP'],
            fetchedAt:  typeof json.fetchedAt === 'number' ? json.fetchedAt : Date.now(),
            apiKeyUsed: Boolean(json.apiKeyUsed),
        };

        _cache = { data: result, timestamp: Date.now() };
        console.log(`[FIRMS] ${detections.length} détections · ${incidents.length} incidents · sources: ${result.sources.join(', ')}`);
        return result;

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[FIRMS] Erreur:', msg);
        return _cache?.data ?? { detections: [], incidents: [], sources: [], fetchedAt: 0, apiKeyUsed: false };
    }
}

/**
 * Raccourci rétro-compatible : retourne seulement les ActiveFire[].
 * Utilisé par App.ts (currentActiveFires) et FiresPanel.
 */
export async function fetchActiveFires(): Promise<ActiveFire[]> {
    const { detections } = await fetchFiresData();
    return detections;
}
