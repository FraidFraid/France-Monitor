#!/usr/bin/env node
// scripts/build-hospitals.mjs : sites d'urgences autorisés (DREES SAE, base administrative) joints au FINESS
// géolocalisé → public/data/hospitals-urgences.json (HospitalsDataset, spec 2026-10-03 panneaux santé § 2.8).
// À lancer une fois par an, à la publication d'une nouvelle base SAE :
//   node scripts/build-hospitals.mjs                              télécharge la SAE (7z, 34 Mo) et le FINESS (48 Mo)
//   node scripts/build-hospitals.mjs --sae <archive.7z> --finess <fichier.csv>   fichiers déjà téléchargés
// Extraction 7z : bsdtar (libarchive, livré avec macOS ; sous Linux, paquet libarchive-tools).
// Reprojection : proj4 (dépendance de développement, MIT) ; FINESS mélange Lambert-93 (métropole) et UTM des DROM.
// Aucune donnée d'occupation ni de tension : il n'en existe pas en données ouvertes.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';

export const SAE_VINTAGE = 2025;
const DREES = 'https://data.drees.solidarites-sante.gouv.fr';
const FINESS_DATASET_API = 'https://www.data.gouv.fr/api/1/datasets/finess-extraction-du-fichier-des-etablissements/';

/** Archive 7z de la base administrative SAE d'un millésime (pièce jointe DREES). */
export function saeUrl(vintage) {
  return `${DREES}/api/v2/catalog/datasets/707_bases-administratives-sae/attachments/sae_${vintage}_base_administrative_formats_sas_csv_7z`;
}
const SAE_TABLES = ['ID', 'URGENCES', 'URGENCES2', 'REA', 'MCO'];

/** Systèmes de coordonnées du FINESS (dernier segment de `sourcecoordet`) → définitions proj4. */
export const PROJ_DEFS = Object.freeze({
  'EPSG:2154': '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  'EPSG:5490': '+proj=utm +zone=20 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  'EPSG:2972': '+proj=utm +zone=22 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  'EPSG:2975': '+proj=utm +zone=40 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  'EPSG:4471': '+proj=utm +zone=38 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  'EPSG:32621': '+proj=utm +zone=21 +datum=WGS84 +units=m +no_defs',
  'EPSG:32701': '+proj=utm +zone=1 +south +datum=WGS84 +units=m +no_defs',
});

/** Catégories FINESS (`CAT` de la SAE = `categetab` du FINESS) → catégorie du contrat. */
const CATEGORY = Object.freeze({
  101: 'chu', // centre hospitalier régional (CHR et CHU)
  355: 'ch', // centre hospitalier
  365: 'private', // établissement de soins pluridisciplinaire
  128: 'private', // établissement de soins chirurgicaux
  129: 'private', // établissement de soins médicaux
  122: 'private', // établissement de soins obstétriques et chirurgico-gynécologiques
  697: 'gcs', // groupement de coopération sanitaire de moyens exploitant un établissement
  114: 'army', // hôpital des armées
});

/** Départements FINESS et SAE des DROM (9A à 9F) → codes INSEE. */
const DROM_DEP = Object.freeze({ '9A': '971', '9B': '972', '9C': '973', '9D': '974', '9E': '975', '9F': '976' });

export function hospitalCategory(cat) {
  return CATEGORY[Number(cat)] ?? 'other';
}

export function departmentCode(dep) {
  const d = String(dep ?? '').trim().toUpperCase();
  return DROM_DEP[d] ?? d;
}

