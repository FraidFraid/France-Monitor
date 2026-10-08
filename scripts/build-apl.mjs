#!/usr/bin/env node
// scripts/build-apl.mjs : accessibilité potentielle localisée (APL, DREES) agrégée par département
// → public/data/apl-2024.json (AplDataset, spec 2026-10-03 panneaux santé § 2.7). À lancer une fois par an,
// à la publication d'un nouveau millésime :
//   node scripts/build-apl.mjs                 télécharge les cinq classeurs DREES (environ 28 Mo) puis écrit le fichier
//   node scripts/build-apl.mjs --dir <dossier> lit des classeurs déjà téléchargés (<identifiant de pièce jointe>.xlsx)
// Règle DREES (feuille et Lisez-moi) : APL moyen = moyenne des APL communaux pondérée par la population
// standardisée ; population sous un seuil = population totale (non standardisée). Mayotte est absente du fichier
// DREES : elle est listée dans `missing`, jamais remplacée. Lecture xlsx : read-excel-file (dépendance de
// développement, MIT, lit l'OOXML sans exécuter de formule).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPT_NAMES } from '../api/_shared/departments.js';

export const DATASET = '530_l-accessibilite-potentielle-localisee-apl';
const DREES = 'https://data.drees.solidarites-sante.gouv.fr';
export const VINTAGE = 2024;
export const YEARS = [2022, 2023, 2024];
/** Seuil historique du zonage médecin 2017-2022 (zone d'intervention prioritaire), consultations par an et par habitant. */
export const MG_THRESHOLD = 2.5;

/** Professions : clé du contrat, pièce jointe DREES, décimales de l'APL (consultations pour mg, ETP pour 100 000 sinon). */
export const PROFESSIONS = Object.freeze([
  { key: 'mg', attachment: 'indicateur_d_apl_aux_medecins_generalistes_xlsx', digits: 2 },
  { key: 'inf', attachment: 'indicateur_d_apl_aux_infirmiers_xlsx', digits: 1 },
  { key: 'kine', attachment: 'indicateur_d_apl_aux_kinesitherapeutes_xlsx', digits: 1 },
  { key: 'sf', attachment: 'indicateur_d_apl_aux_sages_femmes_xlsx', digits: 1 },
  { key: 'dent', attachment: 'indicateur_d_apl_aux_chirurgiens_dentistes_xlsx', digits: 1 },
]);

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
const COMMUNE_RE = /^(?:\d{2}|2A|2B)\d{3}$/;

/** Département d'une commune INSEE : trois caractères outre-mer (97x), deux sinon (arrondissements et Corse compris). */
export function departmentOf(communeCode) {
  const code = String(communeCode);
  return code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2);
}

/**
 * Feuille « APL 20xx » (lignes brutes de read-excel-file) → communes { code, dep, apl, popStd, popTotal }.
 * En-tête : ligne dont la première cellule vaut « Code commune INSEE » (ligne 9 des classeurs 2022-2024),
 * suivie d'une ligne d'unités. Colonnes reconnues par leur début de libellé : « APL aux » (la première, pas les
 * variantes restreintes aux médecins de 65 ans ou moins), « Population standardisée » ou « Population féminine
 * standardisée », « Population totale ».
 */
export function parseAplSheet(rows) {
  const headerAt = rows.findIndex((r) => Array.isArray(r) && String(r[0] ?? '').trim() === 'Code commune INSEE');
  if (headerAt < 0) throw new Error('en-tête « Code commune INSEE » introuvable');
  const header = rows[headerAt].map((h) => String(h ?? '').trim());
  const col = (test) => header.findIndex(test);
  const iApl = col((h) => h.startsWith('APL aux '));
  const iStd = col((h) => h.startsWith('Population standardisée') || h.startsWith('Population féminine standardisée'));
  const iTot = col((h) => h.startsWith('Population totale'));
  if (iApl < 0 || iStd < 0 || iTot < 0) throw new Error(`colonnes APL introuvables : ${header.join(' | ')}`);
  const communes = [];
  for (const row of rows.slice(headerAt + 1)) {
    const code = String(row?.[0] ?? '').trim();
    const apl = row?.[iApl];
    const popStd = row?.[iStd];
    const popTotal = row?.[iTot];
    if (!COMMUNE_RE.test(code) || typeof apl !== 'number' || typeof popStd !== 'number' || typeof popTotal !== 'number') continue;
    communes.push({ code, dep: departmentOf(code), apl, popStd, popTotal: Math.round(popTotal) });
  }
  return communes;
}

/** APL moyen pondéré par la population standardisée ; population totale et population sous le seuil. */
export function aggregate(communes, threshold = null) {
  let weighted = 0;
  let std = 0;
  let pop = 0;
  let under = 0;
  for (const c of communes) {
    weighted += c.apl * c.popStd;
    std += c.popStd;
    pop += c.popTotal;
    if (threshold !== null && c.apl < threshold) under += c.popTotal;
  }
  return { apl: std > 0 ? weighted / std : null, pop, popUnder: under };
}

function byDepartment(communes) {
  const map = new Map();
  for (const c of communes) {
    if (!map.has(c.dep)) map.set(c.dep, []);
    map.get(c.dep).push(c);
  }
  return map;
}

const share = (part, total) => (total > 0 ? round((part / total) * 100, 1) : 0);

/**
 * Communes par profession et par année → AplDataset.
 * @param {{ sheets: Record<string, Record<number, Array<{ code: string, dep: string, apl: number, popStd: number, popTotal: number }>>>, publishedAt: string, names?: Record<string, string> }} input
 */
