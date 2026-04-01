/**
 * internet-outages-proxy.ts — Vite Plugin (dev)
 *
 * Intercepte /api/internet-outages et agrège :
 *  - IODA (Georgia Tech / CAIDA) : pannes BGP/IBR/probing pour la France
 *  - BGPView : comptage courant de préfixes par ASN français
 */

import type { Plugin } from 'vite';

const IODA_BASE = 'https://api.ioda.inetintel.cc.gatech.edu/v2';
const BGPVIEW_BASE = 'https://api.bgpview.io';

const FRENCH_ISPS = [
    { asn: '3215',  name: 'Orange France',    coordinates: [2.349,  48.864] as [number, number] },
    { asn: '12322', name: 'Free / Iliad',      coordinates: [2.290,  48.889] as [number, number] },
    { asn: '15557', name: 'SFR',               coordinates: [2.317,  48.825] as [number, number] },
    { asn: '5410',  name: 'Bouygues Telecom',  coordinates: [2.244,  48.832] as [number, number] },
    { asn: '16276', name: 'OVH',               coordinates: [3.170,  50.694] as [number, number] },
    { asn: '12876', name: 'Scaleway',           coordinates: [2.359,  48.863] as [number, number] },
] as const;

const BASELINE_PREFIXES: Record<string, { v4: number; v6: number }> = {
    '3215':  { v4: 1250, v6: 200 },
    '12322': { v4: 820,  v6: 80  },
    '15557': { v4: 980,  v6: 110 },
    '5410':  { v4: 340,  v6: 55  },
    '16276': { v4: 3200, v6: 600 },
    '12876': { v4: 450,  v6: 90  },
};

const ISP_ENRICHMENT: Record<string, {
    networkType: string; peeringPolicy: string;
    arcepFiber: string | null; mobile: string | null;
    noc: string | null; ipv6Label: string | null;
}> = {
    '3215':  { networkType: 'Opérateur national',  peeringPolicy: 'Selective', arcepFiber: '84 %', mobile: '5G NR', noc: 'noc@orange.fr',   ipv6Label: 'DHCPv6-PD' },
    '12322': { networkType: 'Opérateur national',  peeringPolicy: 'Open',      arcepFiber: '76 %', mobile: '5G NR', noc: 'peering@free.fr', ipv6Label: 'Natif SLAAC · leader IPv6 France' },
    '15557': { networkType: 'Opérateur national',  peeringPolicy: 'Selective', arcepFiber: '79 %', mobile: '5G NR', noc: null,              ipv6Label: 'DHCPv6' },
    '5410':  { networkType: 'Opérateur national',  peeringPolicy: 'Selective', arcepFiber: '72 %', mobile: '5G NR', noc: null,              ipv6Label: 'Partiel' },
    '16276': { networkType: 'Hébergeur / Transit', peeringPolicy: 'Open',      arcepFiber: null,   mobile: 'N/A',   noc: 'noc@ovh.net',     ipv6Label: 'Dual-stack natif' },
    '12876': { networkType: 'Cloud / Hébergeur',   peeringPolicy: 'Open',      arcepFiber: null,   mobile: 'N/A',   noc: null,              ipv6Label: 'Dual-stack natif' },
};

const FRANCE_CENTER: [number, number] = [2.2137, 46.2276];

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

async function fetchIodaEvents(
    entityType: string,
    entityCode: string,
    fromTs: number,
    untilTs: number
): Promise<{ data: any[]; ok: boolean }> {
    try {
        const url = `${IODA_BASE}/outages/events?entityType=${entityType}&entityCode=${entityCode}&from=${fromTs}&until=${untilTs}`;
        const res = await fetchWithTimeout(url, 9000);
        if (!res.ok) return { data: [], ok: false };
        const json = await res.json();
        return { data: Array.isArray(json?.data) ? json.data : [], ok: true };
    } catch {
        return { data: [], ok: false };
    }
}

async function fetchIodaAlerts(
    entityType: string,
    entityCode: string,
    fromTs: number,
    untilTs: number
): Promise<{ data: any[]; ok: boolean }> {
    try {
        const url = `${IODA_BASE}/outages/alerts?entityType=${entityType}&entityCode=${entityCode}&from=${fromTs}&until=${untilTs}`;
        const res = await fetchWithTimeout(url, 7000);
        if (!res.ok) return { data: [], ok: false };
        const json = await res.json();
        return { data: Array.isArray(json?.data) ? json.data : [], ok: true };
    } catch {
        return { data: [], ok: false };
    }
}

