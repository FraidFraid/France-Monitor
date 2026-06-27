/**
 * vigicrues.ts — Service Vigicrues (vigilance crues).
 * API publique : https://www.vigicrues.gouv.fr/services/1/
 * Retourne les tronçons en vigilance, en réutilisant directement
 * la géométrie GeoJSON fournie par Vigicrues.
 */

import type { FloodSegment, FloodVigilanceLevel } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';

// ── Watchdog registration ──
Watchdog.register('vigicrues', {
    label: 'Vigicrues',
    staleAfterMs: 15 * 60_000,
    detail: 'vigicrues.gouv.fr · GeoJSON public',
});

const LEVEL_MAP: Record<number, FloodVigilanceLevel> = {
    1: 'green', 2: 'yellow', 3: 'orange', 4: 'red',
};

let cache: { data: FloodSegment[]; fetchedAt: number } | null = null;
const CACHE_TTL = 15 * 60_000; // 15 min

function parseVigicruesGeoJson(
    geojson: GeoJSON.FeatureCollection,
    dataSource: FloodSegment['dataSource'],
): FloodSegment[] {
    const segments: FloodSegment[] = [];

    for (const feat of geojson.features) {
        const props = feat.properties ?? {};
        const niveau = Number(props.NivInfViCr ?? props.NivSituVigiCruEnt ?? props.NivSituVigiCruEntCdworst ?? 1);

        if (niveau < 2) continue;

        const name = String(props.lbentcru ?? props.LbEntViworst ?? props.NomEntViworst ?? props.NomEntVigiCru ?? 'Tronçon');
        const id = String(props.CdEntCru ?? props.CdEntVigiCru ?? props.id ?? `vc-${segments.length}`);

        if (feat.geometry && (feat.geometry.type === 'LineString' || feat.geometry.type === 'MultiLineString')) {
            const vertexCount = feat.geometry.type === 'LineString'
                ? feat.geometry.coordinates.length
                : feat.geometry.coordinates.flat().length;

            segments.push({
                id,
                name,
                level: LEVEL_MAP[niveau] ?? 'yellow',
                dataSource,
                geometryFidelity: 'matched',
                matchConfidence: 1,
                rawVertexCount: vertexCount,
                displayVertexCount: vertexCount,
                geometry: feat.geometry as FloodSegment['geometry'],
                rawGeometry: feat.geometry as FloodSegment['geometry'],
                displayGeometry: feat.geometry as FloodSegment['geometry'],
            });
        }
    }

    return segments;
}

/**
 * Fetch les tronçons Vigicrues en vigilance.
 * Retourne uniquement les tronçons jaune+ avec leur géométrie brute.
 */
export async function fetchVigicrues(): Promise<FloodSegment[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.data;

    Watchdog.report('vigicrues', { type: 'loading' });
    const t0 = Date.now();

    try {
        // API Vigicrues — vigilance en cours (GeoJSON). L'API ne renvoie pas de
        // header CORS → on passe par /api/json-proxy (serveur) au lieu d'un fetch
        // navigateur direct, qui échoue en prod (« Failed to fetch »).
        const target = 'https://www.vigicrues.gouv.fr/services/InfoVigiCru.geojson';
        const url = `/api/json-proxy?url=${encodeURIComponent(target)}`;
        const resp = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const geojson = await resp.json() as GeoJSON.FeatureCollection;
        const segments = parseVigicruesGeoJson(geojson, 'live');

        cache = { data: segments, fetchedAt: Date.now() };
        Watchdog.report('vigicrues', { type: 'success', responseTimeMs: Date.now() - t0 });

        const avgVertices = segments.length > 0
            ? (segments.reduce((sum, segment) => sum + segment.displayVertexCount, 0) / segments.length).toFixed(1)
            : '0.0';
        console.log(`[Vigicrues] ${segments.length} tronçons live bruts (avgVertices=${avgVertices})`);
        return segments;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[Vigicrues] Fetch failed:', err);
        if (cache) {
            console.warn('[Vigicrues] Returning stale cached data');
            Watchdog.report('vigicrues', { type: 'failure', error: msg, isFallback: true });
            return cache.data;
        }
        Watchdog.report('vigicrues', { type: 'failure', error: msg });
        throw err;
    }
}
