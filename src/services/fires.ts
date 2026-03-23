import type { ActiveFire } from '../types/index.ts';

/**
 * fires.ts — NASA FIRMS Active Fire Data
 * Fetches VIIRS 24h data via /api/fires (proxy serveur, évite CORS).
 * Filtre géographiquement pour la France + Corse.
 * Expose des utilitaires de filtrage avancé (confiance, zone urbaine, persistance).
 */

// ─── Types & constantes de filtre ───────────────────────────────────────────

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

// ─── Fetch ───────────────────────────────────────────────────────────────────

let cachedFires: { data: ActiveFire[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function fetchActiveFires(): Promise<ActiveFire[]> {
    if (cachedFires && Date.now() - cachedFires.timestamp < CACHE_TTL_MS) {
        return cachedFires.data;
    }

    try {
        const response = await fetch('/api/fires', { signal: AbortSignal.timeout(15000) });

        if (!response.ok) {
            console.warn(`[FIRMS] HTTP ${response.status} - retour cache`);
            return cachedFires?.data ?? [];
        }

        const csvData = await response.text();
        const lines = csvData.trim().split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split(',');
        const fires: ActiveFire[] = [];

        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].split(',');
            if (row.length !== headers.length) continue;

            const fire: Record<string, unknown> = {};
            for (let j = 0; j < headers.length; j++) {
                const header = headers[j].trim();
                let value: unknown = row[j].trim();
                if (['latitude', 'longitude', 'bright_ti4', 'scan', 'track', 'bright_ti5', 'frp'].includes(header)) {
                    value = parseFloat(value as string);
                }
                // Normalize VIIRS single-letter confidence ('l','n','h') to full words
                if (header === 'confidence') {
                    if (value === 'l') value = 'low';
                    else if (value === 'n') value = 'nominal';
                    else if (value === 'h') value = 'high';
                }
                fire[header] = value;
            }

            const lat = fire.latitude as number;
            const lon = fire.longitude as number;
            fire.id = `${lat.toFixed(4)}_${lon.toFixed(4)}_${fire.acq_date}_${fire.acq_time}`;

            // Bbox France (métropole + Corse) + marges
            if (lon >= -5.5 && lon <= 10.0 && lat >= 41.0 && lat <= 51.5) {
                fires.push(fire as unknown as ActiveFire);
            }
        }

        cachedFires = { data: fires, timestamp: Date.now() };
        console.log(`[FIRMS] ${fires.length} détections brutes dans la bbox France`);
        return fires;

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[FIRMS] Erreur:', msg);
        return cachedFires?.data ?? [];
    }
}