async function fetchBgpAsnInfo(asn: string): Promise<{ trafficEstimation: string | null; lookingGlass: string | null } | null> {
    try {
        const res = await fetchWithTimeout(`${BGPVIEW_BASE}/asn/${asn}`, 6000);
        if (!res.ok) return null;
        const json = await res.json();
        if (json?.status !== 'ok') return null;
        const d = json.data ?? {};
        return { trafficEstimation: d.traffic_estimation ?? null, lookingGlass: d.looking_glass ?? null };
    } catch { return null; }
}

async function fetchBgpIxs(asn: string): Promise<string[] | null> {
    try {
        const res = await fetchWithTimeout(`${BGPVIEW_BASE}/asn/${asn}/ixs`, 6000);
        if (!res.ok) return null;
        const json = await res.json();
        if (json?.status !== 'ok') return null;
        const v4ixs: any[] = Array.isArray(json?.data?.ipv4_ixs) ? json.data.ipv4_ixs : [];
        const v6ixs: any[] = Array.isArray(json?.data?.ipv6_ixs) ? json.data.ipv6_ixs : [];
        const allNames = [...new Set([...v4ixs, ...v6ixs].map((ix: any) => ix.name_full || ix.name).filter(Boolean))];
        return (allNames as string[]).slice(0, 6);
    } catch { return null; }
}

async function fetchBgpPrefixCount(asn: string): Promise<{ v4: number; v6: number } | null> {
    try {
        const url = `${BGPVIEW_BASE}/asn/${asn}/prefixes`;
        const res = await fetchWithTimeout(url, 7000);
        if (!res.ok) return null;
        const json = await res.json();
        if (json?.status !== 'ok') return null;
        const v4 = Array.isArray(json?.data?.ipv4_prefixes) ? json.data.ipv4_prefixes.length : null;
        const v6 = Array.isArray(json?.data?.ipv6_prefixes) ? json.data.ipv6_prefixes.length : null;
        return (v4 !== null || v6 !== null) ? { v4: v4 ?? 0, v6: v6 ?? 0 } : null;
    } catch {
        return null;
    }
}

function normalizeIodaEvent(
    ev: any,
    entityType: string,
    entityCode: string,
    entityName: string,
    coordinates: [number, number],
    isOngoing: boolean
) {
    const startTs = (ev.startTime ?? 0) * 1000;
    const endTs   = ev.endTime ? ev.endTime * 1000 : null;
    return {
        id:          `${entityType}-${entityCode}-${ev.startTime ?? Date.now()}`,
        entityCode,
        entityName,
        entityType,
        startTime:   startTs,
        endTime:     endTs,
        duration:    ev.duration ?? (endTs ? Math.round((endTs - startTs) / 1000) : 0),
        score:       ev.score ?? 0,
        datasources: Array.isArray(ev.datasources) ? ev.datasources : [],
        isOngoing:   isOngoing || !ev.endTime,
        coordinates,
    };
}

