/**
 * outages-scraper.ts — Service Frontend : Pannes Crowd-sourced
 *
 * Consomme l'endpoint `/api/outages/citizen` (Vercel serverless en prod,
 * Vite plugin en dev) pour afficher les zones de pannes citoyennes sur la carte.
 *
 * Fonctionnalités :
 * - Cache client 10 min (évite les re-fetches inutiles)
 * - Circuit breaker : désactivation après 2 échecs consécutifs
 * - Corrélation avec Ecowatt : booste la severity si signal orange/rouge
 * - Helpers de visualisation : couleurs par severity, GeoJSON layer-ready
 */

import type {
    CitizenOutageReport,
    CitizenOutageResponse,
    OutageZone,
    OutageZoneCollection,
    OutageZoneProperties,
} from '../types/index.ts';
import { Watchdog } from './watchdog.ts';

Watchdog.register('scraping-citoyen', {
    label: 'Pannes Citoyennes',
    staleAfterMs: 10 * 60_000,
    detail: 'Signalements crowd-sourced infocoupure.fr · /api/outages/citizen',
    freshness: 'TEMPS_REEL',
});

// ── Configuration ───────────────────────────────────────────────────────────

const ENDPOINT = '/api/citizen-outages';
const CACHE_TTL_MS = 10 * 60_000; // 10 minutes
const CIRCUIT_BREAKER_THRESHOLD = 2;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60_000; // 5 minutes

// ── Module State ─────────────────────────────────────────────────────────────

let _cache: { data: CitizenOutageResponse; fetchedAt: number } | null = null;
let _failureCount = 0;
let _cooldownUntil = 0;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetche les zones de pannes crowd-sourced depuis le backend.
 *
 * @returns CitizenOutageResponse avec zones GeoJSON + reports individuels
 */
