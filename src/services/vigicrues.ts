/**
 * vigicrues.ts — Service Vigicrues (vigilance crues).
 * API publique : https://www.vigicrues.gouv.fr/services/1/
 * Retourne les tronçons en vigilance, avec géométrie simplifiée.
 */

import type { FloodSegment, FloodVigilanceLevel } from '../types/index.ts';

const LEVEL_MAP: Record<number, FloodVigilanceLevel> = {
    1: 'green', 2: 'yellow', 3: 'orange', 4: 'red',
};

let cache: { data: FloodSegment[]; fetchedAt: number } | null = null;
const CACHE_TTL = 15 * 60_000; // 15 min

/**
 * Fetch les tronçons Vigicrues en vigilance.
 * Retourne uniquement les tronçons jaune+ avec leur géométrie.
 */
export async function fetchVigicrues(): Promise<FloodSegment[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.data;

    try {
        // API Vigicrues — vigilance en cours (GeoJSON)
        const url = 'https://www.vigicrues.gouv.fr/services/InfoVigiCru.geojson';
        const resp = await fetch(url, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const geojson = await resp.json() as GeoJSON.FeatureCollection;
        const segments: FloodSegment[] = [];

        for (const feat of geojson.features) {
            const props = feat.properties ?? {};
            const niveau = Number(props.NivInfViCr ?? props.NivSituVigiCruEnt ?? props.NivSituVigiCruEntCdworst ?? 1);

            // Only keep yellow+ (2+)
            if (niveau < 2) continue;

            const name = String(props.lbentcru ?? props.LbEntViworst ?? props.NomEntViworst ?? props.NomEntVigiCru ?? 'Tronçon');
            const id = String(props.CdEntCru ?? props.CdEntVigiCru ?? props.id ?? `vc-${segments.length}`);

            // Simplify geometry
            if (feat.geometry && (feat.geometry.type === 'LineString' || feat.geometry.type === 'MultiLineString')) {
                segments.push({
                    id,
                    name,
                    level: LEVEL_MAP[niveau] ?? 'yellow',
                    geometry: feat.geometry as FloodSegment['geometry'],
                });
            }
        }

        cache = { data: segments, fetchedAt: Date.now() };
        console.log(`[Vigicrues] ${segments.length} tronçons en vigilance`);
        return segments;
    } catch (err) {
        console.warn('[Vigicrues] Fetch failed:', err);
        return cache?.data ?? [];
    }
}
