// api/_lib/certfr.js : alertes et avis du CERT-FR (ANSSI, Licence ouverte 2.0 ; spec 2026-10-04 souveraineté § 2.3, V3, V4 ; contrats
// § 2.4, arbitrage 14). Les flux `alerte` et `avis` ne gardent que 40 éléments, mêlent 2015, 2024 et 2026 et ne sont pas triés : le
// serveur accumule les éléments par référence (90 jours d'alertes, 35 jours d'avis) et trie sur la date. La page d'un élément donne
// sa « Date de la dernière version » et sa section « Référence CVE » : une mise à jour ne change ni la date du flux ni, toujours, le
// titre (CERTFR-2026-ALE-011, mise à jour le 30/09 sans « [MàJ] »). Le CERT-FR publie un statut officiel d'alerte (amendement 7, O1
// et O3) : la page liste /alerte/ affiche « Alerte en cours » ou « Clôturée le … » pour chaque alerte, et la page d'une alerte close
// finit par « Clôture de l'alerte » ; ce statut est repris tel quel. Le texte d'une alerte dit aussi quand l'exploitation est
// signalée (« activement exploitées »). Le flux CTI donne les « Rapports Menaces et incidents (ANSSI) » (S12). Fonctions pures,
// sauf `fetchAlertList` et `fetchCtiReports` (une lecture stricte chacune) ; la lecture des pages d'alertes et d'avis est faite par
// api/_lib/cyber-collect.js.
import { parisDay } from './paris-time.js';
import { parseRssXml } from './parse-rss.js';
import { cleanText, fetchStrictHtml, fetchStrictXml } from './source-http.js';

/** Page liste des alertes (statut officiel de chacune) et flux des rapports de menace (CTI). */
export const CERTFR_ALERT_LIST_URL = 'https://www.cert.ssi.gouv.fr/alerte/';
export const CERTFR_CTI_FEED = 'https://www.cert.ssi.gouv.fr/cti/feed/';
export const CERTFR_FEEDS = { alerte: 'https://www.cert.ssi.gouv.fr/alerte/feed/', avis: 'https://www.cert.ssi.gouv.fr/avis/feed/' };
/** Référence d'un élément, tirée du lien (« CERTFR-2026-ALE-011 », « CERTFR-2019-AVI-429 », « CERTFR-2026-AVI-0644 »). */
export const CERTFR_REF = /CERTFR-\d{4}-(?:ALE|AVI)-\d+/;
/** Fenêtres d'accumulation (jours de Paris, date de dernière version, sinon de première version). */
export const ALERT_KEEP_DAYS = 90;
export const AVIS_KEEP_DAYS = 35;
/** Pages : alertes de moins de 30 jours relues toutes les 24 h, de 30 à 90 jours tous les 7 jours ; avis de moins de 30 jours lus une fois. */
export const RECENT_DAYS = 30;
export const RECENT_PAGE_MS = 24 * 3_600_000;
export const OLDER_PAGE_MS = 7 * 86_400_000;
export const MAX_PAGES_PER_CYCLE = 20;
const DAY_MS = 86_400_000;
const CVE_RE = /CVE-\d{4}-\d{4,}/g;
const CTI_REF = /CERTFR-\d{4}-CTI-\d+/;
const MONTHS = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

