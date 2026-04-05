/**
 * citizen-outages-proxy.ts — Vite Dev Plugin
 *
 * En développement, proxifie `/api/outages/citizen`.
 * En production, la route est gérée par Vercel Serverless (api/outages/citizen.js).
 *
 * Stratégie dev : scraping HTML réel d'infocoupure.fr (identique au handler Vercel)
 * sur un sous-ensemble de 10 départements prioritaires pour rester dans les délais.
 * Fallback sur MOCK_ZONES si le scraping échoue totalement.
 */

import type { Plugin } from 'vite';

// ── Constantes ────────────────────────────────────────────────────────────────

const DEV_CACHE_TTL_MS     = 10 * 60_000;   // 10 min entre deux scrapes
const RATE_MS              = 1_200;          // politesse entre requêtes par source
const DEPT_FETCH_TIMEOUT   = 6_000;          // timeout page département
const CITY_FETCH_TIMEOUT   = 2_500;          // timeout page ville (fetch parallèle)
const GEOCODE_TIMEOUT      = 4_000;          // timeout API Adresse
const STALE_MS             = 48 * 60 * 60_000; // 48h — ignorer villes sans signalement récent
const MAX_CITIES_PER_DEPT  = 15;

const UA = 'FranceMonitor/2.0-dev (+https://github.com/france-monitor) dev-proxy';

// 10 départements prioritaires (population + activité connue sur infocoupure.fr)
const PRIORITY_DEPTS: Record<string, { name: string; coords: [number, number] }> = {
    '69': { name: 'Rhône',              coords: [4.56,  45.87] },
    '13': { name: 'Bouches-du-Rhône',   coords: [5.37,  43.53] },
    '75': { name: 'Paris',              coords: [2.35,  48.85] },
    '59': { name: 'Nord',               coords: [3.24,  50.52] },
    '67': { name: 'Bas-Rhin',           coords: [7.57,  48.60] },
    '31': { name: 'Haute-Garonne',      coords: [1.44,  43.42] },
    '33': { name: 'Gironde',            coords: [-0.58, 44.84] },
    '44': { name: 'Loire-Atlantique',   coords: [-1.68, 47.35] },
    '35': { name: 'Ille-et-Vilaine',    coords: [-1.62, 48.17] },
    '06': { name: 'Alpes-Maritimes',    coords: [7.12,  43.93] },
};

// ── Module-level state ────────────────────────────────────────────────────────

let _devCache: { data: unknown; fetchedAt: number } | null = null;
const _geocodeCache = new Map<string, { coords: [number, number]; ts: number } | null>();
const _lastFetch: Record<string, number> = {};

// ── Plugin export ─────────────────────────────────────────────────────────────

export function citizenOutagesProxyPlugin(): Plugin {
    return {
        name: 'citizen-outages-proxy',
        configureServer(server) {
            server.middlewares.use('/api/outages/citizen', async (_req, res) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/json');

                const now = Date.now();
                if (_devCache && now - _devCache.fetchedAt < DEV_CACHE_TTL_MS) {
                    res.statusCode = 200;
                    res.end(JSON.stringify(_devCache.data));
                    return;
                }

                console.info('[citizen-outages] Scraping infocoupure.fr (dev)...');
                const t0 = Date.now();

                let reports: CitizenReportRaw[] = [];
                let useMock = false;

                try {
                    reports = await scrapeInfoCoupure();
                } catch (err) {
                    console.warn('[citizen-outages] Scrape failed:', (err as Error).message);
                }

                if (reports.length === 0) {
                    useMock = true;
                    reports = MOCK_REPORTS;
                    console.info(
                        '[citizen-outages] ⚠️  Scraping vide — données MOCK injectées.\n' +
                        '  Vérifier que https://infocoupure.fr est accessible depuis ce réseau.'
                    );
                } else {
                    console.info(
                        `[citizen-outages] ✓ ${reports.length} villes scrapées en ${Date.now() - t0}ms`
                    );
                }

                const zones = useMock ? MOCK_ZONES : buildDevZones(reports);

                const response = {
                    zones,
                    reports,
                    stats: {
                        totalReports: reports.reduce((s, r) => s + r.reportCount, 0),
                        totalZones: zones.features.length,
                        criticalZones: (zones.features as ZoneFeature[]).filter(
                            f => f.properties?.severity === 'critical'
                        ).length,
                        sourcesStatus: {
                            infocoupure: useMock ? 'stale' : 'ok',
                            'coupure-elec': 'stale' as const,
                        },
                        fetchedAt: new Date().toISOString(),
                        isMock: useMock,
                    },
                };

                _devCache = { data: response, fetchedAt: now };
                res.statusCode = 200;
                res.end(JSON.stringify(response));
            });
        },
    };
}

