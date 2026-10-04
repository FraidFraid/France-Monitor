#!/usr/bin/env node
// scripts/fetch-france-military.mjs : ouvrages de défense nommés d'OpenStreetMap vers public/data/defense-osm-works.json (spec
// 2026-10-04 souveraineté § 2.1, V2, V5 ; contrats, arbitrage 10). Option de la couche Défense, masquée par défaut : une seule
// requête Overpass sur la métropole (User-Agent FranceMonitor, api/_lib/source-http.js), seuls les points situés dans un département
// métropolitain sont gardés (288 points hors de France dans l'ancien fichier), fichier daté (génération et base OSM) avec sa licence
// ODbL 1.0. Remplace l'ancien découpage en 21 tuiles vers src/config/osm-france-military.json (Overpass appelé aussi depuis le
// navigateur, retiré à la tâche A17). Usage : node scripts/fetch-france-military.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { departementAt } from '../api/_lib/geo-fr.js';
import { cleanText, fetchStrictJson } from '../api/_lib/source-http.js';
import { OSM_SOURCE, OVERPASS_URL } from '../api/_lib/subsea-cables.js';

export const DEFENSE_OVERPASS_QUERY = '[out:json][timeout:180];('
  + 'node["military"]["name"](41,-5.5,51.5,10);'
  + 'way["military"]["name"](41,-5.5,51.5,10);'
  + ');out center tags;';
export const OUTPUT_PATH = new URL('../public/data/defense-osm-works.json', import.meta.url);
const OVERPASS_TIMEOUT_MS = 200_000;
/** Même nom à moins de 200 m : un seul ouvrage (le chemin l'emporte sur le point). */
const DEDUP_M = 200;

/** Type interne (MilitaryBase['type']) d'un tag `military`. */
const TYPE_MAP = {
  airfield: 'air', air_base: 'air', aerodrome: 'air', naval_base: 'navy',
  barracks: 'army', training_area: 'army', range: 'army', ammunition: 'army', obstacle_course: 'army',
  checkpoint: 'joint', base: 'joint', office: 'joint', danger_area: 'joint', nuclear_explosion_site: 'joint', launchpad: 'joint',
  bunker: 'fortification', trench: 'fortification', shelter: 'fortification',
};
/** Noms trop génériques ou codes d'ouvrages de 1944 (« R622 ») : écartés. */
const EXCLUDE_NAMES = new Set(['bunker', 'blockhaus', 'casemate', 'tobrouk', 'abri']);
/** `military=yes`, bunkers, tranchées et abris : gardés seulement avec un nom significatif. */
const RELEVANT_NAME = [
  /batterie/i, /poste/i, /torpille/i, /fort\b/i, /citadelle/i, /caserne/i, /camp/i, /base/i, /centre/i, /école/i, /régiment/i,
  /escadrille/i, /flottille/i, /légion/i, /préfecture/i, /commandement/i, /état-major/i, /zone de tir/i, /champ de tir/i,
];

function normalized(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function keep(kind, name) {
  const n = normalized(name);
  if (EXCLUDE_NAMES.has(n) || /^[a-z]?\d{2,4}[a-z]?$/i.test(n)) return false;
  if (kind === 'yes') return RELEVANT_NAME.some((p) => p.test(name));
  if (kind === 'bunker' || kind === 'trench' || kind === 'shelter') return RELEVANT_NAME.some((p) => p.test(name)) || name.length > 20;
  return true;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const r = (v) => (v * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Ouvrages de défense (DefenseOsmWork) d'une réponse Overpass (`out center tags`) : nommés, dans un département métropolitain
 * (V2), doublons retirés (même nom à moins de 200 m, le chemin l'emporte). Lève si la réponse n'a pas de liste « elements ».
 * @param {unknown} json
 * @param {{ departementAt(lat: number, lon: number): string | null }} geo
 */
export function defenseWorksFromOverpass(json, geo) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.elements)) throw new Error('réponse Overpass sans « elements »');
  const found = [];
  for (const el of json.elements) {
    const tags = el?.tags ?? {};
    const kind = typeof tags.military === 'string' ? tags.military : '';
    const name = cleanText(String(tags['name:fr'] ?? tags.name ?? ''));
    const lat = el?.lat ?? el?.center?.lat;
    const lon = el?.lon ?? el?.center?.lon;
    if (!kind || !name || !Number.isFinite(lat) || !Number.isFinite(lon) || !keep(kind, name)) continue;
    const dept = geo.departementAt(lat, lon);
    if (!dept) continue;
    found.push({
      id: `${el.type}/${el.id}`, name, kind, type: TYPE_MAP[kind] ?? 'other',
      lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, dept, node: el.type === 'node',
    });
  }
  const kept = found.filter((f) => !f.node);
  for (const f of found.filter((x) => x.node)) {
    if (!kept.some((k) => normalized(k.name) === normalized(f.name) && haversineM(k.lat, k.lon, f.lat, f.lon) <= DEDUP_M)) kept.push(f);
  }
  return kept.map(({ node: _node, ...w }) => w).sort((a, b) => a.id.localeCompare(b.id));
}

async function main() {
  const json = await fetchStrictJson(`${OVERPASS_URL}?data=${encodeURIComponent(DEFENSE_OVERPASS_QUERY)}`, { timeoutMs: OVERPASS_TIMEOUT_MS });
  const osmBase = json?.osm3s?.timestamp_osm_base;
  if (typeof osmBase !== 'string') throw new Error('réponse Overpass sans date de base (osm3s.timestamp_osm_base)');
  const items = defenseWorksFromOverpass(json, { departementAt });
  const file = { generatedAt: new Date().toISOString(), osmBase, licence: 'ODbL 1.0', source: OSM_SOURCE, items };
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(file)}\n`);
  console.log(`public/data/defense-osm-works.json : ${items.length} ouvrages sur ${json.elements.length} éléments lus (base OSM ${osmBase})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`échec : ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
