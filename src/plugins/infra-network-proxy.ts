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

async function fetchAtlassianStatus(baseUrl: string) {
    try {
        const resp = await fetchWithTimeout(`${baseUrl}/api/v2/summary.json`, 8000);
        if (!resp.ok) return { status: 'unknown', incidents: [], ok: false };
        const data = await resp.json() as any;
        const level = atlassianStatusToLevel(data?.status?.indicator ?? 'none');
        const incidents = (data?.incidents ?? []).map((inc: any) => ({
            title:     inc.name ?? 'Incident',
            severity:  inc.impact === 'critical' ? 'critical' : inc.impact === 'major' ? 'major' : 'minor',
            startedAt: inc.created_at ?? new Date().toISOString(),
        }));
        return { status: level, incidents, ok: true };
    } catch {
        return { status: 'unknown', incidents: [], ok: false };
    }
}

async function fetchAwsStatus() {
    try {
        const resp = await fetchWithTimeout('https://status.aws.amazon.com/data.json', 10_000);
        if (!resp.ok) return { status: 'unknown', incidents: [], ok: false };
        const data = await resp.json() as any;
        const recent = (data?.current ?? []).filter((ev: any) =>
            ev.service_name?.toLowerCase().includes('eu-west-3') ||
            ev.service_url?.includes('eu-west-3')
        );
        const incidents = recent.map((ev: any) => ({
            title:     ev.summary ?? 'AWS incident',
            severity:  ev.status >= 2 ? 'major' : 'minor',
            startedAt: ev.date ?? new Date().toISOString(),
        }));
        const status = incidents.some((i: any) => i.severity === 'major') ? 'partial'
            : incidents.length > 0 ? 'degraded' : 'operational';
        return { status, incidents, ok: true };
    } catch {
        return { status: 'unknown', incidents: [], ok: false };
    }
}

async function fetchGcpStatus() {
    try {
        const resp = await fetchWithTimeout('https://status.cloud.google.com/incidents.json', 10_000);
        if (!resp.ok) return { status: 'unknown', incidents: [], ok: false };
        const data = await resp.json() as any[];
        const cutoff = Date.now() - 24 * 3_600_000;
        const active = (Array.isArray(data) ? data : []).filter((inc: any) => {
            const affected = JSON.stringify(inc.affected_products ?? []).toLowerCase();
            const regions  = JSON.stringify(inc.currently_affected_locations ?? []).toLowerCase();
            const withinTTL = new Date(inc.end?.replace(' ', 'T') ?? Date.now()).getTime() > cutoff;
            return (affected.includes('europe-west9') || regions.includes('europe-west9') || regions.includes('paris')) && withinTTL;
        });
        const incidents = active.map((inc: any) => ({
            title:     inc.external_desc ?? 'GCP incident',
            severity:  inc.severity === 'high' ? 'major' : 'minor',
            startedAt: inc.begin ?? new Date().toISOString(),
        }));
        const status = incidents.some((i: any) => i.severity === 'major') ? 'partial'
            : incidents.length > 0 ? 'degraded' : 'operational';
        return { status, incidents, ok: true };
    } catch {
        return { status: 'unknown', incidents: [], ok: false };
    }
}

async function fetchPeeringDbIxps() {
    try {
        const resp = await fetchWithTimeout('https://www.peeringdb.com/api/ix?country=FR&depth=2', 10_000);
        if (!resp.ok) return { data: [], ok: false };
        const json = await resp.json() as any;
        return { data: Array.isArray(json?.data) ? json.data : [], ok: true };
    } catch {
        return { data: [], ok: false };
    }
}

async function fetchCloudflareRadar(token: string) {
    if (!token) return { data: [], ok: false, skipped: true };
    try {
        const resp = await fetchWithTimeout(
            'https://api.cloudflare.com/client/v4/radar/traffic_anomalies?location=FR&dateRange=7d&limit=20',
            8000,
            { Authorization: `Bearer ${token}` }
        );
        if (!resp.ok) return { data: [], ok: false, skipped: false };
        const json = await resp.json() as any;
        const anomalies = (json?.result?.trafficAnomalies ?? []).map((a: any, i: number) => ({
            id:              a.uuid ?? `cf-radar-${i}`,
            type:            a.type ?? 'LOCATION',
            startDate:       a.startDate ?? '',
            endDate:         a.endDate ?? undefined,
            status:          a.status ?? 'UNVERIFIED',
            locationDetails: (a.locationDetails as { code: string; name: string } | undefined) ?? undefined,
            asnDetails:      (a.asnDetails as { asn: string; name: string; locations?: { code: string; name: string } } | undefined) ?? undefined,
            originDetails:   (a.originDetails as { name: string; origin: string } | undefined) ?? undefined,
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

                    const unwrap = (r: PromiseSettledResult<any>) =>
                        r.status === 'fulfilled' ? r.value : { status: 'unknown', incidents: [], ok: false, data: [], skipped: false };

                    const ovh     = unwrap(ovhR);
                    const scw     = unwrap(scwR);
                    const cf      = unwrap(cfR);
                    const eqx     = unwrap(eqxR);
                    const aws     = unwrap(awsR);
                    const gcp     = unwrap(gcpR);
                    const peering = unwrap(peeringR);
                    const radar   = unwrap(radarR);
                    const idfDatacenters: any[] = idfDcsR.status === 'fulfilled' ? idfDcsR.value : [];
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
                    const providerStatus: Record<string, any> = {
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