export function internetOutagesProxyPlugin(): Plugin {
    return {
        name: 'internet-outages-proxy',
        configureServer(server) {
            server.middlewares.use('/api/internet-outages', async (_req, res) => {
                try {
                    const now     = Math.floor(Date.now() / 1000);
                    const from24h = now - 86_400;

                    // IODA: France country-level
                    const [countryEventsResult, countryAlertsResult] = await Promise.all([
                        fetchIodaEvents('country', 'FR', from24h, now),
                        fetchIodaAlerts('country', 'FR', from24h, now),
                    ]);

                    // IODA: top 4 ASNs français (éviter rate-limit)
                    const asnEventResults = await Promise.allSettled(
                        FRENCH_ISPS.slice(0, 4).map(isp =>
                            fetchIodaEvents('asn', isp.asn, from24h, now)
                                .then(r => ({ asn: isp.asn, data: r.data }))
                        )
                    );

                    // BGPView: prefix counts + ASN info + IX list (en parallèle)
                    const [bgpResults, asnInfoResults, ixResults] = await Promise.all([
                        Promise.allSettled(FRENCH_ISPS.map(isp =>
                            fetchBgpPrefixCount(isp.asn).then(counts => ({ asn: isp.asn, counts }))
                        )),
                        Promise.allSettled(FRENCH_ISPS.map(isp =>
                            fetchBgpAsnInfo(isp.asn).then(info => ({ asn: isp.asn, info }))
                        )),
                        Promise.allSettled(FRENCH_ISPS.map(isp =>
                            fetchBgpIxs(isp.asn).then(ixs => ({ asn: isp.asn, ixs }))
                        )),
                    ]);

                    const bgpByAsn: Record<string, { v4: number; v6: number }> = {};
                    for (const r of bgpResults) {
                        if (r.status === 'fulfilled' && r.value.counts !== null) {
                            bgpByAsn[r.value.asn] = r.value.counts;
                        }
                    }
                    const asnInfoByAsn: Record<string, { trafficEstimation: string | null; lookingGlass: string | null }> = {};
                    for (const r of asnInfoResults) {
                        if (r.status === 'fulfilled' && r.value.info !== null) {
                            asnInfoByAsn[r.value.asn] = r.value.info;
                        }
                    }
                    const ixByAsn: Record<string, string[]> = {};
                    for (const r of ixResults) {
                        if (r.status === 'fulfilled' && r.value.ixs !== null) {
                            ixByAsn[r.value.asn] = r.value.ixs;
                        }
                    }

                    // ISP BGP status enrichi
                    const ispStatus = FRENCH_ISPS.map(isp => {
                        const baseline      = BASELINE_PREFIXES[isp.asn] ?? { v4: 100, v6: 10 };
                        const enrichment    = ISP_ENRICHMENT[isp.asn] ?? { networkType: 'Réseau', peeringPolicy: 'N/A', arcepFiber: null, mobile: null, noc: null, ipv6Label: null };
                        const current       = bgpByAsn[isp.asn];
                        const asnInfo       = asnInfoByAsn[isp.asn] ?? {};
                        const ixList        = ixByAsn[isp.asn] ?? [];
                        const baselineTotal = baseline.v4 + baseline.v6;
                        const prefixV4      = current?.v4 ?? baseline.v4;
                        const prefixV6      = current?.v6 ?? baseline.v6;
                        const currentTotal  = prefixV4 + prefixV6;

                        const visibility = current
                            ? Math.min(100, Math.round((currentTotal / baselineTotal) * 100))
                            : 100;

                        const status: 'normal' | 'degraded' | 'outage' =
                            visibility < 50 ? 'outage' : visibility < 85 ? 'degraded' : 'normal';

                        return {
                            asn:               isp.asn,
                            ispName:           isp.name,
                            prefixCount:       currentTotal,
                            prefixCountNormal: baselineTotal,
                            prefixV4,
                            prefixV6,
                            visibility,
                            status,
                            coordinates:       isp.coordinates,
                            lastUpdated:       new Date().toISOString(),
                            trafficEstimation: asnInfo.trafficEstimation ?? null,
                            lookingGlass:      asnInfo.lookingGlass ?? null,
                            ixList,
                            peerCount:         0,
                            networkType:       enrichment.networkType,
                            peeringPolicy:     enrichment.peeringPolicy,
                            arcepFiber:        enrichment.arcepFiber,
                            mobile:            enrichment.mobile,
                            noc:               enrichment.noc,
                            ipv6Label:         enrichment.ipv6Label,
                        };
                    });

                    // Normaliser les events
                    const rawEvents = [
                        ...countryEventsResult.data.map(ev =>
                            normalizeIodaEvent(ev, 'country', 'FR', 'France', FRANCE_CENTER, false)
                        ),
                        ...countryAlertsResult.data.map(ev =>
                            normalizeIodaEvent(ev, 'country', 'FR', 'France', FRANCE_CENTER, true)
                        ),
                        ...asnEventResults.flatMap(r => {
                            if (r.status !== 'fulfilled') return [];
                            const { asn, data } = r.value;
                            const isp = FRENCH_ISPS.find(i => i.asn === asn);
                            return data.map((ev: any) =>
                                normalizeIodaEvent(ev, 'asn', asn, isp?.name ?? `AS${asn}`, isp?.coordinates ?? FRANCE_CENTER, false)
                            );
                        }),
                    ];

                    const seenIds = new Set<string>();
                    const events  = rawEvents.filter(ev => {
                        if (seenIds.has(ev.id)) return false;
                        seenIds.add(ev.id);
                        return true;
                    });

                    const iodaOk = countryEventsResult.ok || countryAlertsResult.ok;
                    const bgpOk  = Object.keys(bgpByAsn).length > 0;

                    const payload = {
                        events,
                        ispStatus,
                        sourcesStatus: {
                            ioda:    iodaOk ? 'ok' : 'error',
                            bgpview: bgpOk  ? 'ok' : 'stale',
                        },
                        generatedAt: new Date().toISOString(),
                    };

                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.end(JSON.stringify(payload));
                } catch (err) {
                    console.error('[internet-outages-proxy] Error:', err);
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Proxy error', events: [], ispStatus: [] }));
                }
            });
        },
    };
}
