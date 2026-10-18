#!/usr/bin/env node
// scripts/build-ehpad.mjs : EHPAD (FINESS, catégorie 500) géolocalisés avec leurs places installées → public/data/ehpad.json.
// Sert la carte Santé : populations vulnérables à protéger (canicule, épidémie), capacité par département.
// À relancer à chaque extraction FINESS (deux fois par an environ) :
//   node scripts/build-ehpad.mjs                                      télécharge les deux extractions (48 Mo et 26 Mo)
//   node scripts/build-ehpad.mjs --finess <etab.csv> --equip <equip.csv>   fichiers déjà téléchargés
// Aucune donnée personnelle : établissements et capacités autorisées publiés par le ministère.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { crsOf, departmentCode, parseSemicolonCsv, toWgs84 } from './build-hospitals.mjs';

const ETAB_API = 'https://www.data.gouv.fr/api/1/datasets/finess-extraction-du-fichier-des-etablissements/';
const EQUIP_API = 'https://www.data.gouv.fr/api/1/datasets/finess-extraction-des-equipements-sociaux-et-medico-sociaux/';
const EHPAD = '500';
// Code d'activité FINESS : 11 = hébergement complet internat (places permanentes), 21 = accueil de jour.
const PERMANENT = '11';
const DAY_CARE = '21';

/** Les extractions FINESS sont en Latin-1. */
const latin1 = (buf) => new TextDecoder('latin1').decode(buf);

/** « 01440 VIRIAT » → « VIRIAT ». */
export function communeOf(acheminement) {
  return String(acheminement ?? '').replace(/^\d{5}\s+/, '').replace(/\s+CEDEX.*$/i, '').trim();
}

/**
 * Extraction des établissements (sections structureet et geolocalisation) + équipements sociaux (equipementsocial)
 * → { finessDate, sites, totals }. Places : capacité installée totale (colonne 10), lignes supprimées (colonne 16 = O) exclues.
 */
export function buildEhpadDataset(etabText, equipText) {
  let finessDate = null;
  const etab = new Map();
  const geo = new Map();
  for (const r of parseSemicolonCsv(etabText)) {
    if (r[0] === 'finess') finessDate = r[3] ?? null;
    else if (r[0] === 'structureet' && r[18] === EHPAD) {
      etab.set(r[1], { name: (r[4] || r[3] || '').trim(), commune: communeOf(r[15]), dept: departmentCode(r[13]) });
    } else if (r[0] === 'geolocalisation') geo.set(r[1], { x: r[2], y: r[3], crs: crsOf(r[4]) });
  }
  const places = new Map();
  for (const r of parseSemicolonCsv(equipText)) {
    if (r[0] !== 'equipementsocial' || !etab.has(r[1]) || r[15] === 'O') continue;
    const n = Number(r[9]);
    if (!Number.isFinite(n)) continue;
    const p = places.get(r[1]) ?? { total: 0, permanent: 0, dayCare: 0 };
    p.total += n;
    if (r[4] === PERMANENT) p.permanent += n;
    if (r[4] === DAY_CARE) p.dayCare += n;
    places.set(r[1], p);
  }
  const sites = [];
  let unplaced = 0;
  for (const [finess, e] of etab) {
    const g = geo.get(finess);
    const ll = g ? toWgs84(g.x, g.y, g.crs) : null;
    if (!ll) { unplaced += 1; continue; }
    const p = places.get(finess) ?? null;
    sites.push({ finess, name: e.name, commune: e.commune, dept: e.dept, lon: ll[0], lat: ll[1],
      places: p ? p.total : null, permanent: p ? p.permanent : null, dayCare: p ? p.dayCare : null });
  }
  sites.sort((a, b) => (b.places ?? 0) - (a.places ?? 0));
  return { finessDate, sites, totals: { ehpad: etab.size, placed: sites.length, unplaced, places: sites.reduce((s, x) => s + (x.places ?? 0), 0) } };
}

async function latestCsv(api) {
  const res = await fetch(api, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`data.gouv ${res.status}`);
  const meta = await res.json();
  const r = (meta.resources ?? []).find((x) => /csv/i.test(x.format) && /stock/i.test(x.url));
  if (!r) throw new Error(`ressource CSV introuvable : ${api}`);
  return r.url;
}

async function load(path, api) {
  if (path) return latin1(await readFile(path));
  const url = await latestCsv(api);
  console.log(`[build-ehpad] téléchargement ${url}…`);
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  return latin1(new Uint8Array(await res.arrayBuffer()));
}

async function main() {
  const arg = (flag) => (process.argv.indexOf(flag) > 0 ? process.argv[process.argv.indexOf(flag) + 1] : null);
  const [etabText, equipText] = await Promise.all([load(arg('--finess'), ETAB_API), load(arg('--equip'), EQUIP_API)]);
  const dataset = buildEhpadDataset(etabText, equipText);
  const out = fileURLToPath(new URL('../public/data/ehpad.json', import.meta.url));
  await writeFile(out, `${JSON.stringify(dataset)}\n`);
  const t = dataset.totals;
  console.log(`[build-ehpad] écrit ${out} (FINESS du ${dataset.finessDate}) : ${t.ehpad} EHPAD, ${t.placed} placés, ${t.unplaced} sans coordonnées, ${t.places} places installées`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`[build-ehpad] échec : ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
