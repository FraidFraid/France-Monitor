/**
 * metropoles.ts — Consommation électrique temps réel des grandes métropoles françaises.
 *
 * Source : https://odre.opendatasoft.com — eco2mix-metropoles-tr
 * Aucune authentification requise. Pas de 15 min, publiées par lot quotidien (dernier point vers 00:00 UTC, publié vers 00:25 UTC).
 *
 * Retourne un tableau de MetropoleConsumption avec coordonnées GPS hardcodées
 * et consommation en MW pour le point le plus récent de chaque métropole.
 */

export interface MetropoleConsumption {
    code: string;
    name: string;
    lon: number;
    lat: number;
    consommation: number; // MW
    date_heure: string;
    /** Variation vs même heure J-1 (%). undefined si la donnée J-1 n'était pas disponible. */
    deltaVsJ1Pct?: number;
}

// ─── Coordonnées GPS des 21 métropoles françaises ───
const METROPOLE_GEO: Record<string, { name: string; lon: number; lat: number }> = {
    '200054781': { name: 'Grand Paris',            lon: 2.3522,   lat: 48.8566 },
    '200054807': { name: 'Aix-Marseille',          lon: 5.3698,   lat: 43.2965 },
    '200046977': { name: 'Lyon',                   lon: 4.8357,   lat: 45.7640 },
    '243100518': { name: 'Toulouse',               lon: 1.4442,   lat: 43.6047 },
    '243300316': { name: 'Bordeaux',               lon: -0.5792,  lat: 44.8378 },
    '245900410': { name: 'Lille',                  lon: 3.0573,   lat: 50.6292 },
    '200030195': { name: 'Nice',                   lon: 7.2620,   lat: 43.7102 },
    '244400404': { name: 'Nantes',                 lon: -1.5536,  lat: 47.2184 },
    '246700488': { name: 'Strasbourg',             lon: 7.7521,   lat: 48.5734 },
    '200040715': { name: 'Grenoble',               lon: 5.7245,   lat: 45.1885 },
    '243500139': { name: 'Rennes',                 lon: -1.6778,  lat: 48.1173 },
    '243400017': { name: 'Montpellier',            lon: 3.8767,   lat: 43.6108 },
    '200023414': { name: 'Rouen',                  lon: 1.0993,   lat: 49.4432 },
    '244200770': { name: 'Saint-Étienne',          lon: 4.3872,   lat: 45.4397 },
    '248300543': { name: 'Toulon',                 lon: 5.9282,   lat: 43.1242 },
    '242900314': { name: 'Brest',                  lon: -4.4860,  lat: 48.3904 },
    '244500468': { name: 'Orléans',                lon: 1.9079,   lat: 47.9029 },
    '242100410': { name: 'Dijon',                  lon: 5.0415,   lat: 47.3220 },
    '246300701': { name: 'Clermont-Ferrand',       lon: 3.0863,   lat: 45.7772 },
    '245400676': { name: 'Nancy',                  lon: 6.1844,   lat: 48.6921 },
    '243700754': { name: 'Tours',                  lon: 0.6848,   lat: 47.3941 },
};

const ODRE_BASE =
    'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/eco2mix-metropoles-tr/records';

/** Route un appel ODRÉ via le proxy serveur (cache CDN, conformité
 * « tout passe par /api/* », §2.4 de l'audit). */
function opendataProxyUrl(upstreamUrl: string): string {
    return `/api/opendata-proxy?url=${encodeURIComponent(upstreamUrl)}`;
}

export function latestUrl(offset: number): string {
    return opendataProxyUrl(
        ODRE_BASE +
        '?limit=100' + `&offset=${offset}` +
        '&select=code_insee_epci,libelle_metropole,date_heure,consommation' +
        '&where=consommation%20is%20not%20null' +
        '&order_by=-date_heure',
    );
}

