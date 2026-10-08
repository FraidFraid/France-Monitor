// api/_lib/cisa-kev.js : catalogue des failles exploitées de la CISA (Known Exploited Vulnerabilities, domaine public ; spec 2026-10-04
// souveraineté § 2.3, V3 ; contrats § 2.4). Une faille publiée n'est pas une attaque : seules comptent celles dont l'exploitation est
// connue. Une faille est « citée par le CERT-FR » si son CVE figure dans une alerte ou un avis du CERT-FR. Fichier de 1,7 Mo relu toutes
// les 6 h et réduit en mémoire du processus (arbitrage 17) : liste de tous les CVE (environ 30 Ko) et entrées détaillées des 120 derniers
// jours seulement.
import { parisDay } from './paris-time.js';
import { cachedSource, fetchStrictJson } from './source-http.js';

export const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
export const KEV_TTL_SEC = 6 * 3_600;
/** Entrées détaillées gardées : 120 jours (12 semaines de courbe et 30 jours de liste). */
export const KEV_DETAIL_DAYS = 120;
const WEEK_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;
const WEEKS = 12;

function text(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function isDay(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Catalogue lu : version, date de publication, compte annoncé, tous les CVE (triés) et toutes les entrées lisibles (date d'ajout
 * décroissante, puis CVE). Lève si la réponse n'a pas de liste « vulnerabilities ».
 * @param {unknown} json
 */
export function parseKev(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.vulnerabilities)) throw new Error('catalogue KEV illisible');
  const items = [];
  const cves = new Set();
  for (const v of json.vulnerabilities) {
    const cve = text(v?.cveID);
    if (!cve) continue;
    cves.add(cve);
    if (!isDay(v.dateAdded)) continue;
    items.push({
      cve,
      vendor: text(v.vendorProject) ?? 'n.d.',
      product: text(v.product) ?? 'n.d.',
      name: text(v.vulnerabilityName) ?? cve,
      dateAdded: v.dateAdded,
      dueDate: isDay(v.dueDate) ? v.dueDate : null,
      ransomware: v.knownRansomwareCampaignUse === 'Known',
    });
  }
  items.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded) || a.cve.localeCompare(b.cve));
  return {
    catalogVersion: text(json.catalogVersion),
    dateReleased: text(json.dateReleased),
    count: Number.isFinite(json.count) ? json.count : null,
    cves: [...cves].sort(),
    items,
  };
}

/**
 * Entrées KEV avec les éléments CERT-FR qui citent leur CVE (`certfrRefs`, triés) ; ordre : citées d'abord, puis date d'ajout
 * décroissante, puis CVE.
 * @param {{ items: Array<{ cve: string, dateAdded: string }> }} kev
 * @param {Array<{ ref: string, cves: string[] }>} certfr
 */
export function crossCertFr(kev, certfr) {
  const refsByCve = new Map();
  for (const item of certfr) for (const cve of item.cves) refsByCve.set(cve, [...(refsByCve.get(cve) ?? []), item.ref]);
  return kev.items
    .map((k) => ({ ...k, certfrRefs: [...new Set(refsByCve.get(k.cve) ?? [])].sort() }))
    .sort((a, b) => Number(b.certfrRefs.length > 0) - Number(a.certfrRefs.length > 0) || b.dateAdded.localeCompare(a.dateAdded) || a.cve.localeCompare(b.cve));
}

/**
 * Failles ajoutées par semaine glissante de 7 × 24 h sur 12 semaines finissant à `now`, plus ancienne d'abord ; une faille compte dans
 * la semaine qui contient minuit UTC de son jour d'ajout ; `cited` : celles citées par le CERT-FR.
 * @param {Array<{ dateAdded: string, certfrRefs: string[] }>} items
 * @param {number} now
 */
export function kevWeeks(items, now) {
  const weeks = [];
  for (let k = WEEKS; k >= 1; k -= 1) {
    const start = now - k * WEEK_MS;
    const end = start + WEEK_MS;
    const inWeek = items.filter((i) => {
      const t = Date.parse(`${i.dateAdded}T00:00:00Z`);
      return t > start && t <= end;
    });
    weeks.push({ weekStart: new Date(start).toISOString(), added: inWeek.length, cited: inWeek.filter((i) => i.certfrRefs.length > 0).length });
  }
  return weeks;
}

/** Jours révolus entre le jour d'ajout et le jour de Paris de `now`. */
export function kevAgeDays(day, now) {
  const [ty, tm, td] = parisDay(now).split('-').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / DAY_MS);
}

/**
 * Catalogue réduit (`{ readAt, catalogVersion, dateReleased, count, cves, items }`, entrées des 120 derniers jours), relu toutes les 6 h,
 * gardé en mémoire du processus (`shared: false`, arbitrage 17) ; lève si le catalogue n'a jamais été lu.
 * @param {number} now
 */
export function loadKev(now) {
  return cachedSource('sov:kev', { ttlSec: KEV_TTL_SEC, staleSec: 7 * 86_400, shared: false }, async () => {
    const parsed = parseKev(await fetchStrictJson(KEV_URL, { timeoutMs: 30_000 }));
    return { readAt: new Date(now).toISOString(), ...parsed, items: parsed.items.filter((i) => kevAgeDays(i.dateAdded, now) <= KEV_DETAIL_DAYS) };
  });
}
