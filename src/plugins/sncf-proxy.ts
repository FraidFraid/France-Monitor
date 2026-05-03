/**
 * sncf-proxy.ts — Plugin Vite qui proxy les requêtes SNCF API pour le dev local.
 * En prod, c'est la serverless function api/transport/disruptions.js qui fait ça.
 */

import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

const SNCF_API_BASE = 'https://api.sncf.com/v1';
const SNCF_PAGE_SIZE = 1000;
const SNCF_MAX_PAGES = 10;
const SNCF_ACTIVE_MAX_PAGES = 2;
const SNCF_CANCEL_TRIP_ENRICH_LIMIT = 120;
const SNCF_TRIP_CACHE_TTL_MS = 5 * 60_000;
const SNCF_TRIP_ENRICH_CONCURRENCY = 4;

type SncfDisruptionsPayload = {
    disruptions?: unknown[];
    pagination?: {
        total_result?: number;
        start_page?: number;
        items_per_page?: number;
        items_on_page?: number;
    };
};

type SncfDisruptionLike = {
    severity?: { effect?: string };
    messages?: Array<{ text?: string }>;
    impacted_objects?: Array<{
        pt_object?: {
            id?: string;
            trip?: { id?: string; name?: string };
            embedded_type?: string;
        };
        impacted_stops?: unknown[];
    }>;
};

type SncfVehicleJourneyPayload = {
    vehicle_journeys?: Array<{
        stop_times?: Array<{
            arrival_time?: string;
            departure_time?: string;
            stop_point?: unknown;
        }>;
    }>;
};

const tripStopTimesCache = new Map<string, { at: number; stops: unknown[] }>();

