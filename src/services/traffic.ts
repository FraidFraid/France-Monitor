/**
 * traffic.ts — Récupération des incidents routiers (bouchons, accidents, fermetures).
 * Source : TomTom Traffic Incidents API (temps réel), agrégation sur 7 grandes zones métropolitaines.
 */

export interface TrafficIncident {
    id: string;
    lon: number;
    lat: number;
    type: string;        // 'Bouchon', 'Accident', 'Travaux', 'Voie fermée', etc.
    severity: string;    // 'low', 'medium', 'high', 'critical'
    delay: number;       // en secondes
    length: number;      // en mètres
    description: string;
    startTime?: string;
    endTime?: string;
    from?: string;
    to?: string;
    roadNumbers?: string[];
    timeValidity?: 'present' | 'future' | string;
    probabilityOfOccurrence?: string;
    numberOfReports?: number | null;
    lastReportTime?: string | null;
    osintScore?: number;
    osintSignals?: string[];
}

export interface TrafficFlowSegment {
    currentSpeed: number;
    freeFlowSpeed: number;
    currentTravelTime: number;
    freeFlowTravelTime: number;
    confidence: number;
    roadClosure: boolean;
    frc?: string;
}

let cache: { data: TrafficIncident[]; fetchedAt: number } | null = null;
const flowCache = new Map<string, { data: TrafficFlowSegment; fetchedAt: number }>();
let budgetStateMemory: TrafficBudgetState | null = null;
let incidentFetchPromise: Promise<TrafficIncident[]> | null = null;
const CACHE_TTL = 12 * 60_000; // 12 min => 120 refresh/jour max, laisse de la marge sous 2500
const FLOW_CACHE_TTL = 15 * 60_000;
const TRAFFIC_BUDGET_STORAGE_KEY = 'fm-tomtom-traffic-budget';
const TRAFFIC_CACHE_STORAGE_KEY = 'fm-tomtom-traffic-cache';
const DAILY_NON_TILE_BUDGET = 2450;   // marge de sécurité sous 2500
const DAILY_INCIDENT_BUDGET = 2200;   // incidentDetails multi-zones
const DAILY_FLOW_BUDGET = 250;        // hover/click enrichi
const PARIS_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

// TomTom Traffic Incidents API n'autorise pas de BBOX > 10,000 km2.
// Certaines grandes métropoles sont donc découpées en sous-zones.
// Les priorités servent à dégrader progressivement si le budget journalier devient serré.
const ZONES = [
    { bbox: '1.446,48.120,2.500,48.680', name: 'Paris Ouest', priority: 1 },
    { bbox: '2.500,48.120,3.559,48.680', name: 'Paris Est', priority: 1 },
    { bbox: '1.446,48.680,2.500,49.241', name: 'IDF Nord-Ouest', priority: 1 },
    { bbox: '2.500,48.680,3.559,49.241', name: 'IDF Nord-Est', priority: 1 },
    { bbox: '4.162,45.242,4.859,46.124', name: 'Lyon Ouest', priority: 1 },
    { bbox: '4.859,45.242,5.556,46.124', name: 'Lyon Est', priority: 1 },
    { bbox: '4.740,43.085,5.888,43.834', name: 'Marseille', priority: 1 },
    { bbox: '2.642,50.158,3.376,50.803', name: 'Lille', priority: 1 },
    { bbox: '-1.201,44.402,-0.252,45.148', name: 'Bordeaux', priority: 1 },
    { bbox: '1.033,43.342,1.823,43.884', name: 'Toulouse', priority: 1 },
    { bbox: '7.202,48.243,8.026,48.865', name: 'Strasbourg', priority: 1 },
    { bbox: '6.800,43.400,7.800,44.000', name: 'Nice', priority: 1 },
    { bbox: '-2.000,46.900,-1.100,47.600', name: 'Nantes', priority: 2 },
    { bbox: '-2.100,47.800,-1.200,48.500', name: 'Rennes', priority: 2 },
    { bbox: '3.400,43.300,4.400,44.000', name: 'Montpellier', priority: 2 },
    { bbox: '0.600,49.100,1.600,49.800', name: 'Rouen', priority: 2 },
    { bbox: '5.300,44.900,6.200,45.500', name: 'Grenoble', priority: 2 },
    { bbox: '0.200,47.100,1.200,47.700', name: 'Tours', priority: 3 },
    { bbox: '4.600,47.000,5.500,47.700', name: 'Dijon', priority: 3 },
    { bbox: '-0.400,49.200,0.600,49.800', name: 'Le Havre', priority: 3 },
    { bbox: '2.600,45.500,3.600,46.100', name: 'Clermont-Ferrand', priority: 3 },
];

