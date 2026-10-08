#!/usr/bin/env node
// scripts/fetch-subsea-cables.mjs : fichier daté des câbles télécom sous-marins des approches de la métropole
// (public/data/subsea-cables.json ; spec 2026-10-04 souveraineté § 2.2, V5 ; contrats § 2.3, arbitrage 9 ; amendement 7,
// règle O18). Référence : le Shom (câbles télécom, zones de câbles, zones de mouillage, WFS sans clé) ; complément : les câbles
// télécom d'OpenStreetMap absents du Shom. Chaque objet porte sa source et sa licence ; le fichier porte sa date de génération,
// la base OSM et l'édition de chaque source. Lancé à la main, User-Agent FranceMonitor (api/_lib/source-http.js), une seconde au
// moins entre deux lectures : GetCapabilities (éditions), fiches data.gouv.fr (licences vérifiées, mise à jour des câbles),
// une lecture GetFeature par couche, une requête Overpass, puis une lecture geo.api.gouv.fr par département d'atterrage.
// Overpass en 429 ou 504 : relancer à la main après une minute, trois essais au plus. Usage : node scripts/fetch-subsea-cables.mjs
// Liaisons électriques (power=cable, line ou minor_line) écartées des compléments OpenStreetMap même avec une fibre (revue finale M5,
// Normandie 1 et 2) ; leurs noms sont imprimés. Un nom OSM non vérifié reste tel quel (AMITIE, chemin 761201757 : dit à l'utilisateur).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { departementAt, departementsNear } from '../api/_lib/geo-fr.js';
import { communesUrl, parseCommunes, rankCommunes } from '../api/_lib/fire-impacts.js';
import {
  SHOM_LAYERS, assertWfsComplete, osmComplement, shomCableCounts, shomCapabilitiesUrl, shomEditionOf, shomExclusionsText, shomFeatureUrl,
  shomToAnchorageZones, shomToCableZones, shomToCables,
} from '../api/_lib/shom-cables.js';
import { fetchStrictJson, fetchStrictXml } from '../api/_lib/source-http.js';
import {
  CABLES_FILE_PATH, CABLES_OVERPASS_QUERY, OSM_LICENCE, OSM_SOURCE, OVERPASS_URL, SHOM_SOURCE, isPowerLink, nameLandings, overpassToCables,
} from '../api/_lib/subsea-cables.js';

const OVERPASS_TIMEOUT_MS = 200_000;
const WFS_TIMEOUT_MS = 120_000;
const PAUSE_MS = 1_000;
const DATAGOUV_API = 'https://www.data.gouv.fr/api/1/datasets';

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Fichier des câbles (SubseaCablesFile) : sources datées dans l'ordre câbles du Shom, zones de câbles, zones de mouillage,
 * OpenStreetMap ; câbles du Shom d'abord, compléments OpenStreetMap ensuite.
 * @param {{ generatedAt: string, osmBase: string, editions: { cables: string | null, cableZones: string | null, anchorageZones: string | null },
 *   shomCables: object[], osmCables: object[], cableZones: object[], anchorageZones: object[] }} parts
 */
export function cablesFile({ generatedAt, osmBase, editions, shomCables, osmCables, cableZones, anchorageZones }) {
  const shom = (key, count) => {
    const { layer, dataset, licence, url } = SHOM_LAYERS[key];
    return { source: SHOM_SOURCE, dataset, layer, licence, attribution: SHOM_SOURCE, edition: editions[key], url, count };
  };
  return {
    generatedAt,
    osmBase,
    sources: [
      shom('cables', shomCables.length),
      shom('cableZones', cableZones.length),
      shom('anchorageZones', anchorageZones.length),
      {
        source: 'OpenStreetMap', dataset: 'OpenStreetMap', layer: 'Overpass', licence: OSM_LICENCE, attribution: OSM_SOURCE, edition: osmBase,
        url: 'https://www.openstreetmap.org/copyright', count: osmCables.length,
      },
    ],
    cables: [...shomCables, ...osmCables],
    cableZones,
    anchorageZones,
  };
}

