/**
 * transport.ts — Service Info Trafic SNCF.
 * Utilise l'API SNCF pour récupérer les perturbations en temps réel.
 * Fallback sur les données mock si l'API n'est pas disponible.
 */

import type { TransportDisruption, ThreatLevel, TrainStop, RailNetworkData } from '../types/index.ts';
import type { TrafficSegment } from '../config/mock-data.ts';
import { Watchdog } from './watchdog.ts';

// ── Watchdog registration ──
Watchdog.register('sncf', {
    label: 'SNCF',
    staleAfterMs: 5 * 60_000,
    detail: 'API SNCF Disruptions · /api/transport/disruptions',
});
import { geocode } from './geocoder.ts';

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
    pagination?: {
        total_result?: number;
        items_on_page?: number;
        items_per_page?: number;
        start_page?: number;
    };
    error?: { message: string };
}

// ─── Cache ───

const disruptionCache = new Map<string, { data: TransportDisruption[]; fetchedAt: number }>();
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

function mapEffectToLabel(effect?: string): string {
    switch (effect) {
        case 'NO_SERVICE':
            return 'Train supprimé / service interrompu';
        case 'SIGNIFICANT_DELAYS':
            return 'Retards significatifs';
        case 'MINOR_DELAYS':
            return 'Retards limités';
        case 'DETOUR':
            return 'Itinéraire modifié';
        case 'REDUCED_SERVICE':
            return 'Service réduit';
        case 'MODIFIED_SERVICE':
            return 'Service modifié';
        case 'ADDITIONAL_SERVICE':
            return 'Train ajouté';
        case 'STOP_MOVED':
            return 'Arrêt déplacé';
        default:
            return 'Impact non qualifié par SNCF';
    }
}

function normalizeSncfCause(cause: string | undefined, messages: string[]): string {
    const raw = (cause || messages[0] || '').trim();
    if (!raw) return 'Cause non précisée';

    const lower = raw.toLocaleLowerCase('fr-FR');
    if (lower.includes('personnes sur les voies')) return 'Présence de personnes sur les voies';
    if (lower.includes('bagage abandonné')) return 'Présence d’un bagage abandonné';
    if (lower.includes('condition') && lower.includes('météo')) return 'Conditions météorologiques';
    if (lower.includes('matériel')) return 'Indisponibilité ou incident matériel';
    if (lower.includes('travaux')) return 'Travaux sur l’infrastructure';
    if (lower.includes('préparation du train')) return 'Incident lors de la préparation du train';
    if (lower.includes('départ non réunies')) return 'Conditions de départ non réunies';
    if (lower.includes('réutilisation')) return 'Réutilisation / rotation matériel';
    if (lower.includes('gestion du trafic')) return 'Difficulté de gestion du trafic';

    return raw;
}

