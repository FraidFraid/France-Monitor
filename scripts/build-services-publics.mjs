// scripts/build-services-publics.mjs : services publics exposés aux pannes (control room des pannes, lot 2, 21/10/2026)
// → public/data/services-publics.json. Relancer à la main chaque mois : `npm run build:services-publics`.
//
// Sources :
//   - Annuaire de l'administration (DILA, API ouverte, Licence Ouverte 2.0) : brigades de gendarmerie, commissariats de police,
//     préfectures, sous-préfectures, SDIS (siège) ; nom, commune (code INSEE) et position.
//     https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records
//   - Établissements de santé avec urgences : public/data/hospitals-urgences.json (FINESS, npm run build:hospitals).
// Champs abrégés (fichier chargé par le serveur à chaque relève) : t type, n nom, c commune INSEE (null pour les hôpitaux, nommés par
// leur commune), d département, x longitude, y latitude. Aucune donnée personnelle (services, pas des agents).
// Requêtes séquentielles par pages de 100, courte pause, 3 reprises avec attente exponentielle (réseau, 5xx, 429).
import { readFile, writeFile } from 'node:fs/promises';

const API = 'https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records';
const TYPES = [['gendarmerie', 'gendarmerie'], ['commissariat_police', 'police'], ['prefecture', 'prefecture'], ['sous_pref', 'sous_pref'], ['sdis', 'sdis']];
const PAGE = 100;
const OUT = new URL('../public/data/services-publics.json', import.meta.url);
const HOSPITALS = new URL('../public/data/hospitals-urgences.json', import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'FranceMonitor/1.0 (services publics exposés)' } });
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status}`);
      throw Object.assign(new Error(`HTTP ${res.status}`), { retry: true });
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/** Département d'un code INSEE : trois caractères outre-mer (97x), deux sinon (2A et 2B compris). */
export function deptOfInsee(insee) {
  return insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2);
}

/** Un service de l'annuaire, ou null sans position ni commune. */
export function serviceOf(record, type) {
  let pivot = [];
  let adresses = [];
  try { pivot = JSON.parse(record.pivot ?? '[]'); } catch { /* champ illisible */ }
  try { adresses = JSON.parse(record.adresse ?? '[]'); } catch { /* champ illisible */ }
  const insee = pivot.find((p) => Array.isArray(p?.code_insee_commune))?.code_insee_commune?.[0] ?? null;
  const at = adresses.find((a) => a?.longitude && a?.latitude);
  const x = Number(at?.longitude);
  const y = Number(at?.latitude);
  if (!insee || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const name = String(record.nom ?? '').replace(/\s+-\s+/g, ' - ').replace(/\s{2,}/g, ' ').trim();
  return { t: type, n: name, c: insee, d: deptOfInsee(insee), x: Math.round(x * 1e5) / 1e5, y: Math.round(y * 1e5) / 1e5 };
}

async function main() {
  const services = [];
  for (const [pivotType, type] of TYPES) {
    const where = encodeURIComponent(`pivot like "\\"${pivotType}\\""`);
    for (let offset = 0; ; offset += PAGE) {
      const json = await getJson(`${API}?select=nom,adresse,pivot&where=${where}&limit=${PAGE}&offset=${offset}`);
      const rows = Array.isArray(json.results) ? json.results : [];
      for (const r of rows) {
        const s = serviceOf(r, type);
        if (s) services.push(s);
      }
      if (rows.length < PAGE) break;
      await sleep(150);
    }
    console.log(`[services-publics] ${type} : ${services.filter((s) => s.t === type).length}`);
  }
  const hospitals = JSON.parse(await readFile(HOSPITALS, 'utf8'));
  for (const h of hospitals.sites ?? []) {
    if (!Number.isFinite(h.lon) || !Number.isFinite(h.lat) || !h.dept) continue;
    services.push({ t: 'hopital', n: `${h.name} (${h.commune})`, c: null, d: h.dept, x: h.lon, y: h.lat });
  }
  console.log(`[services-publics] hopital : ${services.filter((s) => s.t === 'hopital').length}`);
  const out = { generatedAt: new Date().toISOString(), sources: ['Annuaire de l’administration (DILA)', 'FINESS (urgences)'], services };
  await writeFile(OUT, JSON.stringify(out));
  console.log(`[services-publics] ${services.length} services écrits`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
