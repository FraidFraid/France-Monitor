/**
 * infra-network-proxy.ts — Vite Plugin (dev)
 *
 * Intercepte /api/infra-network et agrège :
 *  - OVH / Scaleway / Cloudflare / Equinix via Atlassian Statuspage
 *  - AWS eu-west-3 via status.aws.amazon.com
 *  - Google Cloud europe-west9 via status.cloud.google.com
 *  - PeeringDB : IXP français
 *  - Cloudflare Radar (optionnel)
 */

import type { Plugin } from 'vite';
import { STATIC_DATACENTERS, fetchOfficialIdfDatacenters, fetchUmapProjectDatacenters, mergeDatacenters } from '../../api/_shared/infra-network-datacenters.js';

// Types internes (formes normalisées produites par ce proxy)
interface NetworkIncident {
    title: string;
    severity: string;
    startedAt: string;
}
interface ProviderStatusResult {
    status: string;
    incidents: NetworkIncident[];
    ok: boolean;
}
interface PeeringIx {
    name?: string;
    net_count?: number;
}
interface PeeringResult {
    data: PeeringIx[];
    ok: boolean;
}
interface CloudflareAnomaly {
    id: string;
    type: string;
    startDate: string;
    endDate?: string;
    status: string;
    locationDetails?: { code: string; name: string };
    asnDetails?: { asn: string; name: string; locations?: { code: string; name: string } };
    originDetails?: { name: string; origin: string };
}
interface RadarResult {
    data: CloudflareAnomaly[];
    ok: boolean;
    skipped: boolean;
}

// Formes minimales des réponses d'APIs externes (champs réellement lus)
interface AtlassianSummary {
    status?: { indicator?: string };
    incidents?: Array<{ name?: string; impact?: string; created_at?: string }>;
}
interface AwsEvent {
    service_name?: string;
    service_url?: string;
    summary?: string;
    status?: number;
    date?: string;
}
interface AwsData {
    current?: AwsEvent[];
}
interface GcpIncident {
    affected_products?: unknown;
    currently_affected_locations?: unknown;
    end?: string;
    external_desc?: string;
    severity?: string;
    begin?: string;
}
interface PeeringDbResponse {
    data?: PeeringIx[];
}
interface RadarAnomalyRaw {
    uuid?: string;
    type?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    locationDetails?: { code: string; name: string };
    asnDetails?: { asn: string; name: string; locations?: { code: string; name: string } };
    originDetails?: { name: string; origin: string };
}
interface RadarResponse {
    result?: { trafficAnomalies?: RadarAnomalyRaw[] };
}

const IXPS_STATIC = [
    { id: 'fix-par', name: 'France-IX Paris',    city: 'Paris',     coordinates: [2.3515, 48.8625] as [number, number], speedGbps: 400 },
    { id: 'fix-lyo', name: 'France-IX Lyon',     city: 'Lyon',      coordinates: [4.832,  45.758] as [number, number], speedGbps: 100 },
    { id: 'fix-mrs', name: 'France-IX Marseille',city: 'Marseille', coordinates: [5.370,  43.297] as [number, number], speedGbps: 100 },
    { id: 'eqx-par', name: 'Equinix Paris (PA8)',city: 'Paris',     coordinates: [2.355,  48.861] as [number, number], speedGbps: 200 },
] as const;

