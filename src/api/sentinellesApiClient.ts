/**
 * Client API TypeScript pour le Réseau Sentinelles (Sentiweb)
 * Endpoint: https://www.sentiweb.fr/api/v1/datasets/rest
 *
 * Note: L'API Sentiweb peut renvoyer 501 (Service Unavailable) fréquemment.
 * Le client gère ces erreurs silencieusement et utilise le cache local.
 */

const BASE_URL = 'https://www.sentiweb.fr/api/v1/datasets/rest';

// Track if we've already logged Sentiweb errors to avoid spam
let sentiweb501Logged = false;

// Cache TTL: 24 hours for resilience against rate limits
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface SentinellesIndicator {
    id: number;
    name: string;
    case_definition: string;
    geo?: Record<string, string>;
    datasets?: string[];
}

export interface SentinellesIncidenceRecord {
    week: number;
    indicator: number;
    inc: number;
    inc_low: number;
    inc_up: number;
    inc100: number; // Incidence pour 100 000 habitants
    inc100_low: number;
    inc100_up: number;
    geo_insee: string;
    geo_name: string;
}

/**
 * Liste les indicateurs disponibles (maladies / syndromes)
 */
export async function listIndicators(): Promise<SentinellesIndicator[]> {
    const url = `${BASE_URL}/indicators`;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) {
            handleSentiwebError(response.status);
            return [];
        }
        sentiweb501Logged = false;
        const data = await response.json();
        return data as SentinellesIndicator[];
    } catch (err) {
        handleSentiwebError(err);
        return [];
    }
}

/**
 * Récupère les incidences hebdomadaires par indicateur
 *
 * @param indicatorId ID de l'indicateur (ex: 3 pour Grippe)
 * @param geoLevel PAY (France), REG (Région), RDD (Département)
 * @param span last (dernière sém), short (quelques sém), all (tout)
 */
export async function fetchIncidence(
    indicatorId: number | string,
    geoLevel: 'PAY' | 'REG' | 'RDD',
    span: 'last' | 'short' | 'all' = 'short'
): Promise<SentinellesIncidenceRecord[]> {
    const url = `${BASE_URL}/incidence?indicator=${indicatorId}&geo=${geoLevel}&span=${span}&$format=json`;
    const cacheKey = `sm_sentinelles_v2_${indicatorId}_${geoLevel}_${span}`;

    // Try cache first
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            // Cache valid for 24 hours (resilience against rate limits)
            if (Date.now() - timestamp < CACHE_TTL_MS) {
                return data;
            }
        }
    } catch {
        // Ignore parse error
    }

    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) {
            handleSentiwebError(response.status);
            // Return stale cache if available
            return getCachedData(cacheKey);
        }

        sentiweb501Logged = false;
        const data = await response.json();

        let records: SentinellesIncidenceRecord[] = [];
        if (Array.isArray(data)) {
            records = data as SentinellesIncidenceRecord[];
        } else if (data && Array.isArray(data.data)) {
            records = data.data as SentinellesIncidenceRecord[];
        }

        if (records.length > 0) {
            try {
                localStorage.setItem(cacheKey, JSON.stringify({ data: records, timestamp: Date.now() }));
            } catch {
                // Ignore storage quota error
            }
        }

        return records;
    } catch (err) {
        handleSentiwebError(err);
        // Return stale cache if available
        return getCachedData(cacheKey);
    }
}

function handleSentiwebError(errOrStatus: unknown): void {
    if (sentiweb501Logged) return;

    if (typeof errOrStatus === 'number') {
        if (errOrStatus === 429) {
            console.warn('[Sentiweb] Rate limit (429) - utilisation du cache local (24h TTL)');
        } else if (errOrStatus === 501 || errOrStatus === 503) {
            console.warn('[Sentiweb] API indisponible (501/503) - utilisation du cache local');
        } else {
            console.warn(`[Sentiweb] HTTP ${errOrStatus} - utilisation du cache local`);
        }
    } else {
        const msg = errOrStatus instanceof Error ? errOrStatus.message : String(errOrStatus);
        if (msg.includes('Failed to fetch') || msg.includes('CORS') || msg.includes('timeout')) {
            console.warn('[Sentiweb] API inaccessible - utilisation du cache local');
        }
    }
    sentiweb501Logged = true;
}

function getCachedData(cacheKey: string): SentinellesIncidenceRecord[] {
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const { data } = JSON.parse(cached);
            return Array.isArray(data) ? data : [];
        }
    } catch {
        // Ignore
    }
    return [];
}