// ── Scraping infocoupure.fr ───────────────────────────────────────────────────

async function scrapeInfoCoupure(): Promise<CitizenReportRaw[]> {
    const codes = Object.keys(PRIORITY_DEPTS);
    const all: CitizenReportRaw[] = [];

    // Batches de 4 en parallèle
    for (let i = 0; i < codes.length; i += 4) {
        const batch = codes.slice(i, i + 4);
        const results = await Promise.allSettled(batch.map(code => fetchDeptCities(code)));
        for (const r of results) {
            if (r.status === 'fulfilled') all.push(...r.value);
        }
        if (i + 4 < codes.length) await sleep(RATE_MS);
    }

    return all;
}

async function fetchDeptCities(code: string): Promise<CitizenReportRaw[]> {
    const dept = PRIORITY_DEPTS[code];
    await rateLimitWait('infocoupure');

    let html: string;
    try {
        const resp = await fetchT(`https://infocoupure.fr/departement-${code}/`, {
            headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'fr-FR,fr;q=0.9' },
        }, DEPT_FETCH_TIMEOUT);
        if (!resp.ok) return [];
        html = await resp.text();
    } catch {
        return [];
    }

    const entries = parseDeptArticles(html, code);
    if (entries.length === 0) return [];

    // Fetch pages villes en parallèle (counts réels)
    const withData = await Promise.all(
        entries.slice(0, MAX_CITIES_PER_DEPT).map(async e => ({
            ...e,
            reportData: await fetchCityReportData(e.href),
        }))
    );

    // Filtrer villes sans signalement récent
    const now = Date.now();
    const fresh = withData.filter(e =>
        !e.reportData || now - e.reportData.mostRecentDate.getTime() < STALE_MS
    );

    // Géocodage en parallèle (API Adresse gère la charge, cache 24h)
    const reports = await Promise.all(fresh.map(async e => {
        const coords = await geocodeCity(e.city, code) ?? dept.coords;
        return {
            id: `infocoupure-${code}-${slugify(e.city)}`,
            source: 'infocoupure' as const,
            city: e.city,
            department: dept.name,
            departmentCode: code,
            reportCount: e.reportData?.count ?? 1,
            timestamp: e.reportData?.mostRecentDate ?? new Date(),
            coordinates: coords,
            type: 'electricity' as const,
        };
    }));
    return reports;
}

// ── Parsers HTML ──────────────────────────────────────────────────────────────

