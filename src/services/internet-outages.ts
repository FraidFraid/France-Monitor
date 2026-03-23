/**
 * internet-outages.ts — Service de surveillance des pannes Internet françaises
 *
 * Sources :
 *  - IODA (Georgia Tech / CAIDA)     : détection d'anomalies BGP, IBR, probing actif
 *  - BGPView                          : comptage courant de préfixes par ASN
 *
 * Le proxy `/api/internet-outages` agrège ces sources côté serveur pour éviter les CORS.
 */

import type { IodaOutageEvent, IspBgpStatus, NetworkOutageState } from '../types/index.ts';

// ── Cache ──────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60_000; // 5 min

let cache: { data: NetworkOutageState; fetchedAt: number } | null = null;

// ── Circuit breaker ────────────────────────────────────────────────────────────

const CIRCUIT_COOLDOWN_MS = 2 * 60_000; // 2 min après 2 échecs
let failureCount  = 0;
let cooldownUntil = 0;

// ── Coordonnées ISP (pour affichage carte si ISP non dans la réponse) ──────────

const ISP_COORDS: Record<string, [number, number]> = {
    '3215':  [2.349,  48.864],
    '12322': [2.290,  48.889],
    '15557': [2.317,  48.825],
    '5410':  [2.244,  48.832],
    '16276': [3.170,  50.694],
    '12876': [2.359,  48.863],
};

const FRANCE_CENTER: [number, number] = [2.2137, 46.2276];

// ── Parsers ────────────────────────────────────────────────────────────────────

function parseEvent(raw: Record<string, unknown>): IodaOutageEvent {
    const entityType = (raw.entityType as string) === 'asn' ? 'asn'
        : (raw.entityType as string) === 'region' ? 'region'
        : 'country';

    const coords = Array.isArray(raw.coordinates)
        ? raw.coordinates as [number, number]
        : (ISP_COORDS[raw.entityCode as string] ?? FRANCE_CENTER);

    return {
        id:          String(raw.id ?? ''),
        entityCode:  String(raw.entityCode ?? ''),
        entityName:  String(raw.entityName ?? ''),
        entityType,
        startTime:   new Date(Number(raw.startTime)),
        endTime:     raw.endTime != null ? new Date(Number(raw.endTime)) : null,
        duration:    Number(raw.duration ?? 0),
        score:       Number(raw.score ?? 0),
        datasources: Array.isArray(raw.datasources) ? (raw.datasources as string[]) : [],
        isOngoing:   Boolean(raw.isOngoing),
        coordinates: coords,
    };
}

function parseIspStatus(raw: Record<string, unknown>): IspBgpStatus {
    const coords = Array.isArray(raw.coordinates)
        ? raw.coordinates as [number, number]
        : (ISP_COORDS[raw.asn as string] ?? FRANCE_CENTER);

    const statusRaw = String(raw.status ?? 'normal');
    const status: IspBgpStatus['status'] =
        statusRaw === 'outage' ? 'outage' : statusRaw === 'degraded' ? 'degraded' : 'normal';

    return {
        asn:               String(raw.asn ?? ''),
        ispName:           String(raw.ispName ?? ''),
        prefixCount:       Number(raw.prefixCount ?? 0),
        prefixCountNormal: Number(raw.prefixCountNormal ?? 0),
        visibility:        Number(raw.visibility ?? 100),
        status,
        coordinates:       coords,
        lastUpdated:       new Date(String(raw.lastUpdated ?? Date.now())),
    };
}

// ── Score national ─────────────────────────────────────────────────────────────

/**
 * Calcule un score de santé Internet 0–100 (100 = réseau sain, 0 = crise grave).
 *
 * Contributions :
 *  - Événements IODA actifs (en cours) : -20 pts par événement critique (score > 80)
 *  - Visibilité BGP moyenne des ISPs
 */
function computeNationalScore(events: IodaOutageEvent[], isps: IspBgpStatus[]): number {
    let score = 100;

    // Pénalité événements actifs
    const ongoingEvents = events.filter(e => e.isOngoing);
    for (const ev of ongoingEvents) {
        if (ev.score >= 80) score -= 20;
        else if (ev.score >= 50) score -= 10;
        else score -= 3;
    }

    // Pénalité visibilité ISP
    if (isps.length > 0) {
        const avgVisibility = isps.reduce((sum, isp) => sum + isp.visibility, 0) / isps.length;
        if (avgVisibility < 95) score -= Math.round((95 - avgVisibility) * 1.5);
    }

    return Math.max(0, Math.min(100, score));
}

