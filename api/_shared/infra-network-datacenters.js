const DATAGOUV_WFS_URL = 'https://ogc.geo-ide.developpement-durable.gouv.fr/wxs?map=/opt/data/stack/mapfiles/1.4/org_3954051/054b0271-080c-4906-8d87-fde30fd1d5e5.internet.map';
const DATAGOUV_WFS_TYPENAME = 'ms:L_DATA_CENTER_P_R11';
export const DATACENTER_SOURCE_LABEL = 'data.gouv.fr DRIEAT IDF WFS';
const OFFICIAL_IDF_CACHE_TTL_MS = 6 * 60 * 60_000;

export const STATIC_DATACENTERS = [
    { id: 'ovh-rbx', name: 'OVH Roubaix', provider: 'OVH', region: 'Roubaix', coordinates: [3.170, 50.694] },
    { id: 'ovh-gra', name: 'OVH Gravelines', provider: 'OVH', region: 'Gravelines', coordinates: [2.128, 50.985] },
    { id: 'ovh-sbg', name: 'OVH Strasbourg', provider: 'OVH', region: 'Strasbourg', coordinates: [7.750, 48.574] },
    { id: 'scw-par', name: 'Scaleway Paris', provider: 'Scaleway', region: 'Paris', coordinates: [2.359, 48.863] },
    { id: 'aws-cdg', name: 'AWS Paris (eu-west-3)', provider: 'AWS', region: 'eu-west-3', coordinates: [2.3465, 48.8655] },
    { id: 'gcp-par', name: 'GCP Paris (europe-west9)', provider: 'GCP', region: 'europe-west9', coordinates: [2.340, 48.870] },
    { id: 'cf-par', name: 'Cloudflare Paris', provider: 'Cloudflare', region: 'Paris', coordinates: [2.360, 48.860] },
];

let officialIdfCache = null;

const PROVIDER_ALIASES = [
    [/^ovh/i, 'OVH'],
    [/scaleway/i, 'Scaleway'],
    [/\baws\b|amazon web services|amazon/i, 'AWS'],
    [/google|gcp/i, 'GCP'],
    [/cloudflare/i, 'Cloudflare'],
    [/equinix/i, 'Equinix'],
];