/** Fiche data.gouv.fr d'une couche : lève si la licence a changé ; date de mise à jour (AAAA-MM-JJ) ou null. */
async function datagouvUpdate({ datagouvId, datagouvLicense, dataset }) {
  const json = await fetchStrictJson(`${DATAGOUV_API}/${datagouvId}/`, { timeoutMs: 20_000 });
  if (json?.license !== datagouvLicense) throw new Error(`licence de « ${dataset} » changée sur data.gouv.fr : ${String(json?.license)}`);
  return typeof json.last_update === 'string' ? json.last_update.slice(0, 10) : null;
}

async function shomLayer(key) {
  const { layer } = SHOM_LAYERS[key];
  const json = await fetchStrictJson(shomFeatureUrl(layer), { timeoutMs: WFS_TIMEOUT_MS });
  assertWfsComplete(json, layer);
  await sleep(PAUSE_MS);
  return json;
}

async function main() {
  const geo = { departementAt, departementsNear };
  const capabilities = await fetchStrictXml(shomCapabilitiesUrl(), { timeoutMs: 60_000 });
  await sleep(PAUSE_MS);
  // Édition : celle du résumé de la couche (« 07_2021 »), sinon la mise à jour de la fiche data.gouv.fr (câbles : 2019-01-07).
  const updates = {};
  for (const key of ['cables', 'cableZones']) {
    updates[key] = await datagouvUpdate(SHOM_LAYERS[key]);
    await sleep(PAUSE_MS);
  }
  updates.anchorageZones = updates.cableZones;
  const editions = {};
  for (const key of ['cables', 'cableZones', 'anchorageZones']) editions[key] = shomEditionOf(capabilities, SHOM_LAYERS[key].layer) ?? updates[key];

  const shomCablesJson = await shomLayer('cables');
  const shomCables = shomToCables(shomCablesJson, geo);
  const cableZones = shomToCableZones(await shomLayer('cableZones'));
  const anchorageZones = shomToAnchorageZones(await shomLayer('anchorageZones'), cableZones);

  const overpass = await fetchStrictJson(`${OVERPASS_URL}?data=${encodeURIComponent(CABLES_OVERPASS_QUERY)}`, { timeoutMs: OVERPASS_TIMEOUT_MS });
  const osmBase = overpass?.osm3s?.timestamp_osm_base;
  if (typeof osmBase !== 'string') throw new Error('réponse Overpass sans date de base (osm3s.timestamp_osm_base)');
  const osmAll = overpassToCables(overpass, geo);
  const osmCables = osmComplement(osmAll, shomCables);

  const communes = new Map();
  for (const dept of [...new Set([...shomCables, ...osmCables].flatMap((c) => c.landings.map((l) => l.dept)))].sort()) {
    await sleep(PAUSE_MS);
    communes.set(dept, parseCommunes(await fetchStrictJson(communesUrl(dept), { timeoutMs: 15_000 }), dept));
  }
  const rankOf = (dept, lat, lon) => rankCommunes(communes.get(dept) ?? [], lat, lon);
  const file = cablesFile({
    generatedAt: new Date().toISOString(), osmBase, editions,
    shomCables: nameLandings(shomCables, rankOf), osmCables: nameLandings(osmCables, rankOf), cableZones, anchorageZones,
  });
  const text = `${JSON.stringify(file)}\n`;
  writeFileSync(CABLES_FILE_PATH, text);
  const landings = file.cables.reduce((n, c) => n + c.landings.length, 0);
  console.log(`public/data/subsea-cables.json : ${shomCables.length} câbles du Shom (édition ${editions.cables}), `
    + `${osmCables.length} compléments OpenStreetMap sur ${osmAll.length} (base OSM ${osmBase}), ${landings} atterrages, `
    + `${cableZones.length} zones de câbles et ${anchorageZones.length} zones de mouillage (édition ${editions.cableZones}), `
    + `${Math.round(Buffer.byteLength(text) / 1024)} Ko`);
  console.log(shomExclusionsText(shomCableCounts(shomCablesJson)));
  console.log(`compléments OpenStreetMap : ${osmCables.map((c) => c.name ?? c.id).join(', ')}`);
  const power = overpass.elements.filter((el) => el?.type === 'way' && isPowerLink(el.tags)).map((el) => el.tags?.name ?? `way/${el.id}`);
  console.log(`liaisons électriques écartées (power) : ${power.length > 0 ? power.join(', ') : 'aucune'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`échec : ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
