/**
 * outages.ts — Service for telecom and power outage data.
 *
 * Sources:
 * - ARCEP: Mobile network outages (GeoJSON) — données J ou J-1
 * - Enedis OpenDataSoft v2.1: Historical continuity metrics (HISTORIQUE)
 * - RTE Ecowatt: Grid tension signals (TEMPS RÉEL)
 *
 * Enedis URLs migration:
 *   Deprecated: opendata.enedis.fr/data-fair/api/v1/datasets/[id]/lines  (410 Gone)
 *   Stable:     opendata.enedis.fr/api/explore/v2.1/catalog/datasets/[id]/records
 *   Key field: ndeg_departement (vs previous code_departement variants)
 */

import type { TelecomOutage, PowerOutage } from '../types/index.ts';
import { DEPARTMENTS } from './stability-index.ts';

/** Date réelle du fichier ARCEP servi (J ou J-1) — live binding ESM. */
export let lastArcepDataDate: Date | null = null;
import { fetchEcowatt } from './ecowatt.ts';
import { resilientFetchResults } from '../utils/resilientFetch.ts';
import {
    adaptContinuityRecords,
    adaptDurationRecords,
    adaptFrequencyRecords,
    normalizeDepartmentCode,
    type DataFairContinuityRecord,
    type DataFairDurationRecord,
    type DataFairFrequencyRecord,
} from './adapters/enedis-adapter.ts';
import { Watchdog } from './watchdog.ts';

Watchdog.register('arcep', {
    label: 'ARCEP Réseau Mobile',
    staleAfterMs: 24 * 60 * 60_000, // fichier journalier
    detail: 'Sites HS opérateurs mobiles · data.gouv.fr GeoJSON J ou J-1',
    freshness: 'HISTORIQUE',
});

Watchdog.register('enedis-power', {
    label: 'Enedis / Pannes Électricité',
    staleAfterMs: 15 * 60_000,
    detail: 'Continuité BT · OpenDataSoft v2.1 DataFair + Écowatt',
    freshness: 'HISTORIQUE',
});

// ═══ ARCEP Mobile Network Outages ═══

/**
 * Fetch the latest GeoJSON file containing sites without service (HS).
 * The file is named using the current date. Should it fail, tries to fetch D-1.
 */
export async function fetchTelecomOutages(): Promise<TelecomOutage[]> {
    Watchdog.report('arcep', { type: 'loading' });
    const t0 = Date.now();
    try {
        const today = new Date();
        const formatDate = (date: Date) => {
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        };

        let dateStr = formatDate(today);
        let url = `/api/arcep?date=${dateStr}`;
        let res = await fetch(url);
        let usedFallback = false;

        // Fallback to yesterday if today's file is not yet uploaded
        if (!res.ok) {
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);
            dateStr = formatDate(yesterday);
            url = `/api/arcep?date=${dateStr}`;
            res = await fetch(url);
            usedFallback = true;
            if (!res.ok) {
                throw new Error(`Failed to fetch ARCEP data for ${dateStr}. Status: ${res.status}`);
            }
        }

        // Mémorise la date réelle du fichier servi (J ou J-1) pour l'UI
        lastArcepDataDate = new Date(dateStr + 'T12:00:00');

        const json = await res.json();
        if (!json.features) {
            Watchdog.report('arcep', { type: 'success', responseTimeMs: Date.now() - t0, detail: 'Aucun site HS' });
            return [];
        }

        const sitesHS = json.features.length;
        Watchdog.report('arcep', {
            type: 'success',
            responseTimeMs: Date.now() - t0,
            detail: `${sitesHS} sites HS${usedFallback ? ' · J-1' : ' · J'}`,
        });
        if (usedFallback) Watchdog.report('arcep', { type: 'fallback', reason: 'fichier J indisponible → J-1' });

        return json.features.map((f: any, index: number) => {
            const props = f.properties;
            const coords = f.geometry?.coordinates;
            let voice: 'OK' | 'HS' | 'Degraded' = 'OK';
            let dataStatus: 'OK' | 'HS' | 'Degraded' = 'OK';

            // voix/data aggregate = 'HS' when ANY sub-tech is HS (not all).
            const allVoiceHS = props.voix2g === 'HS' && props.voix3g === 'HS' && props.voix4g === 'HS';
            const anyVoiceHS = props.voix2g === 'HS' || props.voix3g === 'HS' || props.voix4g === 'HS';
            voice = allVoiceHS ? 'HS' : anyVoiceHS ? 'Degraded' : 'OK';

            const allDataHS = props.data3g === 'HS' && props.data4g === 'HS' && props.data5g === 'HS';
            const anyDataHS = props.data3g === 'HS' || props.data4g === 'HS' || props.data5g === 'HS';
            dataStatus = allDataHS ? 'HS' : anyDataHS ? 'Degraded' : 'OK';

            let reason = props.detail || 'Incident';
            if (props.raison === 'INT') reason = 'Intempéries';
            else if (props.raison === 'MNT') reason = 'Maintenance';
            else if (props.raison === 'INC') reason = 'Incident technique';

            return {
                id: `telecom-${index}-${props.station_anfr}`,
                operator: props.operateur || 'Inconnu',
                department: props.departement?.trim() || 'Inconnu',
                city: props.commune || 'Inconnue',
                voiceStatus: voice,
                dataStatus: dataStatus,
                reason: reason,
                coordinates: coords ? [coords[0], coords[1]] : [0, 0]
            };
        }).filter((o: TelecomOutage) => o.coordinates[0] !== 0 && o.coordinates[1] !== 0);
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('[Outages] ARCEP fetch error', error);
        Watchdog.report('arcep', { type: 'failure', error: msg });
        return [];
    }
}

