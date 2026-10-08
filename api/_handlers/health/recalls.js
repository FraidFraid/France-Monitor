// api/_handlers/health/recalls.js : rappels de produits des 14 derniers jours (RappelConso v2,
// data.economie.gouv.fr, quotidien, rien le week-end ; spec 2026-10-03 panneaux santé § 2.6). Versions 1
// seulement (une version 2 republiée porte une nouvelle date et ferait compter deux fois la même fiche).
// Risques sanitaires classés par sous-chaîne de `risques_encourus` (liste séparée par « | », en minuscules).
import { cachedSource, cleanText, handlePreflight, sendHealthJson, sourceError } from '../../_lib/health-http.js';
import { ECONOMIE_BASE, fetchAllRecords, odsDate } from '../../_lib/odisse.js';

export const RECALLS_DATASET = 'rappelconso-v2-gtin-espaces';
export const CACHE_CONTROL = 's-maxage=3600, stale-while-revalidate=21600';
export const DAYS = 14;
const DAY_MS = 86_400_000;
const LATEST = 10;

/** Risques sanitaires (infectieux et allergènes) dans l'ordre d'affichage. */
export const HEALTH_RISKS = Object.freeze(['listeria', 'salmonelle', 'stec', 'campylobacter', 'staphylocoque', 'histamine', 'allergene']);
const RISK_RULES = [
  ['listeria', /listeria/], ['salmonelle', /salmonell/], ['stec', /escherichia|\bstec\b/], ['campylobacter', /campylobacter/],
  ['staphylocoque', /staphylococ/], ['histamine', /histamine/], ['allergene', /allergisant|allerg[eè]ne/],
];

/** Risques d'un rappel ; ['autre'] s'il n'a aucun risque infectieux ni allergène. */
export function classifyRecallRisks(text) {
  const t = String(text ?? '').toLowerCase();
  const risks = RISK_RULES.filter(([, re]) => re.test(t)).map(([risk]) => risk);
  return risks.length > 0 ? risks : ['autre'];
}

/** Jour calendaire à Paris (AAAA-MM-JJ) d'un instant. */
export function parisDay(value) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date(value));
}

function addDays(day, n) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Lignes RappelConso (version 1) → RecallsResponse sans `errors` ; fenêtre de 14 jours à Paris, aujourd'hui compris. */
export function buildRecalls(rows, now) {
  const today = parisDay(now);
  const since = addDays(today, -(DAYS - 1));
  const recalls = rows
    .filter((r) => Number(r?.numero_version) === 1 && typeof r?.date_publication === 'string' && parisDay(r.date_publication) >= since)
    .map((r) => ({
      id: String(r.numero_fiche ?? ''),
      date: r.date_publication,
      label: cleanText(r.libelle),
      brand: cleanText(r.marque_produit),
      category: cleanText(r.sous_categorie_produit || r.categorie_produit),
      risks: classifyRecallRisks(r.risques_encourus),
      riskText: cleanText(String(r.risques_encourus ?? '').split('|').join(' · ')),
      zone: cleanText(r.zone_geographique_de_vente),
      url: typeof r.lien_vers_la_fiche_rappel === 'string' && r.lien_vers_la_fiche_rappel.startsWith('https://') ? r.lien_vers_la_fiche_rappel : '',
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const isHealth = (r) => r.risks[0] !== 'autre';
  const byRisk = {};
  for (const r of recalls) for (const risk of r.risks) byRisk[risk] = (byRisk[risk] ?? 0) + 1;
  const byDay = Array.from({ length: DAYS }, (_, i) => ({ day: addDays(since, i), total: 0, healthRisk: 0 }));
  for (const r of recalls) {
    const slot = byDay.find((d) => d.day === parisDay(r.date));
    if (!slot) continue;
    slot.total += 1;
    if (isHealth(r)) slot.healthRisk += 1;
  }
  return {
    since,
    total: recalls.length,
    healthRisk: recalls.filter(isHealth).length,
    byRisk,
    byDay,
    latest: recalls.filter(isHealth).slice(0, LATEST),
  };
}

/** Réponse complète (RecallsResponse). */
export async function loadRecalls(now = Date.now()) {
  // Un jour de plus côté requête (dates UTC) : la fenêtre exacte est appliquée en heure de Paris.
  const from = addDays(parisDay(now), -DAYS);
  try {
    const rows = await cachedSource(`recalls:${from}`, { ttlSec: 3600 }, () => fetchAllRecords(RECALLS_DATASET, {
      base: ECONOMIE_BASE,
      select: 'numero_fiche,numero_version,date_publication,libelle,marque_produit,categorie_produit,sous_categorie_produit,risques_encourus,zone_geographique_de_vente,lien_vers_la_fiche_rappel',
      where: `numero_version=1 and date_publication>=${odsDate(from)}`,
      orderBy: 'date_publication desc',
      maxRows: 1000,
    }));
    return { ...buildRecalls(rows, now), errors: [] };
  } catch (err) {
    return { ...buildRecalls([], now), errors: [sourceError('RappelConso', err)] };
  }
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadRecalls();
  sendHealthJson(res, body, { ok: body.errors.length === 0, cacheControl: CACHE_CONTROL });
}
