/**
 * military-osm.ts — Gestion des installations militaires depuis OpenStreetMap
 *
 * Deux modes :
 *  1. STATIQUE (recommandé) : Charge osm-france-military.json (pré-généré par scripts/fetch-france-military.mjs)
 *  2. DYNAMIQUE : Fetch Overpass API en live (lent, pour refresh)
 *
 * Le fichier JSON pré-généré contient des features enrichies avec descriptions FR et sous-types.
 *
 * Merge avec DB statique (military-bases-db.ts) : rayon de déduplication 300m pour garder les sub-installations.
 */

import type { MilitaryBase } from '../types/index.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OsmMilitaryFeature {
    id: string;
    name: string;
    type: 'air' | 'navy' | 'army' | 'joint' | 'fortification' | 'other';
    kind: string;      // raw OSM tag: barracks, bunker, airfield, yes …
    coordinates: [number, number]; // [lon, lat]
    description: string;
    operator?: string;
    subtype?: string;  // enrichi: aeronavale, fortification, commandement, etc.
    tier?: number;     // 1=majeur, 2=secondaire, 3=détail
}

// ─── Mapping OSM tag → type interne ──────────────────────────────────────────

const TAG_TO_TYPE: Record<string, OsmMilitaryFeature['type']> = {
    airfield: 'air', air_base: 'air', airstrip: 'air', aerodrome: 'air',
    naval_base: 'navy',
    barracks: 'army', training_area: 'army', range: 'army',
    ammunition: 'army', storage: 'army', obstacle_course: 'army',
    bunker: 'fortification', trench: 'fortification', shelter: 'fortification',
    checkpoint: 'joint', base: 'joint',
    nuclear_explosion_site: 'joint', launchpad: 'joint',
    danger_area: 'joint', hazard: 'joint', office: 'joint',
    yes: 'other',
};

const TAG_LABELS: Record<string, string> = {
    airfield: "Terrain d'aviation militaire",
    air_base: 'Base aérienne',
    aerodrome: 'Aérodrome militaire',
    naval_base: 'Base navale',
    barracks: 'Caserne / Garnison',
    base: 'Base militaire',
    training_area: "Zone d'entraînement",
    range: 'Polygone de tir',
    checkpoint: 'Poste de contrôle',
    bunker: 'Bunker / Abri fortifié',
    ammunition: 'Dépôt de munitions',
    storage: 'Entrepôt militaire',
    danger_area: 'Zone de danger',
    nuclear_explosion_site: 'Site nucléaire',
    launchpad: 'Site de lancement',
    office: 'Bureau militaire',
    obstacle_course: "Parcours d'obstacles",
    trench: 'Tranchée / Fortification',
    hazard: 'Zone de danger',
    yes: 'Installation militaire',
};

// ─── Cache ────────────────────────────────────────────────────────────────────

let cache: OsmMilitaryFeature[] | null = null;
let cacheTs = 0;
const CACHE_TTL = 6 * 3600 * 1000; // 6h

// ─── Chargement du fichier JSON statique (pré-généré) ─────────────────────────

/**
 * Charge les features OSM depuis le fichier JSON pré-généré par scripts/fetch-france-military.mjs.
 * C'est la méthode recommandée (instantanée vs ~6min pour Overpass live).
 */
export async function loadStaticOsmFeatures(): Promise<OsmMilitaryFeature[]> {
    if (cache && Date.now() - cacheTs < CACHE_TTL) return cache;

    try {
        // Import dynamique du fichier JSON
        const data = await import('../config/osm-france-military.json');
        const features: OsmMilitaryFeature[] = (data.default || data).map((f: {
            id: string;
            name: string;
            lat: number;
            lon: number;
            kind: string;
            type: string;
            tier?: number;
            operator?: string;
            description?: string;
            subtype?: string;
        }) => ({
            id: f.id,
            name: f.name,
            type: (f.type || 'other') as OsmMilitaryFeature['type'],
            kind: f.kind,
            coordinates: [f.lon, f.lat] as [number, number],
            description: f.description || TAG_LABELS[f.kind] || 'Installation militaire',
            operator: f.operator,
            subtype: f.subtype,
            tier: f.tier,
        }));

        console.log(`[Military OSM] Chargé ${features.length} features depuis JSON statique`);
        cache = features;
        cacheTs = Date.now();
        return features;
    } catch (err) {
        console.warn('[Military OSM] Impossible de charger le JSON statique, fallback sur cache vide:', err);
        return [];
    }
}

