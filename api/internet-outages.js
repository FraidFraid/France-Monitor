/**
 * api/internet-outages.js — Vercel Serverless Function
 *
 * Agrège les données de pannes Internet depuis :
 *  - IODA (Georgia Tech / CAIDA) : détection d'anomalies BGP, IBR, probing actif
 *  - BGPView : comptage courant de préfixes BGP par ASN français
 *
 * Route : GET /api/internet-outages
 * Cache : 5 min (CDN Vercel)
 */

const IODA_BASE = 'https://api.ioda.inetintel.cc.gatech.edu/v2';
const BGPVIEW_BASE = 'https://api.bgpview.io';

/** Principaux AS français surveillés */
const FRENCH_ISPS = [
    { asn: '3215',  name: 'Orange France',    coordinates: [2.349,  48.864] },
    { asn: '12322', name: 'Free / Iliad',      coordinates: [2.290,  48.889] },
    { asn: '15557', name: 'SFR',               coordinates: [2.317,  48.825] },
    { asn: '5410',  name: 'Bouygues Telecom',  coordinates: [2.244,  48.832] },
    { asn: '16276', name: 'OVH',               coordinates: [3.170,  50.694] },
    { asn: '12876', name: 'Scaleway',           coordinates: [2.359,  48.863] },
];

/** Référentiel de préfixes normal par ASN (IPv4 + IPv6, approximatif) */
const BASELINE_PREFIXES = {
    '3215':  { v4: 1250, v6: 200 },
    '12322': { v4: 820,  v6: 80  },
    '15557': { v4: 980,  v6: 110 },
    '5410':  { v4: 340,  v6: 55  },
    '16276': { v4: 3200, v6: 600 },
    '12876': { v4: 450,  v6: 90  },
};

const FRANCE_CENTER = [2.2137, 46.2276];

async function fetchWithTimeout(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

async function fetchIodaEvents(entityType, entityCode, fromTs, untilTs) {
    try {
        const url = `${IODA_BASE}/outages/events/${entityType}/${entityCode}?from=${fromTs}&until=${untilTs}`;
        const res = await fetchWithTimeout(url, 9000);
        if (!res.ok) return { data: [], ok: false };
        const json = await res.json();
        return { data: Array.isArray(json?.data) ? json.data : [], ok: true };
    } catch {
        return { data: [], ok: false };
    }
}

async function fetchIodaAlerts(entityType, entityCode) {
    try {
        const url = `${IODA_BASE}/outages/alerts/${entityType}/${entityCode}`;
        const res = await fetchWithTimeout(url, 7000);
        if (!res.ok) return { data: [], ok: false };
        const json = await res.json();
        return { data: Array.isArray(json?.data) ? json.data : [], ok: true };
    } catch {
        return { data: [], ok: false };
    }
}

async function fetchBgpPrefixCount(asn) {
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

function normalizeIodaEvent(ev, entityType, entityCode, entityName, coordinates, isOngoing) {
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

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    const now    = Math.floor(Date.now() / 1000);
    const from24h = now - 86_400; // last 24 h

    // ── Fetches IODA ──────────────────────────────────────────────────────────
    const [countryEventsResult, countryAlertsResult] = await Promise.all([
        fetchIodaEvents('country', 'FR', from24h, now),
        fetchIodaAlerts('country', 'FR'),
    ]);

    // Limiter à 4 ASNs pour éviter le rate-limiting IODA
    const asnEventResults = await Promise.allSettled(
        FRENCH_ISPS.slice(0, 4).map(isp =>
            fetchIodaEvents('asn', isp.asn, from24h, now)
                .then(r => ({ asn: isp.asn, data: r.data, ok: r.ok }))
        )
    );

    // ── Fetches BGPView (prefix counts) ──────────────────────────────────────
    const bgpResults = await Promise.allSettled(
        FRENCH_ISPS.map(isp =>
            fetchBgpPrefixCount(isp.asn).then(counts => ({ asn: isp.asn, counts }))
        )
    );
    const bgpByAsn = {};
    for (const r of bgpResults) {
        if (r.status === 'fulfilled' && r.value.counts !== null) {
            bgpByAsn[r.value.asn] = r.value.counts;
        }
    }

    // ── ISP BGP status ────────────────────────────────────────────────────────
    const ispStatus = FRENCH_ISPS.map(isp => {
        const baseline     = BASELINE_PREFIXES[isp.asn] ?? { v4: 100, v6: 10 };
        const current      = bgpByAsn[isp.asn];
        const baselineTotal = baseline.v4 + baseline.v6;
        const currentTotal  = current ? current.v4 + current.v6 : null;

        const visibility = currentTotal !== null
            ? Math.min(100, Math.round((currentTotal / baselineTotal) * 100))
            : 100; // fallback: assume normal when no data

        const status = visibility < 50 ? 'outage'
            : visibility < 85           ? 'degraded'
            : 'normal';

        return {
            asn:               isp.asn,
            ispName:           isp.name,
            prefixCount:       currentTotal ?? baselineTotal,
            prefixCountNormal: baselineTotal,
            visibility,
            status,
            coordinates:       isp.coordinates,
            lastUpdated:       new Date().toISOString(),
        };
    });

    // ── Normaliser tous les events IODA ──────────────────────────────────────
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
            return data.map(ev =>
                normalizeIodaEvent(ev, 'asn', asn, isp?.name ?? `AS${asn}`, isp?.coordinates ?? FRANCE_CENTER, false)
            );
        }),
    ];

    // Déduplification par id
    const seenIds = new Set();
    const events  = rawEvents.filter(ev => {
        if (seenIds.has(ev.id)) return false;
        seenIds.add(ev.id);
        return true;
    });

    // ── Statut des sources ────────────────────────────────────────────────────
    const iodaOk = countryEventsResult.ok || countryAlertsResult.ok;
    const bgpOk  = Object.keys(bgpByAsn).length > 0;

    res.status(200).json({
        events,
        ispStatus,
        sourcesStatus: {
            ioda:    iodaOk ? 'ok' : 'error',
            bgpview: bgpOk  ? 'ok' : 'stale',
        },
        generatedAt: new Date().toISOString(),
    });
}
