#!/usr/bin/env node
/**
 * fetch-apl.mjs — Télécharge les données APL (Accessibilité Potentielle Localisée)
 * depuis les sources DREES officielles et génère public/data/apl-departements.json
 *
 * Sources essayées dans l'ordre :
 * 1. data.gouv.fr — export CSV communal DREES 2023 (lien direct static.data.gouv.fr)
 * 2. INSEE/IRDES via data.gouv.fr resource discovery
 *
 * Usage : node scripts/fetch-apl.mjs
 * Résultat : public/data/apl-departements.json
 *
 * Seuils APL DREES 2023 (consultations/an/habitant) :
 *   < 2.5 = désert médical
 *   2.5–4 = fragile
 *   4–7   = bon accès
 *   > 7   = sur-doté
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '../public/data/apl-departements.json');

// URLs candidates (essayées dans l'ordre)
const CSV_CANDIDATES = [
  // DREES 2023 via static.data.gouv.fr (recherchez la vraie URL dans la fiche du dataset)
  'https://static.data.gouv.fr/resources/donnees-sur-lindicateur-daccessibilite-potentielle-localisee-apl/20241015-135044/apl-medecins-generalistes-commune-2023.csv',
  // Alternative : export direct depuis le portail DREES (si il répond)
  'https://data.drees.solidarites-sante.gouv.fr/api/explore/v2.1/catalog/datasets/accessibilite-potentielle-localisee-apl-aux-medecins-generalistes/exports/csv?limit=-1',
  // Fallback : fichier de la fiche dataset data.gouv.fr
  'https://www.data.gouv.fr/api/1/datasets/donnees-sur-lindicateur-daccessibilite-potentielle-localisee-apl/',
];

function toAplCategory(apl) {
  if (!Number.isFinite(apl)) return 'indisponible';
  if (apl < 2.5) return 'desert';
  if (apl < 4.0) return 'fragile';
  if (apl <= 7.0) return 'bon';
  return 'surdote';
}

function normalizeDep(code) {
  if (!code) return '';
  const s = String(code).trim().toUpperCase();
  if (s === '2A' || s === '2B') return s;
  if (s.length > 2) return s.slice(0, 2).replace(/^0/, '') || s.slice(0, 2);
  return s.replace(/^0/, '') || s;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const delimiters = [';', ',', '\t'];
  let delim = ';';
  let best = 0;
  for (const d of delimiters) {
    const count = (lines[0].match(new RegExp(d === '\\t' ? '\t' : d, 'g')) || []).length;
    if (count > best) { best = count; delim = d; }
  }
  const headers = lines[0].split(delim).map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'));
  return lines.slice(1).map(l => {
    const cols = l.split(delim);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] ?? '').trim(); });
    return obj;
  });
}

function aggregateByDep(rows) {
  const byDep = new Map();
  for (const row of rows) {
    let dep = '';
    // Essayer champ dep direct
    for (const k of ['dep', 'dep_', 'departement', 'code_dep', 'code_departement', 'dep_code']) {
      const v = row[k] || row[k.toUpperCase()];
      if (v) { dep = normalizeDep(v); break; }
    }
    // Sinon extraire du code commune
    if (!dep) {
      for (const k of ['code_com', 'codgeo', 'code_commune', 'com', 'code_geo']) {
        const v = row[k] || row[k.toUpperCase()];
        if (v && String(v).length >= 5) {
          const s = String(v).toUpperCase();
          dep = s.startsWith('2') ? (s.startsWith('2A') ? '2A' : s.startsWith('2B') ? '2B' : normalizeDep(s.slice(0, 2))) : normalizeDep(s.slice(0, 2));
          if (dep) break;
        }
      }
    }
    if (!dep) continue;

    // Trouver la valeur APL
    let apl = NaN;
    for (const k of ['apl', 'apl_mg', 'apl_medecin_generaliste', 'apl_index', 'apl_2023', 'valeur']) {
      const v = parseFloat(String(row[k] || row[k.toUpperCase()] || '').replace(',', '.'));
      if (Number.isFinite(v) && v >= 0) { apl = v; break; }
    }
    if (!Number.isFinite(apl)) continue;

    const prev = byDep.get(dep) ?? { sum: 0, n: 0 };
    prev.sum += apl;
    prev.n += 1;
    byDep.set(dep, prev);
  }

  return [...byDep.entries()].map(([dep, agg]) => {
    const aplIndex = agg.n > 0 ? Math.round((agg.sum / agg.n) * 1000) / 1000 : null;
    return { code_insee: dep, apl_index: aplIndex, category: toAplCategory(aplIndex) };
  }).sort((a, b) => a.code_insee.localeCompare(b.code_insee));
}

async function fetchWithRetry(url, maxMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), maxMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/csv,text/plain,*/*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log('🏥 Fetch APL data...');
  let rows = [];
  let usedUrl = null;

  for (const url of CSV_CANDIDATES) {
    console.log(`  Trying: ${url.slice(0, 80)}...`);
    try {
      const text = await fetchWithRetry(url, 30000);
      if (text.length > 1000 && text.includes('\n')) {
        rows = parseCsv(text);
        if (rows.length > 100) {
          usedUrl = url;
          console.log(`  ✅ Got ${rows.length} rows from ${url.slice(0, 60)}`);
          break;
        }
      }
    } catch (e) {
      console.log(`  ❌ Failed: ${e.message}`);
    }
  }

  if (rows.length === 0) {
    console.error('❌ Could not fetch APL data from any source.');
    console.log(`
📋 MANUAL STEPS:
1. Download the APL data manually from:
   https://drees.solidarites-sante.gouv.fr/sources-outils-et-enquetes/lindicateur-daccessibilite-potentielle-localisee

2. Save the CSV file as: public/data/apl-raw.csv

3. Re-run this script with the file:
   node scripts/fetch-apl.mjs --local public/data/apl-raw.csv
`);

    // If --local flag provided, try reading local file
    const localIdx = process.argv.indexOf('--local');
    if (localIdx >= 0 && process.argv[localIdx + 1]) {
      const localPath = process.argv[localIdx + 1];
      console.log(`  Reading local file: ${localPath}`);
      const text = fs.readFileSync(localPath, 'utf-8');
      rows = parseCsv(text);
      usedUrl = `local:${localPath}`;
      console.log(`  Got ${rows.length} rows`);
    }
  }

  if (rows.length === 0) {
    process.exit(1);
  }

  const departements = aggregateByDep(rows);
  console.log(`  Aggregated: ${departements.length} departments`);

  if (departements.length === 0) {
    console.error('❌ No departments found after aggregation. Check CSV column names.');
    console.log('First row sample:', rows[0]);
    process.exit(1);
  }

  // Create output directory if needed
  const outDir = path.dirname(OUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let dataYear = '2023';
  if (usedUrl) {
    const match = usedUrl.match(/20\d{2}/);
    if (match) dataYear = match[0];
  }
  if (rows.length > 0) {
    const firstRow = rows[0];
    const yearKey = Object.keys(firstRow).find(k => k.includes('annee') || k.includes('millesime') || k.includes('date'));
    if (yearKey && firstRow[yearKey]) {
      const parsedYear = String(firstRow[yearKey]).match(/20\d{2}/);
      if (parsedYear) dataYear = parsedYear[0];
    }
  }

  const output = {
    departements,
    metadata: {
      generated_at: new Date().toISOString(),
      source: usedUrl,
      year: dataYear,
      rows: rows.length,
      departments_found: departements.length,
    }
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(`✅ Saved to ${OUT_PATH}`);
  console.log(`\nSample (first 3 deps):`);
  departements.slice(0, 3).forEach(d => console.log(`  ${d.code_insee}: APL=${d.apl_index} (${d.category})`));
}

main().catch(e => { console.error(e); process.exit(1); });
