#!/usr/bin/env node
// scripts/build-crime.mjs : délinquance enregistrée par la police et la gendarmerie (SSMSI, ministère de l'Intérieur) agrégée pour la
// couche Criminalité → public/data/crime.json (CrimeDataset de src/types/index.ts). Base annuelle, rééditée deux fois par an (janvier,
// juillet) : relancer à chaque édition.
//   node scripts/build-crime.mjs                 télécharge les bases départementale (2 Mo) et communale (40 Mo gzip) puis écrit le fichier
//   node scripts/build-crime.mjs --dir <dossier> lit dep.csv et com.csv.gz déjà téléchargés dans <dossier>
// Vérifié le 17/10/2026 (édition data.gouv du 09/07/2026, années 2016 à 2025) : CSV UTF-8 avec BOM, « ; », valeurs entre guillemets,
// virgule décimale, NA sans guillemets. Homicides et tentatives au département SEULEMENT (absents de la base communale). Base communale :
// est_diffuse = ndiff (secret statistique, petits effectifs) → nombre et taux NA, estimation lissée dans complement_info_taux.
// Taux pour mille habitants, sauf cambriolages de logement (pour mille logements). Villes retenues : 20 000 habitants et plus.
// Valeur d'un indicateur : [nombre, taux pour mille, nombre de l'année précédente] ; nombre null et taux renseigné = estimation lissée
// du SSMSI (secret statistique) ; tout null = absent.
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { DEPT_NAMES } from '../api/_shared/departments.js';

export const DATASET_URL = 'https://www.data.gouv.fr/fr/datasets/bases-statistiques-communale-departementale-et-regionale-de-la-delinquance-enregistree-par-la-police-et-la-gendarmerie-nationales/';
const RESOURCE = (id) => `https://www.data.gouv.fr/api/1/datasets/r/${id}`;
export const DEP_RESOURCE = '2b27a675-e3bf-41ef-a852-5fb9ab483967';
export const COM_RESOURCE = '44ef4323-1097-48d5-8719-3c544b55d294';
export const DATASET_API = 'https://www.data.gouv.fr/api/1/datasets/621df2954fa5a3b5a023e23c/';
const COMMUNES_URL = 'https://geo.api.gouv.fr/communes?fields=nom,code,centre,codeDepartement&format=json&geometry=centre';
export const CITY_MIN_POP = 20_000;

/** Indicateurs retenus (libellés SSMSI exacts) ; `communal` : présent dans la base communale. Sous-totaux AFD écartés. */
export const INDICATORS = Object.freeze([
  { key: 'homicides', ssmsi: 'Homicides', label: 'Homicides', communal: false },
  { key: 'tentatives', ssmsi: "Tentatives d'homicide", label: 'Tentatives d’homicide', communal: false },
  { key: 'violencesIntrafamiliales', ssmsi: 'Violences physiques intrafamiliales', label: 'Violences intrafamiliales', communal: true },
  { key: 'violencesPhysiques', ssmsi: 'Violences physiques hors cadre familial', label: 'Violences physiques hors famille', communal: true },
  { key: 'violencesSexuelles', ssmsi: 'Violences sexuelles', label: 'Violences sexuelles', communal: true },
  { key: 'volsArmes', ssmsi: 'Vols avec armes', label: 'Vols avec armes', communal: true },
  { key: 'volsViolents', ssmsi: 'Vols violents sans arme', label: 'Vols violents sans arme', communal: true },
  { key: 'volsSansViolence', ssmsi: 'Vols sans violence contre des personnes', label: 'Vols sans violence', communal: true },
  { key: 'cambriolages', ssmsi: 'Cambriolages de logement', label: 'Cambriolages de logement', communal: true },
  { key: 'volsVehicules', ssmsi: 'Vols de véhicule', label: 'Vols de véhicules', communal: true },
  { key: 'volsDansVehicules', ssmsi: 'Vols dans les véhicules', label: 'Vols dans les véhicules', communal: true },
  { key: 'volsAccessoires', ssmsi: "Vols d'accessoires sur véhicules", label: 'Vols d’accessoires sur véhicules', communal: true },
  { key: 'degradations', ssmsi: 'Destructions et dégradations volontaires', label: 'Destructions et dégradations', communal: true },
  { key: 'stupefiantsUsage', ssmsi: 'Usage de stupéfiants', label: 'Usage de stupéfiants', communal: true },
  { key: 'stupefiantsTrafic', ssmsi: 'Trafic de stupéfiants', label: 'Trafic de stupéfiants', communal: true },
  { key: 'escroqueries', ssmsi: 'Escroqueries et fraudes aux moyens de paiement', label: 'Escroqueries et fraudes', communal: true },
]);
const BY_SSMSI = new Map(INDICATORS.map((i) => [i.ssmsi, i]));

