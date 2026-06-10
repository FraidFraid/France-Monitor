import { OSM_FRANCE_DATACENTERS_SNAPSHOT } from './osm-datacenters-snapshot.js';
import { MANUAL_DATACENTERS_SNAPSHOT } from './manual-datacenters-snapshot.js';
import { isFranceMetroCoordinate, isLowQualityOsmDatacenter } from './osm-datacenters-cleanup.js';

const DATAGOUV_WFS_URL = 'https://ogc.geo-ide.developpement-durable.gouv.fr/wxs?map=/opt/data/stack/mapfiles/1.4/org_3954051/054b0271-080c-4906-8d87-fde30fd1d5e5.internet.map';
const DATAGOUV_WFS_TYPENAME = 'ms:L_DATA_CENTER_P_R11';
const UMAP_PROJECTS_URL = 'https://umap.openstreetmap.fr/fr/datalayer/1361384/1150df85-cdb4-4283-bdc2-f2ed713ea5df/';
export const DATACENTER_SOURCE_LABEL = 'data.gouv.fr DRIEAT IDF WFS';
export const OSM_DATACENTER_SOURCE_LABEL = 'OpenStreetMap France datacenters snapshot';
export const DATACENTERMAP_SOURCE_LABEL = 'DataCenterMap live browser snapshot';
export const UMAP_PROJECTS_SOURCE_LABEL = 'uMap projets data centers France';
const UMAP_PROJECTS_PAGE_URL = 'https://umap.openstreetmap.fr/fr/map/projets-de-data-centers-en-france_1361384';
const OFFICIAL_IDF_CACHE_TTL_MS = 6 * 60 * 60_000;
const UMAP_PROJECTS_CACHE_TTL_MS = 12 * 60 * 60_000;

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
let umapProjectsCache = null;

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

