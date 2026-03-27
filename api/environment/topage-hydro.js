const TOPAGE_WFS_URL = 'https://services.sandre.eaufrance.fr/geo/topage2023';

function buildUpstreamUrl(reqUrl) {
    const url = new URL(reqUrl, 'http://localhost');
    const bbox = url.searchParams.get('bbox');
    if (!bbox) {
        throw new Error('Missing bbox');
    }

    const count = Number(url.searchParams.get('count') ?? '600');
    const upstream = new URL(TOPAGE_WFS_URL);
    upstream.searchParams.set('service', 'WFS');
    upstream.searchParams.set('version', '2.0.0');
    upstream.searchParams.set('request', 'GetFeature');
    upstream.searchParams.set('typeNames', 'sa:TronconHydrographique_FXX_Topage2023');
    upstream.searchParams.set('outputFormat', 'application/json; subtype=geojson');
    upstream.searchParams.set('bbox', bbox);
    upstream.searchParams.set('count', String(Number.isFinite(count) ? Math.max(1, Math.min(count, 1000)) : 600));
    upstream.searchParams.set('language', 'fre');
    return upstream.toString();
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    try {
        const upstreamUrl = buildUpstreamUrl(req.url ?? '');
        const response = await fetch(upstreamUrl, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(20_000),
        });

        if (!response.ok) {
            res.status(response.status).json({ error: `Topage upstream error ${response.status}` });
            return;
        }

        const payload = await response.text();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=900');
        res.status(200).send(payload);
    } catch (error) {
        console.error('[api/topage-hydro]', error);
        res.status(500).json({ error: 'Topage proxy failed' });
    }
}