/** CSV à point-virgule (champs éventuellement entre guillemets, guillemets doublés) → lignes de cellules texte. */
export function parseSemicolonCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** Table SAE (texte déjà décodé par decodeSaeCsv) → objets par en-tête ; FI reste du texte (zéro initial gardé). */
export function readSaeTable(text) {
  const [header, ...rows] = parseSemicolonCsv(text);
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const WINDOWS_1252 = new TextDecoder('windows-1252');

/**
 * Octets d'un CSV SAE → texte, ligne par ligne : UTF-8 d'abord, windows-1252 (latin-1) en repli si la ligne n'est pas de
 * l'UTF-8 valide. La table ID mêle des valeurs UTF-8 à un fichier latin-1 : décodé d'un bloc en latin-1, « HÔPITAL » devenait
 * « HÃ”PITAL ».
 */
export function decodeSaeCsv(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const lines = [];
  for (let start = 0; start < data.length;) {
    const lf = data.indexOf(0x0a, start);
    const end = lf < 0 ? data.length : lf + 1;
    const line = data.subarray(start, end);
    try {
      lines.push(UTF8.decode(line));
    } catch {
      lines.push(WINDOWS_1252.decode(line));
    }
    start = end;
  }
  return lines.join('');
}

/** « 1,ATLASANTE,96,BAN,EPSG:2154 RGF93 / Lambert-93 (Métropole) » → « EPSG:2154 » ; UTM WGS84 sans code → code EPSG. */
export function crsOf(source) {
  const s = String(source ?? '');
  const epsg = /EPSG:(\d{4,5})/.exec(s);
  if (epsg) return `EPSG:${epsg[1]}`;
  if (/WGS84\/UTM zone 21N/i.test(s)) return 'EPSG:32621';
  if (/WGS84\/UTM zone 1S/i.test(s)) return 'EPSG:32701';
  return null;
}

/** Coordonnées projetées → [longitude, latitude] WGS84 à 5 décimales ; null si système inconnu ou valeur illisible. */
export function toWgs84(x, y, crs) {
  const def = PROJ_DEFS[crs];
  const fx = Number(x);
  const fy = Number(y);
  if (!def || !Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  const [lon, lat] = proj4(def, 'WGS84', [fx, fy]);
  return [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
}

/**
 * FINESS géolocalisé (deux sections dans le même fichier, première ligne de commentaire « finess;etalab;98;AAAA-MM-JJ »)
 * → { date, establishments: Map(nofinesset → { categetab, categagretab, libcategagretab }), geo: Map(nofinesset → { x, y, crs }) }.
 */
export function parseFiness(text) {
  const establishments = new Map();
  const geo = new Map();
  let date = null;
  for (const r of parseSemicolonCsv(text)) {
    if (r[0] === 'finess') date = r[3] ?? null;
    else if (r[0] === 'structureet') {
      establishments.set(r[1], { categetab: r[18] ?? '', categagretab: r[20] ?? '', libcategagretab: r[21] ?? '' });
    } else if (r[0] === 'geolocalisation') geo.set(r[1], { x: r[2], y: r[3], crs: crsOf(r[4]) });
  }
  return { date, establishments, geo };
}

const sum = (rows, field) => rows.reduce((s, r) => s + (Number(r[field]) || 0), 0);
const groupByFi = (rows) => {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.FI)) map.set(r.FI, []);
    map.get(r.FI).push(r);
  }
  return map;
};
const ICU_UNITS = new Set(['REAADU', 'REAENF', 'REAPEDREC']);
/** Cellule de lits : vide ou illisible = non déclaré (null), jamais 0. */
const bedsOrNull = (v) => {
  const t = String(v ?? '').trim();
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null;
};
const INTENSIVE_UNITS = new Set(['SIADU', 'SIPED']);

/**
 * Tables SAE (ID, URGENCES, URGENCES2, REA, MCO) + FINESS → HospitalsDataset. Sites : `AUTSU = 1` joints au FINESS
 * avec coordonnées (sinon listés dans `unmatched`). Lits d'un site : null s'il n'a déclaré aucune ligne dans le
 * bordereau (pas d'unité), jamais 0 inventé. Totaux nationaux : tous les sites de la SAE (lits MCO, réanimation,
 * soins intensifs), passages des sites d'urgences.
 */
export function buildHospitalsDataset({ sae, finess, vintage = SAE_VINTAGE }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(finess.date ?? ''))) throw new Error('date d’extraction FINESS absente ou illisible (première ligne)');
  const ids = new Map(sae.ID.map((r) => [r.FI, r]));
  const urg2 = groupByFi(sae.URGENCES2);
  const rea = groupByFi(sae.REA);
  const mco = new Map(sae.MCO.map((r) => [r.FI, r]));
  const authorized = sae.URGENCES.filter((r) => r.AUTSU === '1');
  const sites = [];
  const unmatched = [];
  for (const u of authorized) {
    const g = finess.geo.get(u.FI);
    const coords = g ? toWgs84(g.x, g.y, g.crs) : null;
    if (!coords) {
      unmatched.push(u.FI);
      continue;
    }
    const id = ids.get(u.FI) ?? {};
    const passRows = urg2.get(u.FI) ?? [];
    const reaRows = rea.get(u.FI) ?? [];
    const icu = reaRows.filter((r) => ICU_UNITS.has(r.UNI));
    const intensive = reaRows.filter((r) => INTENSIVE_UNITS.has(r.UNI));
    const m = mco.get(u.FI);
    sites.push({
      finess: u.FI,
      name: String(id.RS || u.RS || '').trim(),
      commune: String(id.NOMCOM ?? '').trim(),
      dept: departmentCode(id.DEP),
      category: hospitalCategory(id.CAT ?? finess.establishments.get(u.FI)?.categetab),
      lat: coords[1],
      lon: coords[0],
      general: u.AUTGEN === '1',
      pediatric: u.AUTPED === '1',
      seasonal: u.AUTSAIS === '1',
      antenna: u.AUTMEDURG === '1',
      passages: passRows.length > 0 ? sum(passRows, 'PASSU') : null,
      bedsMco: m ? bedsOrNull(m.LIT_MCO) : null,
      bedsIcu: icu.length > 0 ? sum(icu, 'LIT') : null,
      bedsIntensive: intensive.length > 0 ? sum(intensive, 'LIT') : null,
      bedsUhcd: passRows.length > 0 ? sum(passRows, 'LIT_UHCD') : null,
    });
  }
  sites.sort((a, b) => (b.passages ?? -1) - (a.passages ?? -1) || (a.finess < b.finess ? -1 : 1));
  const icuRows = sae.REA.filter((r) => ICU_UNITS.has(r.UNI));
  const aggregates = new Map();
  for (const e of finess.establishments.values()) {
    if (!/^11\d\d$/.test(e.categagretab)) continue;
    const a = aggregates.get(e.categagretab) ?? { aggregate: e.categagretab, label: e.libcategagretab, count: 0 };
    a.count += 1;
    aggregates.set(e.categagretab, a);
  }
  return {
    vintage,
    finessDate: finess.date,
    sites,
    unmatched: unmatched.sort(),
    totals: {
      sites: authorized.length,
      passages: sum(sae.URGENCES2.filter((r) => authorized.some((u) => u.FI === r.FI)), 'PASSU'),
      bedsMco: sum(sae.MCO, 'LIT_MCO'),
      bedsIcu: sum(icuRows, 'LIT'),
      bedsIntensive: sum(sae.REA.filter((r) => INTENSIVE_UNITS.has(r.UNI)), 'LIT'),
      icuSites: new Set(icuRows.filter((r) => Number(r.LIT) > 0).map((r) => r.FI)).size,
    },
    establishments: [...aggregates.values()].sort((a, b) => (a.aggregate < b.aggregate ? -1 : 1)),
  };
}