// ─── Bounding boxes France par région ─────────────────────────────────────────
// Découpage en 9 régions pour rester sous le timeout Overpass (60s par bbox)
// Format: [sud, ouest, nord, est] = [minLat, minLon, maxLat, maxLon]

const FRANCE_REGIONS: Array<{ name: string; bbox: string }> = [
    // Métropole - 9 tuiles
    { name: 'Nord', bbox: '49.0,-5.0,51.5,3.5' }, // Bretagne + Nord + Normandie
    { name: 'NordEst', bbox: '47.5,3.5,51.5,10.0' }, // Grand Est + HdF
    { name: 'OuestAtlant', bbox: '45.5,-5.0,49.0,0.0' }, // Loire + Vendée + Charentes
    { name: 'CentreOuest', bbox: '45.5,0.0,49.0,4.0' }, // Île-de-France + Centre + Bourgogne
    { name: 'CentreEst', bbox: '45.5,4.0,49.0,8.0' }, // Auvergne + Rhône-Alpes nord
    { name: 'Est', bbox: '45.5,6.0,49.0,10.0' }, // Alpes + Jura + Vosges
    { name: 'SudOuest', bbox: '41.3,-5.0,45.5,2.0' }, // Pyrénées + Gascogne + Languedoc W
    { name: 'SudEst', bbox: '41.3,2.0,45.5,10.0' }, // PACA + Languedoc E + Corse
    // DROM
    { name: 'Antilles', bbox: '14.3,-61.5,18.3,-60.7' },
    { name: 'Guyane', bbox: '2.0,-55.0,6.0,-51.5' },
    { name: 'Reunion', bbox: '-21.5,55.2,-20.8,55.9' },
    { name: 'Mayotte', bbox: '-13.1,44.9,-12.5,45.4' },
];

// ─── Overpass query builder ──────────────────────────────────────────────────

function buildQuery(bbox: string): string {
    // Nodes + ways seulement (relations = très lentes)
    return `[out:json][timeout:60];
(
  node["military"](${bbox});
  way["military"](${bbox});
);
out center tags;`.trim();
}

// ─── Fetch une région ─────────────────────────────────────────────────────────

