/**
 * fire-clustering.ts — Clustering DBSCAN des détections VIIRS en incidents feux
 *
 * Hypothèses :
 *  - Coordonnées en SRID 4326 (lat/lon WGS-84)
 *  - Distance haversine en km (sphère unité R = 6371 km)
 *  - eps par défaut : 3 km  (détections à moins de 3 km = même foyer potentiel)
 *  - minPoints par défaut : 2 (un seul point isolé peut être bruit)
 *  - Durée max pour cluster temporel : 48 h (même foyer sur 2 jours = même incident)
 *
 * On ne fait PAS de clustering temporel strict (trop complexe sans BDD) ;
 * la persistance est déjà capturée dans fires.ts via computePersistenceMap.
 * Ici on clusterise uniquement dans l'espace.
 */

import type { ActiveFire, FireIncident, FireIncidentScore } from '../types/index.ts';

// ─── Constantes ─────────────────────────────────────────────────────────────

/** Rayon de la Terre (km) */
const EARTH_R_KM = 6371;

/** Zones urbaines/industrielles françaises [lat, lon, rayon_km]
 *  Copiées et étendues depuis fires.ts pour la détection de proximité.
 */
const URBAN_ZONES_KM: [number, number, number][] = [
    [48.86,  2.35,  30], // Paris Île-de-France
    [45.75,  4.84,  15], // Lyon
    [43.30,  5.37,  15], // Marseille
    [43.60,  1.44,  12], // Toulouse
    [43.70,  7.27,  10], // Nice
    [47.22, -1.55,  14], // Nantes / Saint-Nazaire
    [48.58,  7.75,  10], // Strasbourg
    [43.61,  3.87,  10], // Montpellier
    [44.84, -0.58,  12], // Bordeaux
    [50.63,  3.07,  12], // Lille
    [51.03,  2.38,  10], // Dunkerque
    [48.11, -1.68,  10], // Rennes
    [49.49,  0.11,  10], // Le Havre (raffineries)
    [45.43,  4.39,  10], // Saint-Étienne
    [43.12,  5.93,  10], // Toulon
    [45.19,  5.72,  10], // Grenoble
    [49.44,  1.10,  10], // Rouen (pétrochimie)
    [49.12,  6.18,   8], // Metz
    [47.32,  5.04,   8], // Dijon
    [48.31, -4.44,  10], // Brest
    [50.95,  1.86,   8], // Calais
    [48.69,  6.18,  10], // Nancy
    [47.75,  7.34,   8], // Mulhouse
];

// ─── Haversine ───────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R_KM * Math.asin(Math.sqrt(a));
}

function isNearUrban(lat: number, lon: number): boolean {
    return URBAN_ZONES_KM.some(
        ([clat, clon, r]) => haversineKm(lat, lon, clat, clon) <= r
    );
}

// ─── DBSCAN ──────────────────────────────────────────────────────────────────

interface DbscanOptions {
    /** Distance maximale en km pour deux points du même cluster (défaut : 3 km) */
    epsKm?: number;
    /** Nombre minimum de points pour former un cluster (défaut : 2) */
    minPoints?: number;
}

const NOISE = -1;
const UNVISITED = 0;

/**
 * Implémentation DBSCAN 2D (haversine) sur un tableau de points.
 * Retourne un tableau de même longueur que `points`, chaque élément
 * étant l'id du cluster (1-indexed) ou -1 (bruit).
 */
function dbscan(
    points: { lat: number; lon: number }[],
    epsKm: number,
    minPoints: number
): number[] {
    const n = points.length;
    const labels: number[] = new Array(n).fill(UNVISITED);
    let clusterId = 0;

    const getNeighbors = (idx: number): number[] => {
        const neighbors: number[] = [];
        const p = points[idx];
        for (let j = 0; j < n; j++) {
            if (j === idx) continue;
            if (haversineKm(p.lat, p.lon, points[j].lat, points[j].lon) <= epsKm) {
                neighbors.push(j);
            }
        }
        return neighbors;
    };

    for (let i = 0; i < n; i++) {
        if (labels[i] !== UNVISITED) continue;

        const neighbors = getNeighbors(i);

        if (neighbors.length < minPoints - 1) {
            // -1 car i lui-même compte comme voisin
            labels[i] = NOISE;
            continue;
        }

        clusterId++;
        labels[i] = clusterId;

        const seeds = [...neighbors];
        let si = 0;
        while (si < seeds.length) {
            const q = seeds[si++];
            if (labels[q] === NOISE) labels[q] = clusterId;
            if (labels[q] !== UNVISITED) continue;

            labels[q] = clusterId;
            const qNeighbors = getNeighbors(q);
            if (qNeighbors.length >= minPoints - 1) {
                for (const nb of qNeighbors) {
                    if (!seeds.includes(nb)) seeds.push(nb);
                }
            }
        }
    }

    return labels;
}

// ─── Parsing date FIRMS ──────────────────────────────────────────────────────

