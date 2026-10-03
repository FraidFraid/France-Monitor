// api/_handlers/health/drug-shortages.js : disponibilité des médicaments (ANSM, au fil de l'eau ; spec
// 2026-10-03 panneaux santé § 2.6). Lecture de la page publique des disponibilités : quatre statuts (rupture de
// stock, tension d'approvisionnement, remise à disposition, arrêt de commercialisation), domaines médicaux,
// date de mise à jour, date de remise à disposition. L'export XLS (avec la date de début de situation) n'est
// pas lu : c'est un classeur BIFF .xls que le module xlsx retenu au plan ne lit pas (startedAt reste null).
// Réponse : DrugShortagesV2 (items, counts, latestUpdate, mitmListUrl, errors).
import { cachedSource, cleanText, fetchStrictHtml, handlePreflight, sendHealthJson, sourceError } from '../../_lib/health-http.js';

export const ANSM_PAGE_URL = 'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments';
export const MITM_LIST_URL = 'https://ansm.sante.fr/documents/reference/medicaments-dinteret-therapeutique-majeur-mitm';
export const CACHE_CONTROL = 's-maxage=1800, stale-while-revalidate=300';
const STATUSES = ['rupture', 'tension', 'remise', 'arret'];
const warnedStatus = new Set();

/** Libellé ANSM → statut (contrat) ; null si inconnu (journalisé une fois). */
export function shortageStatus(label) {
  const t = String(label ?? '').toLowerCase();
  if (t.includes('rupture')) return 'rupture';
  if (t.includes('tension')) return 'tension';
  if (t.includes('remise')) return 'remise';
  if (t.includes('arrêt') || t.includes('arret')) return 'arret';
  if (!warnedStatus.has(t)) {
    warnedStatus.add(t);
    console.warn(`[api/health/drug-shortages] statut ANSM inconnu : « ${t} »`);
  }
  return null;
}

/** « 02/10/2026 » ou « 2026/10/02 » → « 2026-10-02 » ; sinon null. */
export function ansmDate(raw) {
  const t = cleanText(raw);
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const ymd = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(t);
  return ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : null;
}

/**
 * Lignes `tr.product-item` du tableau ANSM → { status (null si inconnu), name, updatedAt,
 * availableAgainAt, domains, url }. Colonne « Remise à disposition » : la date est le texte de <b> ; son
 * attribut data-value vaut la date du jour quand la cellule est vide (piège de l'ancienne lecture).
 */
export function parseAnsmRows(html) {
  const rows = [];
  for (const m of String(html ?? '').matchAll(/<tr[^>]*class="[^"]*product-item[^"]*"[^>]*data-href="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tds = [...m[2].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)];
    if (tds.length < 5) continue;
    const statusLabel = cleanText(tds[0][2]);
    const speciality = cleanText(tds[2][2]);
    rows.push({
      status: shortageStatus(statusLabel),
      name: speciality.replace(/\s*[–-]?\s*\[[^\]]*\]\s*$/, '').trim(),
      updatedAt: ansmDate(/data-value="([^"]*)"/i.exec(tds[1][1])?.[1] ?? tds[1][2]),
      availableAgainAt: ansmDate(/<b>([\s\S]*?)<\/b>/i.exec(tds[3][2])?.[1] ?? ''),
      domains: cleanText(tds[4][2]).split(/\s*,\s*/).filter(Boolean),
      url: `https://ansm.sante.fr${m[1]}`,
    });
  }
  return rows;
}

/** Lignes lues → champs DrugShortagesV2 (sans `errors`). */
export function buildDrugShortages(rows) {
  const items = rows.filter((r) => r.status !== null).map((r) => ({
    name: r.name, status: r.status, updatedAt: r.updatedAt, startedAt: null, availableAgainAt: r.availableAgainAt, domains: r.domains, url: r.url,
  }));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, items.filter((i) => i.status === s).length]));
  const latestUpdate = items.map((i) => i.updatedAt).filter(Boolean).sort().at(-1) ?? null;
  return { items, counts, latestUpdate, mitmListUrl: MITM_LIST_URL };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  let body;
  try {
    const html = await cachedSource('ansm:page', { ttlSec: 1800 }, () => fetchStrictHtml(ANSM_PAGE_URL));
    const rows = parseAnsmRows(html);
    const built = buildDrugShortages(rows);
    const errors = rows.length === 0 ? ['ANSM, disponibilités des médicaments : aucune ligne lue dans la page'] : [];
    body = { ...built, errors };
  } catch (err) {
    body = { ...buildDrugShortages([]), errors: [sourceError('ANSM, disponibilités des médicaments', err)] };
  }
  sendHealthJson(res, body, { ok: body.items.length > 0, cacheControl: CACHE_CONTROL });
}