// ── Fetch principal ────────────────────────────────────────────────────────────

export async function fetchNetworkOutages(): Promise<NetworkOutageState> {
    // Retourner le cache si encore frais
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.data;
    }

    // Circuit breaker
    if (failureCount >= 2 && Date.now() < cooldownUntil) {
        console.warn('[NetworkOutages] Circuit breaker ouvert — cooldown actif');
        return cache?.data ?? buildEmptyState('error');
    }

    try {
        const res = await fetch('/api/internet-outages', {
            signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json() as {
            events:        Record<string, unknown>[];
            ispStatus:     Record<string, unknown>[];
            sourcesStatus: { ioda: string; bgpview: string };
            generatedAt:   string;
        };

        const events    = (Array.isArray(json.events)    ? json.events    : []).map(parseEvent);
        const ispStatus = (Array.isArray(json.ispStatus) ? json.ispStatus : []).map(parseIspStatus);

        const iodaStatus   = String(json.sourcesStatus?.ioda    ?? 'stale') as 'ok' | 'stale' | 'error';
        const bgpvStatus   = String(json.sourcesStatus?.bgpview ?? 'stale') as 'ok' | 'stale' | 'error';

        const state: NetworkOutageState = {
            iodaEvents:   events,
            ispStatus,
            nationalScore: computeNationalScore(events, ispStatus),
            sourcesStatus: { ioda: iodaStatus, bgpview: bgpvStatus },
            lastUpdate:   new Date(),
        };

        cache         = { data: state, fetchedAt: Date.now() };
        failureCount  = 0;
        return state;

    } catch (err) {
        failureCount++;
        if (failureCount >= 2) cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
        console.warn('[NetworkOutages] Fetch error:', err);
        return cache?.data ?? buildEmptyState('error');
    }
}

function buildEmptyState(iodaStatus: 'ok' | 'stale' | 'error'): NetworkOutageState {
    return {
        iodaEvents:    [],
        ispStatus:     [],
        nationalScore: 100,
        sourcesStatus: { ioda: iodaStatus, bgpview: 'stale' },
        lastUpdate:    new Date(),
    };
}

// ── Helpers exportés ──────────────────────────────────────────────────────────

/** Renvoie le label lisible pour un niveau de score IODA */
export function iodaScoreLabel(score: number): string {
    if (score >= 80) return 'Critique';
    if (score >= 50) return 'Sévère';
    if (score >= 20) return 'Modérée';
    return 'Faible';
}

/** Renvoie la couleur hex pour un niveau de score IODA */
export function iodaScoreColor(score: number): string {
    if (score >= 80) return '#EF4444'; // rouge
    if (score >= 50) return '#F59E0B'; // orange
    if (score >= 20) return '#FBBF24'; // jaune
    return '#6EE7B7';                  // vert clair
}

/** Renvoie la couleur hex pour le statut BGP d'un ISP */
export function ispStatusColor(status: IspBgpStatus['status']): string {
    if (status === 'outage')   return '#EF4444';
    if (status === 'degraded') return '#F59E0B';
    return '#10B981';
}

/** Renvoie le label fr du statut BGP */
export function ispStatusLabel(status: IspBgpStatus['status']): string {
    if (status === 'outage')   return 'Panne';
    if (status === 'degraded') return 'Dégradé';
    return 'Normal';
}

/** Sources de données à afficher dans le StatusPanel */
export const INTERNET_OUTAGE_SOURCES = [
    {
        id:    'ioda',
        name:  'IODA (CAIDA)',
        url:   'https://ioda.caida.org/',
        description: 'Détection anomalies BGP/IBR/probing — Georgia Tech',
    },
    {
        id:    'bgpview',
        name:  'BGPView',
        url:   'https://bgpview.io/',
        description: 'Comptage préfixes BGP en temps réel par ASN',
    },
] as const;