/** Instant J-1 d'une heure de donnée : exactement 24 h plus tôt, au format ODRÉ (jamais calé sur « maintenant »). */
export function j1Instant(dateHeure: string): string | null {
    const t = Date.parse(dateHeure);
    return Number.isFinite(t) ? new Date(t - 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z') : null;
}

/** URL ODRE (via proxy) des valeurs J-1 : un instant exact par heure de donnée distincte (donnée ODRÉ publiée par lot quotidien, heures différentes selon les métropoles). */
export function buildJ1Url(dataTimes: string[]): string | null {
    const instants = [...new Set(dataTimes.map(j1Instant).filter((x): x is string => x !== null))];
    if (instants.length === 0) return null;
    const where = 'consommation is not null AND (' + instants.map((i) => `date_heure = date'${i}'`).join(' OR ') + ')';
    const upstream = ODRE_BASE +
        '?limit=100' +
        '&select=code_insee_epci,date_heure,consommation' +
        `&where=${encodeURIComponent(where)}`;
    return opendataProxyUrl(upstream);
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Fetch silencieux des données J-1 → Map<code, consumptionMW>, chaque métropole comparée à SA propre heure de donnée − 24 h. */
async function fetchJ1Snapshot(latest: Map<string, { date_heure: string }>, fetchFn: FetchFn): Promise<Map<string, number>> {
    try {
        const url = buildJ1Url([...latest.values()].map((v) => v.date_heure));
        if (!url) return new Map();
        const resp = await fetchFn(url, { signal: AbortSignal.timeout(8_000) });
        if (!resp.ok) return new Map();
        const json = await resp.json() as {
            results: Array<{ code_insee_epci: string; date_heure: string; consommation: number | null }>;
        };
        const byKey = new Map<string, number>();
        for (const rec of json.results) {
            if (rec.code_insee_epci && rec.consommation != null) byKey.set(`${rec.code_insee_epci}|${Date.parse(rec.date_heure)}`, rec.consommation);
        }
        const map = new Map<string, number>();
        for (const [code, v] of latest) {
            const inst = j1Instant(v.date_heure);
            const mw = inst ? byKey.get(`${code}|${Date.parse(inst)}`) : undefined;
            if (mw !== undefined) map.set(code, mw);
        }
        return map;
    } catch {
        return new Map();
    }
}

let cache: { data: MetropoleConsumption[]; fetchedAt: number } | null = null;
const CACHE_TTL = 15 * 60_000;

/** Fetch la consommation la plus récente de chaque métropole (cache 15 min). */
export async function fetchMetropoles(): Promise<MetropoleConsumption[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.data;
    try {
        const result = await loadMetropoles((u, i) => fetch(u, i));
        cache = { data: result, fetchedAt: Date.now() };
        const total = result.reduce((s, m) => s + m.consommation, 0);
        console.log(`[Métropoles] ${result.length} métropoles : total ${total.toLocaleString('fr-FR')} MW`);
        return result;
    } catch (err) {
        console.warn('[Métropoles] Fetch failed, using cache:', err);
        return cache?.data ?? [];
    }
}

/** Dernières valeurs puis J-1 à la même heure de donnée (sans cache ; `fetchFn` injectable pour les tests). */
export async function loadMetropoles(fetchFn: FetchFn): Promise<MetropoleConsumption[]> {
    // Deux pages de 100 : le lot quotidien s'arrête à des heures différentes selon les métropoles (21:45 à 00:00 UTC), 100 records n'atteignent pas toutes les métropoles.
    const pages = await Promise.all([0, 100].map(async (offset) => {
        const resp = await fetchFn(latestUrl(offset), { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return (await resp.json() as { results: OdreRecord[] }).results ?? [];
    }));

    // Garde uniquement le record le plus récent par métropole
    const latestByCode = new Map<string, { date_heure: string; consommation: number }>();
    for (const rec of pages.flat()) {
        const code = rec.code_insee_epci;
        if (!code || rec.consommation == null) continue;
        const existing = latestByCode.get(code);
        if (!existing || rec.date_heure > existing.date_heure) {
            latestByCode.set(code, { date_heure: rec.date_heure, consommation: rec.consommation });
        }
    }

    // J-1 calé sur l'heure de la donnée la plus récente de chaque métropole, pas sur « maintenant »
    const j1Map = await fetchJ1Snapshot(latestByCode, fetchFn);

    const result: MetropoleConsumption[] = [];
    for (const [code, val] of latestByCode) {
        const geo = METROPOLE_GEO[code];
        if (!geo) continue; // Métropole non référencée (ignore)
        const j1MW = j1Map.get(code);
        const deltaVsJ1Pct = (j1MW != null && j1MW > 0)
            ? Math.round((val.consommation - j1MW) / j1MW * 1000) / 10  // 1 décimale
            : undefined;
        result.push({ code, name: geo.name, lon: geo.lon, lat: geo.lat, consommation: val.consommation, date_heure: val.date_heure, deltaVsJ1Pct });
    }
    return result;
}

interface OdreRecord { code_insee_epci: string; libelle_metropole: string; date_heure: string; consommation: number | null }
