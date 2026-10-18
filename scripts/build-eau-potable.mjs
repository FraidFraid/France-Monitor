#!/usr/bin/env node
// scripts/build-eau-potable.mjs : prélèvements d'eau du robinet non conformes (contrôle sanitaire, Hub'Eau) des 60 derniers
// jours publiés, regroupés par commune avec sa position → public/data/eau-potable.json.
// Hub'Eau limite chaque requête à 20 000 lignes : une requête par département et par type (bactériologie, physico-chimie).
// Publication mensuelle : à relancer une fois par mois (npm run build:eau-potable).
// Aucune donnée personnelle : résultats d'analyses publics par réseau et par commune.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HUBEAU = 'https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/resultats_dis';
const GEO = 'https://geo.api.gouv.fr/communes?fields=code,nom,centre,codeDepartement&format=json';
const DAYS = 60;
const FIELDS = ['code_prelevement', 'code_commune', 'nom_commune', 'code_departement', 'date_prelevement', 'libelle_parametre', 'resultat_numerique',
  'resultat_alphanumerique', 'libelle_unite', 'limite_qualite_parametre', 'conclusion_conformite_prelevement', 'nom_distributeur', 'nom_uge'].join(',');
const DEPTS = [...Array.from({ length: 95 }, (_, i) => String(i + 1).padStart(2, '0')).filter((d) => d !== '20'), '2A', '2B', '971', '972', '973', '974', '976'];

// Conclusion de l'ARS : la phrase dit si l'eau reste consommable ou si une restriction s'applique (négations comprises).
const NO_RESTRICT = /(n['’] ?a pas n[ée]cessit[ée]|ne n[ée]cessit\w* pas|ne justifi\w* pas|sans|aucune) (de |d['’] ?|la )?(mesure de )?restriction/i;
const TARGETED = /d[ée]conseill[ée]\w* (aux|pour les) (femmes enceintes|nourrissons|personnes|populations)/i;
const RESTRICT = /(ne (pas|plus) (la )?(boire|consommer|utiliser)|non potable|impropre [àa] la consommation|interdi\w* (de )?(la )?consommation|restriction de (la )?consommation|consommation (est )?(d[ée]conseill|interdit)|faire bouillir|eau embouteill)/i;
const DRINKABLE = /(propre [àa] la consommation|reste consommable|peut [êe]tre consomm|sans risque)/i;

/** « <=0,1 µg/L » → 0.1 ; « <=0 n/(100mL) » → 0. */
export function limitValue(text) {
  const m = /<=\s*([\d,.]+)/.exec(String(text ?? ''));
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** Lecture de la conclusion : restriction générale, restriction pour les publics sensibles, consommable, ou non précisé. */
export function verdictOf(conclusion) {
  const t = String(conclusion ?? '').replace(/\s+/g, ' ');
  if (NO_RESTRICT.test(t)) return 'consommable';
  if (TARGETED.test(t)) return 'restriction ciblée';
  if (RESTRICT.test(t)) return 'restriction';
  if (DRINKABLE.test(t)) return 'consommable';
  return 'non précisé';
}

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (res.ok || res.status === 206) return await res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`${res.status} ${url}`);
    } catch (err) { if (i === tries - 1) throw err; }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error(`échec ${url}`);
}

/** Lignes d'analyses (une par paramètre) → communes avec leurs prélèvements non conformes et les paramètres dépassés. */
export function aggregate(rows, kindOf) {
  const communes = new Map();
  for (const r of rows) {
    const c = communes.get(r.code_commune) ?? { code: r.code_commune, nom: r.nom_commune, dept: r.code_departement, samples: new Map() };
    communes.set(r.code_commune, c);
    const s = c.samples.get(r.code_prelevement) ?? { date: r.date_prelevement.slice(0, 10), kinds: new Set(), distributor: r.nom_distributeur ?? null, network: r.nom_uge ?? null,
      conclusion: r.conclusion_conformite_prelevement ?? '', exceed: [] };
    c.samples.set(r.code_prelevement, s);
    s.kinds.add(kindOf(r));
    const lim = limitValue(r.limite_qualite_parametre);
    if (lim != null && Number.isFinite(r.resultat_numerique) && r.resultat_numerique > lim && !s.exceed.some((x) => x.p === r.libelle_parametre)) {
      s.exceed.push({ p: r.libelle_parametre, v: r.resultat_alphanumerique, lim: r.limite_qualite_parametre });
    }
  }
  return communes;
}

async function main() {
  const latest = await getJson(`${HUBEAU}?size=1&sort=desc&fields=date_prelevement`);
  const last = String(latest?.data?.[0]?.date_prelevement ?? '').slice(0, 10);
  if (!last) throw new Error('date de dernière publication introuvable');
  const from = new Date(Date.parse(last) - DAYS * 864e5).toISOString().slice(0, 10);
  console.log(`[build-eau-potable] prélèvements du ${from} au ${last}`);
  const rows = [];
  for (const kind of ['bact', 'pc']) {
    const flag = kind === 'bact' ? 'conformite_limites_bact_prelevement' : 'conformite_limites_pc_prelevement';
    for (const d of DEPTS) {
      const res = await getJson(`${HUBEAU}?${flag}=N&code_departement=${d}&date_min_prelevement=${from}&size=20000&fields=${FIELDS}`);
      for (const r of res.data ?? []) rows.push({ ...r, kind });
      if ((res.count ?? 0) > 20000) console.warn(`[build-eau-potable] ${d} ${kind} : ${res.count} lignes, tronqué à 20 000`);
    }
    console.log(`[build-eau-potable] ${kind} : ${rows.filter((r) => r.kind === kind).length} lignes`);
  }
  const communes = aggregate(rows, (r) => r.kind);
  const geo = new Map((await getJson(GEO)).map((c) => [c.code, c.centre?.coordinates ?? null]));
  const out = [];
  let unplaced = 0;
  for (const c of communes.values()) {
    const at = geo.get(c.code);
    if (!at) { unplaced += 1; continue; }
    const samples = [...c.samples.values()].sort((a, b) => b.date.localeCompare(a.date))
      .map((s) => ({ date: s.date, kinds: [...s.kinds], verdict: verdictOf(s.conclusion), distributor: s.distributor, network: s.network, exceed: s.exceed.slice(0, 6), conclusion: s.conclusion.slice(0, 400) }));
    out.push({ code: c.code, nom: c.nom, dept: c.dept, lon: at[0], lat: at[1], samples });
  }
  const dataset = { from, to: last, communes: out, totals: { communes: out.length, unplaced, samples: out.reduce((n, c) => n + c.samples.length, 0),
    restriction: out.filter((c) => c.samples.some((s) => s.verdict === 'restriction')).length,
    targeted: out.filter((c) => c.samples.some((s) => s.verdict === 'restriction ciblée')).length } };
  const file = fileURLToPath(new URL('../public/data/eau-potable.json', import.meta.url));
  await writeFile(file, `${JSON.stringify(dataset)}\n`);
  const t = dataset.totals;
  console.log(`[build-eau-potable] écrit ${file} : ${t.communes} communes, ${t.samples} prélèvements non conformes, ${t.restriction} communes avec une restriction annoncée, ${t.unplaced} non placées`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`[build-eau-potable] échec : ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