function buildScheduleImpactLabel(stops: TrainStop[], totalDelayMinutes: number | undefined): string {
    const changedStops = stops.filter((stop) => (
        !!stop.plannedTime && !!stop.updatedTime && stop.plannedTime !== stop.updatedTime
    ));

    if (typeof totalDelayMinutes === 'number' && totalDelayMinutes > 0) {
        return `Retard estimé +${totalDelayMinutes} min · ${changedStops.length} arrêt${changedStops.length > 1 ? 's' : ''} recalé${changedStops.length > 1 ? 's' : ''}`;
    }

    if (changedStops.length > 0) {
        return `${changedStops.length} horaire${changedStops.length > 1 ? 's' : ''} modifié${changedStops.length > 1 ? 's' : ''}`;
    }

    return 'Aucun écart horaire chiffré dans le flux SNCF';
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

function getSncfApplicationPeriods(disruption: SncfDisruption): Array<{ begin?: Date; end?: Date }> {
    return (disruption.application_periods ?? []).map((period) => ({
        begin: parseSncfDate(period.begin),
        end: parseSncfDate(period.end),
    }));
}

function getSncfDisruptionTimeWindow(disruption: SncfDisruption): { startDate: Date; endDate?: Date } {
    const periods = getSncfApplicationPeriods(disruption);
    const startCandidates = periods
        .map((period) => period.begin)
        .filter((date): date is Date => !!date)
        .sort((a, b) => a.getTime() - b.getTime());
    const endCandidates = periods
        .map((period) => period.end)
        .filter((date): date is Date => !!date)
        .sort((a, b) => b.getTime() - a.getTime());

    return {
        startDate: startCandidates[0] ?? new Date(),
        endDate: endCandidates[0],
    };
}

function isSncfDisruptionStillRelevant(disruption: SncfDisruption, now = new Date()): boolean {
    if (disruption.status === 'past') return false;

    const periods = getSncfApplicationPeriods(disruption);
    if (periods.length === 0) return true;

    return periods.some(({ end }) => !end || end.getTime() >= now.getTime());
}

function intersectsCurrentDay(disruption: SncfDisruption, now = new Date()): boolean {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const periods = getSncfApplicationPeriods(disruption);
    if (periods.length === 0) return true;

    return periods.some(({ begin, end }) => {
        const effectiveStart = begin?.getTime() ?? Number.NEGATIVE_INFINITY;
        const effectiveEnd = end?.getTime() ?? Number.POSITIVE_INFINITY;
        return effectiveEnd >= dayStart.getTime() && effectiveStart <= dayEnd.getTime();
    });
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

export async function geocodeSncfStation(stopName: string | undefined): Promise<[number, number] | undefined> {
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

// ─── API Fetch ───

/**
 * Fetch les perturbations SNCF depuis l'API.
 */
export async function fetchSncfDisruptions(
    onEnriched?: (disruptions: TransportDisruption[]) => void,
    mode: 'active' | 'all' = 'active',
): Promise<TransportDisruption[]> {
    const cached = disruptionCache.get(mode);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        return cached.data;
    }

    Watchdog.report('sncf', { type: 'loading' });
    const t0 = Date.now();

    try {
        const resp = await fetch(`/api/transport/disruptions?mode=${mode}`, {
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
        const activeDisruptions = (json.disruptions ?? []).filter((d) => {
            if (!isSncfDisruptionStillRelevant(d)) return false;
            if (mode === 'active' && !intersectsCurrentDay(d)) return false;
            return true;
        });

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
            const sourceMessages = Array.from(new Set(
                (d.messages ?? [])
                    .map((entry) => entry.text?.trim())
                    .filter((entry): entry is string => !!entry)
                    .filter((entry) => entry.length > 0)
            ));

            // Extract all impacted stops
            const allStops = d.impacted_objects
                ?.flatMap((o) => o.impacted_stops ?? [])
                .filter((s) => s.stop_point?.name) ?? [];

            const impactedStopPoints = allStops
                .map((s): TrainStop | null => {
                    const name = s.stop_point.name;
                    if (!name) return null;
                    const arrivalDelay = computeDelayMinutes(s.base_arrival_time, s.amended_arrival_time);
                    const departureDelay = computeDelayMinutes(s.base_departure_time, s.amended_departure_time);
                    return {
                        name,
                        time: formatSncfTime(
                            s.amended_departure_time ??
                            s.amended_arrival_time ??
                            s.base_departure_time ??
                            s.base_arrival_time
                        ),
                        plannedTime: formatSncfTime(s.base_departure_time ?? s.base_arrival_time),
                        updatedTime: formatSncfTime(
                            s.amended_departure_time ??
                            s.amended_arrival_time ??
                            s.base_departure_time ??
                            s.base_arrival_time
                        ),
                        delayMinutes: departureDelay ?? arrivalDelay,
                        coordinates: parseSncfCoords(s.stop_point.coord),
                    };
                })
                .filter((stop): stop is TrainStop => !!stop);

            const objectStopPoints = (d.impacted_objects ?? [])
                .map((o): TrainStop | null => {
                    const objectType = o.pt_object?.embedded_type;
                    const stopAreaName = o.pt_object?.stop_area?.name;
                    const objectName = o.pt_object?.name;
                    const name = stopAreaName || (
                        objectType === 'stop_area' || objectType === 'stop_point'
                            ? objectName
                            : undefined
                    );
                    if (!name) return null;
                    return {
                        name: name.includes(':') ? (name.split(':').pop() || name) : name,
                        coordinates: parseSncfCoords(o.pt_object?.stop_area?.coord) ?? parseSncfCoords(o.pt_object?.coord),
                    };
                })
                .filter((stop): stop is TrainStop => !!stop);

            for (const stop of objectStopPoints) {
                if (!impactedStopPoints.some((existing) => existing.name === stop.name)) {
                    impactedStopPoints.push(stop);
                }
            }

            // Extract affected stop names
            const affectedStops = impactedStopPoints
                .map((s) => s.name)
                .slice(0, 20);

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

            if (!departure && impactedStopPoints.length > 0) {
                departure = impactedStopPoints[0];
            }
            if (!arrival && impactedStopPoints.length > 1) {
                arrival = impactedStopPoints[impactedStopPoints.length - 1];
            }
            if (!coordinates) {
                coordinates = departure?.coordinates ?? arrival?.coordinates;
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
            const { startDate, endDate } = getSncfDisruptionTimeWindow(d);
            const totalDelayMinutes = arrival?.delayMinutes ?? departure?.delayMinutes;
            const causeLabel = normalizeSncfCause(d.cause, sourceMessages);
            const effectLabel = mapEffectToLabel(d.severity?.effect);
            const impactLabel = buildScheduleImpactLabel(impactedStopPoints, totalDelayMinutes);

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
                causeLabel,
                effectLabel,
                impactLabel,
                sourceMessages,
                severity: mapSeverityToThreatLevel(d.severity),
                startDate,
                endDate,
                departure,
                arrival,
                impactedStopPoints,
                affectedStops,
                totalDelayMinutes,
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

        disruptionCache.set(mode, { data: disruptions, fetchedAt: Date.now() });
        Watchdog.report('sncf', { type: 'success', responseTimeMs: Date.now() - t0 });
        console.log(`[SNCF] ${disruptions.length}/${json.pagination?.total_result ?? disruptions.length} perturbations chargées — enrichissement en cours…`);

        if (onEnriched) {
            (async () => {
                const missingStops: Array<Promise<void>> = [];
                const geocodingCandidates = disruptions
                    .filter((d) => d.severity === 'critical' || d.severity === 'high' || d.type === 'cancellation');

                for (const disruption of geocodingCandidates) {
                    if (disruption.departure && !disruption.departure.coordinates) {
                        missingStops.push(
                            geocodeSncfStation(disruption.departure.name).then((coords) => {
                                if (coords) disruption.departure!.coordinates = coords;
                            })
                        );
                    }

                    if (disruption.arrival && !disruption.arrival.coordinates) {
                        missingStops.push(
                            geocodeSncfStation(disruption.arrival.name).then((coords) => {
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
                                geocodeSncfStation(fallbackName).then((coords) => {
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

                disruptionCache.set(mode, { data: disruptions, fetchedAt: Date.now() });

                const mappedDisruptions = disruptions.filter(
                    (d) => d.coordinates || d.departure?.coordinates || d.arrival?.coordinates
                ).length;
                console.log(`[SNCF] Enrichissement terminé — ${mappedDisruptions}/${disruptions.length} géocodées, rendu endpoints`);

                onEnriched(disruptions);
            })().catch((err) => console.warn('[SNCF] Enrichissement échoué:', err));
        }

        return disruptions;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[SNCF] Fetch failed, using cache or empty:', err);
        Watchdog.report('sncf', { type: 'failure', error: msg, isFallback: !!cached });
        return cached?.data ?? [];
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
 * Arcs: intentionally empty for the operational layer.
 * Stations: deduplicated departure/arrival points across disruptions — worst severity per station.
 *
 * Fallback strategy (documented for OSINT clarity):
 * - Disruption with departure/arrival coords → two endpoint points emitted, no intermediate stop clutter
 * - Disruption with no coords → skipped entirely (no geo context available)
 */
export function buildRailNetworkData(disruptions: TransportDisruption[]): RailNetworkData {
    const arcFeatures: RailNetworkData['arcs']['features'] = [];

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
        disruptions: Array<{
            id: string;
            severity: ThreatLevel;
            type: TransportDisruption['type'];
            line: string;
            trainNumber?: string;
            description: string;
            causeLabel?: string;
            effectLabel?: string;
            impactLabel?: string;
            sourceMessages: string[];
            totalDelayMinutes?: number;
            departureName?: string;
            arrivalName?: string;
            departurePlannedTime?: string;
            departureUpdatedTime?: string;
            arrivalPlannedTime?: string;
            arrivalUpdatedTime?: string;
            startDate: string;
            endDate?: string;
            affectedStops: string[];
            stopDetails: Array<{
                name: string;
                plannedTime?: string;
                updatedTime?: string;
                delayMinutes?: number;
            }>;
        }>;
    }>();

    const buildDisruptionSummary = (disruption: TransportDisruption) => ({
        id: disruption.id,
        severity: disruption.severity,
        type: disruption.type,
        line: disruption.line,
        trainNumber: disruption.trainNumber,
        description: disruption.description,
        causeLabel: disruption.causeLabel,
        effectLabel: disruption.effectLabel,
        impactLabel: disruption.impactLabel,
        sourceMessages: (disruption.sourceMessages ?? []).slice(0, 4),
        totalDelayMinutes: disruption.totalDelayMinutes,
        departureName: disruption.departure?.name,
        arrivalName: disruption.arrival?.name,
        departurePlannedTime: disruption.departure?.plannedTime,
        departureUpdatedTime: disruption.departure?.updatedTime,
        arrivalPlannedTime: disruption.arrival?.plannedTime,
        arrivalUpdatedTime: disruption.arrival?.updatedTime,
        startDate: disruption.startDate.toISOString(),
        endDate: disruption.endDate?.toISOString(),
        affectedStops: (disruption.affectedStops ?? []).slice(0, 12),
        stopDetails: (disruption.impactedStopPoints ?? []).slice(0, 18).map((stop) => ({
            name: stop.name,
            plannedTime: stop.plannedTime,
            updatedTime: stop.updatedTime,
            delayMinutes: stop.delayMinutes,
        })),
    });

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
                disruptions: [buildDisruptionSummary(disruption)],
            });
        } else {
            if (SEVERITY_ORDER[disruption.severity] < SEVERITY_ORDER[existing.severity]) {
                existing.severity = disruption.severity;
            }
            if (disruption.line) existing.lines.add(disruption.line);
            if (disruption.trainNumber) existing.trainNumbers.add(disruption.trainNumber);
            for (const stopName of disruption.affectedStops ?? []) existing.affectedStops.add(stopName);
            if (!existing.disruptions.some((entry) => entry.id === disruption.id)) {
                existing.count++;
                existing.disruptions.push(buildDisruptionSummary(disruption));
            }
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
                disruptions: [buildDisruptionSummary(d)],
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
        if (!existing.disruptions.some((entry) => entry.id === d.id)) {
            existing.disruptions.push(buildDisruptionSummary(d));
        }
    };

    for (const d of disruptions) {
        const rawRouteCoords = d.rawRouteGeometry?.coordinates;
        const rawDepartureCoord = rawRouteCoords?.[0];
        const rawArrivalCoord = rawRouteCoords && rawRouteCoords.length > 1
            ? rawRouteCoords[rawRouteCoords.length - 1]
            : undefined;
        const rawDeparture: TrainStop | undefined = rawDepartureCoord
            ? {
                name: d.departure?.name || d.affectedStops?.[0] || d.line || 'Départ SNCF',
                coordinates: rawDepartureCoord as [number, number],
            }
            : undefined;
        const rawArrival: TrainStop | undefined = rawArrivalCoord
            ? {
                name: d.arrival?.name || d.affectedStops?.[d.affectedStops.length - 1] || d.line || 'Arrivée SNCF',
                coordinates: rawArrivalCoord as [number, number],
            }
            : undefined;

        const departureForMap = d.departure?.coordinates ? d.departure : rawDeparture;
        const arrivalForMap = d.arrival?.coordinates ? d.arrival : rawArrival;

        recordStop(departureForMap, d);
        recordStop(arrivalForMap, d);

        // SNCF returns some cancellations with no station coords in impacted stops,
        // but with route geometry. Keep those critical items visible on the map.
        if (!departureForMap?.coordinates && !arrivalForMap?.coordinates) {
            recordFallbackPoint(d);
        }
    }

    const stationFeatures: RailNetworkData['stations']['features'] = Array.from(
        stationMap.entries()
    ).map(([name, { coords, severity, count, lines, trainNumbers, affectedStops, disruptions }]) => {
        const disruptionSummaries = disruptions
            .sort((a, b) => {
                const severityDelta = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
                if (severityDelta !== 0) return severityDelta;
                return (b.totalDelayMinutes ?? 0) - (a.totalDelayMinutes ?? 0);
            })
            .slice(0, 8);

        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords },
            properties: {
                name,
                severity,
                count,
                linesJson: JSON.stringify(Array.from(lines).slice(0, 8)),
                trainNumbersJson: JSON.stringify(Array.from(trainNumbers).slice(0, 8)),
                affectedStopsJson: JSON.stringify(Array.from(affectedStops).slice(0, 16)),
                disruptionIdsJson: JSON.stringify(disruptions.map((entry) => entry.id)),
                disruptionSummariesJson: JSON.stringify(disruptionSummaries),
            },
        };
    });

    return {
        arcs: { type: 'FeatureCollection', features: arcFeatures },
        stations: { type: 'FeatureCollection', features: stationFeatures },
    };
}