interface TrafficBudgetState {
    day: string;
    incidentRequests: number;
    flowRequests: number;
}

interface TrafficCacheState {
    fetchedAt: number;
    data: TrafficIncident[];
}

const CRITICAL_OSINT_TYPES = new Set([
    'Accident',
    'Route barrée',
    'Voie fermée',
    'Inondation',
    'Vent fort',
]);

function getBudgetDayKey(): string {
    return PARIS_DATE_FORMATTER.format(new Date());
}

function readBudgetState(): TrafficBudgetState {
    const day = getBudgetDayKey();
    if (typeof window === 'undefined') {
        if (!budgetStateMemory || budgetStateMemory.day !== day) {
            budgetStateMemory = { day, incidentRequests: 0, flowRequests: 0 };
        }
        return budgetStateMemory;
    }

    try {
        const raw = window.localStorage.getItem(TRAFFIC_BUDGET_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<TrafficBudgetState>;
            if (parsed.day === day) {
                return {
                    day,
                    incidentRequests: Number(parsed.incidentRequests) || 0,
                    flowRequests: Number(parsed.flowRequests) || 0,
                };
            }
        }
    } catch {
        // Ignore storage corruption and reset below.
    }

    const fresh = { day, incidentRequests: 0, flowRequests: 0 };
    budgetStateMemory = fresh;
    return fresh;
}

function writeBudgetState(state: TrafficBudgetState): void {
    budgetStateMemory = state;
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(TRAFFIC_BUDGET_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Ignore storage errors; in-memory fallback still works for the session.
    }
}

function isCacheFresh(entry: { fetchedAt: number } | null): boolean {
    return !!entry && Date.now() - entry.fetchedAt < CACHE_TTL;
}

function readPersistedIncidentCache(): TrafficCacheState | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(TRAFFIC_CACHE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<TrafficCacheState>;
        if (!Array.isArray(parsed.data) || !Number.isFinite(parsed.fetchedAt)) {
            return null;
        }
        return {
            fetchedAt: Number(parsed.fetchedAt),
            data: parsed.data as TrafficIncident[],
        };
    } catch {
        return null;
    }
}

function persistIncidentCache(entry: TrafficCacheState): void {
    cache = entry;
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(TRAFFIC_CACHE_STORAGE_KEY, JSON.stringify(entry));
    } catch {
        // Ignore quota/storage errors; in-memory cache still limits repeated calls.
    }
}

function getFreshIncidentCache(): TrafficCacheState | null {
    if (isCacheFresh(cache)) return cache;
    const persisted = readPersistedIncidentCache();
    if (isCacheFresh(persisted)) {
        cache = persisted;
        return persisted;
    }
    return null;
}

function getRemainingBudget(type: 'incident' | 'flow'): number {
    if (import.meta.env.DEV) {
        return Number.MAX_SAFE_INTEGER;
    }
    const state = readBudgetState();
    const usedTotal = state.incidentRequests + state.flowRequests;
    const totalRemaining = Math.max(0, DAILY_NON_TILE_BUDGET - usedTotal);
    if (type === 'incident') {
        return Math.max(0, Math.min(DAILY_INCIDENT_BUDGET - state.incidentRequests, totalRemaining));
    }
    return Math.max(0, Math.min(DAILY_FLOW_BUDGET - state.flowRequests, totalRemaining));
}

