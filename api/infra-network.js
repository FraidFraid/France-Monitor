/**
 * api/infra-network.js — Vercel Serverless Function
 *
 * Agrège l'état des infrastructures cloud & IXP en France :
 *  - Atlassian Statuspage : OVH, Scaleway, Cloudflare, Equinix
 *  - AWS Health Dashboard  : région eu-west-3 (Paris)
 *  - Google Cloud Status   : europe-west9 (Paris)
 *  - PeeringDB             : IXP français (peers, vitesse)
 *  - Cloudflare Radar      : anomalies trafic FR (optionnel — nécessite CLOUDFLARE_RADAR_TOKEN)
 *
 * Route : GET /api/infra-network
 * Cache : 5 min CDN Vercel
 */

// ── Définition statique des datacenters ──────────────────────────────────────

const DATACENTERS = [
    { id: 'ovh-rbx',  name: 'OVH Roubaix',      provider: 'OVH',       region: 'Roubaix',     coordinates: [3.170,  50.694] },
    { id: 'ovh-gra',  name: 'OVH Gravelines',    provider: 'OVH',       region: 'Gravelines',  coordinates: [2.128,  50.985] },
    { id: 'ovh-sbg',  name: 'OVH Strasbourg',    provider: 'OVH',       region: 'Strasbourg',  coordinates: [7.750,  48.574] },
    { id: 'scw-par',  name: 'Scaleway Paris',     provider: 'Scaleway',  region: 'Paris',       coordinates: [2.359,  48.863] },
    { id: 'aws-cdg',  name: 'AWS Paris (eu-west-3)', provider: 'AWS',   region: 'eu-west-3',   coordinates: [2.3465, 48.8655] },
    { id: 'gcp-par',  name: 'GCP Paris (europe-west9)', provider: 'GCP', region: 'europe-west9', coordinates: [2.340, 48.870] },
    { id: 'cf-par',   name: 'Cloudflare Paris',   provider: 'Cloudflare', region: 'Paris',      coordinates: [2.360,  48.860] },
];

const IXPS_STATIC = [
    { id: 'fix-par',  name: 'France-IX Paris',    city: 'Paris',     coordinates: [2.3515, 48.8625], speedGbps: 400 },
    { id: 'fix-lyo',  name: 'France-IX Lyon',      city: 'Lyon',      coordinates: [4.832,  45.758], speedGbps: 100 },
    { id: 'fix-mrs',  name: 'France-IX Marseille', city: 'Marseille', coordinates: [5.370,  43.297], speedGbps: 100 },
    { id: 'eqx-par',  name: 'Equinix Paris (PA8)', city: 'Paris',     coordinates: [2.355,  48.861], speedGbps: 200 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, timeoutMs = 8000, headers = {}) {
    const resp = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', ...headers },
    });
    return resp;
}

function atlassianStatusToLevel(indicator) {
    switch (indicator) {
        case 'none':          return 'operational';
        case 'minor':         return 'degraded';
        case 'major':         return 'partial';
        case 'critical':      return 'outage';
        case 'maintenance':   return 'maintenance';
        default:              return 'unknown';
    }
}

function atlassianComponentStatus(status) {
    switch (status) {
        case 'operational':         return 'operational';
        case 'degraded_performance':return 'degraded';
        case 'partial_outage':      return 'partial';
        case 'major_outage':        return 'outage';
        case 'under_maintenance':   return 'maintenance';
        default:                    return 'unknown';
    }
}

/** Fetch an Atlassian Statuspage summary and return a unified status. */
async function fetchAtlassianStatus(baseUrl) {
    try {
        const resp = await fetchWithTimeout(`${baseUrl}/api/v2/summary.json`, 8000);
        if (!resp.ok) return { status: 'unknown', incidents: [], ok: false };
        const data = await resp.json();

        const indicator = data?.status?.indicator ?? 'none';
        const level = atlassianStatusToLevel(indicator);

        const incidents = (data?.incidents ?? []).map(inc => ({
            title:     inc.name ?? 'Incident',
            severity:  inc.impact === 'critical' ? 'critical' : inc.impact === 'major' ? 'major' : 'minor',
            startedAt: inc.created_at ?? new Date().toISOString(),
        }));

        return { status: level, incidents, ok: true };
    } catch {
        return { status: 'unknown', incidents: [], ok: false };
    }
}

