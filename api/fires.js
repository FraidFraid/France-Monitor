/**
 * api/fires.js — Vercel Serverless Function
 *
 * Proxy NASA FIRMS VIIRS pour contourner les restrictions CORS.
 *
 * Comportement :
 *  - Avec NASA_FIRMS_API_KEY : fetche 3 sources VIIRS (SNPP, NOAA-20, NOAA-21)
 *    via l'API "area" (bbox France) — même pattern que WorldMonitor.
 *  - Sans clé : fallback sur le CSV public SUOMI_VIIRS_C2_Europe, filtré côté
 *    serveur sur la bbox France avant renvoi (évite de transférer ~800 KB pour rien).
 *
 * Réponse : JSON { detections: ActiveFireRow[], sources: string[], fetchedAt: number }
 *
 * Cache Vercel : 1 h (FIRMS se met à jour toutes les ~3 h)
 *
 * Route : GET /api/fires
 */

import { filterRecentDetections } from './_lib/firms-window.js';

const FRANCE_BBOX   = '-6,41,10,52';      // west,south,east,north — France métropole + Corse
/** Fenêtre glissante, alignée sur celle du CSV public de repli. */
const WINDOW_HOURS  = 24;
const PUBLIC_CSV_URL =
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv';

/** Les 3 capteurs VIIRS disponibles sur NASA FIRMS */
const VIIRS_SOURCES = [
    { id: 'VIIRS_SNPP_NRT',   label: 'SNPP'    },
    { id: 'VIIRS_NOAA20_NRT', label: 'NOAA-20' },
    { id: 'VIIRS_NOAA21_NRT', label: 'NOAA-21' },
];

const FIRMS_API_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

// ─── CSV Parser ───────────────────────────────────────────────────────────────

/**
 * Parse un CSV FIRMS en tableau d'objets.
 * Les colonnes numériques connues sont castées en number.
 */
function parseCSV(csv) {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const numericCols = new Set(['latitude', 'longitude', 'bright_ti4', 'bright_ti5', 'scan', 'track', 'frp']);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',');
        if (vals.length !== headers.length) continue;

        const row = {};
        for (let j = 0; j < headers.length; j++) {
            const key = headers[j].trim();
            let val = vals[j].trim();

            if (numericCols.has(key)) {
                const n = parseFloat(val);
                val = isNaN(n) ? 0 : n;
            }

            // Normalise les lettres de confidence VIIRS ('l','n','h') en mots complets
            if (key === 'confidence') {
                if (val === 'l') val = 'low';
                else if (val === 'n') val = 'nominal';
                else if (val === 'h') val = 'high';
            }

            row[key] = val;
        }

        // ID déterministe
        const lat = typeof row.latitude === 'number' ? row.latitude : parseFloat(row.latitude || '0');
        const lon = typeof row.longitude === 'number' ? row.longitude : parseFloat(row.longitude || '0');
        row.id = `${lat.toFixed(4)}_${lon.toFixed(4)}_${row.acq_date}_${row.acq_time}`;

        rows.push(row);
    }
    return rows;
}

/** Filtre bbox France (métropole + Corse) */
function filterFrance(rows) {
    return rows.filter(r => {
        const lat = typeof r.latitude  === 'number' ? r.latitude  : parseFloat(r.latitude  || '0');
        const lon = typeof r.longitude === 'number' ? r.longitude : parseFloat(r.longitude || '0');
        return lon >= -5.5 && lon <= 10.0 && lat >= 41.0 && lat <= 51.5;
    });
}

// ─── Fetch avec clé API (3 sources) ──────────────────────────────────────────

async function fetchWithApiKey(apiKey) {
    const seen       = new Set();
    const detections = [];
    const okSources  = [];

    const results = await Promise.allSettled(
        VIIRS_SOURCES.map(async ({ id: sourceId, label }) => {
            // 2 jours, pas 1 : `/1` signifie « depuis minuit UTC », donc à
            // 11 h UTC on ne recevait que 11 h de données. Le surplus est
            // ramené à une vraie fenêtre de 24 h par filterRecentDetections.
            const url = `${FIRMS_API_BASE}/${apiKey}/${sourceId}/${FRANCE_BBOX}/2`;
            const res = await fetch(url, {
                signal: AbortSignal.timeout(14_000),
                headers: { 'User-Agent': 'FranceMonitor/1.0 (OSINT dashboard)' },
            });
            if (!res.ok) throw new Error(`FIRMS ${res.status} for ${sourceId}`);
            const csv = await res.text();
            return { label, rows: parseCSV(csv) };
        })
    );

    for (const result of results) {
        if (result.status === 'fulfilled') {
            const { label, rows } = result.value;
            okSources.push(label);
            for (const row of rows) {
                if (!seen.has(row.id)) {
                    seen.add(row.id);
                    // Ajoute le satellite source si absent
                    if (!row.satellite) row.satellite = label;
                    detections.push(row);
                }
            }
        } else {
            console.warn('[api/fires] Source failed:', result.reason?.message);
        }
    }

    // Ramène les 2 jours demandés à FIRMS sur une fenêtre glissante de 24 h,
    // identique à celle du repli public SUOMI_VIIRS_C2_Europe_24h.csv.
    return {
        detections: filterRecentDetections(detections, WINDOW_HOURS, Date.now()),
        sources: okSources,
    };
}

// ─── Fetch fallback (CSV public, pas de clé) ──────────────────────────────────

async function fetchPublicCsv() {
    const res = await fetch(PUBLIC_CSV_URL, {
        signal: AbortSignal.timeout(14_000),
        headers: { 'User-Agent': 'FranceMonitor/1.0 (OSINT dashboard)' },
    });
    if (!res.ok) throw new Error(`NASA FIRMS public CSV HTTP ${res.status}`);
    const csv = await res.text();
    const all = parseCSV(csv);
    return {
        detections: filterFrance(all),
        sources: ['SNPP (public CSV)'],
    };
}

// ─── Handler Vercel ───────────────────────────────────────────────────────────

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');

    if (req.method === 'OPTIONS') { res.status(204).end(); return; }

    try {
        const apiKey = process.env.NASA_FIRMS_API_KEY || process.env.FIRMS_API_KEY || '';

        const { detections, sources } = apiKey
            ? await fetchWithApiKey(apiKey)
            : await fetchPublicCsv();

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.status(200).json({
            detections,
            sources,
            fetchedAt: Date.now(),
            apiKeyUsed: Boolean(apiKey),
        });
    } catch (err) {
        console.error('[api/fires] Erreur upstream:', err?.message ?? err);
        res.status(502).json({ error: 'Proxy error', message: err?.message ?? 'unknown' });
    }
}