function consumeBudget(type: 'incident' | 'flow', amount: number): boolean {
    if (import.meta.env.DEV) {
        return true;
    }
    if (amount <= 0) return true;
    if (getRemainingBudget(type) < amount) return false;

    const state = readBudgetState();
    const next: TrafficBudgetState = {
        ...state,
        incidentRequests: state.incidentRequests + (type === 'incident' ? amount : 0),
        flowRequests: state.flowRequests + (type === 'flow' ? amount : 0),
    };
    writeBudgetState(next);
    return true;
}

function selectZonesForBudget(remainingIncidentRequests: number): Array<(typeof ZONES)[number]> {
    if (remainingIncidentRequests >= ZONES.length) {
        return ZONES;
    }

    const priority1 = ZONES.filter((zone) => zone.priority === 1);
    const priority2 = ZONES.filter((zone) => zone.priority === 2);
    const priority3 = ZONES.filter((zone) => zone.priority === 3);

    const selected: Array<(typeof ZONES)[number]> = [];
    for (const zone of priority1) {
        if (selected.length >= remainingIncidentRequests) break;
        selected.push(zone);
    }

    const daySeed = Math.floor(Date.now() / CACHE_TTL);
    const rotateInto = (pool: Array<(typeof ZONES)[number]>) => {
        if (selected.length >= remainingIncidentRequests || pool.length === 0) return;
        const offset = daySeed % pool.length;
        for (let i = 0; i < pool.length; i += 1) {
            if (selected.length >= remainingIncidentRequests) break;
            selected.push(pool[(offset + i) % pool.length]);
        }
    };

    rotateInto(priority2);
    rotateInto(priority3);
    return selected;
}

function computeOsintMetadata(incident: TrafficIncident): { score: number; signals: string[] } {
    let score = 0;
    const signals: string[] = [];

    if (CRITICAL_OSINT_TYPES.has(incident.type)) {
        score += 70;
        signals.push(incident.type);
    }

    if (incident.severity === 'high' || incident.severity === 'critical') {
        score += 25;
        signals.push('gravité élevée');
    } else if (incident.severity === 'medium') {
        score += 10;
    }

    if (incident.delay >= 1800) {
        score += 30;
        signals.push('retard > 30 min');
    } else if (incident.delay >= 900) {
        score += 20;
        signals.push('retard > 15 min');
    } else if (incident.delay >= 600) {
        score += 10;
    }

    if (incident.length >= 10000) {
        score += 25;
        signals.push('impact > 10 km');
    } else if (incident.length >= 5000) {
        score += 18;
        signals.push('impact > 5 km');
    } else if (incident.length >= 3000) {
        score += 10;
    }

    if (incident.timeValidity === 'future') {
        score += 12;
        signals.push('planifié');
    }

    if ((incident.numberOfReports ?? 0) >= 10) {
        score += 15;
        signals.push('nombreux signalements');
    } else if ((incident.numberOfReports ?? 0) >= 5) {
        score += 8;
    }

    if ((incident.roadNumbers?.length ?? 0) > 0) {
        score += 5;
    }

    return { score, signals };
}

export function filterOsintTrafficIncidents(incidents: TrafficIncident[]): TrafficIncident[] {
    return incidents
        .map((incident) => {
            const { score, signals } = computeOsintMetadata(incident);
            return { ...incident, osintScore: score, osintSignals: signals };
        })
        .filter((incident) => {
            if (CRITICAL_OSINT_TYPES.has(incident.type)) return true;
            if (incident.severity === 'high' || incident.severity === 'critical') return true;
            if (incident.severity === 'medium') {
                if (incident.type === 'Bouchon') {
                    return incident.delay >= 600 || incident.length >= 3000 || (incident.numberOfReports ?? 0) >= 4;
                }
                if (incident.type === 'Travaux') {
                    return incident.timeValidity === 'future' || incident.length >= 1500 || incident.delay >= 300;
                }
                return (incident.osintScore ?? 0) >= 18;
            }
            if (incident.type === 'Bouchon') {
                return incident.delay >= 1200 || incident.length >= 7000 || (incident.numberOfReports ?? 0) >= 8;
            }
            if (incident.type === 'Travaux') {
                return incident.timeValidity === 'future' || incident.length >= 3000 || incident.delay >= 600;
            }
            return (incident.osintScore ?? 0) >= 35;
        })
        .sort((a, b) => (b.osintScore ?? 0) - (a.osintScore ?? 0) || b.delay - a.delay || b.length - a.length)
        .slice(0, 90);
}

