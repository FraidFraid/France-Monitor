#!/usr/bin/env node
// scripts/build-deces.mjs : décès quotidiens par département de résidence (Insee, état civil) agrégés par mois
// → public/data/deces.json. Données agrégées, aucune donnée nominative (le fichier détail de l'Insee n'est pas utilisé).
// L'Insee publie un fichier par millésime, mis à jour chaque mois avec environ un mois de recul ; les années récentes
// sont provisoires. Les pages sont lues pour retrouver le lien du fichier (son nom change à chaque édition).
//   node scripts/build-deces.mjs [--out <fichier.json>]
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readXlsxFile from 'read-excel-file/node';

const INSEE = 'https://www.insee.fr';
// Pages « Données régionales et départementales sur les décès » : la plus récente en dernier (elle l'emporte sur les dates communes).
const PAGES = ['/fr/statistiques/7929668?sommaire=7764286', '/fr/statistiques/8564519?sommaire=7764286', '/fr/statistiques/9000834?sommaire=7764286'];
const UA = { 'User-Agent': 'Mozilla/5.0 (France Monitor, données ouvertes)' };

async function fetchOk(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

/** Lien du fichier T1 (décès par jour, départements et régions) d'une page Insee. */
export function t1Link(html) {
  const m = /\/fr\/statistiques\/fichier\/\d+\/T1_DECES_JOUR_DEP_REG[^"']*\.xlsx/.exec(html);
  return m ? m[0] : null;
}

/** Lignes de l'onglet « Départements » ([code, libellé, AAAA-MM-JJ, nombre]) → Map(code → { name, days: Map(date → n) }). */
export function readDepartments(rows, into = new Map()) {
  for (const r of rows) {
    const [code, name, date, n] = r;
    if (typeof code !== 'string' || !/^(\d{2,3}|2A|2B)$/.test(code) || code === '99') continue;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(n)) continue;
    const d = into.get(code) ?? { name, days: new Map() };
    d.days.set(date, n);
    into.set(code, d);
  }
  return into;
}

async function main() {
  const depts = new Map();
  const files = [];
  for (const page of PAGES) {
    const html = await (await fetchOk(`${INSEE}${page}`)).text();
    const link = t1Link(html);
    if (!link) { console.warn(`[build-deces] aucun fichier T1 sur ${page}`); continue; }
    const buf = Buffer.from(await (await fetchOk(`${INSEE}${link}`)).arrayBuffer());
    const sheets = await readXlsxFile(buf);
    const sheet = sheets.find((s) => s.sheet === 'Départements');
    if (!sheet) throw new Error(`onglet Départements absent de ${link}`);
    readDepartments(sheet.data, depts);
    files.push(`${INSEE}${link}`);
    console.log(`[build-deces] ${link}`);
  }
  let last = '';
  const out = {};
  for (const [code, d] of depts) {
    const months = {};
    for (const [date, n] of d.days) { const m = date.slice(0, 7); months[m] = (months[m] ?? 0) + n; if (date > last) last = date; }
    out[code] = { name: d.name, months };
  }
  // Mois complet seulement : le dernier mois n'est gardé que s'il va jusqu'à son dernier jour.
  const lastMonth = last.slice(0, 7);
  const monthEnd = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const complete = last === monthEnd ? lastMonth : new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const dataset = { source: 'Insee, état civil, décès par jour et par département de résidence', files, lastDay: last, lastCompleteMonth: complete, depts: out };
  const outArg = process.argv.indexOf('--out') > 0 ? process.argv[process.argv.indexOf('--out') + 1] : null;
  const file = outArg ?? fileURLToPath(new URL('../public/data/deces.json', import.meta.url));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(dataset)}\n`);
  await rename(`${file}.tmp`, file);
  console.log(`[build-deces] écrit ${file} : ${Object.keys(out).length} départements, jusqu'au ${last} (dernier mois complet ${complete})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`[build-deces] échec : ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