async function fetchRegion(name: string, bbox: string): Promise<OsmMilitaryFeature[]> {
    const q = buildQuery(bbox);
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`;

    const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(75_000), // 75s (> 60s server-side timeout)
    });
    if (!res.ok) throw new Error(`Overpass ${res.status} for ${name}`);

    const data = await res.json() as {
        elements: Array<{
            type: 'node' | 'way';
            id: number;
            lat?: number;
            lon?: number;
            center?: { lat: number; lon: number };
            tags?: Record<string, string>;
        }>;
    };

    const out: OsmMilitaryFeature[] = [];
    for (const el of data.elements) {
        const tags = el.tags ?? {};
        const militaryTag = tags['military'] ?? '';
        if (!militaryTag) continue;

        // Coordonnées
        let lat: number | undefined;
        let lon: number | undefined;
        if (el.type === 'node') { lat = el.lat; lon = el.lon; }
        else if (el.center) { lat = el.center.lat; lon = el.center.lon; }
        if (lat == null || lon == null) continue;

        // Skip features entièrement sans nom ET tag générique
        const name_ = tags['name'] || tags['name:fr'] || tags['official_name'] || '';
        if (!name_ && ['base', 'yes'].includes(militaryTag)) continue;
        // Skip bunkers anonymes (garder ceux avec nom)
        if (['bunker', 'trench', 'shelter'].includes(militaryTag) && !name_) continue;

        const label = TAG_LABELS[militaryTag] ?? `Site militaire (${militaryTag})`;
        const displayName = name_ || label;
        const type = TAG_TO_TYPE[militaryTag] ?? 'other';

        out.push({
            id: `osm-${el.type}-${el.id}`,
            name: displayName,
            type,
            kind: militaryTag,
            coordinates: [lon, lat],
            description: label + (tags['operator'] ? ` — ${tags['operator']}` : ''),
            operator: tags['operator'] ?? undefined,
        });
    }
    return out;
}

// ─── Déduplique les features OSM entre elles (rayon 100m ≈ 0.001°) ───────────

function deduplicateOsm(features: OsmMilitaryFeature[]): OsmMilitaryFeature[] {
    const GRID = 0.001; // ~110m
    const seen = new Set<string>();
    return features.filter((f) => {
        const k = `${Math.round(f.coordinates[1] / GRID)},${Math.round(f.coordinates[0] / GRID)}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch toutes les features militaires OSM en France (métro + DROM).
 * Résultats mis en cache 6h.
 */
export async function fetchOsmMilitaryFeatures(): Promise<OsmMilitaryFeature[]> {
    if (cache && Date.now() - cacheTs < CACHE_TTL) return cache;

    console.log(`[Military OSM] Démarrage fetch Overpass (${FRANCE_REGIONS.length} régions)…`);

    const allRaw: OsmMilitaryFeature[] = [];

    // Fetch séquentiel pour éviter de surcharger Overpass (rate-limit public)
    for (const region of FRANCE_REGIONS) {
        try {
            const feats = await fetchRegion(region.name, region.bbox);
            allRaw.push(...feats);
            console.log(`[Military OSM] ${region.name}: ${feats.length} features`);
        } catch (err) {
            console.warn(`[Military OSM] ${region.name}: ERREUR`, err);
        }
        // Petite pause pour respecter la politesse Overpass (public instance)
        await new Promise((r) => setTimeout(r, 500));
    }

    const deduped = deduplicateOsm(allRaw);
    console.log(`[Military OSM] Total après dédup: ${deduped.length} features (brut: ${allRaw.length})`);

    cache = deduped;
    cacheTs = Date.now();
    return deduped;
}

/**
 * Fusionne les features OSM avec la DB statique.
 *
 * La DB statique a priorité. Les features OSM trop proches d'une base statique
 * (rayon 300m ≈ 0.003°) sont exclues pour éviter les doublons exacts.
 * Les sub-installations à l'intérieur d'une grande base sont CONSERVÉES
 * (le rayon est petit exprès).
 */
export function mergeWithStaticDb(
    osmFeatures: OsmMilitaryFeature[],
    staticBases: MilitaryBase[],
): MilitaryBase[] {
    // Grille de 0.003° ≈ 330m pour exclure les vraies dupes seulement
    const DEDUP_GRID = 0.003;
    const staticKeys = new Set<string>(
        staticBases.map((b) => `${Math.round(b.coordinates[1] / DEDUP_GRID)},${Math.round(b.coordinates[0] / DEDUP_GRID)}`),
    );

    const newFromOsm: MilitaryBase[] = [];
    for (const osm of osmFeatures) {
        const k = `${Math.round(osm.coordinates[1] / DEDUP_GRID)},${Math.round(osm.coordinates[0] / DEDUP_GRID)}`;
        if (staticKeys.has(k)) continue;
        newFromOsm.push({
            id: osm.id,
            name: osm.name,
            type: osm.type,
            coordinates: osm.coordinates,
            description: osm.description,
            subtype: osm.subtype,
            tier: osm.tier,
        });
    }

    console.log(`[Military OSM] Merge: ${staticBases.length} static + ${newFromOsm.length} OSM = total ${staticBases.length + newFromOsm.length}`);
    return [...staticBases, ...newFromOsm];
}
