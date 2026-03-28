/**
 * outages.ts — Service for telecom and power outage data.
 *
 * Sources:
 * - ARCEP: Mobile network outages (GeoJSON)
 * - Enedis DataFair: Historical continuity metrics
 * - RTE Ecowatt: Grid tension signals
 */

import type { TelecomOutage, PowerOutage } from '../types/index.ts';
import { DEPARTMENTS } from './stability-index.ts';
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

// ═══ ARCEP Mobile Network Outages ═══

/**
 * Fetch the latest GeoJSON file containing sites without service (HS).
 * The file is named using the current date. Should it fail, tries to fetch D-1.
 */
export async function fetchTelecomOutages(): Promise<TelecomOutage[]> {
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

        // Fallback to yesterday if today's file is not yet uploaded
        if (!res.ok) {
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);
            dateStr = formatDate(yesterday);
            url = `/api/arcep?date=${dateStr}`;
            res = await fetch(url);
            if (!res.ok) {
                throw new Error(`Failed to fetch ARCEP data for ${dateStr}. Status: ${res.status}`);
            }
        }

        const json = await res.json();
        if (!json.features) return [];

        return json.features.map((f: any, index: number) => {
            const props = f.properties;
            const coords = f.geometry?.coordinates;
            let voice: 'OK' | 'HS' | 'Degraded' = 'OK';
            let dataStatus: 'OK' | 'HS' | 'Degraded' = 'OK';

            // voix/data aggregate = 'HS' when ANY sub-tech is HS (not all).
            // Use per-tech fields for accurate total vs partial distinction.
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
        console.warn('[Outages] ARCEP fetch error', error);
        return [];
    }
}

// ═══ Enedis Power Outages ═══

// DataFair API v1 endpoints
const ENEDIS_CONTINUITY_URL =
    'https://opendata.enedis.fr/data-fair/api/v1/datasets/indicateur-continuite-dalimentation/lines?size=200';
const ENEDIS_FREQ_URL =
    'https://opendata.enedis.fr/data-fair/api/v1/datasets/frequence-moyenne-de-coupure-par-client-bt/lines?size=200';
const ENEDIS_DURATION_URL =
    'https://opendata.enedis.fr/data-fair/api/v1/datasets/duree-moyenne-de-coupure-bt/lines?size=200';

// Cache configuration
const POWER_CACHE_TTL_MS = 15 * 60_000; // 15 minutes for DataFair data

// Module-level state
let powerCache: { data: PowerOutage[]; fetchedAt: number } | null = null;
const previousPowerByDept = new Map<string, number>();

/**
 * Fetch power outages by merging:
 * 1. Enedis DataFair historical metrics (baseline)
 * 2. Ecowatt grid tension signals (context)
 */
export async function fetchPowerOutages(): Promise<PowerOutage[]> {
    // Return cached data if still fresh
    if (powerCache && Date.now() - powerCache.fetchedAt < POWER_CACHE_TTL_MS) {
        return powerCache.data;
    }

    try {
        // Fetch all data sources in parallel
        const [continuityRows, freqRows, durRows, ecowatt] = await Promise.all([
            fetchDataFairRecords<DataFairContinuityRecord>(ENEDIS_CONTINUITY_URL),
            fetchDataFairRecords<DataFairFrequencyRecord>(ENEDIS_FREQ_URL),
            fetchDataFairRecords<DataFairDurationRecord>(ENEDIS_DURATION_URL),
            fetchEcowatt(),
        ]);

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

        // Update cache
        powerCache = { data: results, fetchedAt: Date.now() };

        return results;

    } catch (error) {
        console.warn('[Outages] Power outage fetch error', error);
        // Return cached data or empty array
        return powerCache?.data ?? [];
    }
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
