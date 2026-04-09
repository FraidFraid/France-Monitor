/**
 * transport.ts — Service Info Trafic SNCF.
 * Utilise l'API SNCF pour récupérer les perturbations en temps réel.
 * Fallback sur les données mock si l'API n'est pas disponible.
 */

import type { TransportDisruption, ThreatLevel, TrainStop, RailNetworkData } from '../types/index.ts';
import type { TrafficSegment } from '../config/mock-data.ts';
import type { FeatureCollection, LineString } from 'geojson';
import { Watchdog } from './watchdog.ts';

// ── Watchdog registration ──
Watchdog.register('sncf', {
    label: 'SNCF',
    staleAfterMs: 5 * 60_000,
    detail: 'API SNCF Disruptions · /api/transport/disruptions',
});
import { geocode } from './geocoder.ts';
import { distance, point } from '@turf/turf';
import type { OsmRailwayFeature } from './osm-rail-graph.ts';
import { buildOsmRailGraph, dijkstraRailPath, projectToNearestRailNode, reconstructRailLineString } from './osm-rail-graph.ts';

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
const osmRailCache = new Map<string, Promise<OsmRailwayFeature[]>>();

// Overpass rate-limit guard: max 1 concurrent request
let overpassQueue: Promise<unknown> = Promise.resolve();
function enqueueOverpass<T>(fn: () => Promise<T>): Promise<T> {
  const next = overpassQueue.then(fn, fn);
  overpassQueue = next.then(() => undefined, () => undefined);
  return next;
}
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

function parseSncfMinutes(timeStr: string | undefined): number | undefined {
    if (!timeStr) return undefined;

    let timePart = timeStr;
    if (timeStr.includes('T')) {
        timePart = timeStr.split('T')[1];
    }

    if (timePart.length < 4) return undefined;

    const hour = parseInt(timePart.substring(0, 2), 10);
    const min = parseInt(timePart.substring(2, 4), 10);
    if (Number.isNaN(hour) || Number.isNaN(min)) return undefined;
    return hour * 60 + min;
}