function parseDeptArticles(html: string, code: string): Array<{ city: string; href: string }> {
    const results: Array<{ city: string; href: string }> = [];

    // ── Validation de structure ──
    // Vérifier que la page ressemble à du WordPress (infocoupure est un site WP).
    // Si absente, une réponse Cloudflare / erreur / maintenance est silencieusement
    // interprétée comme "zéro panne" — ce guard rend l'échec visible.
    const IS_WORDPRESS =
        /<article[^>]+class="[^"]*post[^"]*"[^>]*>/i.test(html) ||
        /<h2[^>]+class="[^"]*entry-title[^"]*"/i.test(html) ||
        /<div[^>]+class="[^"]*entry-content[^"]*"/i.test(html);

    if (!IS_WORDPRESS) {
        console.warn(
            `[infocoupure] /departement-${code}/ : structure HTML inattendue — ` +
            'marqueurs WordPress absents. Le scraper est peut-\u00eatre cass\u00e9.'
        );
        return [];
    }

    const articleRe = new RegExp(
        `<article[^>]+category-departement-${code}[^>]*>[\\s\\S]*?</article>`,
        'gi'
    );
    const articles = html.match(articleRe)
        ?? html.match(/<article[^>]+class="[^"]*post[^"]*"[^>]*>[\s\S]*?<\/article>/gi)
        ?? [];

    for (const article of articles) {
        const m = article.match(
            /<h2[^>]*entry-title[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
        );
        if (!m) continue;
        const href  = m[1];
        const title = m[2].replace(/<[^>]+>/g, '').trim();
        const city  = extractCityFromTitle(title, code) || extractCityFromUrl(href);
        if (city && city.length >= 2) results.push({ city, href });
    }

    return results;
}

function extractCityFromTitle(title: string, code: string): string {
    const patterns = [
        new RegExp(`(?:coupures?|pannes?|électricité)[^(]*?([\\w][\\w\\s'\\-]+?)\\s*\\(${code}\\)`, 'i'),
        new RegExp(`^([\\w][\\w\\s'\\-]+?)\\s*\\(${code}\\)`, 'i'),
    ];
    for (const p of patterns) {
        const m = title.match(p);
        if (m) return m[1].trim().replace(/^(?:à|de|d'|du|le|la|les)\s+/i, '').trim();
    }
    return '';
}

function extractCityFromUrl(href: string): string {
    const slug = href.replace(/.*\/([^/]+)\/?$/, '$1');
    if (!slug || slug === 'departement') return '';
    return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
}

async function fetchCityReportData(
    href: string
): Promise<{ count: number; totalPages: number; mostRecentDate: Date } | null> {
    try {
        const url = href.startsWith('http') ? href : `https://infocoupure.fr${href}`;
        const resp = await fetchT(url, {
            headers: { 'User-Agent': UA, Accept: 'text/html' },
        }, CITY_FETCH_TIMEOUT);
        if (!resp.ok) return null;
        return parseCityComments(await resp.text());
    } catch {
        return null;
    }
}

function parseCityComments(html: string): { count: number; totalPages: number; mostRecentDate: Date } {
    const wraps        = html.match(/<div[^>]+class="[^"]*wpd-comment-wrap[^"]*"/g) ?? [];
    const commentsOnPage = wraps.length;

    const pageMatch  = html.match(/<span[^>]+aria-current="page"[^>]*>(\d+)<\/span>/i);
    const totalPages = pageMatch ? parseInt(pageMatch[1], 10) : 1;

    const allDates = [...html.matchAll(/class="wpd-comment-date"[^>]+title="([^"]+)"/gi)]
        .map(m => parseFrenchDate(m[1]))
        .filter(d => !isNaN(d.getTime()));

    const mostRecentDate = allDates.length > 0
        ? new Date(Math.max(...allDates.map(d => d.getTime())))
        : new Date();

    return {
        count: Math.max(1, commentsOnPage * totalPages),
        totalPages,
        mostRecentDate,
    };
}

function parseFrenchDate(str: string): Date {
    const MONTHS: Record<string, number> = {
        'janvier': 0, 'février': 1, 'mars': 2, 'avril': 3, 'mai': 4, 'juin': 5,
        'juillet': 6, 'août': 7, 'septembre': 8, 'octobre': 9, 'novembre': 10, 'décembre': 11,
    };
    const m = str.match(/(\d+)\s+(\w+)\s+(\d{4})\s+(\d+)\s*h\s*(\d+)/i);
    if (!m) return new Date(NaN);
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined) return new Date(NaN);
    return new Date(parseInt(m[3]), month, parseInt(m[1]), parseInt(m[4]), parseInt(m[5]));
}

// ── Géocodage API Adresse ─────────────────────────────────────────────────────

async function geocodeCity(city: string, dept: string): Promise<[number, number] | null> {
    const key = `${city}|${dept}`.toLowerCase();
    const cached = _geocodeCache.get(key);
    if (cached !== undefined) return cached?.coords ?? null;

    try {
        const q   = `${encodeURIComponent(city)}&postcode=${encodeURIComponent(dept)}`;
        const url = `https://api-adresse.data.gouv.fr/search/?q=${q}&type=municipality&limit=1`;
        const resp = await fetchT(url, { headers: { 'User-Agent': UA } }, GEOCODE_TIMEOUT);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json() as { features?: Array<{ geometry: { coordinates: [number, number] } }> };
        const feat = data?.features?.[0];
        if (!feat) { _geocodeCache.set(key, null); return null; }
        const coords: [number, number] = [feat.geometry.coordinates[0], feat.geometry.coordinates[1]];
        _geocodeCache.set(key, { coords, ts: Date.now() });
        return coords;
    } catch {
        _geocodeCache.set(key, null);
        return null;
    }
}

// ── Dev clustering (sans Turf) ────────────────────────────────────────────────

function buildDevZones(reports: CitizenReportRaw[]) {
    const grid = new Map<string, { reports: CitizenReportRaw[]; total: number }>();
    for (const r of reports) {
        if (!r.coordinates) continue;
        const [lng, lat] = r.coordinates;
        if (!isFinite(lng) || !isFinite(lat)) continue;
        const key = `${Math.round(lng * 10)},${Math.round(lat * 10)}`;
        const cell = grid.get(key) ?? { reports: [], total: 0 };
        cell.reports.push(r);
        cell.total += r.reportCount;
        grid.set(key, cell);
    }

    const features: unknown[] = [];
    let id = 0;
    for (const [, cell] of grid) {
        if (cell.reports.length < 1 || cell.total < 1) continue;
        const lngs = cell.reports.map(r => r.coordinates![0]);
        const lats = cell.reports.map(r => r.coordinates![1]);
        const cx = lngs.reduce((a, b) => a + b, 0) / lngs.length;
        const cy = lats.reduce((a, b) => a + b, 0) / lats.length;
        const severity = cell.total > 100 ? 'critical' : cell.total > 30 ? 'high' : cell.total > 10 ? 'medium' : 'low';
        features.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [makeCircle([cx, cy], 8)] },
            properties: {
                clusterId: id++,
                density: Math.round(cell.total / (Math.PI * 64) * 100) / 100,
                totalReports: cell.total,
                sources: [...new Set(cell.reports.map(r => r.source))],
                severity,
                center: [cx, cy],
                radiusKm: 8,
                createdAt: new Date().toISOString(),
            },
        });
    }
    return { type: 'FeatureCollection', features };
}