// ═══ Enedis Power Outages ═══

// OpenDataSoft v2.1 catalogue endpoints (stable — remplace les v1 DataFair dépréciés)
const ENEDIS_BASE = 'https://opendata.enedis.fr/api/explore/v2.1/catalog/datasets';
const ENEDIS_CONTINUITY_URL =
    `${ENEDIS_BASE}/indicateur-continuite-dalimentation/records?limit=200&timezone=Europe%2FParis`;
const ENEDIS_FREQ_URL =
    `${ENEDIS_BASE}/frequence-moyenne-de-coupure-par-client-bt/records?limit=200&timezone=Europe%2FParis`;
const ENEDIS_DURATION_URL =
    `${ENEDIS_BASE}/duree-moyenne-de-coupure-bt/records?limit=200&timezone=Europe%2FParis`;

// Cache configuration
const POWER_CACHE_TTL_MS = 15 * 60_000; // 15 minutes for DataFair data

// ── Circuit Breaker ──────────────────────────────────────────────────────────

type CircuitState = 'closed' | 'open' | 'half-open';

const CB_FAILURE_THRESHOLD = 3;
const CB_COOLDOWN_MS = 30 * 60_000; // 30 min before half-open probe

const _cb: { failures: number; lastFailureAt: number | null; state: CircuitState } = {
    failures: 0,
    lastFailureAt: null,
    state: 'closed',
};

// ── Outages Meta ─────────────────────────────────────────────────────────────

export type OutagesMeta = {
    /** Timestamp of last successful fetch, or null if never fetched. */
    fetchedAt: number | null;
    /** True when circuit breaker is open (Enedis unreachable). */
    cbOpen: boolean;
    /** ID of the request that produced the current cache entry. */
    requestId: string;
};

let _meta: OutagesMeta = { fetchedAt: null, cbOpen: false, requestId: '' };

/** Race condition guard — tracks the most recent in-flight request ID. */
let _currentRequestId = '';

// ── Module-level state ───────────────────────────────────────────────────────

let powerCache: { data: PowerOutage[]; fetchedAt: number } | null = null;
const previousPowerByDept = new Map<string, number>();

/**
 * Fetch power outages by merging:
 * 1. Enedis DataFair historical metrics (baseline)
 * 2. Ecowatt grid tension signals (context)
 */
