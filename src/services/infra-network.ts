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
        case 'operational':  return '#A78BFA';  // violet-400 — cohérent avec légende ▲
        case 'degraded':     return '#F59E0B';
        case 'partial':      return '#F97316';
        case 'outage':       return '#EF4444';
        case 'maintenance':  return '#8B5CF6';  // violet-500
        case 'unknown':      return '#A78BFA';  // violet — pas d'incident connu = opérationnel
        default:             return '#A78BFA';
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
    if (status === 'operational') return '#C4B5FD';  // violet-300 — cohérent avec légende ◆
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
        id:          String(a.id ?? ''),
        type:        String(a.type ?? ''),
        startDate:   String(a.startDate ?? ''),
        endDate:     a.endDate ? String(a.endDate) : undefined,
        status:      (a.status === 'ONGOING' ? 'ONGOING' : 'FINISHED') as 'ONGOING' | 'FINISHED',
        description: String(a.description ?? ''),
        asns:        Array.isArray(a.asns) ? a.asns.map((as: any) => ({ asn: Number(as.asn), asName: String(as.asName ?? '') })) : [],
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
        return state;
    } catch (err) {
        failureCount++;
        if (failureCount >= 2) cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
        console.warn('[infra-network] fetch failed:', err);
        return cache?.data ?? null;
    }
}