// ── MOCK DATA — fallback si infocoupure.fr inaccessible ──────────────────────

const MOCK_REPORTS: CitizenReportRaw[] = [
    { id: 'm1',  source: 'infocoupure', city: 'Saint-Denis',    department: 'Seine-Saint-Denis', departmentCode: '93', reportCount: 87,  timestamp: new Date(), coordinates: [2.357,  48.936], type: 'electricity' },
    { id: 'm2',  source: 'infocoupure', city: 'Montreuil',      department: 'Seine-Saint-Denis', departmentCode: '93', reportCount: 52,  timestamp: new Date(), coordinates: [2.443,  48.864], type: 'electricity' },
    { id: 'm3',  source: 'infocoupure', city: 'Argenteuil',     department: "Val-d'Oise",        departmentCode: '95', reportCount: 63,  timestamp: new Date(), coordinates: [2.247,  48.947], type: 'electricity' },
    { id: 'm4',  source: 'infocoupure', city: 'Nanterre',       department: 'Hauts-de-Seine',    departmentCode: '92', reportCount: 45,  timestamp: new Date(), coordinates: [2.207,  48.892], type: 'electricity' },
    { id: 'm5',  source: 'infocoupure', city: 'Créteil',        department: 'Val-de-Marne',      departmentCode: '94', reportCount: 38,  timestamp: new Date(), coordinates: [2.455,  48.790], type: 'electricity' },
    { id: 'm6',  source: 'infocoupure', city: 'Lyon',           department: 'Rhône',             departmentCode: '69', reportCount: 34,  timestamp: new Date(), coordinates: [4.832,  45.748], type: 'electricity' },
    { id: 'm7',  source: 'infocoupure', city: 'Villeurbanne',   department: 'Rhône',             departmentCode: '69', reportCount: 29,  timestamp: new Date(), coordinates: [4.880,  45.771], type: 'electricity' },
    { id: 'm8',  source: 'infocoupure', city: 'Vénissieux',     department: 'Rhône',             departmentCode: '69', reportCount: 18,  timestamp: new Date(), coordinates: [4.886,  45.698], type: 'electricity' },
    { id: 'm9',  source: 'infocoupure', city: 'Marseille',      department: 'Bouches-du-Rhône',  departmentCode: '13', reportCount: 112, timestamp: new Date(), coordinates: [5.370,  43.296], type: 'electricity' },
    { id: 'm10', source: 'infocoupure', city: 'Aubagne',        department: 'Bouches-du-Rhône',  departmentCode: '13', reportCount: 67,  timestamp: new Date(), coordinates: [5.571,  43.294], type: 'electricity' },
    { id: 'm11', source: 'infocoupure', city: 'Lille',          department: 'Nord',              departmentCode: '59', reportCount: 56,  timestamp: new Date(), coordinates: [3.064,  50.629], type: 'electricity' },
    { id: 'm12', source: 'infocoupure', city: 'Roubaix',        department: 'Nord',              departmentCode: '59', reportCount: 43,  timestamp: new Date(), coordinates: [3.175,  50.692], type: 'electricity' },
    { id: 'm13', source: 'infocoupure', city: 'Strasbourg',     department: 'Bas-Rhin',          departmentCode: '67', reportCount: 128, timestamp: new Date(), coordinates: [7.752,  48.574], type: 'electricity' },
    { id: 'm14', source: 'infocoupure', city: 'Toulouse',       department: 'Haute-Garonne',     departmentCode: '31', reportCount: 19,  timestamp: new Date(), coordinates: [1.444,  43.605], type: 'electricity' },
    { id: 'm15', source: 'infocoupure', city: 'Bordeaux',       department: 'Gironde',           departmentCode: '33', reportCount: 12,  timestamp: new Date(), coordinates: [-0.579, 44.837], type: 'electricity' },
    { id: 'm16', source: 'infocoupure', city: 'Nantes',         department: 'Loire-Atlantique',  departmentCode: '44', reportCount: 23,  timestamp: new Date(), coordinates: [-1.554, 47.218], type: 'electricity' },
    { id: 'm17', source: 'infocoupure', city: 'Rennes',         department: 'Ille-et-Vilaine',   departmentCode: '35', reportCount: 8,   timestamp: new Date(), coordinates: [-1.677, 48.117], type: 'electricity' },
    { id: 'm18', source: 'infocoupure', city: 'Nice',           department: 'Alpes-Maritimes',   departmentCode: '06', reportCount: 14,  timestamp: new Date(), coordinates: [7.266,  43.710], type: 'electricity' },
];

const MOCK_ZONES = buildDevZones(MOCK_REPORTS);

// ── Utilities ─────────────────────────────────────────────────────────────────

function makeCircle([lng, lat]: [number, number], radiusKm: number, steps = 24): [number, number][] {
    const coords: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * 2 * Math.PI;
        coords.push([
            lng + ((radiusKm / 111.32) / Math.cos((lat * Math.PI) / 180)) * Math.cos(a),
            lat + (radiusKm / 111.32) * Math.sin(a),
        ]);
    }
    coords.push(coords[0]);
    return coords;
}

function slugify(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
}

async function rateLimitWait(source: string): Promise<void> {
    const last    = _lastFetch[source] ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed < RATE_MS) await sleep(RATE_MS - elapsed);
    _lastFetch[source] = Date.now();
}

async function fetchT(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Local Types ───────────────────────────────────────────────────────────────

interface CitizenReportRaw {
    id: string;
    source: 'infocoupure' | 'coupure-elec';
    city: string;
    department: string;
    departmentCode: string;
    reportCount: number;
    timestamp: Date;
    coordinates: [number, number] | null;
    type: 'electricity' | 'internet' | 'unknown';
}

interface ZoneFeature {
    properties: { severity: string };
}