/** JSON de métadonnées : statut HTTP contrôlé, délai borné. */
export async function fetchMetadata(url, timeoutMs = 60_000) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} pour ${url}`);
  return resp.json();
}

async function download(url, file) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} pour ${url}`);
  await writeFile(file, Buffer.from(await resp.arrayBuffer()));
}

/** URL du dernier FINESS géolocalisé (ressource etalab-cs1100507-stock-AAAAMMJJ-hhmm.csv la plus récente). */
export function latestFinessUrl(resources) {
  return resources
    .map((r) => ({ url: String(r?.url ?? ''), stamp: /etalab-cs1100507-stock-(\d{8})-\d{4}\.csv$/.exec(String(r?.url ?? ''))?.[1] }))
    .filter((r) => r.stamp)
    .sort((a, b) => (a.stamp < b.stamp ? 1 : -1))[0]?.url ?? null;
}

async function findFile(dir, name) {
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === name && (entry.parentPath ?? entry.path).endsWith('Base CSV')) return join(entry.parentPath ?? entry.path, entry.name);
  }
  throw new Error(`${name} introuvable dans l'archive SAE`);
}

async function main() {
  const arg = (flag) => (process.argv.indexOf(flag) > 0 ? process.argv[process.argv.indexOf(flag) + 1] : null);
  const work = await mkdtemp(join(tmpdir(), 'sae-'));
  try {
    await buildIn(work, arg);
  } finally {
    // Téléchargements (82 Mo) et tables extraites supprimés ; les fichiers passés par --sae et --finess ne sont jamais touchés.
    await rm(work, { recursive: true, force: true });
  }
}

async function buildIn(work, arg) {
  let saeArchive = arg('--sae');
  let finessFile = arg('--finess');
  if (!saeArchive) {
    saeArchive = join(work, 'sae.7z');
    console.log('[build-hospitals] téléchargement de la base administrative SAE…');
    await download(saeUrl(SAE_VINTAGE), saeArchive);
  }
  if (!finessFile) {
    const meta = await fetchMetadata(FINESS_DATASET_API);
    const url = latestFinessUrl(meta?.resources ?? []);
    if (!url) throw new Error('ressource FINESS géolocalisée introuvable sur data.gouv');
    finessFile = join(work, 'finess.csv');
    console.log(`[build-hospitals] téléchargement ${url}…`);
    await download(url, finessFile);
  }
  const includes = SAE_TABLES.flatMap((t) => ['--include', `*/Base CSV/${t}_${SAE_VINTAGE}.csv`]);
  execFileSync('bsdtar', ['-xf', saeArchive, '-C', work, ...includes], { stdio: 'inherit' });
  const sae = {};
  for (const t of SAE_TABLES) sae[t] = readSaeTable(decodeSaeCsv(await readFile(await findFile(work, `${t}_${SAE_VINTAGE}.csv`))));
  const finess = parseFiness(await readFile(finessFile, 'utf8'));
  const dataset = buildHospitalsDataset({ sae, finess });
  const out = fileURLToPath(new URL('../public/data/hospitals-urgences.json', import.meta.url));
  await writeFile(out, `${JSON.stringify(dataset)}\n`);
  const t = dataset.totals;
  console.log(`[build-hospitals] écrit ${out} (FINESS du ${dataset.finessDate})`);
  console.log(`[build-hospitals] contrôle : ${t.sites} sites (attendu 617), ${dataset.sites.length} joints (attendu 616), non joints : ${dataset.unmatched.join(', ') || 'aucun'} (attendu 830200523) ; passages ${t.passages} (attendu ≈ 21,7 millions) ; lits MCO ${t.bedsMco} (attendu 184 933), réanimation ${t.bedsIcu} (attendu 5 755) dans ${t.icuSites} sites (attendu 327), soins intensifs ${t.bedsIntensive} (attendu 9 867)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`[build-hospitals] échec : ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