function normalizeWhitespace(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
    return normalizeWhitespace(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function canonicalProviderName(rawProvider) {
    const value = normalizeWhitespace(rawProvider);
    for (const [pattern, canonical] of PROVIDER_ALIASES) {
        if (pattern.test(value)) return canonical;
    }
    return value;
}

function isIleDeFranceCoordinate(coordinates) {
    const [lng, lat] = coordinates;
    return lng >= 1.3 && lng <= 3.7 && lat >= 48.0 && lat <= 49.3;
}

function xmlDecode(value) {
    return String(value ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function extractTagValue(block, tagName) {
    const pattern = new RegExp(`<ms:${tagName}>([\\s\\S]*?)<\\/ms:${tagName}>`, 'i');
    const match = block.match(pattern);
    return match ? xmlDecode(match[1]) : '';
}

function lambert93ToWgs84(x, y) {
    const n = 0.7256077650532670;
    const c = 11754255.426096;
    const xs = 700000.0;
    const ys = 12655612.049876;
    const e = 0.081819191042816;
    const lonMeridian = 3 * Math.PI / 180;

    const dx = x - xs;
    const dy = ys - y;
    const gamma = Math.atan(dx / dy);
    const radius = Math.sqrt(dx * dx + dy * dy);
    const latiso = -1 / n * Math.log(Math.abs(radius / c));

    let lat = 2 * Math.atan(Math.exp(latiso)) - Math.PI / 2;
    for (let i = 0; i < 6; i++) {
        lat = 2 * Math.atan(Math.pow((1 + e * Math.sin(lat)) / (1 - e * Math.sin(lat)), e / 2) * Math.exp(latiso)) - Math.PI / 2;
    }

    const lon = lonMeridian + gamma / n;
    return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}

function parseOfficialDatacenterBlock(block) {
    const posMatch = block.match(/<gml:pos>([\d.\-]+)\s+([\d.\-]+)<\/gml:pos>/i);
    if (!posMatch) return null;

    const lambertX = Number(posMatch[1]);
    const lambertY = Number(posMatch[2]);
    if (!Number.isFinite(lambertX) || !Number.isFinite(lambertY)) return null;

    const [lng, lat] = lambert93ToWgs84(lambertX, lambertY);
    const idDc = Number(extractTagValue(block, 'id_dc'));

    return {
        id_dc: Number.isFinite(idDc) ? idDc : null,
        nom: normalizeWhitespace(extractTagValue(block, 'nom')),
        nom_site: normalizeWhitespace(extractTagValue(block, 'nom_site')),
        operateur: normalizeWhitespace(extractTagValue(block, 'operateur')),
        nom_com: normalizeWhitespace(extractTagValue(block, 'nom_com')),
        adresse: normalizeWhitespace(extractTagValue(block, 'adresse')),
        etat_av: normalizeWhitespace(extractTagValue(block, 'etat_av')),
        bornes_mw: normalizeWhitespace(extractTagValue(block, 'bornes_mw')),
        coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))],
    };
}

function parseOfficialDatacentersXml(xmlText) {
    const blocks = xmlText.match(/<wfs:member>[\s\S]*?<\/wfs:member>/g) ?? [];
    return blocks.map(parseOfficialDatacenterBlock).filter(Boolean);
}

function parseNextStartIndex(xmlText) {
    const match = xmlText.match(/\bnext="[^"]*STARTINDEX=([0-9]+)[^"]*"/i);
    return match ? Number(match[1]) : null;
}

export async function fetchOfficialIdfDatacenters(fetchImpl = fetch, options = {}) {
    const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : OFFICIAL_IDF_CACHE_TTL_MS;
    const force = options.force === true;
    if (!force && officialIdfCache && Date.now() - officialIdfCache.fetchedAt < ttlMs) {
        return officialIdfCache.rows;
    }

    const count = 100;
    let startIndex = 0;
    const rows = [];

    while (true) {
        const url = `${DATAGOUV_WFS_URL}&SERVICE=WFS&REQUEST=GetFeature&VERSION=2.0.0&TYPENAMES=${encodeURIComponent(DATAGOUV_WFS_TYPENAME)}&COUNT=${count}&STARTINDEX=${startIndex}`;
        const resp = await fetchImpl(url, {
            headers: { Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' },
        });
        if (!resp.ok) {
            throw new Error(`DRIEAT WFS HTTP ${resp.status}`);
        }

        const xml = await resp.text();
        rows.push(...parseOfficialDatacentersXml(xml));

        const nextStartIndex = parseNextStartIndex(xml);
        if (nextStartIndex === null || nextStartIndex <= startIndex) break;
        startIndex = nextStartIndex;
    }

    officialIdfCache = {
        rows,
        fetchedAt: Date.now(),
    };
    return rows;
}

/**
 * @param {{
 *   staticDatacenters?: Array<Record<string, any>>,
 *   officialIdfDatacenters?: Array<Record<string, any>>,
 *   providerStatus?: Record<string, { status?: string, incidents?: Array<any> }>,
 *   now?: string,
 * }} input
 */
export function mergeDatacenters({ staticDatacenters = STATIC_DATACENTERS, officialIdfDatacenters = [], providerStatus = {}, now = new Date().toISOString() }) {
    const officialProviders = new Set();

    const normalizedOfficial = officialIdfDatacenters.map((row) => {
        const provider = canonicalProviderName(row.operateur || row.nom || 'Datacenter');
        const providerHealth = providerStatus[provider] ?? { status: 'unknown', incidents: [] };

        officialProviders.add(provider);

        return {
            id: row.id_dc != null ? `idf-${row.id_dc}` : `idf-${slugify(`${provider}-${row.nom}-${row.nom_com}`)}`,
            name: normalizeWhitespace(row.nom_site) ? `${row.nom} ${row.nom_site}` : row.nom,
            provider,
            region: row.nom_com || 'Île-de-France',
            city: row.nom_com || '',
            address: row.adresse || '',
            coordinates: row.coordinates,
            status: providerHealth.status ?? 'unknown',
            incidents: Array.isArray(providerHealth.incidents) ? providerHealth.incidents : [],
            operationalState: row.etat_av || 'inconnu',
            powerBand: row.bornes_mw || '',
            source: DATACENTER_SOURCE_LABEL,
            sourceUpdatedAt: now,
            lastUpdated: now,
        };
    });

    const staticBackbone = staticDatacenters
        .filter((dc) => !(isIleDeFranceCoordinate(dc.coordinates) && officialProviders.has(canonicalProviderName(dc.provider))))
        .map((dc) => {
            const providerHealth = providerStatus[dc.provider] ?? { status: 'unknown', incidents: [] };
            return {
                ...dc,
                city: dc.region,
                address: '',
                status: providerHealth.status ?? 'unknown',
                incidents: Array.isArray(providerHealth.incidents) ? providerHealth.incidents : [],
                operationalState: 'surveillance opérateur',
                powerBand: '',
                source: 'static backbone',
                sourceUpdatedAt: now,
                lastUpdated: now,
            };
        });

    return [...staticBackbone, ...normalizedOfficial];
}
