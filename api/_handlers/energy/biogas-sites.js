// api/_handlers/energy/biogas-sites.js — Vercel Serverless Function
//
// Root cause de la panne 502 (audit 2026-09) : le dataset GRDF a été retravaillé
// et n'expose plus les champs `coordonnees` (lat/lon) ni `site_ouvert` (le
// `select=` de l'ancienne requête référençait un champ inconnu → 400 upstream,
// remonté ici en 502). Le schéma actuel expose en revanche `code_commune`
// (INSEE) et `date_de_fermeture_du_site`.
//
// Fix : on sélectionne les champs qui existent réellement, puis on reconstruit
// des coordonnées par commune via geo.api.gouv.fr (centroïde INSEE) pour ne
// pas casser le contrat attendu par src/services/biogas-sites.ts (qui filtre
// tout enregistrement sans `coordonnees`). `site_ouvert` est resynthétisé à
// partir de la date de fermeture (absente = site ouvert).
//
// Les ~850 sites + géocodage (~800 communes) sont mis en cache Redis 20h pour
// ne pas refaire ce travail à chaque miss CDN (Cache-Control CDN : 24h).

import { redisGet, redisSet } from '../../_utils/redis.js';

const BASE_URL =
    'https://opendata.grdf.fr/api/explore/v2.1/catalog/datasets/' +
    'les-sites-dinjection-de-biomethane-en-france/records' +
    '?select=nom_du_projet,commune,code_commune,capacite_de_production_gwh_an,' +
    'grx_demandeur,gestionnaire_de_registre,type_de_reseau,date_de_fermeture_du_site,' +
    'procede,region,departement,code_dep';

const PAGE_SIZE = 100;
// geo.api.gouv.fr n'accepte PAS `?code=A&code=B&...` comme filtre multi-valeurs
// (seule la première occurrence est prise en compte) : pas de géocodage par lot
// possible. On récupère donc le référentiel complet (~35 000 communes, un seul
// appel) et on filtre en mémoire — les coordonnées d'une commune ne changent
// jamais, donc ce coût n'est payé qu'au cold-cache (Redis 20h ci-dessous).
const GEO_API_ALL_COMMUNES_URL = 'https://geo.api.gouv.fr/communes?fields=code,centre';
const CACHE_KEY = 'biogas-sites:v2';
const CACHE_TTL_SEC = 20 * 60 * 60; // 20h — sous le s-maxage CDN de 24h

class GrdfFetchError extends Error {}

/** @param {string} url @param {number} timeoutMs */
async function fetchJsonOrThrow(url, timeoutMs) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) throw new GrdfFetchError(`GRDF returned ${resp.status}`);
    return resp.json();
}

/** Récupère toutes les pages GRDF : la 1ère séquentiellement (pour connaître total_count), le reste en parallèle. */
async function fetchAllSites() {
    const first = await fetchJsonOrThrow(`${BASE_URL}&limit=${PAGE_SIZE}&offset=0`, 15_000);
    const total = first.total_count || 0;
    const sites = [...(first.results || [])];

    const offsets = [];
    for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) offsets.push(offset);

    const pages = await Promise.all(
        offsets.map((offset) => fetchJsonOrThrow(`${BASE_URL}&limit=${PAGE_SIZE}&offset=${offset}`, 15_000)),
    );
    for (const page of pages) sites.push(...(page.results || []));

    return sites;
}

/**
 * Géocode une liste de codes commune INSEE (centroïde) en filtrant le
 * référentiel complet geo.api.gouv.fr. Best-effort : en cas d'échec réseau,
 * les sites resteront sans `coordonnees` et seront filtrés côté client
 * (src/services/biogas-sites.ts), comme avant quand le champ manquait déjà.
 * @param {string[]} codes
 * @returns {Promise<Map<string, { lat: number, lon: number }>>}
 */
async function geocodeCommunes(codes) {
    const needed = new Set(codes.filter(Boolean));
    const coordsByCode = new Map();
    if (needed.size === 0) return coordsByCode;

    try {
        const resp = await fetch(GEO_API_ALL_COMMUNES_URL, { signal: AbortSignal.timeout(20_000) });
        if (!resp.ok) return coordsByCode;
        const communes = await resp.json();
        for (const commune of communes || []) {
            if (!commune?.code || !needed.has(commune.code)) continue;
            const coords = commune?.centre?.coordinates;
            if (Array.isArray(coords) && coords.length === 2) {
                coordsByCode.set(commune.code, { lon: coords[0], lat: coords[1] });
            }
        }
    } catch {
        // best-effort — géocodage indisponible, on renvoie ce qui a déjà été trouvé
    }

    return coordsByCode;
}

async function buildPayload() {
    const rawSites = await fetchAllSites();
    const coordsByCode = await geocodeCommunes(rawSites.map((site) => site.code_commune));

    const sites = rawSites.map((site) => ({
        ...site,
        coordonnees: coordsByCode.get(site.code_commune),
        site_ouvert: site.date_de_fermeture_du_site ? 'False' : 'True',
    }));

    return { sites, fetchedAt: new Date().toISOString() };
}

/**
 * @param {{ method?: string }} req
 * @param {{ statusCode: number, setHeader: (k: string, v: string) => void, status: (c: number) => any, json: (b: unknown) => unknown, end: (b?: unknown) => unknown }} res
 */
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();

    try {
        const cached = await redisGet(CACHE_KEY);
        if (cached) {
            res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
            return res.status(200).json(JSON.parse(cached));
        }
    } catch {
        // cache corrompu/indisponible — on retombe sur un fetch live
    }

    try {
        const payload = await buildPayload();
        await redisSet(CACHE_KEY, JSON.stringify(payload), CACHE_TTL_SEC);
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
        return res.status(200).json(payload);
    } catch (err) {
        if (err instanceof GrdfFetchError) return res.status(502).json({ error: err.message });
        return res.status(500).json({ error: err.message || 'fetch failed' });
    }
}
