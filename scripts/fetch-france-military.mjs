#!/usr/bin/env node
/**
 * fetch-france-military.mjs
 *
 * Pipeline amélioré pour récupérer les installations militaires françaises depuis OSM :
 * 1. Overpass API : toutes les features military=* avec nom, France découpée en ~20 bbox
 * 2. Inclut military=yes SI le nom est pertinent (Batterie, Poste, Fort, etc.)
 * 3. Inclut bunkers SI nom significatif (pas les bunkers anonymes)
 * 4. Enrichissement automatique : descriptions FR, types affinés, tiers
 * 5. Dédup node vs way (même nom + <200m)
 * 6. Output → src/config/osm-france-military.json
 *
 * Pause 12s entre chaque requête pour respecter le rate-limit public Overpass.
 * Durée totale : ~5-6 minutes.
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'src', 'config', 'osm-france-military.json');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const PAUSE_MS = 12_000; // 12s entre requêtes
const TIMEOUT_MS = 120_000; // 120s par requête

// France découpée en ~20 tuiles de ~2.5° × 3° chacune
// Format: [sud, ouest, nord, est]
const TILES = [
    // ─── Ligne 1: Nord (49-51.2) ───
    { name: 'Nord-Bretagne', bbox: '47.5,-5.5,49.5,-1.0' },
    { name: 'Nord-Normandie', bbox: '47.5,-1.0,49.5,2.0' },
    { name: 'Nord-IDF', bbox: '47.5,2.0,49.5,4.5' },
    { name: 'Nord-ChampArd', bbox: '47.5,4.5,49.5,7.5' },
    { name: 'Hauts-de-France', bbox: '49.5,-1.0,51.2,4.5' },
    { name: 'Nord-Alsace', bbox: '47.5,7.5,49.5,8.5' },
    { name: 'Nord-Est', bbox: '49.5,4.5,51.2,8.5' },

    // ─── Ligne 2: Centre (45.5-47.5) ───
    { name: 'Centre-Ouest', bbox: '45.5,-5.5,47.5,-1.0' },
    { name: 'Centre-Loire', bbox: '45.5,-1.0,47.5,2.0' },
    { name: 'Centre-Bourgo', bbox: '45.5,2.0,47.5,4.5' },
    { name: 'Centre-RhAlp', bbox: '45.5,4.5,47.5,7.5' },
    { name: 'Centre-Jura', bbox: '45.5,7.5,47.5,8.5' },

    // ─── Ligne 3: Sud (41.3-45.5) ───
    { name: 'Sud-Aquitaine', bbox: '42.5,-2.0,45.5,1.0' },
    { name: 'Sud-Pyrenees', bbox: '42.5,1.0,45.5,3.5' },
    { name: 'Sud-Languedoc', bbox: '42.5,3.5,45.5,5.5' },
    { name: 'Sud-PACA', bbox: '42.5,5.5,45.5,8.0' },
    { name: 'Corse', bbox: '41.3,8.5,43.1,9.7' },

    // ─── DROM-COM ───
    { name: 'Antilles', bbox: '14.3,-61.9,18.3,-60.7' },
    { name: 'Guyane', bbox: '2.0,-55.0,6.0,-51.5' },
    { name: 'Reunion', bbox: '-21.5,55.2,-20.8,55.9' },
    { name: 'Mayotte', bbox: '-13.1,44.9,-12.5,45.4' },
];

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION ENRICHISSEMENT
// ═══════════════════════════════════════════════════════════════════════════

// Tier 1 : Bases majeures (zoom 3+)
const TIER1_KINDS = new Set([
    'base', 'airfield', 'naval_base', 'training_area', 'nuclear_explosion_site', 'launchpad',
]);

// Tier 2 : Installations secondaires (zoom 5+)
const TIER2_KINDS = new Set([
    'barracks', 'office', 'checkpoint', 'range', 'danger_area', 'ammunition',
]);

// Mapping kind → type interne
const TYPE_MAP = {
    airfield: 'air', air_base: 'air', aerodrome: 'air',
    naval_base: 'navy',
    barracks: 'army', training_area: 'army', range: 'army', ammunition: 'army',
    bunker: 'fortification', checkpoint: 'joint', base: 'joint',
    trench: 'fortification', shelter: 'fortification', office: 'joint',
    danger_area: 'joint', nuclear_explosion_site: 'joint', launchpad: 'joint',
    obstacle_course: 'army', yes: 'other',
};

// Descriptions en français par kind
const KIND_DESCRIPTIONS = {
    airfield: 'Base aérienne',
    air_base: 'Base aérienne',
    aerodrome: 'Aérodrome militaire',
    naval_base: 'Base navale',
    barracks: 'Caserne / Garnison',
    base: 'Base militaire',
    training_area: "Zone d'entraînement",
    range: 'Polygone de tir',
    checkpoint: 'Poste de contrôle / Entrée',
    bunker: 'Bunker / Fortification',
    ammunition: 'Dépôt de munitions',
    storage: 'Entrepôt militaire',
    danger_area: 'Zone de danger / Tir',
    nuclear_explosion_site: 'Site nucléaire',
    launchpad: 'Site de lancement',
    office: 'État-major / Bureau militaire',
    obstacle_course: "Parcours d'obstacles",
    trench: 'Tranchée / Fortification',
    shelter: 'Abri fortifié',
    yes: 'Installation militaire',
};

// Mots-clés pour détecter les sous-types à partir du nom
const NAME_ENRICHMENT = [
    // Unités Marine
    { pattern: /flottille/i, subtype: 'aeronavale', description: 'Flottille aéronavale' },
    { pattern: /escadrille/i, subtype: 'aeronavale', description: 'Escadrille aéronavale' },
    { pattern: /fusiliers?[\s-]?marins?/i, subtype: 'marine', description: 'Fusiliers marins' },
    { pattern: /préfecture maritime/i, subtype: 'commandement', description: 'Préfecture maritime', tier: 1 },
    { pattern: /centre (roland )?morillot/i, subtype: 'snle', description: 'Centre de formation SNLE', tier: 1 },

    // Fortifications côtières (historiques mais pertinentes)
    { pattern: /batterie/i, subtype: 'fortification', description: 'Batterie côtière' },
    { pattern: /poste (de |intérieur|extérieur)/i, subtype: 'fortification', description: 'Poste fortifié' },
    { pattern: /torpille/i, subtype: 'fortification', description: 'Installation torpilles', tier: 2 },
    { pattern: /casemate/i, subtype: 'fortification', description: 'Casemate' },
    { pattern: /blockhaus/i, subtype: 'fortification', description: 'Blockhaus' },
    { pattern: /fort (de |du |d\')/i, subtype: 'fortification', description: 'Fort', tier: 2 },
    { pattern: /citadelle/i, subtype: 'fortification', description: 'Citadelle', tier: 1 },

    // Zones de tir / danger
    { pattern: /zone de tir/i, subtype: 'danger', description: 'Zone de tir active', tier: 2 },
    { pattern: /champ de tir/i, subtype: 'danger', description: 'Champ de tir', tier: 2 },
    { pattern: /stand de tir/i, subtype: 'range', description: 'Stand de tir' },

    // Commandements
    { pattern: /état[\s-]?major/i, subtype: 'commandement', description: 'État-major', tier: 1 },
    { pattern: /commandement/i, subtype: 'commandement', description: 'Commandement', tier: 1 },
    { pattern: /quartier général/i, subtype: 'commandement', description: 'Quartier général', tier: 1 },

    // Régiments / Unités
    { pattern: /\d+e?\s*(régiment|ri|rima|rpima|rcp|rch|ra|rg)/i, subtype: 'regiment', description: 'Régiment' },
    { pattern: /légion étrangère/i, subtype: 'legion', description: 'Légion étrangère', tier: 1 },
    { pattern: /gendarmerie/i, subtype: 'gendarmerie', description: 'Gendarmerie' },

    // Écoles
    { pattern: /école/i, subtype: 'ecole', description: 'École militaire', tier: 2 },
    { pattern: /centre (de |d\')?formation/i, subtype: 'ecole', description: 'Centre de formation', tier: 2 },
    { pattern: /centre (de |d\')?recrutement/i, subtype: 'recrutement', description: 'Centre de recrutement' },

    // DGA / Essais
    { pattern: /dga/i, subtype: 'dga', description: 'DGA - Direction Générale de l\'Armement', tier: 1 },
    { pattern: /essais?/i, subtype: 'essais', description: 'Centre d\'essais' },

    // Camps
    { pattern: /camp (de |du |militaire)/i, subtype: 'camp', description: 'Camp militaire', tier: 2 },
    { pattern: /caserne/i, subtype: 'caserne', description: 'Caserne' },

    // Abris / Mémoriaux
    { pattern: /abri/i, subtype: 'abri', description: 'Abri' },
    { pattern: /mémorial/i, subtype: 'memorial', description: 'Mémorial militaire' },
];

// Noms à exclure (trop génériques ou non pertinents)
const EXCLUDE_NAMES = new Set([
    'bunker', 'blockhaus', 'casemate', 'tobrouk', 'abri',
    'r622', 'r626', 'r633', 'fl298', 'fl304', 'fl307', // Codes bunkers WW2
    'h601', 'b331', 'b332', 'm152', 'm157', // Codes bunkers
]);

// Noms pertinents pour military=yes (sinon on skip)
const RELEVANT_YES_PATTERNS = [
    /batterie/i, /poste/i, /torpille/i, /fort\b/i, /citadelle/i,
    /caserne/i, /camp/i, /base/i, /centre/i, /école/i,
    /régiment/i, /escadrille/i, /flottille/i, /légion/i,
    /préfecture/i, /commandement/i, /état-major/i,
    /zone de tir/i, /champ de tir/i,
];

// ═══════════════════════════════════════════════════════════════════════════
// FONCTIONS UTILITAIRES
// ═══════════════════════════════════════════════════════════════════════════

const EARTH_R = 6_371_000;
function haversineM(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeText(s) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH OVERPASS
// ═══════════════════════════════════════════════════════════════════════════

async function fetchTile(name, bbox, retries = 2) {
    // Overpass: nodes + ways avec military=* ET un nom
    const query = `[out:json][timeout:90];
(
  node["military"]["name"](${bbox});
  way["military"]["name"](${bbox});
);
out center tags;`.trim();

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`  [${attempt}/${retries}] ${name} ...`);
            const res = await fetch(OVERPASS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `data=${encodeURIComponent(query)}`,
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });

            if (res.status === 429) {
                console.warn(`  ${name}: rate-limited (429), waiting 30s...`);
                await sleep(30_000);
                continue;
            }
            if (res.status === 504) {
                console.warn(`  ${name}: gateway timeout (504), waiting 20s and retrying...`);
                await sleep(20_000);
                continue;
            }
            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                throw new Error(`HTTP ${res.status}: ${txt.slice(0, 100)}`);
            }

            const json = await res.json();
            const elements = json.elements || [];
            console.log(`  ${name}: ${elements.length} elements ✓`);
            return elements;
        } catch (err) {
            if (attempt === retries) {
                console.warn(`  ${name}: FAILED after ${retries} attempts — ${err.message}`);
                return [];
            }
            console.warn(`  ${name}: attempt ${attempt} failed — ${err.message}, retrying...`);
            await sleep(10_000);
        }
    }
    return [];
}

// ═══════════════════════════════════════════════════════════════════════════
// PROCESSING & ENRICHISSEMENT
// ═══════════════════════════════════════════════════════════════════════════

function shouldInclude(kind, name) {
    const nameLower = normalizeText(name);

    // Exclure les noms trop génériques
    if (EXCLUDE_NAMES.has(nameLower)) return false;

    // Exclure les codes bunkers WW2 (R622, Fl298, etc.)
    if (/^[a-z]?\d{2,4}[a-z]?$/i.test(nameLower)) return false;

    // military=yes : n'inclure que si le nom est pertinent
    if (kind === 'yes') {
        return RELEVANT_YES_PATTERNS.some(p => p.test(name));
    }

    // bunker/trench/shelter : n'inclure que si le nom est significatif
    if (['bunker', 'trench', 'shelter'].includes(kind)) {
        // Garder les batteries, postes, forts, casemates nommées, abris historiques
        return RELEVANT_YES_PATTERNS.some(p => p.test(name)) || name.length > 20;
    }

    // Autres kinds : toujours inclure s'il y a un nom
    return true;
}

function enrichFeature(kind, name, operator) {
    let description = KIND_DESCRIPTIONS[kind] || 'Installation militaire';
    let subtype = undefined;
    let tierOverride = undefined;

    // Chercher enrichissement basé sur le nom
    for (const rule of NAME_ENRICHMENT) {
        if (rule.pattern.test(name)) {
            description = rule.description;
            subtype = rule.subtype;
            if (rule.tier) tierOverride = rule.tier;
            break;
        }
    }

    // Ajouter l'opérateur à la description si disponible
    if (operator && !description.includes(operator)) {
        description = `${description} — ${operator}`;
    }

    return { description, subtype, tierOverride };
}

function processElement(el) {
    const tags = el.tags || {};
    const kind = tags.military || '';
    if (!kind) return null;

    const lat = el.lat ?? el.center?.lat ?? null;
    const lon = el.lon ?? el.center?.lon ?? null;
    if (lat == null || lon == null) return null;

    const name = tags['name:fr'] || tags.name || tags['name:en'] || '';
    if (!name) return null;

    // Vérifier si on doit inclure cette feature
    if (!shouldInclude(kind, name)) return null;

    const osmId = `${el.type}/${el.id}`;
    const operator = tags.operator || '';

    // Enrichir la feature
    const { description, subtype, tierOverride } = enrichFeature(kind, name, operator);

    // Calculer le tier
    let tier;
    if (tierOverride) {
        tier = tierOverride;
    } else if (TIER1_KINDS.has(kind)) {
        tier = 1;
    } else if (TIER2_KINDS.has(kind)) {
        tier = 2;
    } else {
        tier = 3;
    }

    // Déterminer le type
    const type = TYPE_MAP[kind] || 'other';

    return {
        id: osmId,
        name,
        lat: Math.round(lat * 100000) / 100000,
        lon: Math.round(lon * 100000) / 100000,
        kind,
        type,
        tier,
        operator: operator || undefined,
        description,
        subtype,
        branch: tags.military_branch || undefined,
        osmElementType: el.type, // node/way for dedup
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// DÉDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════

function dedup(features) {
    // Priorité aux ways (zones) sur les nodes (points)
    const areas = features.filter(f => f.osmElementType !== 'node');
    const nodes = features.filter(f => f.osmElementType === 'node');
    const kept = [...areas];
    let dropped = 0;

    for (const node of nodes) {
        const isDupe = kept.some(other => {
            const dist = haversineM(node.lat, node.lon, other.lat, other.lon);
            // Dupe si même nom ET <200m
            return dist <= 200 && normalizeText(node.name) === normalizeText(other.name);
        });
        if (isDupe) dropped++;
        else kept.push(node);
    }

    // Dédup par coordonnées exactes
    const final = [];
    const coordSet = new Set();
    for (const f of kept) {
        const key = `${f.lat},${f.lon}`;
        if (coordSet.has(key)) { dropped++; continue; }
        coordSet.add(key);
        final.push(f);
    }

    console.log(`  Dedup: ${dropped} duplicates removed → ${final.length} unique`);
    return final;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  fetch-france-military.mjs — OSM Military Features (v2.0)    ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`Output: ${OUTPUT_PATH}\n`);

    const allProcessed = [];

    for (let i = 0; i < TILES.length; i++) {
        const tile = TILES[i];
        const elements = await fetchTile(tile.name, tile.bbox);
        for (const el of elements) {
            const p = processElement(el);
            if (p) allProcessed.push(p);
        }

        // Pause between tiles (except last)
        if (i < TILES.length - 1) {
            console.log(`  ⏳ Pause ${PAUSE_MS / 1000}s ...`);
            await sleep(PAUSE_MS);
        }
    }

    console.log(`\nTotal processed: ${allProcessed.length}`);
    const final = dedup(allProcessed);

    // Nettoyer les champs internes
    const output = final.map(({ osmElementType, ...rest }) => rest);

    // Stats
    const tierCounts = { 1: 0, 2: 0, 3: 0 };
    const kindCounts = {};
    const typeCounts = {};
    const subtypeCounts = {};

    for (const f of output) {
        tierCounts[f.tier] = (tierCounts[f.tier] || 0) + 1;
        kindCounts[f.kind] = (kindCounts[f.kind] || 0) + 1;
        typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
        if (f.subtype) subtypeCounts[f.subtype] = (subtypeCounts[f.subtype] || 0) + 1;
    }

    console.log('\n═══ STATISTIQUES ═══');
    console.log('\nTier distribution:');
    console.log(`  Tier 1 (zoom 3+):  ${tierCounts[1] || 0}`);
    console.log(`  Tier 2 (zoom 5+):  ${tierCounts[2] || 0}`);
    console.log(`  Tier 3 (zoom 8+):  ${tierCounts[3] || 0}`);

    console.log('\nPar type interne:');
    for (const [k, c] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k}: ${c}`);
    }

    console.log('\nPar kind OSM (top 15):');
    for (const [k, c] of Object.entries(kindCounts).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        console.log(`  ${k}: ${c}`);
    }

    if (Object.keys(subtypeCounts).length > 0) {
        console.log('\nPar subtype enrichi:');
        for (const [k, c] of Object.entries(subtypeCounts).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${k}: ${c}`);
        }
    }

    // Écrire le fichier JSON (formaté pour lisibilité)
    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    const sizeKB = (Buffer.byteLength(JSON.stringify(output)) / 1024).toFixed(0);

    console.log(`\n✅ Output: ${OUTPUT_PATH}`);
    console.log(`   ${output.length} entries, ~${sizeKB} KB`);
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
