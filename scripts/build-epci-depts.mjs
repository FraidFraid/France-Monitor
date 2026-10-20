#!/usr/bin/env node
// scripts/build-epci-depts.mjs : intercommunalités (SIREN) et nombre de leurs communes par département, pour rattacher l'indice ATMO
// publié par EPCI (Air Breizh, Atmo Occitanie : 17 départements absents sinon, 20/10/2026). Source : API Découpage administratif
// (geo.api.gouv.fr, Licence Ouverte). Sortie api/_shared/epci-depts.js : { '<siren>': [['<dept>', communes], ...] }.
// À relancer au 1er janvier (fusions d'intercommunalités).
import { writeFileSync } from 'node:fs';

const SOURCE_URL = 'https://geo.api.gouv.fr/communes?fields=code,codeDepartement,codeEpci&format=json';
const OUT = new URL('../api/_shared/epci-depts.js', import.meta.url);

const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'FranceMonitor/1.0 (build-epci-depts)' }, signal: AbortSignal.timeout(60_000) });
if (!res.ok) throw new Error(`geo.api.gouv.fr : HTTP ${res.status}`);
const list = await res.json();
if (!Array.isArray(list) || list.length < 30_000) throw new Error(`réponse inattendue (${Array.isArray(list) ? list.length : 'non tableau'} communes)`);

const epcis = new Map();
for (const c of list) {
  if (typeof c?.codeEpci !== 'string' || typeof c?.codeDepartement !== 'string') continue;
  const depts = epcis.get(c.codeEpci) ?? new Map();
  depts.set(c.codeDepartement, (depts.get(c.codeDepartement) ?? 0) + 1);
  epcis.set(c.codeEpci, depts);
}
const out = Object.fromEntries([...epcis].sort(([a], [b]) => a.localeCompare(b)).map(([siren, depts]) => [siren, [...depts].sort((a, b) => b[1] - a[1])]));
writeFileSync(OUT, `// api/_shared/epci-depts.js : GÉNÉRÉ par scripts/build-epci-depts.mjs (${new Date().toISOString().slice(0, 10)}, geo.api.gouv.fr), ne pas éditer.\n`
  + `// Intercommunalité (SIREN) : [département, nombre de ses communes dans ce département], le plus grand d'abord.\n`
  + `export const EPCI_DEPTS = ${JSON.stringify(out)};\n`);
console.log(`${epcis.size} intercommunalités écrites.`);