function transformTomTomIncident(inc: any): TrafficIncident {
    let coord = [0, 0];
    if (inc.geometry && inc.geometry.type === 'LineString' && inc.geometry.coordinates.length > 0) {
        coord = inc.geometry.coordinates[0];
    } else if (inc.geometry && inc.geometry.type === 'MultiLineString' && inc.geometry.coordinates.length > 0 && inc.geometry.coordinates[0].length > 0) {
        coord = inc.geometry.coordinates[0][0];
    } else if (inc.geometry && inc.geometry.type === 'Point') {
        coord = inc.geometry.coordinates;
    }

    let type = 'Inconnu';
    switch (inc.properties?.iconCategory) {
        case 1: type = 'Accident'; break;
        case 6: type = 'Bouchon'; break;
        case 7: type = 'Voie fermée'; break;
        case 8: type = 'Route barrée'; break;
        case 9: type = 'Travaux'; break;
        case 10: type = 'Vent fort'; break;
        case 11: type = 'Inondation'; break;
        case 14: type = 'Véhicule en panne'; break;
        default: type = 'Alerte'; break;
    }

    const delay = inc.properties?.delay || 0;
    const length = inc.properties?.length || 0;
    const magnitude = inc.properties?.magnitudeOfDelay || 0;

    let severity: TrafficIncident['severity'] = 'low';
    if (
        type === 'Route barrée' ||
        type === 'Accident' ||
        magnitude >= 3 ||
        delay >= 1800 ||
        length >= 10000
    ) {
        severity = 'high';
    } else if (
        magnitude === 2 ||
        type === 'Voie fermée' ||
        (type === 'Bouchon' && (delay >= 600 || length >= 2500)) ||
        (type === 'Travaux' && (delay >= 300 || length >= 1500)) ||
        (type === 'Vent fort' && (delay >= 300 || length >= 1500)) ||
        (type === 'Inondation' && (delay >= 180 || length >= 1000))
    ) {
        severity = 'medium';
    }

    const desc = inc.properties?.events?.map((e: any) => e.description).join(' - ') || type;
    const roadNumbers = Array.isArray(inc.properties?.roadNumbers)
        ? inc.properties.roadNumbers.filter((value: unknown) => typeof value === 'string' && value.trim() !== '')
        : [];
    const numberOfReportsRaw = inc.properties?.numberOfReports;
    const parsedReports = numberOfReportsRaw == null || numberOfReportsRaw === 'null'
        ? null
        : Number(numberOfReportsRaw);

    return {
        id: inc.properties?.id || Math.random().toString(36),
        lon: coord[0],
        lat: coord[1],
        type,
        severity,
        delay,
        length,
        description: desc,
        startTime: inc.properties?.startTime || undefined,
        endTime: inc.properties?.endTime || undefined,
        from: inc.properties?.from || undefined,
        to: inc.properties?.to || undefined,
        roadNumbers,
        timeValidity: inc.properties?.timeValidity || undefined,
        probabilityOfOccurrence: inc.properties?.probabilityOfOccurrence || undefined,
        numberOfReports: Number.isFinite(parsedReports) ? parsedReports : null,
        lastReportTime: inc.properties?.lastReportTime && inc.properties.lastReportTime !== 'null'
            ? inc.properties.lastReportTime
            : null,
    };
}