/** Champs d'une ligne SSMSI : guillemets retirés, NA → null. */
export function splitLine(line) {
  return line.replace(/^﻿/, '').split(';').map((f) => {
    const v = f.trim();
    if (v === 'NA' || v === '') return null;
    return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
  });
}

/** Nombre SSMSI (« 0,0078318 », « 638425 ») ; null si illisible. */
export function num(v) {
  if (v === null || v === undefined || v === 'NA') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const round = (v, d) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

async function* lines(path) {
  const input = createReadStream(path);
  const stream = path.endsWith('.gz') ? input.pipe(createGunzip()) : input;
  yield* createInterface({ input: stream, crlfDelay: Infinity });
}

/** Base départementale → séries par département, indicateur et année : { [dep]: { pop, [key]: { [year]: [nombre, taux] } } }. */
export async function readDepartments(path) {
  const out = new Map();
  let header = null;
  for await (const line of lines(path)) {
    const f = splitLine(line);
    if (!header) { header = f; continue; }
    const row = Object.fromEntries(header.map((h, i) => [h, f[i]]));
    const ind = BY_SSMSI.get(row.indicateur);
    if (!ind) continue;
    const year = Number(row.annee);
    const dep = row.Code_departement;
    const entry = out.get(dep) ?? { pop: {}, logements: {}, values: {} };
    entry.pop[year] = num(row.insee_pop);
    entry.logements[year] = num(row.insee_log);
    (entry.values[ind.key] ??= {})[year] = [num(row.nombre), num(row.taux_pour_mille)];
    out.set(dep, entry);
  }
  return out;
}

/** Base communale, deux dernières années seulement : { [code]: { pop, [key]: { [year]: [nombre|null, taux|null, estimé] } } }. */
export async function readCommunes(path, years) {
  const out = new Map();
  let header = null;
  const wanted = new Set(years.map(String));
  for await (const line of lines(path)) {
    const f = splitLine(line);
    if (!header) { header = f; continue; }
    if (!wanted.has(f[1])) continue;
    const row = Object.fromEntries(header.map((h, i) => [h, f[i]]));
    const ind = BY_SSMSI.get(row.indicateur);
    if (!ind) continue;
    const code = row.CODGEO_2026 ?? row[header[0]];
    const year = Number(row.annee);
    const entry = out.get(code) ?? { pop: 0, values: {} };
    entry.pop = Math.max(entry.pop, num(row.insee_pop) ?? 0);
    const diffused = row.est_diffuse === 'diff';
    (entry.values[ind.key] ??= {})[year] = diffused
      ? [num(row.nombre), num(row.taux_pour_mille), false]
      : [null, num(row.complement_info_taux), true];
    out.set(code, entry);
  }
  return out;
}

/** Département d'une commune INSEE : trois caractères outre-mer (97x), deux sinon. */
export const departmentOf = (code) => (String(code).startsWith('97') ? String(code).slice(0, 3) : String(code).slice(0, 2));

/** Jeu final (pur, testé) : France, départements, villes de 20 000 habitants et plus. */
export function buildDataset({ deps, communes, places, publishedAt }) {
  const years = [...new Set([...deps.values()].flatMap((d) => Object.keys(d.pop).map(Number)))].sort((a, b) => a - b);
  const year = years.at(-1);
  const prev = years.at(-2) ?? null;
  // Base du taux par indicateur : logements si le taux SSMSI rapporte le nombre aux logements (cambriolages), habitants sinon.
  const base = {};
  const sample = deps.get('75') ?? [...deps.values()][0];
  for (const ind of INDICATORS) {
    const [n, rate] = sample.values[ind.key]?.[year] ?? [null, null];
    const perPop = n !== null && sample.pop[year] ? (n / sample.pop[year]) * 1000 : null;
    base[ind.key] = rate !== null && perPop !== null && Math.abs(rate - perPop) > 0.01 * Math.max(rate, 0.001) ? 'logements' : 'habitants';
  }
  const france = {};
  for (const ind of INDICATORS) {
    france[ind.key] = years.map((y) => {
      let count = 0;
      let denom = 0;
      for (const d of deps.values()) {
        const v = d.values[ind.key]?.[y];
        if (!v || v[0] === null) continue;
        count += v[0];
        denom += (base[ind.key] === 'logements' ? d.logements[y] : d.pop[y]) ?? 0;
      }
      return { year: y, count, rate: denom > 0 ? round((count / denom) * 1000, 4) : null };
    });
  }
  const departments = [...deps.entries()]
    .filter(([code]) => Object.hasOwn(DEPT_NAMES, code))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, d]) => ({
      code,
      name: DEPT_NAMES[code],
      population: d.pop[year] ?? null,
      values: Object.fromEntries(INDICATORS.map((ind) => {
        const [count, rate] = d.values[ind.key]?.[year] ?? [null, null];
        const prevCount = prev === null ? null : d.values[ind.key]?.[prev]?.[0] ?? null;
        return [ind.key, [count, round(rate, 4), prevCount]];
      })),
      // Homicides : la série complète (rares, trop variables d'une année sur l'autre pour une seule comparaison).
      homicides: years.map((y) => ({ year: y, count: d.values.homicides?.[y]?.[0] ?? null })),
    }));
  const cities = [];
  for (const [code, c] of communes) {
    if (c.pop < CITY_MIN_POP) continue;
    const place = places.get(code);
    if (!place) continue;
    cities.push({
      code,
      name: place.name,
      dept: departmentOf(code),
      lat: round(place.lat, 4),
      lon: round(place.lon, 4),
      population: c.pop,
      values: Object.fromEntries(INDICATORS.filter((i) => i.communal).map((ind) => {
        const [count, rate] = c.values[ind.key]?.[year] ?? [null, null];
        const prevCount = prev === null ? null : c.values[ind.key]?.[prev]?.[0] ?? null;
        return [ind.key, [count, round(rate, 4), prevCount]];
      })),
    });
  }
  cities.sort((a, b) => b.population - a.population);
  return {
    year,
    previousYear: prev,
    publishedAt,
    source: 'SSMSI (ministère de l’Intérieur), bases statistiques communale et départementale de la délinquance enregistrée par la police et la gendarmerie nationales',
    sourceUrl: DATASET_URL,
    cityMinPopulation: CITY_MIN_POP,
    indicators: INDICATORS.map((i) => ({ key: i.key, label: i.label, communal: i.communal, base: base[i.key] })),
    france,
    departments,
    cities,
  };
}

