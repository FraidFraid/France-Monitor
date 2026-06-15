import type { BiogasDaily, BiogasState, BiogasAlert } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';

/* ── Watchdog ──────────────────────────────────────────── */

Watchdog.register('biogas', {
    label: 'Biométhane GRDF',
    staleAfterMs: 60 * 60_000,
    detail: 'opendata.grdf.fr · production quotidienne biométhane',
});

/* ── Cache ─────────────────────────────────────────────── */

let cache: { data: BiogasState; fetchedAt: number } | null = null;
const CACHE_TTL = 30 * 60_000;

const API_URL = import.meta.env.PROD
    ? '/api/energy/biogas'
    : 'http://localhost:3001/api/energy/biogas';

/* ── Aggregation: merge multiple records per day ───────── */

function aggregateByDay(records: Array<{
    journee_gaziere?: string;
    quantite_injectee?: number | null;
    nombre_de_sites_comptabilises?: number;
    statut?: string;
}>): BiogasDaily[] {
    const byDay = new Map<string, { mwh: number; sites: number; status: string }>();

    for (const rec of records) {
        if (!rec.journee_gaziere || rec.quantite_injectee == null) continue;
        const day = rec.journee_gaziere;
        const existing = byDay.get(day);
        if (existing) {
            existing.mwh += rec.quantite_injectee;
            existing.sites = Math.max(existing.sites, rec.nombre_de_sites_comptabilises ?? 0);
        } else {
            byDay.set(day, {
                mwh: rec.quantite_injectee,
                sites: rec.nombre_de_sites_comptabilises ?? 0,
                status: rec.statut ?? 'Provisoire',
            });
        }
    }

    return [...byDay.entries()]
        .map(([date, v]) => ({
            date,
            productionMWh: Math.round(v.mwh * 100) / 100,
            sitesCount: v.sites,
            status: v.status as BiogasDaily['status'],
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
}

/* ── Anomaly detection vs 7-day average ────────────────── */

function detectAnomaly(daily: BiogasDaily[], avg7d: number): BiogasAlert | null {
    if (daily.length < 7 || avg7d === 0) return null;
    const latest = daily.find(d => d.sitesCount > 100);
    if (!latest) return null;
    const dropPct = ((avg7d - latest.productionMWh) / avg7d) * 100;
    if (dropPct > 30) {
        return {
            type: 'production_drop',
            severityPct: Math.round(dropPct * 10) / 10,
        };
    }
    return null;
}

/* ── Main fetch ────────────────────────────────────────── */

export async function fetchBiogasProduction(): Promise<BiogasState> {
    const fallback: BiogasState = {
        daily: [],
        latestMWh: 0,
        deltaJ1Pct: null,
        avg7dMWh: 0,
        alert: null,
        updatedAt: new Date(),
    };

    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.data;

    Watchdog.report('biogas', { type: 'loading' });
    const t0 = Date.now();

    try {
        const resp = await fetch(API_URL, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) {
            Watchdog.report('biogas', { type: 'failure', error: `HTTP ${resp.status}` });
            return cache?.data ?? fallback;
        }

        const json = await resp.json() as { records: Array<Record<string, unknown>> };
        const daily = aggregateByDay(json.records);
        const completeDays = daily.filter(d => d.sitesCount > 100);

        const latestMWh = completeDays[0]?.productionMWh ?? 0;

        const deltaJ1Pct = completeDays.length >= 2
            ? Math.round(((completeDays[0].productionMWh - completeDays[1].productionMWh) / completeDays[1].productionMWh) * 1000) / 10
            : null;

        const last7 = completeDays.slice(0, 7);
        const avg7dMWh = last7.length > 0
            ? Math.round(last7.reduce((s, d) => s + d.productionMWh, 0) / last7.length)
            : 0;

        const alert = detectAnomaly(completeDays, avg7dMWh);

        const state: BiogasState = {
            daily,
            latestMWh: Math.round(latestMWh),
            deltaJ1Pct,
            avg7dMWh,
            alert,
            updatedAt: new Date(),
        };

        cache = { data: state, fetchedAt: Date.now() };
        Watchdog.report('biogas', { type: 'success', responseTimeMs: Date.now() - t0 });
        return state;

    } catch (err) {
        Watchdog.report('biogas', { type: 'failure', error: (err as Error).message });
        return cache?.data ?? fallback;
    }
}