function computeDelayMinutes(baseTime: string | undefined, amendedTime: string | undefined): number | undefined {
    const baseMinutes = parseSncfMinutes(baseTime);
    const amendedMinutes = parseSncfMinutes(amendedTime);
    if (baseMinutes == null || amendedMinutes == null) return undefined;

    let delta = amendedMinutes - baseMinutes;
    if (delta < -720) delta += 24 * 60;
    if (delta > 720) delta -= 24 * 60;
    return delta >= 0 ? delta : undefined;
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

async function geocodeStation(stopName: string | undefined): Promise<[number, number] | undefined> {
    if (!stopName) return undefined;

    const normalized = stopName.trim();
    if (!normalized) return undefined;

    const attempts = [
        `gare ${normalized}`,
        normalized,
    ];

    for (const query of attempts) {
        try {
            const result = await geocode(query);
            if (result && result.confidence >= 0.45) {
                return [result.lon, result.lat];
            }
        } catch {
            // Best effort fallback only
        }
    }

    return undefined;
}

function bboxKey(bbox: [number, number, number, number]): string {
    return bbox.map((value) => value.toFixed(4)).join(',');
}

function computeRailBBox(
    departure: [number, number],
    arrival: [number, number],
): [number, number, number, number] {
    const directGapKm = distance(point(departure), point(arrival), { units: 'kilometers' });
    const dynamicPadding = Math.min(1.25, Math.max(0.25, directGapKm / 180));
    const padding = dynamicPadding;
    return [
        Math.min(departure[0], arrival[0]) - padding,
        Math.min(departure[1], arrival[1]) - padding,
        Math.max(departure[0], arrival[0]) + padding,
        Math.max(departure[1], arrival[1]) + padding,
    ];
}

function computeRailBBoxFromAnchors(
    anchors: [number, number][],
): [number, number, number, number] {
    const lngs = anchors.map((coord) => coord[0]);
    const lats = anchors.map((coord) => coord[1]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const spanLng = Math.max(0.25, maxLng - minLng);
    const spanLat = Math.max(0.25, maxLat - minLat);
    const padding = Math.min(1.5, Math.max(0.25, Math.max(spanLng, spanLat) * 0.35));
    return [minLng - padding, minLat - padding, maxLng + padding, maxLat + padding];
}

function dedupeAnchorCoords(coords: [number, number][]): [number, number][] {
    const deduped: [number, number][] = [];
    for (const coord of coords) {
        const tooClose = deduped.some((existing) => distance(point(existing), point(coord), { units: 'kilometers' }) < 1.2);
        if (!tooClose) deduped.push(coord);
    }
    return deduped;
}

function generateCurvedLine(start: [number, number], end: [number, number], numPoints: number = 50): [number, number][] {
    const coords: [number, number][] = [];
    const [x1, y1] = start;
    const [x2, y2] = end;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return [start, end];

    const curveHeight = dist * 0.15;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const px = -dy / dist;
    const py = dx / dist;
    
    // Control point for quadratic bezier
    const cx = mx + px * curveHeight;
    const cy = my + py * curveHeight;

    for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const u = 1 - t;
        const x = u * u * x1 + 2 * u * t * cx + t * t * x2;
        const y = u * u * y1 + 2 * u * t * cy + t * t * y2;
        coords.push([x, y]);
    }
    return coords;
}

function sampleRawGeometryAnchors(rawRouteGeometry: LineString | undefined): [number, number][] {
    const coords = rawRouteGeometry?.coordinates as [number, number][] | undefined;
    if (!coords || coords.length < 2) return [];

    if (coords.length <= 6) return dedupeAnchorCoords(coords);

    const samples: [number, number][] = [];
    const sampleCount = 6;
    for (let index = 0; index < sampleCount; index += 1) {
        const ratio = index / (sampleCount - 1);
        const coordIndex = Math.min(coords.length - 1, Math.round(ratio * (coords.length - 1)));
        samples.push(coords[coordIndex]);
    }

    return dedupeAnchorCoords(samples);
}

async function resolveIntermediateStopAnchors(disruption: TransportDisruption): Promise<[number, number][]> {
    const candidateNames = Array.from(new Set(
        (disruption.affectedStops ?? [])
            .filter(Boolean)
            .filter((name) => name !== disruption.departure?.name && name !== disruption.arrival?.name)
            .slice(0, 8)
    ));

    const anchors = await Promise.all(candidateNames.map((name) => geocodeStation(name)));
    return anchors.filter((coord): coord is [number, number] => Array.isArray(coord));
}

function stitchRailPathBetweenAnchors(
    graph: ReturnType<typeof buildOsmRailGraph>,
    features: OsmRailwayFeature[],
    anchors: [number, number][],
): [number, number][] | null {
    if (anchors.length < 2) return null;

    const projected = anchors.map((coord) => ({
        coord,
        match: projectToNearestRailNode(coord, features),
    })).filter((entry) => entry.match && entry.match.distanceKm <= 15) as Array<{
        coord: [number, number];
        match: NonNullable<ReturnType<typeof projectToNearestRailNode>>;
    }>;

    if (projected.length < 2) return null;

    const stitched: [number, number][] = [];
    let cursor = 0;

    while (cursor < projected.length - 1) {
        let resolved = false;
        for (let nextIndex = projected.length - 1; nextIndex > cursor; nextIndex -= 1) {
            const segmentPath = dijkstraRailPath(
                graph,
                projected[cursor].match.node.key,
                projected[nextIndex].match.node.key,
            );
            if (!segmentPath) continue;

            const coords = reconstructRailLineString(segmentPath);
            if (coords.length < 2) continue;

            if (stitched.length === 0) stitched.push(...coords);
            else {
                const [lastLng, lastLat] = stitched[stitched.length - 1];
                const [nextLng, nextLat] = coords[0];
                if (lastLng === nextLng && lastLat === nextLat) stitched.push(...coords.slice(1));
                else stitched.push(...coords);
            }

            cursor = nextIndex;
            resolved = true;
            break;
        }

        if (!resolved) return null;
    }

    return stitched.length >= 2 ? stitched : null;
}

async function fetchOsmRailFeaturesForBBox(
    bbox: [number, number, number, number],
): Promise<OsmRailwayFeature[]> {
    const key = bboxKey(bbox);
    const cached = osmRailCache.get(key);
    if (cached) return cached;

    const pending = enqueueOverpass(async () => {
        const params = new URLSearchParams({
            bbox: `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`,
        });

        const response = await fetch(`/api/transport/osm-railways?${params.toString()}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(20_000),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const geojson = await response.json() as FeatureCollection<LineString>;
        return geojson.features.filter((feature): feature is OsmRailwayFeature => (
            !!feature.geometry &&
            feature.geometry.type === 'LineString' &&
            (feature.geometry.coordinates?.length ?? 0) >= 2
        ));
    });

    osmRailCache.set(key, pending);
    try {
        return await pending;
    } catch (error) {
        osmRailCache.delete(key);
        throw error;
    }
}

async function matchDisruptionRouteToOsmRail(disruption: TransportDisruption): Promise<void> {
    const rawAnchors = sampleRawGeometryAnchors(disruption.rawRouteGeometry);
    const departure = disruption.departure?.coordinates ?? rawAnchors[0];
    const arrival = disruption.arrival?.coordinates ?? rawAnchors[rawAnchors.length - 1];
    if (!departure || !arrival) return;

    try {
        const intermediateAnchors = await resolveIntermediateStopAnchors(disruption);
        const anchorCoords = dedupeAnchorCoords([departure, ...rawAnchors, ...intermediateAnchors, arrival]);
        const bbox = anchorCoords.length >= 2
            ? computeRailBBoxFromAnchors(anchorCoords)
            : computeRailBBox(departure, arrival);
        const features = await fetchOsmRailFeaturesForBBox(bbox);
        if (features.length === 0) return;

        const graph = buildOsmRailGraph(features);
        const coords = stitchRailPathBetweenAnchors(graph, features, anchorCoords);
        if (!coords) return;
        if (coords.length < 2) return;

        const directGapKm = distance(point(departure), point(arrival), { units: 'kilometers' });
        const pathLengthKm = coords.reduce((sum, coord, index) => {
            if (index === 0) return sum;
            return sum + distance(point(coords[index - 1]), point(coord), { units: 'kilometers' });
        }, 0);
        const pathRatio = directGapKm > 1 ? pathLengthKm / directGapKm : 1;
        if (pathRatio > 5) return;

        disruption.routeGeometry = {
            type: 'LineString',
            coordinates: coords,
        };
        disruption.geometryFidelity = 'matched';
    } catch (error) {
        console.warn('[SNCF/OSM] Rail matching failed:', error);
    }
}

// ─── API Fetch ───

/**
 * Fetch les perturbations SNCF depuis l'API.
 */
export async function fetchSncfDisruptions(
    onEnriched?: (disruptions: TransportDisruption[]) => void
): Promise<TransportDisruption[]> {
    if (disruptionCache && Date.now() - disruptionCache.fetchedAt < CACHE_TTL) {
        return disruptionCache.data;
    }

    Watchdog.report('sncf', { type: 'loading' });
    const t0 = Date.now();

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
            const rawRouteCoords = d.impacted_objects
                ?.map((o) => o.pt_object?.geojson?.coordinates)
                .find((coords): coords is [number, number][] => Array.isArray(coords) && coords.length >= 2);

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
                const departureDelayMinutes = computeDelayMinutes(firstStop.base_departure_time, firstStop.amended_departure_time);
                const arrivalDelayMinutes = computeDelayMinutes(lastStop.base_arrival_time, lastStop.amended_arrival_time);

                // Parse departure
                departure = {
                    name: firstStop.stop_point.name,
                    time: formatSncfTime(firstStop.amended_departure_time ?? firstStop.base_departure_time),
                    plannedTime: formatSncfTime(firstStop.base_departure_time),
                    updatedTime: formatSncfTime(firstStop.amended_departure_time ?? firstStop.base_departure_time),
                    delayMinutes: departureDelayMinutes,
                    coordinates: parseSncfCoords(firstStop.stop_point.coord),
                };

                // Parse arrival (only if different from departure)
                if (allStops.length > 1) {
                    arrival = {
                        name: lastStop.stop_point.name,
                        time: formatSncfTime(lastStop.amended_arrival_time ?? lastStop.base_arrival_time),
                        plannedTime: formatSncfTime(lastStop.base_arrival_time),
                        updatedTime: formatSncfTime(lastStop.amended_arrival_time ?? lastStop.base_arrival_time),
                        delayMinutes: arrivalDelayMinutes,
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
                totalDelayMinutes: arrival?.delayMinutes ?? departure?.delayMinutes,
                coordinates,
                rawRouteGeometry: rawRouteCoords ? { type: 'LineString', coordinates: rawRouteCoords } : undefined,
                geometryFidelity: rawRouteCoords ? 'raw' : undefined,
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
        Watchdog.report('sncf', { type: 'success', responseTimeMs: Date.now() - t0 });
        console.log(`[SNCF] ${disruptions.length} perturbations chargées — enrichissement en cours…`);

        if (onEnriched) {
            (async () => {
                const missingStops: Array<Promise<void>> = [];
                for (const disruption of disruptions) {
                    if (disruption.departure && !disruption.departure.coordinates) {
                        missingStops.push(
                            geocodeStation(disruption.departure.name).then((coords) => {
                                if (coords) disruption.departure!.coordinates = coords;
                            })
                        );
                    }

                    if (disruption.arrival && !disruption.arrival.coordinates) {
                        missingStops.push(
                            geocodeStation(disruption.arrival.name).then((coords) => {
                                if (coords) disruption.arrival!.coordinates = coords;
                            })
                        );
                    }

                    if (!disruption.coordinates) {
                        const fallbackName =
                            disruption.departure?.name ||
                            disruption.arrival?.name ||
                            disruption.affectedStops?.[0];

                        if (fallbackName) {
                            missingStops.push(
                                geocodeStation(fallbackName).then((coords) => {
                                    if (coords) disruption.coordinates = coords;
                                })
                            );
                        }
                    }
                }

                if (missingStops.length > 0) {
                    await Promise.allSettled(missingStops);
                }

                for (const disruption of disruptions) {
                    if (!disruption.coordinates) {
                        disruption.coordinates = disruption.departure?.coordinates ?? disruption.arrival?.coordinates;
                    }
                }

                const routeMatchingTasks = disruptions
                    .filter((d) => d.departure?.coordinates && d.arrival?.coordinates)
                    .map((d) => matchDisruptionRouteToOsmRail(d));

                if (routeMatchingTasks.length > 0) {
                    await Promise.allSettled(routeMatchingTasks);
                }

                disruptionCache = { data: disruptions, fetchedAt: Date.now() };

                const mappedDisruptions = disruptions.filter(
                    (d) => d.coordinates || d.departure?.coordinates || d.arrival?.coordinates
                ).length;
                const matchedRoutes = disruptions.filter((d) => d.routeGeometry?.coordinates?.length).length;
                console.log(`[SNCF] Enrichissement terminé — ${mappedDisruptions}/${disruptions.length} géocodées, ${matchedRoutes} tracés OSM`);

                onEnriched(disruptions);
            })().catch((err) => console.warn('[SNCF] Enrichissement échoué:', err));
        }

        return disruptions;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[SNCF] Fetch failed, using cache or empty:', err);
        Watchdog.report('sncf', { type: 'failure', error: msg, isFallback: !!disruptionCache });
        return disruptionCache?.data ?? [];
    }
}

/**
 * Fetch le trafic routier (temporairement désactivé en attente de crédits).
 * Gardé pour compatibilité avec le layer traffic de la carte.
 */
export async function fetchSncfTraffic(): Promise<TrafficSegment[]> {
    // Les mocks routiers ont été retirés en attente du retour des crédits TomTom.
    return [];
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

        let fallbackGeometry: [number, number][] = [];
        if (dep && arr) {
            try {
                // OSINT Dashboard: Generate a curved arc for the fallback to look professional instead of a rigid straight line
                fallbackGeometry = generateCurvedLine(dep as [number, number], arr as [number, number]);
            } catch (err) {
                fallbackGeometry = [dep, arr]; // Safety ultimate fallback to straight line
            }
        }

        let effectiveGeometry = d.routeGeometry?.coordinates
            ?? d.rawRouteGeometry?.coordinates
            ?? fallbackGeometry;

        // Force curvature if the resulting geometry is just a 2-point straight line
        if (effectiveGeometry && effectiveGeometry.length === 2) {
            try {
                effectiveGeometry = generateCurvedLine(
                    effectiveGeometry[0] as [number, number], 
                    effectiveGeometry[1] as [number, number]
                );
            } catch (err) {
                // Ignore, keep straight
            }
        }
        const effectiveFidelity = d.routeGeometry
            ? (d.geometryFidelity ?? 'matched')
            : d.rawRouteGeometry
                ? 'raw'
                : 'fallback';
        const firstGeometryCoord = effectiveGeometry[0] as [number, number] | undefined;
        const lastGeometryCoord = effectiveGeometry[effectiveGeometry.length - 1] as [number, number] | undefined;
        const departureCoord = dep ?? firstGeometryCoord;
        const arrivalCoord = arr ?? lastGeometryCoord;
        const hasRenderableLine = effectiveGeometry.length >= 2;

        if (hasRenderableLine) {
            arcFeatures.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: effectiveGeometry,
                },
                properties: {
                    id: d.id,
                    severity: d.severity,
                    type: d.type,
                    line: d.line,
                    trainNumber: d.trainNumber,
                    description: d.description,
                    departureName: d.departure?.name,
                    arrivalName: d.arrival?.name,
                    departurePlannedTime: d.departure?.plannedTime,
                    departureUpdatedTime: d.departure?.updatedTime,
                    arrivalPlannedTime: d.arrival?.plannedTime,
                    arrivalUpdatedTime: d.arrival?.updatedTime,
                    totalDelayMinutes: d.totalDelayMinutes,
                    affectedStopsCount: d.affectedStops?.length ?? 0,
                    affectedStopsJson: JSON.stringify((d.affectedStops ?? []).slice(0, 12)),
                    geometryFidelity: effectiveFidelity,
                },
            });
        }

        // Keep single-anchor disruptions visible through the station layer below.
        if (!departureCoord && !arrivalCoord && !d.coordinates) continue;
    }

    // ─── Stations: deduplicate by name, keep worst severity ───
    const SEVERITY_ORDER: Record<ThreatLevel, number> = {
        critical: 0, high: 1, medium: 2, low: 3, info: 4,
    };

    const stationMap = new Map<string, {
        coords: [number, number];
        severity: ThreatLevel;
        count: number;
        lines: Set<string>;
        trainNumbers: Set<string>;
        affectedStops: Set<string>;
    }>();

    const recordStop = (stop: TrainStop | undefined, disruption: TransportDisruption): void => {
        if (!stop?.coordinates || !stop.name) return;
        const existing = stationMap.get(stop.name);
        if (!existing) {
            stationMap.set(stop.name, {
                coords: stop.coordinates,
                severity: disruption.severity,
                count: 1,
                lines: new Set(disruption.line ? [disruption.line] : []),
                trainNumbers: new Set(disruption.trainNumber ? [disruption.trainNumber] : []),
                affectedStops: new Set(disruption.affectedStops ?? []),
            });
        } else {
            existing.count++;
            if (SEVERITY_ORDER[disruption.severity] < SEVERITY_ORDER[existing.severity]) {
                existing.severity = disruption.severity;
            }
            if (disruption.line) existing.lines.add(disruption.line);
            if (disruption.trainNumber) existing.trainNumbers.add(disruption.trainNumber);
            for (const stopName of disruption.affectedStops ?? []) existing.affectedStops.add(stopName);
        }
    };

    const recordFallbackPoint = (d: TransportDisruption): void => {
        if (!d.coordinates) return;

        const fallbackName =
            d.departure?.name ||
            d.arrival?.name ||
            d.affectedStops?.[0] ||
            d.line;

        const existing = stationMap.get(fallbackName);
        if (!existing) {
            stationMap.set(fallbackName, {
                coords: d.coordinates,
                severity: d.severity,
                count: 1,
                lines: new Set(d.line ? [d.line] : []),
                trainNumbers: new Set(d.trainNumber ? [d.trainNumber] : []),
                affectedStops: new Set(d.affectedStops ?? []),
            });
            return;
        }

        existing.count++;
        if (SEVERITY_ORDER[d.severity] < SEVERITY_ORDER[existing.severity]) {
            existing.severity = d.severity;
        }
        if (d.line) existing.lines.add(d.line);
        if (d.trainNumber) existing.trainNumbers.add(d.trainNumber);
        for (const stopName of d.affectedStops ?? []) existing.affectedStops.add(stopName);
    };

    for (const d of disruptions) {
        recordStop(d.departure, d);
        recordStop(d.arrival, d);

        // SNCF returns some disruptions with only one usable anchor point.
        // Keep them visible on the map instead of dropping them silently.
        if (!d.departure?.coordinates && !d.arrival?.coordinates) {
            recordFallbackPoint(d);
        }
    }

    const stationFeatures: RailNetworkData['stations']['features'] = Array.from(
        stationMap.entries()
    ).map(([name, { coords, severity, count, lines, trainNumbers, affectedStops }]) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: {
            name,
            severity,
            count,
            linesJson: JSON.stringify(Array.from(lines).slice(0, 6)),
            trainNumbersJson: JSON.stringify(Array.from(trainNumbers).slice(0, 6)),
            affectedStopsJson: JSON.stringify(Array.from(affectedStops).slice(0, 12)),
        },
    }));

    return {
        arcs: { type: 'FeatureCollection', features: arcFeatures },
        stations: { type: 'FeatureCollection', features: stationFeatures },
    };
}
