#!/usr/bin/env node
// scripts/build-seveso.mjs : recensement des établissements Seveso (seuil haut et seuil bas) en France pour la couche Seveso
// → public/data/seveso.json. Relancer à la main chaque trimestre : `npm run build:seveso`.
//
// Source : Géorisques, installations classées (API v1, sans clé) :
//   https://georisques.gouv.fr/api/v1/installations_classees?departement=<CODE>&page_size=1000&page=<N>
// Licence : Licence Ouverte Etalab 2.0.
// Les filtres d'API sur le statut Seveso ne fonctionnent pas : le tri se fait ici, sur le champ statutSeveso
// ('Seveso seuil haut', 'Seveso seuil bas', 'Non Seveso' ou null) et sur etatActivite (on garde seulement « En exploitation… »).
// Requêtes séquentielles, courte pause entre deux, 3 reprises avec attente exponentielle (réseau, 5xx, 429).
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = 'https://georisques.gouv.fr/api/v1/installations_classees';
const PAUSE_MS = 150;
const RETRIES = 3;
const PAGE_SIZE = 1000;
const OUT = fileURLToPath(new URL('../public/data/seveso.json', import.meta.url));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Codes départements acceptés par l'API : métropole (dont 2A et 2B) puis DROM. */
export function departementCodes() {
  const codes = [];
  for (let i = 1; i <= 95; i++) {
    if (i === 20) { codes.push('2A', '2B'); continue; }
    codes.push(String(i).padStart(2, '0'));
  }
  return codes.concat(['971', '972', '973', '974', '976']);
}

async function fetchJson(url) {
  let derniere;
  for (let essai = 0; essai < RETRIES; essai++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'FranceMonitor-seveso/1.0' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      derniere = e;
      await sleep(1000 * 2 ** essai);
    }
  }
  throw derniere;
}

/** Une passe complète sur un département avec une taille de page donnée. */
async function passe(code, taille) {
  const lignes = [];
  let page = 1;
  let total = 1;
  let results = 0;
  while (page <= total) {
    const json = await fetchJson(`${API}?departement=${code}&page_size=${taille}&page=${page}`);
    total = json.total_pages || 0;
    results = json.results || 0;
    lignes.push(...(json.data || []));
    page++;
    await sleep(PAUSE_MS);
  }
  return { lignes, results, pages: total };
}

const estSeveso = (l) => l.statutSeveso === 'Seveso seuil haut' || l.statutSeveso === 'Seveso seuil bas';
const TAILLES = [1000, 250, 500, 100];
const PASSES_MAX = 8;

/**
 * Toutes les lignes Seveso d'un département. La pagination de l'API est instable (constaté le 20/10/2026 : lignes en double
 * d'une page à l'autre et d'autres absentes dès que le département dépasse une page, même à taille de page identique).
 * Dès qu'il y a plus d'une page, on refait des passes (tailles de page variées) et on réunit les résultats par codeAIOT,
 * jusqu'à deux passes de suite sans nouveauté.
 */
async function fetchDepartement(code) {
  const unis = new Map();
  let toutes = [];
  let sansNouveau = 0;
  for (let i = 0; i < PASSES_MAX; i++) {
    const { lignes, pages } = await passe(code, TAILLES[i % TAILLES.length]);
    toutes = lignes.length ? lignes : toutes;
    let nouveaux = 0;
    for (const l of lignes) {
      if (estSeveso(l) && !unis.has(l.codeAIOT)) { unis.set(l.codeAIOT, l); nouveaux++; }
    }
    if (pages <= 1) break;
    sansNouveau = nouveaux ? 0 : sansNouveau + 1;
    if (sansNouveau >= 2) break;
  }
  return { total: toutes.length, seveso: [...unis.values()] };
}

const SEUILS = { 'Seveso seuil haut': 'haut', 'Seveso seuil bas': 'bas' };
const r5 = (n) => Math.round(n * 1e5) / 1e5;

/** Transforme les lignes d'un département en sites ; met à jour les compteurs de diagnostic. */
export function extraire(lignes, dept, stats) {
  const sites = [];
  for (const l of lignes) {
    const seuil = SEUILS[l.statutSeveso];
    if (!seuil) continue;
    const etat = String(l.etatActivite ?? '');
    stats.etats.set(etat, (stats.etats.get(etat) || 0) + 1);
    if (!/^en exploitation/i.test(etat)) { stats.ecartesEtat++; continue; }
    const lon = Number(l.longitude);
    const lat = Number(l.latitude);
    if (l.longitude == null || l.latitude == null || !Number.isFinite(lon) || !Number.isFinite(lat) || (lon === 0 && lat === 0)) {
      stats.sansCoord++;
      continue;
    }
    sites.push({
      id: String(l.codeAIOT),
      name: String(l.raisonSociale ?? '').trim(),
      commune: String(l.commune ?? '').trim(),
      insee: l.codeInsee ?? '',
      dept,
      seuil,
      lon: r5(lon),
      lat: r5(lat),
      url: 'https://www.georisques.gouv.fr/risques/installations/donnees/details/' + l.codeAIOT,
    });
  }
  return sites;
}

async function main() {
  const filtre = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const codes = filtre.length ? filtre : departementCodes();
  const stats = { etats: new Map(), ecartesEtat: 0, sansCoord: 0 };
  const parId = new Map();
  const echecs = [];
  for (const code of codes) {
    try {
      const { total, seveso: lignes } = await fetchDepartement(code);
      if (!total) { console.warn(`[seveso] ${code} : 0 résultat`); echecs.push(code); continue; }
      const sites = extraire(lignes, code, stats);
      for (const s of sites) if (!parId.has(s.id)) parId.set(s.id, s);
      console.log(`[seveso] ${code} : ${total} lignes, ${sites.length} Seveso en exploitation`);
    } catch (e) {
      console.warn(`[seveso] ${code} : échec (${e.message})`);
      echecs.push(code);
    }
  }
  const sites = [...parId.values()].sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name, 'fr'));
  const counts = { haut: sites.filter((s) => s.seuil === 'haut').length, bas: sites.filter((s) => s.seuil === 'bas').length };
  console.log('[seveso] etatActivite vus (Seveso seulement) :', Object.fromEntries(stats.etats));
  console.log(`[seveso] écartés (hors exploitation) : ${stats.ecartesEtat} · sans coordonnées valides : ${stats.sansCoord}`);
  if (echecs.length) console.warn('[seveso] départements en échec ou vides :', echecs.join(', '));
  if (filtre.length) { console.log('[seveso] sous-ensemble : fichier non écrit', counts); return; }
  if (echecs.length > 5) throw new Error('trop de départements en échec : fichier non écrit');
  const dataset = { source: 'Géorisques, installations classées (API v1)', readAt: new Date().toISOString(), counts, sites };
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(dataset));
  console.log(`[seveso] ${OUT} : ${counts.haut} seuil haut, ${counts.bas} seuil bas`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