export function buildAplDataset({ sheets, publishedAt, names = DEPT_NAMES }) {
  const professions = PROFESSIONS.map((p) => p.key);
  const deps = {};
  for (const p of PROFESSIONS) {
    deps[p.key] = {};
    for (const year of [2023, VINTAGE]) deps[p.key][year] = byDepartment(sheets[p.key]?.[year] ?? []);
  }
  const mgDeps = deps.mg[VINTAGE];
  const codes = Object.keys(names).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const aplOf = (p, communes) => {
    const v = communes ? aggregate(communes).apl : null;
    return v === null ? null : round(v, PROFESSIONS.find((x) => x.key === p).digits);
  };
  const departments = codes.filter((code) => mgDeps.has(code)).map((code) => {
    const mg = aggregate(mgDeps.get(code), MG_THRESHOLD);
    return {
      code,
      name: names[code],
      apl: Object.fromEntries(professions.map((p) => [p, aplOf(p, deps[p][VINTAGE].get(code))])),
      apl2023: Object.fromEntries(professions.map((p) => [p, aplOf(p, deps[p][2023].get(code))])),
      pop: mg.pop,
      popUnder25: mg.popUnder,
      shareUnder25: share(mg.popUnder, mg.pop),
    };
  });
  const franceApl = (year) => Object.fromEntries(professions.map((p) => [p, aplOf(p, sheets[p]?.[year] ?? [])]));
  const byYear = YEARS.map((year) => {
    const mg = aggregate(sheets.mg?.[year] ?? [], MG_THRESHOLD);
    return { year, aplMg: mg.apl === null ? null : round(mg.apl, 2), shareUnder25: share(mg.popUnder, mg.pop), popUnder25: mg.popUnder };
  });
  return {
    vintage: VINTAGE,
    publishedAt,
    source: `DREES, accessibilité potentielle localisée (APL) aux professionnels de santé, jeu ${DATASET}`,
    france: { apl: franceApl(VINTAGE), apl2023: franceApl(2023), byYear },
    departments,
    missing: codes.filter((code) => !mgDeps.has(code)),
  };
}

/** JSON de métadonnées : statut HTTP contrôlé, délai borné. */
export async function fetchMetadata(url, timeoutMs = 60_000) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} pour ${url}`);
  return resp.json();
}

/** Date de publication du jeu (AAAA-MM-JJ, S1) ; absente ou illisible : échec, jamais un fichier sans date. */
export function publishedAtOf(meta) {
  const date = String(meta?.metas?.default?.modified ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date de publication absente des métadonnées DREES');
  return date;
}

async function download(url, file) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} pour ${url}`);
  await writeFile(file, Buffer.from(await resp.arrayBuffer()));
}

async function main() {
  const { default: readExcelFile } = await import('read-excel-file/node');
  const dirArg = process.argv.indexOf('--dir');
  const dir = dirArg > 0 ? process.argv[dirArg + 1] : await mkdtemp(join(tmpdir(), 'apl-'));
  try {
    await buildFrom(dir, dirArg < 0, readExcelFile);
  } finally {
    // Classeurs téléchargés (28 Mo) supprimés ; un dossier passé par --dir n'est jamais touché.
    if (dirArg < 0) await rm(dir, { recursive: true, force: true });
  }
}

async function buildFrom(dir, downloadFirst, readExcelFile) {
  const publishedAt = publishedAtOf(await fetchMetadata(`${DREES}/api/explore/v2.1/catalog/datasets/${DATASET}`));
  const sheets = {};
  for (const p of PROFESSIONS) {
    const file = join(dir, `${p.attachment}.xlsx`);
    if (downloadFirst) {
      console.log(`[build-apl] téléchargement ${p.attachment}…`);
      await download(`${DREES}/api/v2/catalog/datasets/${DATASET}/attachments/${p.attachment}`, file);
    }
    const workbook = await readExcelFile(await readFile(file));
    sheets[p.key] = {};
    for (const year of YEARS) {
      const sheet = workbook.find((s) => s.sheet === `APL ${year}`);
      if (!sheet) throw new Error(`feuille « APL ${year} » absente de ${file}`);
      sheets[p.key][year] = parseAplSheet(sheet.data);
    }
    console.log(`[build-apl] ${p.key} : ${sheets[p.key][VINTAGE].length} communes en ${VINTAGE}`);
  }
  const dataset = buildAplDataset({ sheets, publishedAt });
  const out = fileURLToPath(new URL('../public/data/apl-2024.json', import.meta.url));
  await writeFile(out, `${JSON.stringify(dataset)}\n`);
  const dep = (code) => dataset.departments.find((d) => d.code === code);
  const y2022 = dataset.france.byYear.find((y) => y.year === 2022);
  const y2024 = dataset.france.byYear.find((y) => y.year === VINTAGE);
  console.log(`[build-apl] écrit ${out} (${dataset.departments.length} départements, absents : ${dataset.missing.join(', ') || 'aucun'})`);
  console.log(`[build-apl] contrôle : France ${y2024.aplMg} (attendu 3,72) ; part sous 2,5 ${y2024.shareUnder25} % (attendu 18,2), ${y2024.popUnder25} habitants (attendu ≈ 12,3 millions) ; 2022 ${y2022.shareUnder25} % (attendu 14,9) ; Paris ${dep('75')?.apl.mg} (attendu 5,50) ; Bouches-du-Rhône ${dep('13')?.apl.mg} (attendu 4,60)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`[build-apl] échec : ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
