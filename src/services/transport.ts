/**
 * transport.ts — Service Info Trafic SNCF.
 * Utilise l'API SNCF pour récupérer les perturbations en temps réel.
 * Fallback sur les données mock si l'API n'est pas disponible.
 */

import type { TransportDisruption, ThreatLevel, TrainStop, RailNetworkData } from '../types/index.ts';
import type { TrafficSegment } from '../config/mock-data.ts';
import { MOCK_TRAFFIC_SEGMENTS } from '../config/mock-data.ts';

// ─── Types SNCF API ───

interface SncfStopPoint {
    id: string;
    name: string;
    label?: string;
    coord?: {
        lon: string;
        lat: string;
    };
}

interface SncfImpactedStop {
    stop_point: SncfStopPoint;
    amended_arrival_time?: string;
    amended_departure_time?: string;
    base_arrival_time?: string;
    base_departure_time?: string;
    cause?: string;
    stop_time_effect?: string;
}

interface SncfDisruption {
    id: string;
    status: string;
    severity?: {
        name: string;
        priority: number;
        effect: string;
    };
    messages?: Array<{
        text: string;
        channel?: { name: string };
    }>;
    application_periods?: Array<{
        begin: string;
        end: string;
    }>;
    impacted_objects?: Array<{
        pt_object?: {
            id: string;
            name: string;
            embedded_type: string;
            coord?: { lon: string; lat: string };
            // For lines, there might be route info
            geojson?: {
                coordinates?: [number, number][];
            };
            // Stop areas might have coordinates
            stop_area?: {
                coord?: { lon: string; lat: string };
                name?: string;
            };
        };
        impacted_stops?: SncfImpactedStop[];
    }>;
    cause?: string;
}

interface SncfApiResponse {
    disruptions?: SncfDisruption[];
    error?: { message: string };
}

// ─── Cache ───