export async function fetchPowerOutages(): Promise<PowerOutage[]> {
    const now = Date.now();

    // ── Circuit breaker ──────────────────────────────────────────────────────
    if (_cb.state === 'open') {
        if (_cb.lastFailureAt !== null && now - _cb.lastFailureAt >= CB_COOLDOWN_MS) {
            _cb.state = 'half-open';
            console.warn('[outages]', { event: 'cb_half_open', note: 'probing Enedis' });
        } else {
            _meta.cbOpen = true;
            Watchdog.report('enedis-power', { type: 'fallback', reason: 'circuit breaker ouvert' });
            return powerCache?.data ?? [];
        }
    }

    // ── Cache check (skipped in half-open to force a live probe) ─────────────
    if (_cb.state === 'closed' && powerCache && now - powerCache.fetchedAt < POWER_CACHE_TTL_MS) {
        return powerCache.data;
    }

    // ── Race condition guard ─────────────────────────────────────────────────
    const requestId = crypto.randomUUID();
    _currentRequestId = requestId;

    Watchdog.report('enedis-power', { type: 'loading' });
    const _t0 = Date.now();

    try {
        // Fetch all data sources in parallel
        const [continuityRows, freqRows, durRows, ecowatt] = await Promise.all([
            fetchDataFairRecords<DataFairContinuityRecord>(ENEDIS_CONTINUITY_URL),
            fetchDataFairRecords<DataFairFrequencyRecord>(ENEDIS_FREQ_URL),
            fetchDataFairRecords<DataFairDurationRecord>(ENEDIS_DURATION_URL),
            fetchEcowatt(),
        ]);

        // Stale response: a newer call already took over
        if (_currentRequestId !== requestId) {
            console.warn('[outages]', { event: 'stale_response_dropped', requestId });
            return powerCache?.data ?? [];
        }

        // Use adapters to transform DataFair records
        const continuityByDept = adaptContinuityRecords(continuityRows);
        const freqMetrics = adaptFrequencyRecords(freqRows);
        const durMetrics = adaptDurationRecords(durRows);

        // Compute power outages for all known departments
        const deptCodes = new Set<string>(Object.keys(DEPARTMENTS));
        const computed: Array<PowerOutage & { _signal: 'green' | 'orange' | 'red' }> = [];

        for (const departmentCode of deptCodes) {
            const continuityPct = continuityByDept.get(departmentCode) ?? 0;
            const regionCode = DEPARTMENTS[departmentCode]?.regionCode;
            const rawSignal = (regionCode ? ecowatt.signals[regionCode] : undefined) ?? 'green';
            const signal = softenSignal(rawSignal, continuityPct);

            // Compute off-grid count
            const hasEnedisMetric = continuityPct > 0;
            const offGridCount = hasEnedisMetric
                ? Math.round(Math.max(1, continuityPct * 120))
                : 0;

            const signalLabel = signal === 'red' ? '🔴 rouge' : signal === 'orange' ? '🟠 orange' : '🟢 vert';
            const causePrefix = hasEnedisMetric
                ? 'Indicateurs Historiques DataFair'
                : 'Risque tension réseau';

            // Build metrics string
            const freqStr = freqMetrics ? `freq=${freqMetrics.total.toFixed(2)}` : 'freq=n/a';
            const durStr = durMetrics ? `dur=${durMetrics.totalMinutes.toFixed(1)}min` : 'dur=n/a';

            const eventCause = `${causePrefix} — Signal ${signalLabel} · continuité=${continuityPct.toFixed(2)}% · BT national(${freqStr}, ${durStr})`;

            // Compute trend vs previous value
            const departmentName = DEPARTMENTS[departmentCode]?.name ?? `Département ${departmentCode}`;
            const previous = previousPowerByDept.get(departmentCode);
            const trend: PowerOutage['trend'] =
                previous == null ? 'stable' :
                offGridCount > previous * 1.1 ? 'worsening' :
                offGridCount < previous * 0.9 ? 'improving' : 'stable';

            previousPowerByDept.set(departmentCode, offGridCount);

            const totalPDL = Math.max(20_000, offGridCount > 0 ? offGridCount * 30 : 20_000);

            computed.push({
                departmentCode,
                departmentName,
                offGridCount,
                totalPDL,
                eventCause,
                trend,
                _signal: signal,
            });
        }

        // Include departments with Ecowatt tension signal (for panel display)
        // OR with actual measured Enedis outages.
        // The map layer separately filters to offGridCount > 0.
        let results = computed
            .filter((r) => {
                if (r._signal !== 'green') return true;   // Ecowatt orange/red → show in panel
                return r.offGridCount >= 1200;             // Green with real outage → show
            })
            .map(({ _signal, ...rest }) => rest);

        // If nothing at all, show top 6 by impact
        if (results.length === 0) {
            results = computed
                .sort((a, b) => b.offGridCount - a.offGridCount)
                .slice(0, 6)
                .map(({ _signal, ...rest }) => rest);
        }

        // Sort by affected count (descending)
        results.sort((a, b) => b.offGridCount - a.offGridCount);

        // ── CB success reset ─────────────────────────────────────────────────
        if (_cb.state !== 'closed' || _cb.failures > 0) {
            console.warn('[outages]', { event: 'cb_reset', prevFailures: _cb.failures, prevState: _cb.state });
        }
        _cb.failures = 0;
        _cb.lastFailureAt = null;
        _cb.state = 'closed';

        // Update cache and meta
        powerCache = { data: results, fetchedAt: now };
        _meta = { fetchedAt: now, cbOpen: false, requestId };

        Watchdog.report('enedis-power', {
            type: 'success',
            responseTimeMs: Date.now() - _t0,
            detail: `${results.length} dpts · ${continuityByDept.size} enedis records`,
        });

        return results;

    } catch (error) {
        // ── CB failure tracking ──────────────────────────────────────────────
        _cb.failures++;
        _cb.lastFailureAt = Date.now();

        if (_cb.failures >= CB_FAILURE_THRESHOLD) {
            if (_cb.failures === CB_FAILURE_THRESHOLD) {
                // Log only on first threshold crossing
                console.warn('[outages]', {
                    event: 'cb_open',
                    failures: _cb.failures,
                    cooldownMin: CB_COOLDOWN_MS / 60_000,
                });
            }
            _cb.state = 'open';
        } else {
            console.warn('[outages]', {
                event: 'fetch_error',
                failures: _cb.failures,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        _meta.cbOpen = _cb.state === 'open';

        const msg = error instanceof Error ? error.message : String(error);
        Watchdog.report('enedis-power', { type: 'failure', error: msg, isFallback: !!powerCache });

        // Return cached data or empty array
        return powerCache?.data ?? [];
    }
}

// ── Public meta helpers ───────────────────────────────────────────────────────

/** Returns freshness metadata for the last successful power outage fetch. */
export function getPowerOutagesMeta(): OutagesMeta {
    return { ..._meta };
}

/**
 * Derives a freshness state from OutagesMeta.
 * - degraded : circuit breaker open (Enedis unreachable)
 * - stale    : data older than 20 min (or never fetched)
 * - aging    : data between 5 and 20 min old
 * - fresh    : data less than 5 min old
 */
export function getFreshnessState(meta: OutagesMeta): 'fresh' | 'aging' | 'stale' | 'degraded' {
    if (meta.cbOpen) return 'degraded';
    if (meta.fetchedAt === null) return 'stale';
    const ageMs = Date.now() - meta.fetchedAt;
    if (ageMs > 20 * 60_000) return 'stale';
    if (ageMs > 5 * 60_000) return 'aging';
    return 'fresh';
}

// ═══ Data Fetchers ═══

/**
 * Fetch records from Enedis DataFair API with retry logic.
 */
async function fetchDataFairRecords<T>(url: string): Promise<T[]> {
    return resilientFetchResults<T>(url, {
        timeout: 10_000,
        retries: 2,
        retryDelay: 1_000,
    });
}

// ═══ Helpers ═══

/**
 * Soften Ecowatt signal based on local continuity metrics.
 * Avoids "all red" visual when no local fragility indicator exists.
 */
function softenSignal(
    signal: 'green' | 'orange' | 'red',
    continuityPct: number
): 'green' | 'orange' | 'red' {
    if (signal === 'red' && continuityPct < 2.5) return 'orange';
    if (signal === 'orange' && continuityPct < 0.8) return 'green';
    return signal;
}

// Re-export adapter utilities for external use
export { normalizeDepartmentCode };