/** « 30 septembre 2026 », « 1er octobre 2026 », « 02 octobre 2026 » vers « 2026-09-30 » ; null si illisible. */
export function frenchDate(text) {
  const m = /(\d{1,2})(?:er)?\s+([a-zà-ÿ]+)\s+(\d{4})/i.exec(String(text ?? ''));
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
  const day = Number(m[1]);
  if (!month || day < 1 || day > 31) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** CVE d'un texte, distincts et triés. */
function cvesIn(text) {
  return [...new Set(String(text ?? '').match(CVE_RE) ?? [])].sort();
}

/** Titre sans le préfixe « [MàJ] » ni la date entre parenthèses ; espaces resserrés, tiret cadratin remplacé. */
function cleanTitle(raw) {
  return cleanText(String(raw ?? '').replace(/^\s*\[m[aà]j\]\s*/i, '').replace(/\s*\(\s*\d{1,2}(?:er)?\s+[^()]*\d{4}\s*\)\s*$/, ''));
}

/** Produit : le titre sans « Multiples vulnérabilités dans » ni « Vulnérabilité(s) dans » ; null si le titre a une autre forme. */
function productOf(title) {
  const m = /^(?:multiples\s+vuln[ée]rabilit[ée]s|vuln[ée]rabilit[ée]s?)\s+dans\s+(.+)$/i.exec(title);
  return m ? m[1].trim() : null;
}

/**
 * Éléments d'un flux RSS du CERT-FR (`kind` : 'alerte' ou 'avis'), dans l'ordre du flux : référence, titre nettoyé, produit, marque
 * « [MàJ] », lien, première version (pubDate, minuit UTC) et CVE du résumé. Un élément sans référence lisible ou sans date est écarté.
 * @param {string} xml
 * @param {'alerte' | 'avis'} kind
 */
export function parseCertFrFeed(xml, kind) {
  const out = [];
  for (const item of parseRssXml(String(xml ?? ''))) {
    const ref = CERTFR_REF.exec(item.link)?.[0];
    const t = Date.parse(item.pubDate);
    if (!ref || !Number.isFinite(t)) continue;
    const title = cleanTitle(item.title);
    out.push({
      ref,
      kind,
      title,
      product: productOf(title),
      updatedMark: /^\s*\[m[aà]j\]/i.test(item.title),
      url: item.link.trim(),
      firstVersion: new Date(t).toISOString().slice(0, 10),
      feedCves: cvesIn(item.description),
    });
  }
  return out;
}

/** Cellule qui suit « Date de la … version » dans le tableau « Gestion du document ». */
function versionCell(html, which) {
  const accent = '(?:è|&egrave;|&#232;)';
  const label = which === 'derniere' ? `derni${accent}re` : `premi${accent}re`;
  const m = new RegExp(`Date de la ${label} version\\s*</td>\\s*<td[^>]*>([^<]*)</td>`, 'i').exec(html);
  return m ? frenchDate(cleanText(m[1])) : null;
}

const APOS = "(?:'|&#39;|&#x27;|&rsquo;|\u2019)";
/** Phrase qui dit l'exploitation : « activement exploitées », « exploitation active », « exploitées activement » (hors phrase négative). */
const EXPLOITED_RE = /activement\s+exploit[ée]e?s?|exploit[ée]e?s?\s+activement|exploitations?\s+actives?/i;
const NEGATION_RE = /(?:\bne\s|\bpas\b|\baucune?\b|\bn['\u2019])/i;

/** Date de clôture inscrite dans la « Gestion détaillée du document » : « le 22 septembre 2026 » avant « Clôture de l'alerte ». */
function closureDate(html) {
  const m = new RegExp(`<dt>\\s*(?:<strong>)?([^<]*)(?:</strong>)?\\s*</dt>\\s*<dd>\\s*Cl(?:ô|&ocirc;|&#244;)ture de l${APOS}alerte`, 'i').exec(html);
  return m ? frenchDate(cleanText(m[1])) : null;
}

/** Première phrase du texte qui dit l'exploitation, citée telle quelle ; null si aucune. */
function exploitedQuote(html) {
  const body = String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(?:p|li|dd|dt|h\d|tr|td)>/gi, '. ');
  for (const sentence of cleanText(body).split(/(?<=[.!?])\s+/)) {
    if (EXPLOITED_RE.test(sentence) && !NEGATION_RE.test(sentence)) return sentence.replace(/[.\s]+$/, '').trim() + '.';
  }
  return null;
}

/**
 * Page d'une alerte ou d'un avis : dates de première et de dernière version (« 30 septembre 2026 »), CVE de la section « Référence
 * CVE » seulement (les CVE cités ailleurs dans la page ne comptent pas), clôture (« Clôture de l'alerte » dans la gestion détaillée :
 * `closed`, `closedAt`) et exploitation signalée par le texte (`exploited`, `exploitedQuote`, la phrase citée). Lève si la date de
 * dernière version est introuvable : la page n'est alors pas notée comme lue.
 * @param {string} html
 */
export function parseCertFrPage(html) {
  const text = String(html ?? '');
  const lastVersion = versionCell(text, 'derniere');
  if (!lastVersion) throw new Error('page sans « Date de la dernière version »');
  const cves = [...new Set([...text.matchAll(/R(?:é|&eacute;|&#233;)f(?:é|&eacute;|&#233;)rence CVE\s+(CVE-\d{4}-\d{4,})/gi)].map((m) => m[1]))].sort();
  const closedAt = closureDate(text);
  const quote = exploitedQuote(text);
  return { lastVersion, firstVersion: versionCell(text, 'premiere'), cves, closed: closedAt !== null, closedAt, exploited: quote !== null, exploitedQuote: quote };
}

/**
 * Page liste des alertes (https://www.cert.ssi.gouv.fr/alerte/, une lecture) : pour chaque alerte, référence, date de publication et
 * statut officiel (« Alerte en cours » : 'en-cours' ; « Clôturée le … » : 'cloturee' et `closedAt`). Une alerte au statut illisible
 * est écartée ; lève si aucune alerte n'est lisible (page changée ou défi anti-robot).
 * @param {string} html
 * @returns {Array<{ ref: string, publishedAt: string | null, status: 'en-cours' | 'cloturee', closedAt: string | null }>}
 */
export function parseCertFrAlertList(html) {
  const out = [];
  for (const chunk of String(html ?? '').split(/<article\b/i).slice(1)) {
    const ref = CERTFR_REF.exec(/class="item-ref"[^>]*>([^<]*)</i.exec(chunk)?.[1] ?? '')?.[0];
    const statusText = cleanText(/class="item-status"[^>]*>([^<]*)</i.exec(chunk)?.[1] ?? '');
    if (!ref) continue;
    const publishedAt = frenchDate(cleanText(/class="item-date"[^>]*>([^<]*)</i.exec(chunk)?.[1] ?? ''));
    if (/^alerte en cours/i.test(statusText)) out.push({ ref, publishedAt, status: 'en-cours', closedAt: null });
    else if (/^cl(?:ô|o)tur(?:é|e)e/i.test(statusText)) out.push({ ref, publishedAt, status: 'cloturee', closedAt: frenchDate(statusText) });
  }
  if (out.length === 0) throw new Error('page liste des alertes sans statut lisible');
  return out;
}

/**
 * Statut officiel d'une alerte : celui de la page liste ; sans la liste (alerte absente de la première page), celui de la page de
 * l'alerte (« Clôture de l'alerte »), sinon 'en-cours' n'est jamais supposé : null. `conflict` : la liste et la page se contredisent
 * (la liste l'emporte, la contradiction est dite).
 * @param {{ status: 'en-cours' | 'cloturee', closedAt: string | null } | null | undefined} listEntry
 * @param {{ closed: boolean, closedAt: string | null } | null | undefined} page
 * @returns {{ status: 'en-cours' | 'cloturee' | null, closedAt: string | null, conflict: boolean }}
 */
export function resolveAlertStatus(listEntry, page) {
  if (listEntry) {
    const conflict = Boolean(page) && (listEntry.status === 'cloturee') !== page.closed;
    return { status: listEntry.status, closedAt: listEntry.closedAt ?? (listEntry.status === 'cloturee' ? page?.closedAt ?? null : null), conflict };
  }
  if (page?.closed) return { status: 'cloturee', closedAt: page.closedAt, conflict: false };
  return { status: null, closedAt: null, conflict: false };
}

/**
 * Rapports « Menaces et incidents (ANSSI) » du flux CTI du CERT-FR (S12) : référence, titre sans date finale ni drapeau de langue,
 * langue ('fr' ou 'en'), date (pubDate) et lien ; plus récent d'abord, puis référence décroissante.
 * @param {string} xml
 */
export function parseCtiFeed(xml) {
  const out = [];
  for (const item of parseRssXml(String(xml ?? ''))) {
    const ref = CTI_REF.exec(item.link)?.[0];
    const t = Date.parse(item.pubDate);
    if (!ref || !Number.isFinite(t)) continue;
    const raw = String(item.title ?? '');
    out.push({
      ref,
      title: cleanText(raw.replace(/^\s*\uD83C[\uDDE6-\uDDFF]\uD83C[\uDDE6-\uDDFF]\s*/, '').replace(/\s*\(\s*\d{1,2}(?:er)?\s+[^()]*\d{4}\s*\)\s*$/, '')),
      lang: /^\s*\uD83C\uDDEC\uD83C\uDDE7/.test(raw) ? 'en' : 'fr',
      date: new Date(t).toISOString().slice(0, 10),
      url: item.link.trim(),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref, 'fr', { numeric: true }));
}

/** Une lecture de la page liste des alertes (lecture stricte, User-Agent FranceMonitor) ; lève si illisible. */
export async function fetchAlertList() {
  return parseCertFrAlertList(await fetchStrictHtml(CERTFR_ALERT_LIST_URL));
}

/** Une lecture du flux CTI (lecture stricte, User-Agent FranceMonitor) ; lève si aucun rapport n'est lisible. */
export async function fetchCtiReports() {
  const reports = parseCtiFeed(await fetchStrictXml(CERTFR_CTI_FEED));
  if (reports.length === 0) throw new Error('flux CTI sans rapport lisible');
  return reports;
}

/** Jours de Paris révolus depuis le jour « AAAA-MM-JJ » ; Infinity si illisible. */
export function parisDaysSince(day, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  if (!m) return Number.POSITIVE_INFINITY;
  const [ty, tm, td] = parisDay(now).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / DAY_MS);
}

/** Date d'un élément accumulé : dernière version, sinon première. */
export function itemDate(item) {
  return item.lastVersion ?? item.firstVersion;
}

/**
 * Vrai si la page de l'élément doit être lue à ce cycle (arbitrage 14) : alerte de moins de 90 jours jamais lue, ou relue depuis
 * plus de 24 h (moins de 30 jours) ou de 7 jours (30 à 90 jours) ; avis de moins de 30 jours jamais lu (lu une fois).
 * @param {{ kind: 'alerte' | 'avis', firstVersion: string, lastVersion: string | null, pageReadAt: string | null }} item
 * @param {number} now
 */
export function pageDue(item, now) {
  const age = parisDaysSince(itemDate(item), now);
  if (item.kind === 'avis') return item.pageReadAt === null && age < RECENT_DAYS;
  if (age >= ALERT_KEEP_DAYS) return false;
  if (item.pageReadAt === null) return true;
  const readAt = Date.parse(item.pageReadAt);
  return !Number.isFinite(readAt) || now - readAt >= (age < RECENT_DAYS ? RECENT_PAGE_MS : OLDER_PAGE_MS);
}

/** Plus récent d'abord (dernière version, sinon première), puis référence décroissante (numérique). */
export function sortCertFr(items) {
  return [...items].sort((a, b) => itemDate(b).localeCompare(itemDate(a)) || b.ref.localeCompare(a.ref, 'fr', { numeric: true }));
}

/**
 * Accumulation par référence (arbitrage 14) : les éléments du flux mettent à jour titre, produit, lien, marque et CVE du résumé ;
 * les données de page déjà lues sont gardées. Seuls restent les alertes de moins de 90 jours et les avis de moins de 35 jours.
 * Un élément accumulé porte `feedCves`, `pageCves` (null : page non lue), `lastVersion`, `pageReadAt`, `status` et `closedAt`
 * (statut officiel d'une alerte, null tant qu'il n'est pas lu), `exploited` et `exploitedQuote` (null : page non lue).
 * @param {Array<Record<string, unknown>>} stored
 * @param {ReturnType<typeof parseCertFrFeed>} incoming
 * @param {number} now
 */
export function mergeCertFrItems(stored, incoming, now) {
  const byRef = new Map();
  for (const s of Array.isArray(stored) ? stored : []) if (s && typeof s.ref === 'string') byRef.set(s.ref, s);
  for (const f of incoming) {
    const old = byRef.get(f.ref);
    byRef.set(f.ref, old ? { ...old, ...f } : { ...f, lastVersion: null, pageCves: null, pageReadAt: null, status: null, closedAt: null, exploited: null, exploitedQuote: null });
  }
  return sortCertFr([...byRef.values()].filter((i) => parisDaysSince(itemDate(i), now) < (i.kind === 'alerte' ? ALERT_KEEP_DAYS : AVIS_KEEP_DAYS)));
}

/**
 * Applique à un élément accumulé la lecture de sa page (`page` : sortie de parseCertFrPage) et le statut officiel de la page liste
 * (`listEntry` : élément de parseCertFrAlertList, ou null). Pour un avis, pas de statut. Rend un nouvel élément.
 * @param {Record<string, any>} item
 * @param {ReturnType<typeof parseCertFrPage>} page
 * @param {{ status: 'en-cours' | 'cloturee', closedAt: string | null } | null} listEntry
 * @param {number} readAt
 */
export function applyPageRead(item, page, listEntry, readAt) {
  const resolved = item.kind === 'alerte' ? resolveAlertStatus(listEntry, page) : { status: null, closedAt: null, conflict: false };
  return {
    ...item,
    lastVersion: page.lastVersion,
    pageCves: page.cves,
    pageReadAt: new Date(readAt).toISOString(),
    status: resolved.status,
    closedAt: resolved.closedAt,
    exploited: page.exploited,
    exploitedQuote: page.exploitedQuote,
  };
}

/**
 * Applique le statut officiel de la page liste aux alertes accumulées, sans lire leur page (une alerte absente de la liste garde son
 * statut déjà lu). Rend de nouveaux éléments.
 * @param {Array<Record<string, any>>} items
 * @param {ReturnType<typeof parseCertFrAlertList>} list
 */
export function applyAlertList(items, list) {
  const byRef = new Map(list.map((e) => [e.ref, e]));
  return items.map((i) => {
    const e = i.kind === 'alerte' ? byRef.get(i.ref) : undefined;
    return e ? { ...i, status: e.status, closedAt: e.closedAt } : i;
  });
}