export async function fetchCitizenOutageZones(): Promise<CitizenOutageResponse> {
    const now = Date.now();

    // Circuit breaker : évite de spammer un endpoint défaillant
    if (_failureCount >= CIRCUIT_BREAKER_THRESHOLD && now < _cooldownUntil) {
        console.warn('[outages-scraper] Circuit breaker open — returning cached or empty data');
        Watchdog.report('scraping-citoyen', { type: 'fallback', reason: 'circuit breaker ouvert' });
        return _cache?.data ?? buildEmptyResponse();
    }

    // Cache client
    if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
        return _cache.data;
    }

    Watchdog.report('scraping-citoyen', { type: 'loading' });
    const t0 = Date.now();

    try {
        const resp = await fetch(ENDPOINT, {
            // 60s : le plugin dev scrape jusqu'à 10 depts × 15 villes + géocodage,
            // ce qui peut dépasser largement les 15s initiaux.
            // En prod (Vercel), la serverless function a son propre timeout.
            signal: AbortSignal.timeout(60_000),
        });

        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status} from ${ENDPOINT}`);
        }

        const data: CitizenOutageResponse = await resp.json();

        // Reset circuit breaker on success
        _failureCount = 0;
        _cooldownUntil = 0;

        // Update cache
        _cache = { data, fetchedAt: now };

        const zoneCount = data.zones?.features?.length ?? 0;
        Watchdog.report('scraping-citoyen', {
            type: 'success',
            responseTimeMs: Date.now() - t0,
            detail: `${zoneCount} zones · ${data.reports?.length ?? 0} signalements`,
        });

        return data;
    } catch (err) {
        _failureCount++;
        if (_failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
            _cooldownUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS;
            console.warn(
                `[outages-scraper] Circuit breaker triggered (${_failureCount} failures). ` +
                `Cooling down for ${CIRCUIT_BREAKER_COOLDOWN_MS / 60_000} min.`
            );
        } else {
            console.warn('[outages-scraper] Fetch error:', err instanceof Error ? err.message : err);
        }

        const msg = err instanceof Error ? err.message : String(err);
        Watchdog.report('scraping-citoyen', { type: 'failure', error: msg, isFallback: !!_cache });

        // Return stale cache on error
        return _cache?.data ?? buildEmptyResponse();
    }
}

/**
 * Retourne uniquement la FeatureCollection GeoJSON des zones,
 * prête à être injectée dans un layer Deck.gl ou MapLibre.
 */
export async function fetchOutageZoneCollection(): Promise<OutageZoneCollection> {
    const response = await fetchCitizenOutageZones();
    return response.zones;
}

/**
 * Retourne les signalements bruts (CitizenOutageReport[]) triés par date décroissante.
 */
export async function fetchCitizenReports(): Promise<CitizenOutageReport[]> {
    const response = await fetchCitizenOutageZones();
    return [...response.reports].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
}

/**
 * Corrèle les zones de pannes avec un signal Ecowatt.
 * Si le signal est orange/rouge, remonte la severity des zones 'low'/'medium'.
 *
 * @param ecowattSignal 'green' | 'orange' | 'red'
 * @returns FeatureCollection avec severities ajustées
 */
export function correlateWithEcowatt(
    zones: OutageZoneCollection,
    ecowattSignal: 'green' | 'orange' | 'red'
): OutageZoneCollection {
    if (ecowattSignal === 'green') return zones;

    const boostedFeatures = zones.features.map((zone: OutageZone) => {
        const props = zone.properties;
        let severity = props.severity;

        if (ecowattSignal === 'red') {
            // Tension réseau nationale : monter d'un niveau
            if (severity === 'low') severity = 'medium';
            else if (severity === 'medium') severity = 'high';
        } else if (ecowattSignal === 'orange') {
            // Vigilance : monter seulement les zones avec peu de reports
            if (severity === 'low' && props.totalReports > 5) severity = 'medium';
        }

        if (severity === props.severity) return zone;

        return {
            ...zone,
            properties: {
                ...props,
                severity,
                // Marquer la corrélation pour le rendu
                ecowattCorrelated: true,
            } as OutageZoneProperties,
        };
    });

    return { ...zones, features: boostedFeatures };
}

/**
 * Force le refresh du cache (utile pour un bouton "Actualiser" dans l'UI).
 */
export function invalidateCitizenOutageCache(): void {
    _cache = null;
}

/**
 * Retourne l'état du circuit breaker pour le StatusPanel.
 */
export function getCitizenOutageCircuitBreakerState() {
    return {
        isOpen: _failureCount >= CIRCUIT_BREAKER_THRESHOLD && Date.now() < _cooldownUntil,
        failureCount: _failureCount,
        cooldownUntil: _cooldownUntil > 0 ? new Date(_cooldownUntil) : null,
    };
}

// ── Visualization Helpers ────────────────────────────────────────────────────

/** Couleurs RGBA pour le rendu Deck.gl (ScatterplotLayer / GeoJsonLayer). */
export const SEVERITY_COLORS: Record<
    OutageZoneProperties['severity'],
    [number, number, number, number]
> = {
    low:      [255, 200,  50, 80],  // jaune translucide
    medium:   [255, 140,   0, 120], // orange
    high:     [220,  50,  50, 150], // rouge
    critical: [180,   0, 255, 180], // violet électrique (maximum alerte)
};

/** Couleur de contour (stroke) par severity. */
export const SEVERITY_STROKE_COLORS: Record<
    OutageZoneProperties['severity'],
    [number, number, number, number]
> = {
    low:      [255, 200,  50, 200],
    medium:   [255, 140,   0, 230],
    high:     [220,  50,  50, 255],
    critical: [180,   0, 255, 255],
};

/**
 * Retourne la couleur RGBA d'une zone en fonction de sa severity.
 * Compatible avec le format Deck.gl `getFillColor`.
 */
export function getZoneColor(
    zone: OutageZone,
    alpha?: number
): [number, number, number, number] {
    const base = SEVERITY_COLORS[zone.properties.severity] ?? SEVERITY_COLORS.low;
    if (alpha !== undefined) return [base[0], base[1], base[2], alpha];
    return base;
}

/**
 * Construit le label HTML d'une zone pour le MapPopup.
 */
export function buildZonePopupHtml(zone: OutageZone): string {
    const p = zone.properties;
    const severityLabel: Record<OutageZoneProperties['severity'], string> = {
        low: '🟡 Faible',
        medium: '🟠 Modéré',
        high: '🔴 Élevé',
        critical: '🟣 Critique',
    };
    const sourcesStr = p.sources.join(', ');

    return `
        <div class="popup-outage-zone">
            <div class="popup-header">${severityLabel[p.severity]} — Zone de pannes</div>
            <div class="popup-body">
                <p><strong>${p.totalReports}</strong> signalements · densité ${p.density.toFixed(1)}/km²</p>
                <p>Rayon estimé : ~${p.radiusKm} km</p>
                <p class="popup-sources">Sources : ${sourcesStr}</p>
                <p class="popup-ts">Mis à jour : ${new Date(p.createdAt).toLocaleTimeString('fr-FR')}</p>
            </div>
        </div>
    `.trim();
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

function buildEmptyResponse(): CitizenOutageResponse {
    return {
        zones: { type: 'FeatureCollection', features: [] },
        reports: [],
        stats: {
            totalReports: 0,
            totalZones: 0,
            criticalZones: 0,
            sourcesStatus: {
                infocoupure: 'error',
                'coupure-elec': 'error',
            },
            fetchedAt: new Date().toISOString(),
        },
    };
}
