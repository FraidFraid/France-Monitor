#!/usr/bin/env node
// scripts/build-communes.mjs : communes de France avec leur population et leur centre, pour la population exposée de l'onglet
// Environnement (20/10/2026). Source : API Découpage administratif (geo.api.gouv.fr, populations légales INSEE, Licence Ouverte).
// Format compact public/data/communes.json : { source, readAt, communes: [[code, nom, département, population, lon, lat], ...] }.
// À relancer chaque année, à la publication des populations légales (fin décembre).
import { writeFileSync } from 'node:fs';

const SOURCE_URL = 'https://geo.api.gouv.fr/communes?fields=nom,code,population,centre,codeDepartement&format=json';
const OUT = new URL('../public/data/communes.json', import.meta.url);

const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'FranceMonitor/1.0 (build-communes)' }, signal: AbortSignal.timeout(60_000) });
if (!res.ok) throw new Error(`geo.api.gouv.fr : HTTP ${res.status}`);
const list = await res.json();
if (!Array.isArray(list) || list.length < 30_000) throw new Error(`réponse inattendue (${Array.isArray(list) ? list.length : 'non tableau'} communes)`);

const communes = [];
let skipped = 0;
for (const c of list) {
  const [lon, lat] = c?.centre?.coordinates ?? [];
  if (typeof c?.code !== 'string' || typeof c?.nom !== 'string' || !Number.isFinite(lon) || !Number.isFinite(lat)) { skipped += 1; continue; }
  const pop = Number.isFinite(c.population) ? c.population : null;
  communes.push([c.code, c.nom, String(c.codeDepartement ?? c.code.slice(0, 2)), pop, Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]);
}
communes.sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync(OUT, JSON.stringify({ source: 'geo.api.gouv.fr (populations légales INSEE)', readAt: new Date().toISOString(), communes }));
const total = communes.reduce((s, c) => s + (c[3] ?? 0), 0);
console.log(`${communes.length} communes écrites (${skipped} écartées), ${total} habitants.`);