function firmsDateToMs(acqDate: string, acqTime: string): number {
    const padded = String(acqTime).padStart(4, '0');
    return new Date(`${acqDate}T${padded.slice(0, 2)}:${padded.slice(2)}:00Z`).getTime();
}

// ─── Score ────────────────────────────────────────────────────────────────────

/**
 * Calcule le score de sévérité/impact d'un incident feu.
 *
 * severityScore : intensité intrinsèque (FRP, persistance, % haute confiance).
 * impactScore   : dangerosité contextuelle (zone urbaine/infra, détection nocturne,
 *                 multi-satellite = confirmé, durée étendue).
 *
 * Toutes les contributions sont linéairement interpolées entre 0 et leur plafond.
 */
function computeIncidentScore(incident: Omit<FireIncident, 'score'>): FireIncidentScore {
    const labels: string[] = [];
    let severity = 0;
    let impact = 0;

    // ── Severity : FRP moyen ─────────────────────────────────────────────────
    // 0 MW → 0, 50 MW → max (plafond pratique pour la France)
    const frpContrib = Math.min((incident.frpMean / 50) * 45, 45);
    severity += frpContrib;
    if (incident.frpMean >= 20) labels.push('high_frp');

    // ── Severity : FRP max (bonification feux extrêmes) ──────────────────────
    const frpMaxContrib = Math.min((incident.frpMax / 100) * 15, 15);
    severity += frpMaxContrib;

    // ── Severity : persistance (nombre de détections, proxy multi-passes) ────
    // 1 détection → 0, 10+ → 20 pts
    const persistContrib = Math.min(((incident.detectionsCount - 1) / 9) * 20, 20);
    severity += persistContrib;
    if (incident.detectionsCount >= 5) labels.push('persistent');

    // ── Severity : pénalité confiance basse ──────────────────────────────────
    if (incident.confidenceMax === 'low') {
        severity *= 0.6;
        labels.push('low_confidence');
    } else if (incident.confidenceMax === 'high') {
        severity = Math.min(severity * 1.1, 100);
        labels.push('high_confidence');
    }

    // ── Impact : proximité zone urbaine/infra ─────────────────────────────────
    if (incident.nearUrban) {
        impact += 40;
        labels.push('near_urban');
    }

    // ── Impact : durée (feux de longue durée = plus dangereux) ───────────────
    // 0 min → 0, 360 min (6h) → 20 pts
    const durContrib = Math.min((incident.durationMinutes / 360) * 20, 20);
    impact += durContrib;

    // ── Impact : détection nocturne (feux de nuit = moins maîtrisés) ─────────
    if (incident.hasNightDetection) {
        impact += 15;
        labels.push('night');
    }

    // ── Impact : confirmation multi-satellite ─────────────────────────────────
    if (incident.satellites.length >= 2) {
        impact += 10;
        labels.push('multi_satellite');
    }

    // ── Impact : FRP total (taille absolue de l'incendie) ────────────────────
    const totalContrib = Math.min((incident.frpTotal / 200) * 15, 15);
    impact += totalContrib;

    return {
        severityScore: Math.min(Math.round(severity), 100),
        impactScore:   Math.min(Math.round(impact), 100),
        labels,
    };
}

// ─── Cluster → FireIncident ──────────────────────────────────────────────────

function buildIncident(
    clusterFires: ActiveFire[],
    epsKm: number,
    minPoints: number,
    clusterIdx: number
): FireIncident {
    const frpTotal = clusterFires.reduce((s, f) => s + (f.frp || 0), 0);
    const frpMax   = Math.max(...clusterFires.map(f => f.frp || 0));
    const frpMean  = frpTotal / clusterFires.length;

    // Centro-centroïde pondéré par FRP (ou équiprobable si toutes FRP = 0)
    const weight = frpTotal > 0 ? frpTotal : clusterFires.length;
    const centroidLat = clusterFires.reduce(
        (s, f) => s + f.latitude  * ((frpTotal > 0 ? (f.frp || 0) : 1) / weight), 0
    );
    const centroidLon = clusterFires.reduce(
        (s, f) => s + f.longitude * ((frpTotal > 0 ? (f.frp || 0) : 1) / weight), 0
    );

    // Bbox
    const lats = clusterFires.map(f => f.latitude);
    const lons = clusterFires.map(f => f.longitude);
    const bboxMinLat = Math.min(...lats);
    const bboxMaxLat = Math.max(...lats);
    const bboxMinLon = Math.min(...lons);
    const bboxMaxLon = Math.max(...lons);

    // Timestamps
    const timestamps = clusterFires.map(f => firmsDateToMs(f.acq_date, f.acq_time));
    const tMin = Math.min(...timestamps);
    const tMax = Math.max(...timestamps);

    // Confiance max
    const confOrder: Record<string, number> = { low: 0, nominal: 1, high: 2 };
    const confidenceMax = clusterFires.reduce<'high' | 'nominal' | 'low'>(
        (best, f) => {
            const c = f.confidence as 'high' | 'nominal' | 'low';
            return (confOrder[c] ?? 0) > (confOrder[best] ?? 0) ? c : best;
        },
        'low'
    );

    // Satellites distincts
    const satellites = [...new Set(clusterFires.map(f => f.satellite || '').filter(Boolean))];

    // Nuit ?
    const hasNightDetection = clusterFires.some(f => f.daynight === 'N');

    // Proximité zone urbaine (centroïde)
    const nearUrban = isNearUrban(centroidLat, centroidLon);

    // ID déterministe
    const id = `inc_${clusterIdx}_${tMin}_${centroidLat.toFixed(3)}_${centroidLon.toFixed(3)}`;

    const base: Omit<FireIncident, 'score'> = {
        id,
        centroidLat,
        centroidLon,
        bboxMinLat,
        bboxMaxLat,
        bboxMinLon,
        bboxMaxLon,
        detectionsCount: clusterFires.length,
        frpMean,
        frpMax,
        frpTotal,
        confidenceMax,
        startDatetime: new Date(tMin).toISOString(),
        endDatetime:   new Date(tMax).toISOString(),
        durationMinutes: Math.round((tMax - tMin) / 60_000),
        satellites,
        hasNightDetection,
        nearUrban,
        clusterMethod: 'dbscan',
        epsKm,
        minPoints,
        detectionIds: clusterFires.map(f => f.id),
    };

    return { ...base, score: computeIncidentScore(base) };
}

