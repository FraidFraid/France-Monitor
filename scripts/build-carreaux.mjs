#!/usr/bin/env node
// scripts/build-carreaux.mjs : habitants par carreau de 200 m (Insee, Filosofi 2019, Licence Ouverte), un fichier par département, pour
// compter les habitants DANS les zones inondables du panneau Crues (20/10/2026). Le CSV national (465 Mo) se télécharge à part :
//   https://www.insee.fr/fr/statistiques/7655475 → Filosofi2019_carreaux_200m_csv.zip (archive 7z dedans, bsdtar -xf l'ouvre)
// Usage : node scripts/build-carreaux.mjs <dossier contenant carreaux_200m_met.csv, _mart.csv, _reun.csv>
// Sortie public/data/carreaux/<dept>.json : { source, year, scale, lon0, lat0, communes: [code INSEE], cells: [[dlon, dlat, habitants,
// 80 ans et plus ×10, indice commune]] }, centre du carreau en 1e-4 degré relatif à (lon0, lat0). Un carreau compte pour la première
// commune qu'il touche (lcog_geo). À relancer à chaque nouveau millésime carroyé.
import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const dir = process.argv[2];
if (!dir) throw new Error('usage : node scripts/build-carreaux.mjs <dossier des CSV Filosofi>');
const OUT = new URL('../public/data/carreaux/', import.meta.url);
const SCALE = 1e4;

// ETRS89-LAEA (EPSG:3035) vers longitude/latitude, inverse ellipsoïdale (Snyder, Map Projections, p. 189).
const A = 6378137;
const E2 = 0.0066943800229;
const E = Math.sqrt(E2);
const LAT0 = (52 * Math.PI) / 180;
const LON0 = (10 * Math.PI) / 180;
const q = (phi) => {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
};
const QP = q(Math.PI / 2);
const B1 = Math.asin(q(LAT0) / QP);
const RQ = A * Math.sqrt(QP / 2);
const D = (A * Math.cos(LAT0)) / Math.sqrt(1 - E2 * Math.sin(LAT0) ** 2) / (RQ * Math.cos(B1));
function laeaToLonLat(east, north) {
  const x = east - 4321000;
  const y = north - 3210000;
  const rho = Math.hypot(x / D, D * y);
  const c = 2 * Math.asin(rho / (2 * RQ));
  const beta = Math.asin(Math.cos(c) * Math.sin(B1) + (D * y * Math.sin(c) * Math.cos(B1)) / rho);
  const lon = LON0 + Math.atan2(x * Math.sin(c), D * rho * Math.cos(B1) * Math.cos(c) - D * D * y * Math.sin(B1) * Math.sin(c));
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const lat = beta + (E2 / 3 + (31 * e4) / 180 + (517 * e6) / 5040) * Math.sin(2 * beta)
    + ((23 * e4) / 360 + (251 * e6) / 3780) * Math.sin(4 * beta) + ((761 * e6) / 45360) * Math.sin(6 * beta);
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

const deptOf = (code) => (code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2));
/** département → { communes: Map<code, indice>, rows: [lon, lat, ind, a80, indice] } */
const byDept = new Map();
let total = 0;
let cells = 0;

for (const file of ['carreaux_200m_met.csv', 'carreaux_200m_mart.csv', 'carreaux_200m_reun.csv']) {
  const lines = createInterface({ input: createReadStream(join(dir, file)), crlfDelay: Infinity });
  let col = null;
  for await (const line of lines) {
    const f = line.split(',');
    if (!col) { col = Object.fromEntries(f.map((name, i) => [name.replace(/"/g, ''), i])); continue; }
    const id = f[col.idcar_200m].replace(/"/g, '');
    const m = /N(\d+)E(\d+)$/.exec(id);
    const cog = f[col.lcog_geo].replace(/"/g, '').slice(0, 5);
    const ind = Number(f[col.ind]);
    if (!m || cog.length < 5 || !Number.isFinite(ind) || ind <= 0) continue;
    // Coin bas-gauche du carreau dans l'identifiant : centre à +100 m.
    const [lon, lat] = laeaToLonLat(Number(m[2]) + 100, Number(m[1]) + 100);
    const dept = deptOf(cog);
    let d = byDept.get(dept);
    if (!d) { d = { communes: new Map(), rows: [] }; byDept.set(dept, d); }
    let ci = d.communes.get(cog);
    if (ci === undefined) { ci = d.communes.size; d.communes.set(cog, ci); }
    const a80 = Number(f[col.ind_80p]);
    d.rows.push([lon, lat, Math.round(ind), Number.isFinite(a80) ? Math.round(a80 * 10) : 0, ci]);
    total += ind;
    cells += 1;
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const [dept, d] of byDept) {
  const lon0 = Math.floor(Math.min(...d.rows.map((r) => r[0])) * SCALE);
  const lat0 = Math.floor(Math.min(...d.rows.map((r) => r[1])) * SCALE);
  const out = d.rows.map((r) => [Math.round(r[0] * SCALE) - lon0, Math.round(r[1] * SCALE) - lat0, r[2], r[3], r[4]]);
  writeFileSync(new URL(`${dept}.json`, OUT), JSON.stringify({
    source: 'Insee, Filosofi 2019, carreaux de 200 m', year: 2019, scale: SCALE, lon0, lat0, communes: [...d.communes.keys()], cells: out,
  }));
}
console.log(`${cells} carreaux, ${Math.round(total)} habitants, ${byDept.size} départements écrits.`);
