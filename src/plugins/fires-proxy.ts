/**
 * fires-proxy.ts — Vite Plugin (dev)
 *
 * Intercepte /api/fires et reproduit le comportement de api/fires.js :
 *  - Avec NASA_FIRMS_API_KEY dans l'env : 3 sources VIIRS (SNPP, NOAA-20, NOAA-21)
 *  - Sans clé : fallback sur CSV public SUOMI_VIIRS_C2_Europe_24h, filtré France
 *
 * Réponse : JSON { detections, sources, fetchedAt, apiKeyUsed }
 */

import type { Plugin } from 'vite';

const FRANCE_BBOX    = '-6,41,10,52';   // west,south,east,north
const PUBLIC_CSV_URL =
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv';
const FIRMS_API_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

const VIIRS_SOURCES = [
    { id: 'VIIRS_SNPP_NRT',   label: 'SNPP'    },
    { id: 'VIIRS_NOAA20_NRT', label: 'NOAA-20' },
    { id: 'VIIRS_NOAA21_NRT', label: 'NOAA-21' },
] as const;

// ─── CSV Parser ───────────────────────────────────────────────────────────────

type FireRow = Record<string, string | number>;

function parseCSV(csv: string): FireRow[] {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const numericCols = new Set(['latitude', 'longitude', 'bright_ti4', 'bright_ti5', 'scan', 'track', 'frp']);
    const rows: FireRow[] = [];

    for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',');
        if (vals.length !== headers.length) continue;

        const row: FireRow = {};
        for (let j = 0; j < headers.length; j++) {
            const key = headers[j].trim();
            let val: string | number = vals[j].trim();

            if (numericCols.has(key)) {
                const n = parseFloat(val as string);
                val = isNaN(n) ? 0 : n;
            }

            if (key === 'confidence') {
                if (val === 'l') val = 'low';
                else if (val === 'n') val = 'nominal';
                else if (val === 'h') val = 'high';
            }

            row[key] = val;
        }

        const lat = typeof row.latitude  === 'number' ? row.latitude  : parseFloat(String(row.latitude  || '0'));
        const lon = typeof row.longitude === 'number' ? row.longitude : parseFloat(String(row.longitude || '0'));
        row.id = `${lat.toFixed(4)}_${lon.toFixed(4)}_${row.acq_date}_${row.acq_time}`;

        rows.push(row);
    }
    return rows;
}

function filterFrance(rows: FireRow[]): FireRow[] {
    return rows.filter(r => {
        const lat = typeof r.latitude  === 'number' ? r.latitude  : parseFloat(String(r.latitude  || '0'));
        const lon = typeof r.longitude === 'number' ? r.longitude : parseFloat(String(r.longitude || '0'));
        return lon >= -5.5 && lon <= 10.0 && lat >= 41.0 && lat <= 51.5;
    });
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchWithApiKey(apiKey: string): Promise<{ detections: FireRow[]; sources: string[] }> {
    const seen = new Set<string>();
    const detections: FireRow[] = [];
    const okSources: string[] = [];

    const results = await Promise.allSettled(
        VIIRS_SOURCES.map(async ({ id: sourceId, label }) => {
            const url = `${FIRMS_API_BASE}/${apiKey}/${sourceId}/${FRANCE_BBOX}/1`;
            const upstream = await fetch(url, {
                signal: AbortSignal.timeout(14_000),
                headers: { 'User-Agent': 'FranceMonitor/1.0 (dev)' },
            });
            if (!upstream.ok) throw new Error(`FIRMS ${upstream.status} for ${sourceId}`);
            return { label, rows: parseCSV(await upstream.text()) };
        })
    );

    for (const r of results) {
        if (r.status === 'fulfilled') {
            const { label, rows } = r.value;
            okSources.push(label);
            for (const row of rows) {
                if (!seen.has(row.id as string)) {
                    seen.add(row.id as string);
                    if (!row.satellite) row.satellite = label;
                    detections.push(row);
                }
            }
        } else {
            console.warn('[fires-proxy] Source failed:', (r.reason as Error)?.message);
        }
    }
    return { detections, sources: okSources };
}

async function fetchPublicCsv(): Promise<{ detections: FireRow[]; sources: string[] }> {
    const upstream = await fetch(PUBLIC_CSV_URL, {
        signal: AbortSignal.timeout(14_000),
        headers: { 'User-Agent': 'FranceMonitor/1.0 (dev)' },
    });
    if (!upstream.ok) throw new Error(`NASA FIRMS public CSV HTTP ${upstream.status}`);
    const rows = parseCSV(await upstream.text());
    return { detections: filterFrance(rows), sources: ['SNPP (public CSV)'] };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export function firesProxyPlugin(): Plugin {
    return {
        name: 'fires-proxy',
        configureServer(server) {
            server.middlewares.use('/api/fires', async (_req, res) => {
                try {
                    const apiKey =
                        process.env.NASA_FIRMS_API_KEY ||
                        process.env.FIRMS_API_KEY ||
                        '';

                    const { detections, sources } = apiKey
                        ? await fetchWithApiKey(apiKey)
                        : await fetchPublicCsv();

                    const payload = JSON.stringify({
                        detections,
                        sources,
                        fetchedAt: Date.now(),
                        apiKeyUsed: Boolean(apiKey),
                    });

                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.end(payload);
                } catch (err) {
                    console.error('[fires-proxy] Erreur:', err);
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ error: 'Proxy error' }));
                }
            });
        },
    };
}