// ─── API Publique ─────────────────────────────────────────────────────────────

export interface ClusterOptions extends DbscanOptions {
    /** Si true, les points bruit (singletons) sont inclus comme incidents solo. Défaut : false */
    includeNoise?: boolean;
}

/**
 * Clusterise une liste de détections VIIRS en incidents feux via DBSCAN.
 *
 * @param fires     Liste de détections (normalement déjà filtrées par bbox France)
 * @param options   Paramètres DBSCAN + option bruit
 * @returns         Liste d'incidents triés par severityScore décroissant
 */
export function clusterFireDetections(
    fires: ActiveFire[],
    options: ClusterOptions = {}
): FireIncident[] {
    if (fires.length === 0) return [];

    const epsKm     = options.epsKm     ?? 3;
    const minPoints = options.minPoints ?? 2;
    const includeNoise = options.includeNoise ?? false;

    const points = fires.map(f => ({ lat: f.latitude, lon: f.longitude }));
    const labels = dbscan(points, epsKm, minPoints);

    // Grouper par cluster
    const clusters = new Map<number, ActiveFire[]>();
    for (let i = 0; i < fires.length; i++) {
        const lbl = labels[i];
        if (lbl === NOISE && !includeNoise) continue;
        const key = lbl === NOISE ? -(i + 1000000) : lbl; // clé unique pour bruit
        if (!clusters.has(key)) clusters.set(key, []);
        clusters.get(key)!.push(fires[i]);
    }

    const incidents: FireIncident[] = [];
    let clusterIdx = 0;
    for (const clusterFires of clusters.values()) {
        incidents.push(buildIncident(clusterFires, epsKm, minPoints, ++clusterIdx));
    }

    // Tri : severityScore desc, puis impactScore desc
    incidents.sort((a, b) =>
        b.score.severityScore - a.score.severityScore ||
        b.score.impactScore   - a.score.impactScore
    );

    return incidents;
}

/**
 * Filtre les incidents au-dessus d'un seuil de score minimum.
 */
export function filterIncidentsByScore(
    incidents: FireIncident[],
    minSeverity = 0,
    minImpact   = 0
): FireIncident[] {
    return incidents.filter(
        i => i.score.severityScore >= minSeverity && i.score.impactScore >= minImpact
    );
}

/**
 * Convertit un FireIncident en GeoJSON Feature (Point centroïde).
 */
export function incidentToGeoJsonFeature(incident: FireIncident): object {
    return {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [incident.centroidLon, incident.centroidLat],
        },
        properties: {
            id:               incident.id,
            detectionsCount:  incident.detectionsCount,
            frpMean:          incident.frpMean,
            frpMax:           incident.frpMax,
            frpTotal:         incident.frpTotal,
            confidenceMax:    incident.confidenceMax,
            startDatetime:    incident.startDatetime,
            endDatetime:      incident.endDatetime,
            durationMinutes:  incident.durationMinutes,
            satellites:       incident.satellites.join(', '),
            hasNightDetection:incident.hasNightDetection,
            nearUrban:        incident.nearUrban,
            severityScore:    incident.score.severityScore,
            impactScore:      incident.score.impactScore,
            labels:           incident.score.labels.join(', '),
        },
    };
}

/**
 * Convertit une liste d'incidents en GeoJSON FeatureCollection.
 */
export function incidentsToGeoJson(incidents: FireIncident[]): object {
    return {
        type: 'FeatureCollection',
        features: incidents.map(incidentToGeoJsonFeature),
    };
}