/** AWS Health Dashboard — public JSON feed (eu-west-3). */
async function fetchAwsStatus() {
    try {
        const resp = await fetchWithTimeout('https://status.aws.amazon.com/data.json', 10_000);
        if (!resp.ok) return { status: 'unknown', incidents: [], ok: false };
        const data = await resp.json();

        // Filter recent events for eu-west-3 (ec2, rds, lambda…)
        const recent = (data?.current ?? []).filter(ev =>
            ev.service_name?.toLowerCase().includes('eu-west-3') ||
            ev.service_url?.includes('eu-west-3')
        );

        const incidents = recent.map(ev => ({
            title:     ev.summary ?? 'AWS incident',
            severity:  ev.status >= 2 ? 'major' : 'minor',
            startedAt: ev.date ?? new Date().toISOString(),
        }));

        const status = incidents.some(i => i.severity === 'major') ? 'partial'
            : incidents.length > 0 ? 'degraded'
            : 'operational';

        return { status, incidents, ok: true };
    } catch {
        return { status: 'unknown', incidents: [], ok: false };
    }
}

/** Google Cloud Status — incidents.json filtered by europe-west9. */
async function fetchGcpStatus() {
    try {
        const resp = await fetchWithTimeout('https://status.cloud.google.com/incidents.json', 10_000);
        if (!resp.ok) return { status: 'unknown', incidents: [], ok: false };
        const data = await resp.json();

        const cutoff = Date.now() - 24 * 3_600_000; // last 24h
        const active = (Array.isArray(data) ? data : []).filter(inc => {
            const affected = JSON.stringify(inc.affected_products ?? []).toLowerCase();
            const regions  = JSON.stringify(inc.currently_affected_locations ?? []).toLowerCase();
            const withinTTL = new Date(inc.end?.replace(' ', 'T') ?? Date.now()).getTime() > cutoff;
            return (affected.includes('europe-west9') || regions.includes('europe-west9') || regions.includes('paris')) && withinTTL;
        });

        const incidents = active.map(inc => ({
            title:     inc.external_desc ?? 'GCP incident',
            severity:  inc.severity === 'high' ? 'major' : 'minor',
            startedAt: inc.begin ?? new Date().toISOString(),
        }));

        const status = incidents.some(i => i.severity === 'major') ? 'partial'
            : incidents.length > 0 ? 'degraded'
            : 'operational';

        return { status, incidents, ok: true };
    } catch {
        return { status: 'unknown', incidents: [], ok: false };
    }
}

/** PeeringDB — IXP metadata (peers count, speed) for French exchanges. */
async function fetchPeeringDbIxps() {
    try {
        const resp = await fetchWithTimeout('https://www.peeringdb.com/api/ix?country=FR&depth=2', 10_000);
        if (!resp.ok) return { data: [], ok: false };
        const json = await resp.json();
        return { data: Array.isArray(json?.data) ? json.data : [], ok: true };
    } catch {
        return { data: [], ok: false };
    }
}

