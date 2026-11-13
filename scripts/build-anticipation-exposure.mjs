#!/usr/bin/env node
// scripts/build-anticipation-exposure.mjs : enjeux exposés par département pour les fiches de l'onglet Anticipation (13/11/2026).
// Compte, dans les jeux déjà publiés par le site (public/data), les services d'urgences, les EHPAD et les sites Seveso de chaque
// département, et écrit api/_lib/anticipation/exposure-data.js (module généré, ne pas éditer à la main). À relancer quand un de ces
// jeux est mis à jour :  node scripts/build-anticipation-exposure.mjs
import { readFile, writeFile } from 'node:fs/promises';

const read = async (name) => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'));
const [hospitals, ehpad, seveso] = await Promise.all([read('hospitals-urgences'), read('ehpad'), read('seveso')]);

/** @type {Record<string, { urgences: number, passages: number, mainHospitals: string[], ehpad: number, ehpadPlaces: number, sevesoHaut: number, sevesoBas: number }>} */
const depts = {};
const of = (code) => (depts[code] ??= { urgences: 0, passages: 0, mainHospitals: [], ehpad: 0, ehpadPlaces: 0, sevesoHaut: 0, sevesoBas: 0 });
const title = (name) => String(name).toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(Chu|Chr|Ch|Aphp|Ghu|Chi|Hia)\b/g, (m) => m.toUpperCase());

const byDept = new Map();
for (const s of hospitals.sites) {
  if (typeof s.dept !== 'string') continue;
  const d = of(s.dept);
  d.urgences += 1;
  d.passages += Number.isFinite(s.passages) ? s.passages : 0;
  byDept.set(s.dept, [...(byDept.get(s.dept) ?? []), s]);
}
for (const [code, sites] of byDept) {
  of(code).mainHospitals = sites.filter((s) => Number.isFinite(s.passages)).sort((a, b) => b.passages - a.passages).slice(0, 2).map((s) => title(s.name).slice(0, 60));
}
for (const s of ehpad.sites) {
  if (typeof s.dept !== 'string') continue;
  const d = of(s.dept);
  d.ehpad += 1;
  d.ehpadPlaces += Number.isFinite(s.places) ? s.places : 0;
}
for (const s of seveso.sites) {
  if (typeof s.dept !== 'string') continue;
  if (s.seuil === 'haut') of(s.dept).sevesoHaut += 1; else of(s.dept).sevesoBas += 1;
}

const day = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso)); return m ? `${m[3]}/${m[2]}/${m[1]}` : 'n.d.'; };
const sources = {
  urgences: `Services d'urgences : FINESS du ${day(hospitals.finessDate)}, passages annuels SAE ${hospitals.vintage}`,
  ehpad: `EHPAD : FINESS du ${day(ehpad.finessDate)}`,
  seveso: `Sites Seveso : Géorisques, relevé du ${day(seveso.readAt)}`,
};
const sorted = Object.fromEntries(Object.keys(depts).sort().map((k) => [k, depts[k]]));
const body = `// api/_lib/anticipation/exposure-data.js : GÉNÉRÉ par scripts/build-anticipation-exposure.mjs, ne pas éditer à la main.
// Enjeux exposés par département (services d'urgences, EHPAD, sites Seveso), comptés dans les jeux publiés par le site.

export const EXPOSURE_SOURCES = ${JSON.stringify(sources, null, 2)};

/** @type {Record<string, { urgences: number, passages: number, mainHospitals: string[], ehpad: number, ehpadPlaces: number, sevesoHaut: number, sevesoBas: number }>} */
export const EXPOSURE_BY_DEPT = ${JSON.stringify(sorted)};
`;
await writeFile(new URL('../api/_lib/anticipation/exposure-data.js', import.meta.url), body);
console.log(`${Object.keys(sorted).length} départements écrits`);
