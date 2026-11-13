#!/usr/bin/env node
// scripts/build-anticipation-flood-exposure.mjs : établissements situés dans une zone de crue cartographiée (13/11/2026).
// Pour chaque service d'urgences, site Seveso et EHPAD des jeux du site, une petite boîte (~30 m) est demandée au WFS Géorisques
// (cartographie des TRI, Directive inondation) : scénario extrême d'abord, puis moyen (~centennal) si le premier répond. Le point est
// ensuite testé dans le polygone rendu (trous compris). Hors TRI, rien n'est cartographié : « non couvert », jamais « hors d'eau ».
// Une requête à la fois, reprise possible (cache node_modules/.cache/flood-exposure.json). Écrit
// api/_lib/anticipation/flood-exposure-data.js (GÉNÉRÉ, ne pas éditer à la main).
//   node scripts/build-anticipation-flood-exposure.mjs            (tout, environ 1 h)
//   KINDS=urgences,seveso node scripts/build-anticipation-flood-exposure.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const WFS = 'https://www.georisques.gouv.fr/services';
const LAYERS = { extreme: 'ms:ALEA_SYNT_01_04FAI_FXX', moyen: 'ms:ALEA_SYNT_01_02MOY_FXX' };
const D = 0.0003;
const CACHE = new URL('../node_modules/.cache/flood-exposure.json', import.meta.url);
const kinds = (process.env.KINDS ?? 'urgences,seveso,ehpad').split(',');
const read = async (name) => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Point dans une géométrie GeoJSON (Polygon ou MultiPolygon), trous exclus. */
export function inGeometry(lon, lat, g) {
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((p) => Array.isArray(p?.[0]) && inRing(lon, lat, p[0]) && !p.slice(1).some((hole) => inRing(lon, lat, hole)));
}

async function query(layer, lat, lon) {
  const q = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: layer, outputFormat: 'geojson', count: '20' });
  const url = `${WFS}?${q}&bbox=${lat - D},${lon - D},${lat + D},${lon + D},urn:ogc:def:crs:EPSG::4326`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) { await sleep(15_000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) return []; // corps vide : aucune entité dans la boîte
      return JSON.parse(text).features ?? [];
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(5_000 * (attempt + 1));
    }
  }
  throw new Error('service indisponible');
}

const isMain = import.meta.url === new URL(process.argv[1], 'file:').href;
if (isMain) {
  const [hospitals, seveso, ehpad] = await Promise.all([read('hospitals-urgences'), read('seveso'), read('ehpad')]);
  const sites = [
    ...(kinds.includes('urgences') ? hospitals.sites.map((s) => ({ kind: 'urgences', id: `u:${s.finess}`, name: s.name, commune: s.commune, dept: s.dept, lat: s.lat, lon: s.lon })) : []),
    ...(kinds.includes('seveso') ? seveso.sites.map((s) => ({ kind: s.seuil === 'haut' ? 'seveso_haut' : 'seveso_bas', id: `s:${s.id}`, name: s.name, commune: s.commune, dept: s.dept, lat: s.lat, lon: s.lon })) : []),
    ...(kinds.includes('ehpad') ? ehpad.sites.map((s) => ({ kind: 'ehpad', id: `e:${s.finess}`, name: s.name, commune: s.commune, dept: s.dept, lat: s.lat, lon: s.lon, places: s.places })) : []),
  ].filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && typeof s.dept === 'string' && s.lat > 41 && s.lat < 51.5 && s.lon > -5.5 && s.lon < 10);
  let cache = {};
  try { cache = JSON.parse(await readFile(CACHE, 'utf8')); } catch { /* premier passage */ }
  await mkdir(new URL('.', CACHE), { recursive: true });
  let done = 0, failed = 0;
  for (const s of sites) {
    done += 1;
    if (cache[s.id]) continue;
    try {
      const hit = (features) => features.find((f) => inGeometry(s.lon, s.lat, f.geometry));
      const extreme = hit(await query(LAYERS.extreme, s.lat, s.lon));
      let scenario = null, river = null;
      if (extreme) {
        const moyen = hit(await query(LAYERS.moyen, s.lat, s.lon));
        scenario = moyen ? 'moyen' : 'extreme';
        river = String((moyen ?? extreme).properties?.cours_deau ?? '').trim() || null;
      }
      cache[s.id] = { scenario, river };
    } catch (e) {
      failed += 1;
      console.error(`échec ${s.id} : ${e instanceof Error ? e.message : e}`);
    }
    if (done % 100 === 0) { await writeFile(CACHE, JSON.stringify(cache)); console.log(`${done}/${sites.length}, ${Object.values(cache).filter((c) => c.scenario).length} en zone, ${failed} échecs`); }
    await sleep(150);
  }
  await writeFile(CACHE, JSON.stringify(cache));
  // Quelques noms FINESS arrivent mal encodés (« RÃ‰SIDENCE ») : remis en clair avant la mise en casse.
  const MOJIBAKE = { 'Ã‰': 'É', 'Ãˆ': 'È', 'Ã€': 'À', 'Ã©': 'é', 'Ã¨': 'è', 'Ã´': 'ô', 'Ã§': 'ç', 'Ã‚': 'Â', 'Ã¢': 'â', 'Ãª': 'ê', 'Ã®': 'î' };
  const title = (name) => String(name).replace(/Ã[‰ˆ€©¨´§‚¢ª®]/g, (m) => MOJIBAKE[m] ?? m).toLowerCase().replace(/(^|[\s'’(-])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(Chu|Chr|Ch|Aphp|Ghu|Chi|Hia|Ehpad|Sa|Sas)\b/g, (m) => m.toUpperCase());
  /** @type {Record<string, Array<{ kind: string, name: string, commune: string, scenario: string, river: string|null, places?: number }>>} */
  const byDept = {};
  let checked = 0;
  for (const s of sites) {
    const c = cache[s.id];
    if (!c) continue;
    checked += 1;
    if (!c.scenario) continue;
    (byDept[s.dept] ??= []).push({ kind: s.kind, name: title(s.name).slice(0, 70), commune: title(s.commune), scenario: c.scenario, river: c.river, ...(s.places ? { places: s.places } : {}) });
  }
  const sorted = Object.fromEntries(Object.keys(byDept).sort().map((k) => [k, byDept[k].sort((a, b) => a.kind.localeCompare(b.kind) || a.commune.localeCompare(b.commune, 'fr'))]));
  const today = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
  await writeFile(new URL('../api/_lib/anticipation/flood-exposure-data.js', import.meta.url), `// api/_lib/anticipation/flood-exposure-data.js : GÉNÉRÉ par scripts/build-anticipation-flood-exposure.mjs, ne pas éditer à la main.
// Établissements dont le point est dans une zone de crue cartographiée (Géorisques, TRI de la Directive inondation). « moyen » : crue
// moyenne (~centennale) ; « extreme » : crue extrême seulement. Un établissement absent n'est pas hors d'eau : hors TRI, rien n'est cartographié.

export const FLOOD_EXPOSURE_META = ${JSON.stringify({ builtOn: today, checked, kinds, source: `Géorisques, cartographie des TRI (Directive inondation), relevé du ${today}` })};

/** @type {Record<string, Array<{ kind: string, name: string, commune: string, scenario: 'moyen'|'extreme', river: string|null, places?: number }>>} */
export const FLOOD_EXPOSURE_BY_DEPT = ${JSON.stringify(sorted)};
`);
  console.log(`TERMINÉ : ${checked}/${sites.length} établissements vérifiés, ${Object.values(sorted).flat().length} en zone, ${failed} échecs`);
}