/** Cloudflare Radar — traffic anomalies in France (requires optional token). */
async function fetchCloudflareRadar(token) {
    if (!token) return { data: [], ok: false, skipped: true };
    try {
        const url = 'https://api.cloudflare.com/client/v4/radar/traffic_anomalies?location=FR&dateRange=7d&limit=20';
        const resp = await fetchWithTimeout(url, 8000, { Authorization: `Bearer ${token}` });
        if (!resp.ok) return { data: [], ok: false };
        const json = await resp.json();
        const anomalies = (json?.result?.trafficAnomalies ?? []).map((a, i) => ({
            id:              a.uuid ?? `cf-radar-${i}`,
            type:            a.type ?? 'LOCATION',
            startDate:       a.startDate ?? '',
            endDate:         a.endDate ?? undefined,
            status:          a.status ?? 'UNVERIFIED',
            locationDetails: a.locationDetails ?? undefined,
            asnDetails:      a.asnDetails ?? undefined,
            originDetails:   a.originDetails ?? undefined,
        }));
        return { data: anomalies, ok: true };
    } catch {
        return { data: [], ok: false };
    }
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    const radarToken = process.env.CLOUDFLARE_RADAR_TOKEN ?? '';

    // ── Fetch all sources in parallel ───────────────────────────────────────
    const [
        ovhResult,
        scwResult,
        cfResult,
        eqxResult,
        awsResult,
        gcpResult,
        peeringResult,
        radarResult,
    ] = await Promise.allSettled([
        fetchAtlassianStatus('https://status.ovhcloud.com'),
        fetchAtlassianStatus('https://status.scaleway.com'),
        fetchAtlassianStatus('https://www.cloudflarestatus.com'),
        fetchAtlassianStatus('https://status.equinix.com'),
        fetchAwsStatus(),
        fetchGcpStatus(),
        fetchPeeringDbIxps(),
        fetchCloudflareRadar(radarToken),
    ]);

    const unwrap = (r) => r.status === 'fulfilled' ? r.value : { status: 'unknown', incidents: [], ok: false, data: [] };

    const ovh     = unwrap(ovhResult);
    const scw     = unwrap(scwResult);
    const cf      = unwrap(cfResult);
    const eqx     = unwrap(eqxResult);
    const aws     = unwrap(awsResult);
    const gcp     = unwrap(gcpResult);
    const peering = unwrap(peeringResult);
    const radar   = unwrap(radarResult);

    // ── Build peer count index from PeeringDB ────────────────────────────────
    const peerIndex = {};
    for (const ix of (peering.data ?? [])) {
        const name = (ix.name ?? '').toLowerCase();
        // Match our static IXP list by name similarity
        if (name.includes('france-ix') || name.includes('franceix')) {
            if (name.includes('lyon'))           peerIndex['fix-lyo'] = ix.net_count ?? 0;
            else if (name.includes('marseille')) peerIndex['fix-mrs'] = ix.net_count ?? 0;
            else                                 peerIndex['fix-par'] = ix.net_count ?? 0;
        } else if (name.includes('equinix') && name.includes('paris')) {
            peerIndex['eqx-par'] = ix.net_count ?? 0;
        }
    }

    // ── Build datacenter list ────────────────────────────────────────────────
    const now = new Date().toISOString();

    const providerStatus = {
        OVH:       { status: ovh.status,  incidents: ovh.incidents  },
        Scaleway:  { status: scw.status,  incidents: scw.incidents  },
        AWS:       { status: aws.status,  incidents: aws.incidents  },
        GCP:       { status: gcp.status,  incidents: gcp.incidents  },
        Cloudflare:{ status: cf.status,   incidents: cf.incidents   },
    };

    const datacenters = DATACENTERS.map(dc => ({
        ...dc,
        status:      (providerStatus[dc.provider]?.status ?? 'unknown'),
        incidents:   (providerStatus[dc.provider]?.incidents ?? []),
        lastUpdated: now,
    }));

    // ── Build IXP list ────────────────────────────────────────────────────────
    const ixps = IXPS_STATIC.map(ixp => {
        const equinixStatus = ixp.id === 'eqx-par' ? eqx.status : 'operational';
        return {
            ...ixp,
            peersCount:  peerIndex[ixp.id] ?? 0,
            status:      equinixStatus,
            lastUpdated: now,
        };
    });

    // ── Sources status ────────────────────────────────────────────────────────
    const sourcesStatus = {
        ovh:       ovh.ok        ? 'ok' : 'error',
        scaleway:  scw.ok        ? 'ok' : 'error',
        aws:       aws.ok        ? 'ok' : 'error',
        google:    gcp.ok        ? 'ok' : 'error',
        cloudflare:cf.ok         ? 'ok' : 'error',
        peeringdb: peering.ok    ? 'ok' : 'error',
        radar:     radar.ok      ? 'ok' : (radar.skipped ? 'stale' : 'error'),
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
        datacenters,
        ixps,
        cloudflareAnomalies: radar.data ?? [],
        sourcesStatus,
        generatedAt: now,
    });
}