async function fetchWithTimeout(url: string, timeoutMs = 8000, headers: Record<string, string> = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', ...headers } });
        clearTimeout(timer);
        return resp;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

function atlassianStatusToLevel(indicator: string): string {
    switch (indicator) {
        case 'none':        return 'operational';
        case 'minor':       return 'degraded';
        case 'major':       return 'partial';
        case 'critical':    return 'outage';
        case 'maintenance': return 'maintenance';
        default:            return 'unknown';
    }
}

async function fetchAtlassianStatus(baseUrl: string): Promise<ProviderStatusResult> {
    try {
        const resp = await fetchWithTimeout(`${baseUrl}/api/v2/summary.json`, 8000);
        if (!resp.ok) return { status: 'unknown', incidents: [], ok: false };
        const data = await resp.json() as AtlassianSummary;
        const level = atlassianStatusToLevel(data?.status?.indicator ?? 'none');
        const incidents = (data?.incidents ?? []).map((inc): NetworkIncident => ({
            title:     inc.name ?? 'Incident',
            severity:  inc.impact === 'critical' ? 'critical' : inc.impact === 'major' ? 'major' : 'minor',
            startedAt: inc.created_at ?? new Date().toISOString(),
        }));
        return { status: level, incidents, ok: true };
    } catch {
        return { status: 'unknown', incidents: [], ok: false };
    }
}

async function fetchAwsStatus(): Promise<ProviderStatusResult> {
    try {
        const resp = await fetchWithTimeout('https://status.aws.amazon.com/data.json', 10_000);
        if (!resp.ok) return { status: 'unknown', incidents: [], ok: false };
        const data = await resp.json() as AwsData;
        const recent = (data?.current ?? []).filter((ev) =>
            ev.service_name?.toLowerCase().includes('eu-west-3') ||
            ev.service_url?.includes('eu-west-3')
        );
        const incidents = recent.map((ev): NetworkIncident => ({
            title:     ev.summary ?? 'AWS incident',
            severity:  (ev.status ?? 0) >= 2 ? 'major' : 'minor',
            startedAt: ev.date ?? new Date().toISOString(),
        }));
        const status = incidents.some((i) => i.severity === 'major') ? 'partial'
            : incidents.length > 0 ? 'degraded' : 'operational';
        return { status, incidents, ok: true };
    } catch {
        return { status: 'unknown', incidents: [], ok: false };
    }
}

async function fetchGcpStatus(): Promise<ProviderStatusResult> {
    try {
        const resp = await fetchWithTimeout('https://status.cloud.google.com/incidents.json', 10_000);
        if (!resp.ok) return { status: 'unknown', incidents: [], ok: false };
        const data = await resp.json() as GcpIncident[];
        const cutoff = Date.now() - 24 * 3_600_000;
        const active = (Array.isArray(data) ? data : []).filter((inc) => {
            const affected = JSON.stringify(inc.affected_products ?? []).toLowerCase();
            const regions  = JSON.stringify(inc.currently_affected_locations ?? []).toLowerCase();
            const withinTTL = new Date(inc.end?.replace(' ', 'T') ?? Date.now()).getTime() > cutoff;
            return (affected.includes('europe-west9') || regions.includes('europe-west9') || regions.includes('paris')) && withinTTL;
        });
        const incidents = active.map((inc): NetworkIncident => ({
            title:     inc.external_desc ?? 'GCP incident',
            severity:  inc.severity === 'high' ? 'major' : 'minor',
            startedAt: inc.begin ?? new Date().toISOString(),
        }));
        const status = incidents.some((i) => i.severity === 'major') ? 'partial'
            : incidents.length > 0 ? 'degraded' : 'operational';
        return { status, incidents, ok: true };
    } catch {
        return { status: 'unknown', incidents: [], ok: false };
    }
}

async function fetchPeeringDbIxps(): Promise<PeeringResult> {
    try {
        const resp = await fetchWithTimeout('https://www.peeringdb.com/api/ix?country=FR&depth=2', 10_000);
        if (!resp.ok) return { data: [], ok: false };
        const json = await resp.json() as PeeringDbResponse;
        return { data: Array.isArray(json?.data) ? json.data : [], ok: true };
    } catch {
        return { data: [], ok: false };
    }
}

async function fetchCloudflareRadar(token: string): Promise<RadarResult> {
    if (!token) return { data: [], ok: false, skipped: true };
    try {
        const resp = await fetchWithTimeout(
            'https://api.cloudflare.com/client/v4/radar/traffic_anomalies?location=FR&dateRange=7d&limit=20',
            8000,
            { Authorization: `Bearer ${token}` }
        );
        if (!resp.ok) return { data: [], ok: false, skipped: false };
        const json = await resp.json() as RadarResponse;
        const anomalies = (json?.result?.trafficAnomalies ?? []).map((a, i): CloudflareAnomaly => ({
            id:              a.uuid ?? `cf-radar-${i}`,
            type:            a.type ?? 'LOCATION',
            startDate:       a.startDate ?? '',
            endDate:         a.endDate ?? undefined,
            status:          a.status ?? 'UNVERIFIED',
            locationDetails: a.locationDetails ?? undefined,
            asnDetails:      a.asnDetails ?? undefined,
            originDetails:   a.originDetails ?? undefined,
        }));
        return { data: anomalies, ok: true, skipped: false };
    } catch {
        return { data: [], ok: false, skipped: false };
    }
}

export function infraNetworkProxyPlugin(): Plugin {
    return {
        name: 'infra-network-proxy',
        configureServer(server) {
            server.middlewares.use('/api/infra-network', async (_req, res) => {
                try {
                    const radarToken = process.env.CLOUDFLARE_RADAR_TOKEN ?? '';

                    const [ovhR, scwR, cfR, eqxR, awsR, gcpR, peeringR, radarR, idfDcsR, umapProjectsR] = await Promise.allSettled([
                        fetchAtlassianStatus('https://status.ovhcloud.com'),
                        fetchAtlassianStatus('https://status.scaleway.com'),
                        fetchAtlassianStatus('https://www.cloudflarestatus.com'),
                        fetchAtlassianStatus('https://status.equinix.com'),
                        fetchAwsStatus(),
                        fetchGcpStatus(),
                        fetchPeeringDbIxps(),
                        fetchCloudflareRadar(radarToken),
                        fetchOfficialIdfDatacenters(),
                        fetchUmapProjectDatacenters(),
                    ]);

                    const unwrap = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
                        r.status === 'fulfilled' ? r.value : fallback;

                    const provFallback: ProviderStatusResult = { status: 'unknown', incidents: [], ok: false };
                    const ovh     = unwrap(ovhR, provFallback);
                    const scw     = unwrap(scwR, provFallback);
                    const cf      = unwrap(cfR,  provFallback);
                    const eqx     = unwrap(eqxR, provFallback);
                    const aws     = unwrap(awsR, provFallback);
                    const gcp     = unwrap(gcpR, provFallback);
                    const peering = unwrap(peeringR, { data: [], ok: false });
                    const radar   = unwrap(radarR, { data: [], ok: false, skipped: false });
                    const idfDatacenters: Record<string, unknown>[] = idfDcsR.status === 'fulfilled' ? idfDcsR.value : [];
                    const umapProjects = umapProjectsR.status === 'fulfilled' ? umapProjectsR.value : null;

                    // PeeringDB peer index
                    const peerIndex: Record<string, number> = {};
                    for (const ix of (peering.data ?? [])) {
                        const name = (ix.name ?? '').toLowerCase();
                        if (name.includes('france-ix') || name.includes('franceix')) {
                            if (name.includes('lyon'))           peerIndex['fix-lyo'] = ix.net_count ?? 0;
                            else if (name.includes('marseille')) peerIndex['fix-mrs'] = ix.net_count ?? 0;
                            else                                 peerIndex['fix-par'] = ix.net_count ?? 0;
                        } else if (name.includes('equinix') && name.includes('paris')) {
                            peerIndex['eqx-par'] = ix.net_count ?? 0;
                        }
                    }

                    const now = new Date().toISOString();
                    const providerStatus: Record<string, { status: string; incidents: NetworkIncident[] }> = {
                        OVH:       { status: ovh.status,  incidents: ovh.incidents  },
                        Scaleway:  { status: scw.status,  incidents: scw.incidents  },
                        AWS:       { status: aws.status,  incidents: aws.incidents  },
                        GCP:       { status: gcp.status,  incidents: gcp.incidents  },
                        Cloudflare:{ status: cf.status,   incidents: cf.incidents   },
                        Equinix:   { status: eqx.status,  incidents: eqx.incidents  },
                    };

                    const datacenters = mergeDatacenters({
                        staticDatacenters: STATIC_DATACENTERS,
                        officialIdfDatacenters: idfDatacenters,
                        umapProjectDatacenters: umapProjects,
                        providerStatus,
                        now,
                    });

                    const ixps = IXPS_STATIC.map(ixp => ({
                        ...ixp,
                        peersCount:  peerIndex[ixp.id] ?? 0,
                        status:      ixp.id === 'eqx-par' ? eqx.status : 'operational',
                        lastUpdated: now,
                    }));

                    const payload = {
                        datacenters,
                        ixps,
                        cloudflareAnomalies: radar.data ?? [],
                        sourcesStatus: {
                            ovh:       ovh.ok      ? 'ok' : 'error',
                            scaleway:  scw.ok      ? 'ok' : 'error',
                            aws:       aws.ok      ? 'ok' : 'error',
                            google:    gcp.ok      ? 'ok' : 'error',
                            cloudflare:cf.ok       ? 'ok' : 'error',
                            peeringdb: peering.ok  ? 'ok' : 'error',
                            radar:     radar.ok    ? 'ok' : (radar.skipped ? 'stale' : 'error'),
                        },
                        generatedAt: now,
                    };

                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.end(JSON.stringify(payload));
                } catch (err) {
                    console.error('[infra-network-proxy] Error:', err);
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Proxy error', datacenters: [], ixps: [], cloudflareAnomalies: [] }));
                }
            });
        },
    };
}
