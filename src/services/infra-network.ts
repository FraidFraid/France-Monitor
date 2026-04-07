/**
 * infra-network.ts — Service de surveillance des datacenters & IXP français
 *
 * Sources (via /api/infra-network) :
 *  - OVH / Scaleway / Cloudflare / Equinix  → Atlassian Statuspage
 *  - AWS eu-west-3                           → status.aws.amazon.com
 *  - Google Cloud europe-west9               → status.cloud.google.com
 *  - PeeringDB                               → IXP peers count
 *  - Cloudflare Radar (optionnel)            → anomalies trafic FR
 */

import type { InfraNetworkState, DatacenterStatus, IxpStatus, CloudflareRadarAnomaly } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';

Watchdog.register('infra-network', {
    label: 'Infra Réseau DC / IXP',
    staleAfterMs: 15 * 60_000,
    detail: 'OVH · Scaleway · AWS · GCP · Cloudflare · PeeringDB IXP',
    freshness: 'TEMPS_REEL',
});

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60_000; // 5 min

let cache: { data: InfraNetworkState; fetchedAt: number } | null = null;

// ── Circuit breaker ────────────────────────────────────────────────────────────

const CIRCUIT_COOLDOWN_MS = 2 * 60_000;
let failureCount  = 0;
let cooldownUntil = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function dcStatusColor(status: DatacenterStatus['status']): string {
    switch (status) {
        case 'operational':  return '#60A5FA';
        case 'degraded':     return '#3B82F6';
        case 'partial':      return '#2563EB';
        case 'outage':       return '#1D4ED8';
        case 'maintenance':  return '#93C5FD';
        case 'unknown':      return '#60A5FA';
        default:             return '#60A5FA';
    }
}

export function dcStatusLabel(status: DatacenterStatus['status']): string {
    switch (status) {
        case 'operational':  return 'Opérationnel';
        case 'degraded':     return 'Dégradé';
        case 'partial':      return 'Partiel';
        case 'outage':       return 'En panne';
        case 'maintenance':  return 'Maintenance';
        case 'unknown':      return 'Opérationnel';  // pas d'incident signalé
        default:             return 'Opérationnel';
    }
}

export function ixpStatusColor(status: IxpStatus['status']): string {
    if (status === 'operational') return '#BFDBFE';
    if (status === 'degraded') return '#93C5FD';
    if (status === 'outage') return '#64748B';
    return dcStatusColor(status as DatacenterStatus['status']);
}

export const INFRA_NETWORK_SOURCES = [
    { id: 'ovh',       label: 'OVH Status' },
    { id: 'scaleway',  label: 'Scaleway Status' },
    { id: 'aws',       label: 'AWS Status' },
    { id: 'google',    label: 'GCP Status' },
    { id: 'cloudflare',label: 'Cloudflare Status' },
    { id: 'peeringdb', label: 'PeeringDB' },
    { id: 'radar',     label: 'Cloudflare Radar' },
] as const;

// ── Parser ────────────────────────────────────────────────────────────────────

function parseResponse(raw: Record<string, unknown>): InfraNetworkState {
    const datacenters = (Array.isArray(raw.datacenters) ? raw.datacenters : []).map((dc: any): DatacenterStatus => ({
        id:          String(dc.id ?? ''),
        name:        String(dc.name ?? ''),
        provider:    String(dc.provider ?? ''),
        region:      String(dc.region ?? ''),
        coordinates: Array.isArray(dc.coordinates) ? dc.coordinates as [number, number] : [2.35, 48.86],
        status:      dc.status as DatacenterStatus['status'] ?? 'unknown',
        incidents:   Array.isArray(dc.incidents) ? dc.incidents : [],
        lastUpdated: String(dc.lastUpdated ?? ''),
    }));

    const ixps = (Array.isArray(raw.ixps) ? raw.ixps : []).map((ix: any): IxpStatus => ({
        id:          String(ix.id ?? ''),
        name:        String(ix.name ?? ''),
        city:        String(ix.city ?? ''),
        coordinates: Array.isArray(ix.coordinates) ? ix.coordinates as [number, number] : [2.35, 48.86],
        peersCount:  Number(ix.peersCount ?? 0),
        speedGbps:   Number(ix.speedGbps ?? 0),
        status:      ix.status as IxpStatus['status'] ?? 'unknown',
        lastUpdated: String(ix.lastUpdated ?? ''),
    }));

    const cloudflareAnomalies = (Array.isArray(raw.cloudflareAnomalies) ? raw.cloudflareAnomalies : []).map((a: any): CloudflareRadarAnomaly => ({
        id:              String(a.id ?? ''),
        type:            String(a.type ?? ''),
        startDate:       String(a.startDate ?? ''),
        endDate:         a.endDate ? String(a.endDate) : undefined,
        status:          String(a.status ?? 'UNVERIFIED'),
        locationDetails: a.locationDetails ? { code: String(a.locationDetails.code ?? ''), name: String(a.locationDetails.name ?? '') } : undefined,
        asnDetails:      a.asnDetails ? {
            asn:       String(a.asnDetails.asn ?? ''),
            name:      String(a.asnDetails.name ?? ''),
            locations: a.asnDetails.locations ? { code: String(a.asnDetails.locations.code ?? ''), name: String(a.asnDetails.locations.name ?? '') } : undefined,
        } : undefined,
        originDetails:   a.originDetails ? { name: String(a.originDetails.name ?? ''), origin: String(a.originDetails.origin ?? '') } : undefined,
    }));

    const ss = (raw.sourcesStatus as any) ?? {};
    const asSourceStatus = (v: unknown) => v === 'ok' ? 'ok' : v === 'stale' ? 'stale' : 'error';

    return {
        datacenters,
        ixps,
        cloudflareAnomalies,
        sourcesStatus: {
            ovh:        asSourceStatus(ss.ovh),
            scaleway:   asSourceStatus(ss.scaleway),
            aws:        asSourceStatus(ss.aws),
            google:     asSourceStatus(ss.google),
            cloudflare: asSourceStatus(ss.cloudflare),
            peeringdb:  asSourceStatus(ss.peeringdb),
            radar:      asSourceStatus(ss.radar),
        },
        lastUpdate: new Date(),
    };
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

export async function fetchInfraNetwork(): Promise<InfraNetworkState | null> {
    // Circuit breaker
    if (failureCount >= 2 && Date.now() < cooldownUntil) {
        return cache?.data ?? null;
    }

    // Cache hit
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.data;
    }

    Watchdog.report('infra-network', { type: 'loading' });
    const _t0 = Date.now();
    try {
        const resp = await fetch('/api/infra-network', {
            signal: AbortSignal.timeout(15_000),
            headers: { Accept: 'application/json' },
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const raw = await resp.json() as Record<string, unknown>;
        const state = parseResponse(raw);

        cache = { data: state, fetchedAt: Date.now() };
        failureCount = 0;
        Watchdog.report('infra-network', {
            type: 'success',
            responseTimeMs: Date.now() - _t0,
            detail: `${state.datacenters.length} DC · ${state.ixps.length} IXP`,
        });
        return state;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failureCount++;
        if (failureCount >= 2) cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
        console.warn('[infra-network] fetch failed:', err);
        Watchdog.report('infra-network', { type: 'failure', error: msg });
        return cache?.data ?? null;
    }
}