async function download(url, path) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const dirArg = process.argv.indexOf('--dir');
  const tmp = dirArg === -1 ? await mkdtemp(join(tmpdir(), 'crime-')) : null;
  const dir = dirArg === -1 ? tmp : process.argv[dirArg + 1];
  try {
    if (tmp) {
      console.log('Téléchargement des bases SSMSI…');
      await download(RESOURCE(DEP_RESOURCE), join(dir, 'dep.csv'));
      await download(RESOURCE(COM_RESOURCE), join(dir, 'com.csv.gz'));
    }
    const meta = await (await fetch(DATASET_API)).json();
    const publishedAt = String(meta.last_update ?? meta.last_modified ?? '').slice(0, 10) || null;
    const deps = await readDepartments(join(dir, 'dep.csv'));
    const years = [...new Set([...deps.values()].flatMap((d) => Object.keys(d.pop).map(Number)))].sort((a, b) => a - b);
    const communes = await readCommunes(join(dir, 'com.csv.gz'), years.slice(-2));
    const list = await (await fetch(COMMUNES_URL)).json();
    const places = new Map(list.filter((c) => Array.isArray(c.centre?.coordinates))
      .map((c) => [c.code, { name: c.nom, lon: c.centre.coordinates[0], lat: c.centre.coordinates[1] }]));
    const dataset = buildDataset({ deps, communes, places, publishedAt });
    const out = fileURLToPath(new URL('../public/data/crime.json', import.meta.url));
    await writeFile(out, `${JSON.stringify(dataset)}\n`);
    const size = (await readFile(out)).length;
    console.log(`public/data/crime.json : année ${dataset.year}, ${dataset.departments.length} départements, ${dataset.cities.length} villes, ${Math.round(size / 1024)} Ko`);
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