export async function fetchTrafficIncidents(): Promise<TrafficIncident[]> {
    const cached = getFreshIncidentCache();
    if (cached) {
        return cached.data;
    }

    // La clé TomTom reste côté serveur : les incidents passent par /api/traffic/road.
    if (incidentFetchPromise) {
        return incidentFetchPromise;
    }

    incidentFetchPromise = (async () => {
        const remainingIncidentBudget = getRemainingBudget('incident');
        if (remainingIncidentBudget <= 0) {
            console.warn('[traffic.ts] Budget journalier TomTom incidents épuisé.');
            return cache?.data ?? [];
        }

        const zonesToQuery = selectZonesForBudget(remainingIncidentBudget);
        if (zonesToQuery.length === 0) {
            return cache?.data ?? [];
        }

        if (!consumeBudget('incident', zonesToQuery.length)) {
            return cache?.data ?? [];
        }

        const promises = zonesToQuery.map(zone => {
            const url = `/api/traffic/road?bbox=${encodeURIComponent(zone.bbox)}`;
            return fetch(url, { signal: AbortSignal.timeout(10_000) })
                .then(r => r.ok ? r.json() : null)
                .catch(() => null);
        });

        const results = await Promise.all(promises);

        const allIncidents = new Map<string, TrafficIncident>();
        const apiErrors: Array<{ code?: string; message?: string }> = [];
        for (const res of results) {
            if (res?.detailedError) {
                apiErrors.push({
                    code: res.detailedError.code,
                    message: res.detailedError.message,
                });
            }
            if (res && res.incidents) {
                for (const inc of res.incidents) {
                    const mapped = transformTomTomIncident(inc);
                    allIncidents.set(mapped.id, mapped);
                }
            }
        }

        const finalData = Array.from(allIncidents.values())
            .sort((a, b) => b.delay - a.delay || b.length - a.length);

        if (finalData.length === 0 && apiErrors.length > 0) {
            const firstError = apiErrors[0];
            const code = firstError.code ? ` ${firstError.code}` : '';
            const message = firstError.message || 'Erreur API inconnue';
            throw new Error(`TomTom${code}: ${message}`);
        }

        persistIncidentCache({ data: finalData, fetchedAt: Date.now() });
        return finalData;
    })().catch((err) => {
        console.error('[traffic.ts] Failed to fetch incidents', err);
        return [];
    }).finally(() => {
        incidentFetchPromise = null;
    });

    return incidentFetchPromise;
}

export function hasFreshTrafficIncidentCache(): boolean {
    return getFreshIncidentCache() !== null;
}

export function clearTrafficIncidentCache(): void {
    cache = null;
    incidentFetchPromise = null;
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(TRAFFIC_CACHE_STORAGE_KEY);
    } catch {
        // Ignore storage errors.
    }
}

export async function fetchTrafficFlowSegment(lat: number, lon: number, zoom = 10): Promise<TrafficFlowSegment | null> {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)},${zoom}`;
    const cached = flowCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < FLOW_CACHE_TTL) {
        return cached.data;
    }

    if (!consumeBudget('flow', 1)) {
        console.warn('[traffic.ts] Budget journalier TomTom flow épuisé.');
        return null;
    }

    const safeZoom = Math.max(0, Math.min(22, Math.round(zoom)));
    // La clé TomTom reste côté serveur : on passe par le proxy /api/traffic/flow.
    const url = `/api/traffic/flow?point=${lat},${lon}&zoom=${safeZoom}`;

    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) return null;

        const data = await response.json();
        if (data?.detailedError) return null;

        // L'API TomTom v4 imbrique les valeurs sous `flowSegmentData`.
        const payload = data?.flowSegmentData ?? data;

        const segment: TrafficFlowSegment = {
            currentSpeed: Number(payload.currentSpeed) || 0,
            freeFlowSpeed: Number(payload.freeFlowSpeed) || 0,
            currentTravelTime: Number(payload.currentTravelTime) || 0,
            freeFlowTravelTime: Number(payload.freeFlowTravelTime) || 0,
            confidence: Number(payload.confidence) || 0,
            roadClosure: payload.roadClosure === true,
            frc: typeof payload.frc === 'string' ? payload.frc : undefined,
        };

        flowCache.set(key, { data: segment, fetchedAt: Date.now() });
        return segment;
    } catch {
        return null;
    }
}