function approxDistanceKm(a, b) {
    const [lng1, lat1] = a;
    const [lng2, lat2] = b;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const sLat1 = toRad(lat1);
    const sLat2 = toRad(lat2);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(sLat1) * Math.cos(sLat2) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function isGenericSiteName(value) {
    return /^(data ?center|datacenter|site|building \d+)$/i.test(normalizeWhitespace(value));
}

function hasSameSiteFingerprint(left, right) {
    const leftName = slugify(left.name);
    const rightName = slugify(right.name);
    const sameName = leftName && leftName === rightName;
    const leftAddress = slugify(left.address);
    const rightAddress = slugify(right.address);
    const sameAddress = leftAddress && leftAddress === rightAddress;
    const near = approxDistanceKm(left.coordinates, right.coordinates);
    const genericMatch = isGenericSiteName(left.name) || isGenericSiteName(right.name);
    const sameStem = leftName && rightName && (leftName.startsWith(rightName) || rightName.startsWith(leftName));
    return sameName || (sameAddress && near <= 0.8 && (genericMatch || sameStem));
}

function normalizeOsmDatacenterRows(rows, providerStatus, now) {
    return rows
        .filter((row) => Array.isArray(row.coordinates) && row.coordinates.length === 2)
        .filter((row) => isFranceMetroCoordinate(row.coordinates))
        .filter((row) => !isIleDeFranceCoordinate(row.coordinates))
        .filter((row) => !isLowQualityOsmDatacenter(row))
        .map((row) => {
            const provider = canonicalProviderName(row.provider || row.name || 'Datacenter');
            const providerHealth = providerStatus[provider] ?? { status: 'unknown', incidents: [] };
            return {
                id: row.id,
                name: normalizeWhitespace(row.name) || `${provider} datacenter`,
                provider,
                region: normalizeWhitespace(row.region) || normalizeWhitespace(row.city) || 'France',
                city: normalizeWhitespace(row.city),
                address: normalizeWhitespace(row.address),
                coordinates: row.coordinates,
                status: providerHealth.status ?? 'unknown',
                incidents: Array.isArray(providerHealth.incidents) ? providerHealth.incidents : [],
                operationalState: 'site existant',
                powerBand: normalizeWhitespace(row.powerBand),
                powerDetail: normalizeWhitespace(row.powerDetail),
                detailSummary: normalizeWhitespace(row.detailSummary),
                rawSource: normalizeWhitespace(row.rawSource),
                sourceUrl: normalizeWhitespace(row.sourceUrl),
                source: OSM_DATACENTER_SOURCE_LABEL,
                sourceUpdatedAt: now,
                lastUpdated: now,
            };
        });
}

function normalizeManualDatacenterRows(rows, providerStatus, now) {
    return rows
        .filter((row) => Array.isArray(row.coordinates) && row.coordinates.length === 2)
        .filter((row) => isFranceMetroCoordinate(row.coordinates))
        .map((row) => {
            const provider = canonicalProviderName(row.provider || row.name || 'Datacenter');
            const providerHealth = providerStatus[provider] ?? { status: 'unknown', incidents: [] };
            return {
                id: row.id,
                name: normalizeWhitespace(row.name) || `${provider} datacenter`,
                provider,
                region: normalizeWhitespace(row.region) || normalizeWhitespace(row.city) || 'France',
                city: normalizeWhitespace(row.city),
                address: normalizeWhitespace(row.address),
                coordinates: row.coordinates,
                status: providerHealth.status ?? 'unknown',
                incidents: Array.isArray(providerHealth.incidents) ? providerHealth.incidents : [],
                operationalState: normalizeWhitespace(row.operationalState) || 'site existant',
                powerBand: normalizeWhitespace(row.powerBand),
                powerDetail: normalizeWhitespace(row.powerDetail),
                detailSummary: normalizeWhitespace(row.detailSummary),
                rawSource: normalizeWhitespace(row.rawSource),
                sourceUrl: normalizeWhitespace(row.sourceUrl),
                source: normalizeWhitespace(row.source) || DATACENTERMAP_SOURCE_LABEL,
                sourceUpdatedAt: now,
                lastUpdated: now,
            };
        });
}

function stripHtml(value) {
    return String(value ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parsePowerDetail(description) {
    const match = normalizeWhitespace(description).match(/(\d+(?:[.,]\d+)?)\s*(gigawatt|gwh?|mwa?|mw)\b/i);
    if (!match) return '';
    const unit = match[2].toLowerCase();
    const normalizedUnit = unit.startsWith('g') ? 'GW' : unit === 'mwa' ? 'MVA' : 'MW';
    return `${match[1].replace(',', '.')} ${normalizedUnit}`;
}

function parseUmapPowerBand(description, iconColor) {
    const text = normalizeWhitespace(description).toLowerCase();
    if (/gigawatt|1\s*,?\s*1\s*gigawatt|1\s+gigawatt|700\s*mw|plus de 500 mw|> ?500/.test(text)) {
        return 'plus de 500 MW';
    }
    if (/380\s*mwa|400\s*mw|300\s*mw|250\s*mw|entre 250 et 500 mw/.test(text)) {
        return 'entre 250 et 500 MW';
    }
    if (/200\s*mw|120\s*mw|125\s*mw|100\s*mw|entre 100 et 250 mw/.test(text)) {
        return 'entre 100 et 250 MW';
    }
    if (/90\s*mw|80\s*mw|55\s*mw|45\s*mw|40\s*mw|38\s*mw|14\s*mw|7\s*mw|moins de 100 mw/.test(text)) {
        return 'moins de 100 MW';
    }

    const color = String(iconColor ?? '').trim().toLowerCase();
    if (['#9c27b0', 'darkorchid', 'darkviolet'].includes(color)) return 'plus de 500 MW';
    if (['#ff5252', 'crimson'].includes(color)) return 'entre 250 et 500 MW';
    if (['#f57c00', 'coral'].includes(color)) return 'entre 100 et 250 MW';
    if (['#ffea00', 'yellow'].includes(color)) return 'moins de 100 MW';
    return '';
}

function parseUmapOperationalState(description) {
    const text = normalizeWhitespace(description).toLowerCase();
    if (/fast-?track/.test(text)) return 'fast-track';
    if (/en construction|construction en cours|en cours de construction|début de la construction/.test(text)) return 'en construction';
    if (/engagement de raccordement signé|en négociation|consultation publique|appel à manifestation d'intérêt|ami en cours|recours en cours|mise en service prévue|livraison prévue|date: 2028|date: 2029|date: 2030|date: 2031/.test(text)) return 'en projet';
    return 'en projet';
}

function parseUmapSource(description) {
    const match = String(description ?? '').match(/source\s*:\s*([^\n]+)/i);
    return normalizeWhitespace(match?.[1] ?? '');
}

function extractProjectCoordinates(geometry) {
    const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null;
    if (!coordinates || coordinates.length < 2) return null;
    const [lng, lat] = coordinates;
    return Number.isFinite(lng) && Number.isFinite(lat) ? [Number(lng.toFixed(6)), Number(lat.toFixed(6))] : null;
}

function normalizeUmapProjectDatacenters(featureCollection, providerStatus, now) {
    const features = Array.isArray(featureCollection?.features) ? featureCollection.features : [];
    return features.map((feature, index) => {
        const properties = feature?.properties ?? {};
        const coordinates = extractProjectCoordinates(feature?.geometry);
        if (!coordinates) return null;

        const rawName = normalizeWhitespace(properties.name || properties.nom || `Projet datacenter ${index + 1}`);
        const description = stripHtml(properties.description || '');
        const provider = canonicalProviderName(rawName.split(' - ')[0] || rawName);
        const providerHealth = providerStatus[provider] ?? { status: 'unknown', incidents: [] };

        return {
            id: `umap-${slugify(rawName) || index + 1}`,
            name: rawName,
            provider,
            region: normalizeWhitespace(rawName.split(' - ').slice(1).join(' - ')) || 'France',
            city: normalizeWhitespace(properties.city),
            address: '',
            coordinates,
            status: providerHealth.status ?? 'unknown',
            incidents: Array.isArray(providerHealth.incidents) ? providerHealth.incidents : [],
            operationalState: parseUmapOperationalState(description),
            powerBand: parseUmapPowerBand(description, properties['icon-color']),
            powerDetail: parsePowerDetail(description),
            source: UMAP_PROJECTS_SOURCE_LABEL,
            sourceUpdatedAt: now,
            lastUpdated: now,
            detailSummary: description,
            rawSource: parseUmapSource(description),
            sourceUrl: UMAP_PROJECTS_PAGE_URL,
        };
    }).filter(Boolean);
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

export async function fetchUmapProjectDatacenters(fetchImpl = fetch, options = {}) {
    const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : UMAP_PROJECTS_CACHE_TTL_MS;
    const force = options.force === true;
    if (!force && umapProjectsCache && Date.now() - umapProjectsCache.fetchedAt < ttlMs) {
        return umapProjectsCache.rows;
    }

    const resp = await fetchImpl(UMAP_PROJECTS_URL, {
        headers: {
            Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
            'User-Agent': 'FranceMonitor/1.0',
        },
    });
    if (!resp.ok) {
        throw new Error(`uMap projects HTTP ${resp.status}`);
    }

    const json = await resp.json();
    umapProjectsCache = {
        rows: json,
        fetchedAt: Date.now(),
    };
    return json;
}

/**
 * @param {{
 *   staticDatacenters?: Array<Record<string, any>>,
 *   officialIdfDatacenters?: Array<Record<string, any>>,
 *   providerStatus?: Record<string, { status?: string, incidents?: Array<any> }>,
 *   osmDatacenters?: Array<Record<string, any>>,
 *   manualDatacenters?: Array<Record<string, any>>,
 *   umapProjectDatacenters?: Record<string, any>,
 *   now?: string,
 * }} input
 */
export function mergeDatacenters({
    staticDatacenters = STATIC_DATACENTERS,
    officialIdfDatacenters = [],
    providerStatus = {},
    osmDatacenters = OSM_FRANCE_DATACENTERS_SNAPSHOT,
    manualDatacenters = MANUAL_DATACENTERS_SNAPSHOT,
    umapProjectDatacenters = null,
    now = new Date().toISOString(),
}) {
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

    const osmBackbone = normalizeOsmDatacenterRows(osmDatacenters, providerStatus, now);
    const manualBackbone = normalizeManualDatacenterRows(manualDatacenters, providerStatus, now);
    const projectBackbone = normalizeUmapProjectDatacenters(umapProjectDatacenters, providerStatus, now);
    const nationalOsint = [];
    const nationalProjects = [];

    for (const dc of [...osmBackbone, ...manualBackbone]) {
        if (nationalOsint.some((existing) => hasSameSiteFingerprint(existing, dc))) continue;
        nationalOsint.push(dc);
    }

    for (const dc of projectBackbone) {
        if (normalizedOfficial.some((existing) => hasSameSiteFingerprint(existing, dc))) continue;
        if (nationalProjects.some((existing) => hasSameSiteFingerprint(existing, dc))) continue;
        const osmIndex = nationalOsint.findIndex((existing) => hasSameSiteFingerprint(existing, dc));
        if (osmIndex >= 0) nationalOsint.splice(osmIndex, 1);
        nationalProjects.push(dc);
    }

    const allRichSources = [...nationalOsint, ...nationalProjects, ...normalizedOfficial];
    const fallbackStatic = staticBackbone.filter((dc) => !allRichSources.some((existing) => hasSameSiteFingerprint(existing, dc)));

    return [...fallbackStatic, ...nationalOsint, ...nationalProjects, ...normalizedOfficial];
}
