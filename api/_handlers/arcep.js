/**
 * api/_handlers/arcep.js — Vercel Serverless Function
 *
 * Proxy vers les données ARCEP "sites indisponibles" (data.gouv.fr).
 * Évite les erreurs CORS côté client.
 *
 * Root cause de la panne 404 (audit 2026-09) : data.gouv.fr a migré le stockage
 * du fichier quotidien de son propre object storage (object.files.data.gouv.fr)
 * vers un bucket OVH dédié (arcep.s3.rbx.io.cloud.ovh.net) autour de fin
 * juillet 2026 — cf. https://object.files.data.gouv.fr/... répond 404 pour
 * toute date de septembre, alors que la ressource existe toujours au catalogue
 * data.gouv.fr (dataset "Sites indisponibles", id 5f7c7fae9cd6c79b58da3e20) sous
 * le nouveau host. Le chemin `sites-indisponibles/all/<date>/raw<date>.geojson`
 * n'a lui pas changé.
 *
 * Route  : GET /api/arcep  (le paramètre ?date= est désormais ignoré : on sert
 *          toujours le dernier jour disponible, header X-Data-Date en réponse)
 * Stratégie :
 *   1. Sonde HEAD sur le bucket OVH, jour par jour en remontant (borné à
 *      MAX_DAY_PROBES) — rapide, pas d'appel API data.gouv.fr dans le cas nominal.
 *   2. Si rien trouvé, repli sur le catalogue data.gouv.fr (liste des ressources
 *      du dataset) pour retrouver l'URL réelle la plus récente — résiste à un
 *      nouveau changement d'hébergeur sans modification de code.
 *   3. Si toujours rien sous MAX_LOOKBACK_DAYS, 404 avec cache CDN négatif
 *      court pour éviter de marteler l'amont.
 */

const OVH_BASE = 'https://arcep.s3.rbx.io.cloud.ovh.net/sites-indisponibles/all';
const DATA_GOUV_DATASET_API = 'https://www.data.gouv.fr/api/1/datasets/5f7c7fae9cd6c79b58da3e20/';
const MAX_DAY_PROBES = 10;
const MAX_LOOKBACK_DAYS = 45;

/** @param {Date} date */
function formatDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/** @param {string} dateStr */
function ovhUrl(dateStr) {
    return `${OVH_BASE}/${dateStr}/raw${dateStr}.geojson`;
}

/** @param {string} dateStr */
async function probeDate(dateStr) {
    try {
        const resp = await fetch(ovhUrl(dateStr), { method: 'HEAD', signal: AbortSignal.timeout(6000) });
        return resp.ok;
    } catch {
        return false;
    }
}

/** @returns {Promise<{ dateStr: string, url: string } | null>} */
async function findLatestViaDayProbes() {
    const today = new Date();
    for (let i = 0; i < MAX_DAY_PROBES; i += 1) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = formatDate(d);
        if (await probeDate(dateStr)) return { dateStr, url: ovhUrl(dateStr) };
    }
    return null;
}

/** Extrait une date AAAA-MM-JJ d'un titre ou d'une URL de ressource data.gouv.fr. @param {string} value */
function extractDateStr(value) {
    return value?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
}

/** Repli résistant à un changement d'hébergeur : lit le catalogue data.gouv.fr. @returns {Promise<{ dateStr: string, url: string } | null>} */
async function findLatestViaDatasetListing() {
    try {
        const resp = await fetch(DATA_GOUV_DATASET_API, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) return null;
        const data = await resp.json();
        const resources = Array.isArray(data.resources) ? data.resources : [];
        const cutoff = Date.now() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

        const candidates = resources
            .filter((r) => r.format === 'geojson' && typeof r.url === 'string')
            .map((r) => ({ url: r.url, dateStr: extractDateStr(r.title) ?? extractDateStr(r.url) }))
            .filter((r) => r.dateStr && new Date(r.dateStr).getTime() >= cutoff)
            .sort((a, b) => (a.dateStr < b.dateStr ? 1 : -1));

        return candidates[0] ?? null;
    } catch {
        return null;
    }
}

/**
 * @param {{ method?: string }} req
 * @param {{ statusCode: number, setHeader: (k: string, v: string) => void, status: (c: number) => any, json: (b: unknown) => unknown, end: (b?: unknown) => unknown }} res
 */
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    const target = (await findLatestViaDayProbes()) ?? (await findLatestViaDatasetListing());

    if (!target) {
        res.setHeader('Cache-Control', 'public, s-maxage=3600');
        res.status(404).json({
            error: 'Aucun jeu de données ARCEP disponible',
            lastTried: formatDate(new Date()),
        });
        return;
    }

    try {
        const resp = await fetch(target.url, { signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) {
            res.setHeader('Cache-Control', 'public, s-maxage=3600');
            res.status(404).json({
                error: `ARCEP data unavailable (HTTP ${resp.status})`,
                lastTried: target.dateStr,
            });
            return;
        }
        const data = await resp.json();
        res.setHeader('X-Data-Date', target.dateStr);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
        res.status(200).json(data);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.setHeader('Cache-Control', 'public, s-maxage=3600');
        res.status(404).json({ error: `Proxy error: ${message}`, lastTried: target.dateStr });
    }
}
