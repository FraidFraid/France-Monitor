/**
 * api/arcep.js — Vercel Serverless Function
 *
 * Proxy vers les données ARCEP "sites indisponibles" (data.gouv.fr).
 * Évite les erreurs CORS côté client.
 *
 * Route  : GET /api/arcep?date=YYYY-MM-DD
 * Cache  : 1h (données publiées 1x/jour par ARCEP)
 * Fallback : si la date demandée est absente, essaie J-1 automatiquement.
 */

const ARCEP_BASE = 'https://object.files.data.gouv.fr/arcep/sites-indisponibles/all';

function formatDate(date) {
    const yyyy = date.getFullYear();
    const mm   = String(date.getMonth() + 1).padStart(2, '0');
    const dd   = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function arcepUrl(dateStr) {
    return `${ARCEP_BASE}/${dateStr}/raw${dateStr}.geojson`;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    // Lire le paramètre ?date= ou utiliser la date du jour
    const { date } = req.query ?? {};
    const today     = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const primaryDate  = (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))
        ? date
        : formatDate(today);
    const fallbackDate = primaryDate === formatDate(today) ? formatDate(yesterday) : null;

    // Tentative sur la date principale
    try {
        const resp = await fetch(arcepUrl(primaryDate), {
            signal: AbortSignal.timeout(10_000),
        });

        if (resp.ok) {
            const data = await resp.json();
            res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
            res.setHeader('Content-Type', 'application/json');
            return res.status(200).json(data);
        }

        // Si 404 (fichier pas encore publié), tenter J-1
        if (resp.status === 404 && fallbackDate) {
            const fallback = await fetch(arcepUrl(fallbackDate), {
                signal: AbortSignal.timeout(10_000),
            });

            if (fallback.ok) {
                const data = await fallback.json();
                res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
                res.setHeader('Content-Type', 'application/json');
                return res.status(200).json(data);
            }

            return res.status(fallback.status).json({
                error: `ARCEP data unavailable for ${primaryDate} and ${fallbackDate}`,
            });
        }

        return res.status(resp.status).json({ error: `ARCEP fetch failed (HTTP ${resp.status})` });

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return res.status(502).json({ error: `Proxy error: ${message}` });
    }
}