let disruptionCache: { data: TransportDisruption[]; fetchedAt: number } | null = null;
let trafficCache: { data: TrafficSegment[]; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60_000; // 5 min

// ─── Severity Mapping ───

function mapSeverityToThreatLevel(severity?: { priority: number; effect: string }): ThreatLevel {
    if (!severity) return 'info';

    // SNCF priority: 1 = most severe, higher = less severe
    if (severity.priority <= 1 || severity.effect === 'NO_SERVICE') return 'critical';
    if (severity.priority <= 2 || severity.effect === 'SIGNIFICANT_DELAYS') return 'high';
    if (severity.priority <= 3 || severity.effect === 'REDUCED_SERVICE') return 'medium';
    if (severity.priority <= 4) return 'low';
    return 'info';
}

function mapEffectToType(effect?: string): TransportDisruption['type'] {
    if (!effect) return 'other';
    switch (effect) {
        case 'NO_SERVICE':
            return 'cancellation';
        case 'SIGNIFICANT_DELAYS':
        case 'MINOR_DELAYS':
            return 'delay';
        case 'DETOUR':
        case 'REDUCED_SERVICE':
        case 'MODIFIED_SERVICE':
            return 'works';
        default:
            return 'other';
    }
}

// ─── Date Parsing ───

/**
 * Parse SNCF date format: "20260225T183900" → Date
 */
function parseSncfDate(dateStr: string | undefined): Date | undefined {
    if (!dateStr) return undefined;

    // Format: YYYYMMDDTHHMMSS
    const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
    if (!match) return undefined;

    const [, year, month, day, hour, min, sec] = match;
    return new Date(
        parseInt(year),
        parseInt(month) - 1, // Months are 0-indexed
        parseInt(day),
        parseInt(hour),
        parseInt(min),
        parseInt(sec)
    );
}

/**
 * Format SNCF time: "183900" → "18:39"
 */
function formatSncfTime(timeStr: string | undefined): string | undefined {
    if (!timeStr) return undefined;

    // Format: HHMMSS (6 chars) or full datetime YYYYMMDDTHHMMSS
    let timePart = timeStr;
    if (timeStr.includes('T')) {
        timePart = timeStr.split('T')[1];
    }

    if (timePart.length >= 4) {
        const hour = timePart.substring(0, 2);
        const min = timePart.substring(2, 4);
        return `${hour}:${min}`;
    }
    return undefined;
}

/**
 * Parse SNCF coordinates: { lon: "2.35", lat: "48.85" } → [lon, lat]
 */
function parseSncfCoords(coord: { lon: string; lat: string } | undefined): [number, number] | undefined {
    if (!coord?.lon || !coord?.lat) return undefined;

    const lon = parseFloat(coord.lon);
    const lat = parseFloat(coord.lat);

    if (isNaN(lon) || isNaN(lat)) return undefined;
    return [lon, lat];
}

// ─── API Fetch ───

/**
 * Fetch les perturbations SNCF depuis l'API.
 */
export async function fetchSncfDisruptions(): Promise<TransportDisruption[]> {
    if (disruptionCache && Date.now() - disruptionCache.fetchedAt < CACHE_TTL) {
        return disruptionCache.data;
    }

    try {
        const resp = await fetch('/api/transport/disruptions', {
            signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
            console.warn('[SNCF] API returned:', resp.status);
            throw new Error(`API error ${resp.status}`);
        }

        const json: SncfApiResponse = await resp.json();

        if (json.error) {
            console.warn('[SNCF] API error:', json.error.message);
            throw new Error(json.error.message);
        }

        // Filter out past disruptions and map to our format
        const activeDisruptions = (json.disruptions ?? []).filter(
            (d) => d.status !== 'past'
        );

        const disruptions = activeDisruptions.map((d): TransportDisruption => {
            // Extract line/trip info from impacted objects
            const lineObj = d.impacted_objects?.find(
                (o) => o.pt_object?.embedded_type === 'line'
            );
            const tripObj = d.impacted_objects?.find(
                (o) => o.pt_object?.embedded_type === 'trip'
            );
            const anyObj = d.impacted_objects?.[0];

            // Extract train number from trip name (format: "SNCF:2026-02-27:834901:1187:Train")
            let trainNumber: string | undefined;
            if (tripObj?.pt_object?.name) {
                const parts = tripObj.pt_object.name.split(':');
                if (parts.length >= 3) {
                    trainNumber = parts[2]; // e.g., "834901"
                }
            }

            // Build line name
            let lineName = 'Train';
            if (lineObj?.pt_object?.name) {
                lineName = lineObj.pt_object.name;
            } else if (trainNumber) {
                lineName = `Train ${trainNumber}`;
            } else if (anyObj?.pt_object?.name) {
                // Try to extract a cleaner name
                const name = anyObj.pt_object.name;
                if (name.includes(':')) {
                    const parts = name.split(':');
                    lineName = parts[parts.length - 1] || 'Train';
                } else {
                    lineName = name;
                }
            }

            // Extract message
            const message = d.messages?.[0]?.text ?? d.cause ?? 'Perturbation en cours';

            // Extract all impacted stops
            const allStops = d.impacted_objects
                ?.flatMap((o) => o.impacted_stops ?? [])
                .filter((s) => s.stop_point?.name) ?? [];

            // Extract affected stop names
            const affectedStops = allStops
                .map((s) => s.stop_point.name)
                .slice(0, 10);

            // Extract departure (first stop) and arrival (last stop) with times and coords
            let departure: TrainStop | undefined;
            let arrival: TrainStop | undefined;
            let coordinates: [number, number] | undefined;

            if (allStops.length > 0) {
                const firstStop = allStops[0];
                const lastStop = allStops[allStops.length - 1];

                // Parse departure
                departure = {
                    name: firstStop.stop_point.name,
                    time: formatSncfTime(firstStop.amended_departure_time ?? firstStop.base_departure_time),
                    coordinates: parseSncfCoords(firstStop.stop_point.coord),
                };

                // Parse arrival (only if different from departure)
                if (allStops.length > 1) {
                    arrival = {
                        name: lastStop.stop_point.name,
                        time: formatSncfTime(lastStop.amended_arrival_time ?? lastStop.base_arrival_time),
                        coordinates: parseSncfCoords(lastStop.stop_point.coord),
                    };
                }

                // Use departure coords as main coordinates
                if (departure.coordinates) {
                    coordinates = departure.coordinates;
                } else if (arrival?.coordinates) {
                    coordinates = arrival.coordinates;
                }
            }

            // Fallback: if we still don't have coordinates, try pt_object sources
            // This handles both empty impacted_stops AND stops without coords
            if (!coordinates) {
                for (const obj of d.impacted_objects ?? []) {
                    if (!obj.pt_object) continue;

                    // Try direct coord on pt_object
                    const objCoords = parseSncfCoords(obj.pt_object.coord);
                    if (objCoords) {
                        coordinates = objCoords;
                        if (!departure) {
                            departure = {
                                name: obj.pt_object.name?.split(':').pop() ?? lineName,
                                coordinates: objCoords,
                            };
                        } else {
                            departure.coordinates = objCoords;
                        }
                        break;
                    }

                    // Try stop_area coord
                    if (obj.pt_object.stop_area?.coord) {
                        const areaCoords = parseSncfCoords(obj.pt_object.stop_area.coord);
                        if (areaCoords) {
                            coordinates = areaCoords;
                            if (!departure) {
                                departure = {
                                    name: obj.pt_object.stop_area.name ?? lineName,
                                    coordinates: areaCoords,
                                };
                            } else {
                                departure.coordinates = areaCoords;
                            }
                            break;
                        }
                    }

                    // Try geojson coordinates (for line routes)
                    if (obj.pt_object.geojson?.coordinates?.length) {
                        const routeCoords = obj.pt_object.geojson.coordinates;
                        const firstCoord = routeCoords[0];
                        const lastCoord = routeCoords[routeCoords.length - 1];

                        if (firstCoord && lastCoord) {
                            coordinates = firstCoord;
                            if (!departure) {
                                departure = { name: 'Départ', coordinates: firstCoord };
                            } else {
                                departure.coordinates = firstCoord;
                            }
                            if (!arrival) {
                                arrival = { name: 'Arrivée', coordinates: lastCoord };
                            } else {
                                arrival.coordinates = lastCoord;
                            }
                            break;
                        }
                    }
                }
            }

            // Parse dates (SNCF format: 20260225T183900)
            const period = d.application_periods?.[0];
            const startDate = parseSncfDate(period?.begin) ?? new Date();
            const endDate = parseSncfDate(period?.end);

            // Debug: log if we couldn't find coordinates for a disruption
            if (!coordinates) {
                console.log('[SNCF] Disruption without coords:', {
                    id: d.id,
                    effect: d.severity?.effect,
                    lineName,
                    stopsCount: allStops.length,
                    stopsWithCoords: allStops.filter(s => s.stop_point?.coord).length,
                    impactedObjects: d.impacted_objects?.map(o => ({
                        type: o.pt_object?.embedded_type,
                        name: o.pt_object?.name?.substring(0, 50),
                        hasCoord: !!o.pt_object?.coord,
                        hasStopArea: !!o.pt_object?.stop_area,
                        hasGeojson: !!o.pt_object?.geojson,
                        stopsCount: o.impacted_stops?.length ?? 0,
                    })),
                });
            }

            return {
                id: d.id,
                type: mapEffectToType(d.severity?.effect),
                trainNumber,
                line: lineName,
                description: message,
                severity: mapSeverityToThreatLevel(d.severity),
                startDate,
                endDate,
                departure,
                arrival,
                affectedStops,
                coordinates,
            };
        });

        // Sort by severity (critical first)
        const severityOrder: Record<ThreatLevel, number> = {
            critical: 0,
            high: 1,
            medium: 2,
            low: 3,
            info: 4,
        };
        disruptions.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

        disruptionCache = { data: disruptions, fetchedAt: Date.now() };
        console.log(`[SNCF] ${disruptions.length} perturbations chargées`);

        return disruptions;
    } catch (err) {
        console.warn('[SNCF] Fetch failed, using cache or empty:', err);
        return disruptionCache?.data ?? [];
    }
}

/**
 * Fetch le trafic routier (mock pour l'instant, SNCF = ferroviaire).
 * Gardé pour compatibilité avec le layer traffic de la carte.
 */
export async function fetchSncfTraffic(): Promise<TrafficSegment[]> {
    if (trafficCache && Date.now() - trafficCache.fetchedAt < CACHE_TTL) {
        return trafficCache.data;
    }

    // Traffic segments are road data - keep mock for now
    // SNCF API is for rail, not road traffic
    const segments = MOCK_TRAFFIC_SEGMENTS;

    trafficCache = { data: segments, fetchedAt: Date.now() };
    console.log(`[Traffic] ${segments.length} axes routiers`);
    return segments;
}

/**
 * Compte les perturbations par niveau de gravité.
 */
export function countDisruptionsBySeverity(
    disruptions: TransportDisruption[]
): Record<ThreatLevel, number> {
    const counts: Record<ThreatLevel, number> = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
    };

    for (const d of disruptions) {
        counts[d.severity]++;
    }

    return counts;
}

/**
 * Builds two GeoJSON FeatureCollections from disruption data for map rendering.
 *
 * Arcs: one LineString per disruption that has both departure AND arrival coordinates.
 * Stations: deduplicated stop points across all disruptions — worst severity per station.
 *
 * Fallback strategy (documented for OSINT clarity):
 * - Disruption with only departure coord → station point emitted, no arc
 * - Disruption with no coords → skipped entirely (no geo context available)
 */
export function buildRailNetworkData(disruptions: TransportDisruption[]): RailNetworkData {
    // ─── Arcs ───
    const arcFeatures: RailNetworkData['arcs']['features'] = [];

    for (const d of disruptions) {
        const dep = d.departure?.coordinates;
        const arr = d.arrival?.coordinates;

        // Arc requires both endpoints; skip otherwise (station-only fallback below)
        if (!dep || !arr) continue;

        arcFeatures.push({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [dep, arr],
            },
            properties: {
                id: d.id,
                severity: d.severity,
                type: d.type,
                line: d.line,
                description: d.description,
            },
        });
    }

    // ─── Stations: deduplicate by name, keep worst severity ───
    const SEVERITY_ORDER: Record<ThreatLevel, number> = {
        critical: 0, high: 1, medium: 2, low: 3, info: 4,
    };

    const stationMap = new Map<string, { coords: [number, number]; severity: ThreatLevel; count: number }>();

    const recordStop = (stop: TrainStop | undefined, severity: ThreatLevel): void => {
        if (!stop?.coordinates || !stop.name) return;
        const existing = stationMap.get(stop.name);
        if (!existing) {
            stationMap.set(stop.name, { coords: stop.coordinates, severity, count: 1 });
        } else {
            existing.count++;
            if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[existing.severity]) {
                existing.severity = severity;
            }
        }
    };

    for (const d of disruptions) {
        recordStop(d.departure, d.severity);
        recordStop(d.arrival, d.severity);
    }

    const stationFeatures: RailNetworkData['stations']['features'] = Array.from(
        stationMap.entries()
    ).map(([name, { coords, severity, count }]) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: { name, severity, count },
    }));

    return {
        arcs: { type: 'FeatureCollection', features: arcFeatures },
        stations: { type: 'FeatureCollection', features: stationFeatures },
    };
}