async function fetchTripStopTimes(authHeader: string, tripId: string, cause: string): Promise<unknown[]> {
    const cached = tripStopTimesCache.get(tripId);
    if (cached && Date.now() - cached.at < SNCF_TRIP_CACHE_TTL_MS) {
        return cached.stops;
    }

    const url = `${SNCF_API_BASE}/coverage/sncf/trips/${encodeURIComponent(tripId)}/vehicle_journeys?depth=3`;
    const resp = await fetch(url, {
        headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return [];

    const payload = await resp.json() as SncfVehicleJourneyPayload;
    const stopTimes = payload.vehicle_journeys?.[0]?.stop_times ?? [];
    const stops = stopTimes
        .filter((stopTime) => stopTime.stop_point)
        .map((stopTime) => ({
            stop_point: stopTime.stop_point,
            base_arrival_time: stopTime.arrival_time,
            base_departure_time: stopTime.departure_time,
            amended_arrival_time: stopTime.arrival_time,
            amended_departure_time: stopTime.departure_time,
            cause,
            stop_time_effect: 'deleted',
            departure_status: 'deleted',
            arrival_status: 'deleted',
            is_detour: false,
        }));

    tripStopTimesCache.set(tripId, { at: Date.now(), stops });
    return stops;
}

async function enrichNoServiceTrips(payload: SncfDisruptionsPayload, authHeader: string): Promise<void> {
    const candidates = (payload.disruptions ?? [])
        .map((entry) => entry as SncfDisruptionLike)
        .filter((disruption) => disruption.severity?.effect === 'NO_SERVICE')
        .flatMap((disruption) => (disruption.impacted_objects ?? [])
            .filter((obj) => obj.pt_object?.embedded_type === 'trip' && (obj.impacted_stops?.length ?? 0) === 0)
            .map((obj) => ({ disruption, obj, tripId: obj.pt_object?.id ?? obj.pt_object?.trip?.id })))
        .filter((entry): entry is { disruption: SncfDisruptionLike; obj: NonNullable<SncfDisruptionLike['impacted_objects']>[number]; tripId: string } => !!entry.tripId)
        .slice(0, SNCF_CANCEL_TRIP_ENRICH_LIMIT);

    let cursor = 0;
    const workers = Array.from({ length: Math.min(SNCF_TRIP_ENRICH_CONCURRENCY, candidates.length) }, async () => {
        while (cursor < candidates.length) {
            const candidate = candidates[cursor];
            cursor += 1;
            const cause = candidate.disruption.messages?.[0]?.text ?? 'Train supprimé';
            try {
                const stops = await fetchTripStopTimes(authHeader, candidate.tripId, cause);
                if (stops.length > 0) {
                    candidate.obj.impacted_stops = stops;
                }
            } catch (err) {
                console.warn('[sncf-proxy] Trip stop enrichment failed:', candidate.tripId, err);
            }
        }
    });

    await Promise.all(workers);
}

async function fetchAllSncfDisruptions(authHeader: string): Promise<SncfDisruptionsPayload> {
    const allDisruptions: unknown[] = [];
    let firstPayload: SncfDisruptionsPayload | null = null;
    let totalResult = Infinity;

    for (let page = 0; page < SNCF_MAX_PAGES && allDisruptions.length < totalResult; page += 1) {
        const params = new URLSearchParams({
            count: String(SNCF_PAGE_SIZE),
            depth: '2',
            start_page: String(page),
        });
        const url = `${SNCF_API_BASE}/coverage/sncf/disruptions?${params.toString()}`;
        const resp = await fetch(url, {
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
            console.error('[sncf-proxy] API error:', resp.status, await resp.text());
            throw new Error(`SNCF API error: ${resp.status}`);
        }

        const payload = await resp.json() as SncfDisruptionsPayload;
        if (!firstPayload) firstPayload = payload;
        allDisruptions.push(...(payload.disruptions ?? []));
        totalResult = payload.pagination?.total_result ?? allDisruptions.length;

        if ((payload.pagination?.items_on_page ?? 0) === 0) break;
    }

    const result = {
        ...firstPayload,
        disruptions: allDisruptions,
        pagination: {
            ...(firstPayload?.pagination ?? {}),
            total_result: Number.isFinite(totalResult) ? totalResult : allDisruptions.length,
            items_per_page: SNCF_PAGE_SIZE,
            items_on_page: allDisruptions.length,
            start_page: 0,
        },
    };
    await enrichNoServiceTrips(result, authHeader);
    return result;
}

function franceStartOfTodaySncf(): string {
    const parts = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
    const month = parts.find((part) => part.type === 'month')?.value ?? '01';
    const day = parts.find((part) => part.type === 'day')?.value ?? '01';
    return `${year}${month}${day}T000000`;
}

function franceEndOfTodaySncf(): string {
    const parts = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
    const month = parts.find((part) => part.type === 'month')?.value ?? '01';
    const day = parts.find((part) => part.type === 'day')?.value ?? '01';
    return `${year}${month}${day}T235959`;
}

async function fetchRecentSncfDisruptions(authHeader: string): Promise<SncfDisruptionsPayload> {
    const allDisruptions: unknown[] = [];
    let firstPayload: SncfDisruptionsPayload | null = null;
    let totalResult = Infinity;

    for (let page = 0; page < SNCF_ACTIVE_MAX_PAGES && allDisruptions.length < totalResult; page += 1) {
        const params = new URLSearchParams({
            count: String(SNCF_PAGE_SIZE),
            depth: '2',
            start_page: String(page),
            since: franceStartOfTodaySncf(),
            until: franceEndOfTodaySncf(),
        });
        const url = `${SNCF_API_BASE}/coverage/sncf/disruptions?${params.toString()}`;
        const resp = await fetch(url, {
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
            console.error('[sncf-proxy] API error:', resp.status, await resp.text());
            throw new Error(`SNCF API error: ${resp.status}`);
        }

        const payload = await resp.json() as SncfDisruptionsPayload;
        if (!firstPayload) firstPayload = payload;
        allDisruptions.push(...(payload.disruptions ?? []));
        totalResult = payload.pagination?.total_result ?? allDisruptions.length;

        if ((payload.pagination?.items_on_page ?? 0) === 0) break;
    }

    const result = {
        ...firstPayload,
        disruptions: allDisruptions,
        pagination: {
            ...(firstPayload?.pagination ?? {}),
            total_result: Number.isFinite(totalResult) ? totalResult : allDisruptions.length,
            items_per_page: SNCF_PAGE_SIZE,
            items_on_page: allDisruptions.length,
            start_page: 0,
        },
    };
    await enrichNoServiceTrips(result, authHeader);
    return result;
}

export function sncfProxyPlugin(): Plugin {
    return {
        name: 'sncf-proxy',
        configureServer(server) {
            // Load env variables (including non-VITE_ prefixed ones)
            const env = loadEnv('development', process.cwd(), '');
            const sncfApiKey = env.SNCF_API_KEY;
            // Proxy pour les perturbations SNCF
            server.middlewares.use('/api/transport/disruptions', async (req, res) => {
                const apiKey = sncfApiKey;

                if (!apiKey) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'SNCF_API_KEY not configured' }));
                    return;
                }

                try {
                    const requestUrl = new URL(req.url ?? '', 'http://localhost');
                    const mode = requestUrl.searchParams.get('mode') === 'all' ? 'all' : 'active';
                    // Encode API key for Basic Auth (SNCF uses key as username, no password)
                    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

                    // depth=2 includes detailed object info with coordinates.
                    const data = mode === 'all'
                        ? await fetchAllSncfDisruptions(authHeader)
                        : await fetchRecentSncfDisruptions(authHeader);
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Cache-Control', 'public, max-age=300');
                    res.end(JSON.stringify(data));
                } catch (err) {
                    console.error('[sncf-proxy] Fetch failed:', err);
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'SNCF API fetch failed' }));
                }
            });

            // Proxy pour les lignes/trajets
            server.middlewares.use('/api/sncf/lines', async (_req, res) => {
                const apiKey = sncfApiKey;

                if (!apiKey) {
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'SNCF_API_KEY not configured' }));
                    return;
                }

                try {
                    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

                    const url = `${SNCF_API_BASE}/coverage/sncf/lines?count=200`;
                    const resp = await fetch(url, {
                        headers: {
                            'Authorization': authHeader,
                            'Accept': 'application/json',
                        },
                        signal: AbortSignal.timeout(15000),
                    });

                    if (!resp.ok) {
                        res.statusCode = resp.status;
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ error: `SNCF API error: ${resp.status}` }));
                        return;
                    }

                    const data = await resp.json();
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Cache-Control', 'public, max-age=3600');
                    res.end(JSON.stringify(data));
                } catch (err) {
                    console.error('[sncf-proxy] Lines fetch failed:', err);
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'SNCF API fetch failed' }));
                }
            });
        },
    };
}
