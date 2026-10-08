// api/_lib/vigipirate-page.js : relecture quotidienne de la page Vigipirate du SGDSN (amendement 7, O14 ; arbitrage du contrôleur :
// route /api/sovereignty/vigipirate, forme VigipiratePageCheck). Le niveau Vigipirate affiché vient d'une saisie datée
// (src/config/vigipirate.ts) ; le serveur relit https://www.sgdsn.gouv.fr/vigipirate une fois par jour (une lecture stricte, User-Agent
// FranceMonitor par api/_lib/source-http.js) et ne garde qu'une empreinte SHA-256 du texte utile, jamais le texte lui-même. Texte
// utile : le texte principal de la section Vigipirate (blocs « fr-prose » de l'article, sinon l'article, sinon le contenu principal),
// sans scripts, menus, pied de page, tuiles ni dates de mise à jour, casse et espaces normalisés : un changement cosmétique ne change
// pas l'empreinte. Les dates du texte (date d'effet d'une posture, fin d'une alerte attentat) restent dans l'empreinte : elles sont
// le contenu que la saisie reprend. `pageChangedAt` : lecture où l'empreinte a changé pour la dernière fois. Une page illisible, une
// page de contrôle anti-robot ou une panne est une erreur nommée (« SGDSN, page Vigipirate : HTTP 503 »), jamais « inchangée » :
// la dernière lecture réussie reste servie avec sa date.
import { createHash } from 'node:crypto';
import { kvGetJson, kvSetJson } from './kv-history.js';
import { cleanText, fetchStrictHtml, sourceError } from './source-http.js';

export const VIGIPIRATE_PAGE_URL = 'https://www.sgdsn.gouv.fr/vigipirate';
export const VIGIPIRATE_KEY = 'sov:vigipirate:page';
/** Une lecture par jour ; après un échec, nouvel essai une heure plus tard. */
export const VIGIPIRATE_INTERVAL_MS = 24 * 3_600_000;
export const VIGIPIRATE_RETRY_MS = 60 * 60_000;
const LABEL = 'SGDSN, page Vigipirate';
const KEEP_SEC = 90 * 86_400;
const TIMEOUT_MS = 10_000;
const TICK_TOLERANCE_MS = 5_000;
/** Blocs retirés avant lecture du texte : scripts, styles, menus, en-tête, pied de page, formulaires, dates balisées. */
const DROPPED_BLOCKS = /<(script|style|noscript|template|svg|nav|header|footer|form|button|time)\b[\s\S]*?<\/\1\s*>/gi;
/** Mention de mise à jour ou de publication et sa date (« Mis à jour le 03/10/2026 », « Publié le 4 octobre 2026 à 10 h 12 »). */
const UPDATE_STAMP = /\b(?:publi[ée]e?|mise?\s+[àa]\s+jour|modifi[ée]e?|actualis[ée]e?|derni[èe]re\s+(?:mise\s+[àa]\s+jour|modification))\s*(?:le|:)?\s*\d{1,2}(?:er)?(?:\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\s+[a-zà-ÿ]+\s+\d{4})(?:\s*(?:à|-)?\s*\d{1,2}\s*(?:h|:)\s*\d{0,2})?/gi;

/**
 * Blocs `<div …>` équilibrés dont l'attribut class contient `className` (balises div imbriquées comptées).
 * @param {string} html
 * @param {string} className
 */
function divBlocks(html, className) {
  const out = [];
  const open = new RegExp(`<div\\b[^>]*\\bclass="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'gi');
  for (const m of html.matchAll(open)) {
    const start = m.index + m[0].length;
    const tags = /<(\/?)div\b[^>]*>/gi;
    tags.lastIndex = start;
    let depth = 1;
    let end = html.length;
    for (let t = tags.exec(html); t; t = tags.exec(html)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) { end = t.index; break; }
    }
    out.push(html.slice(start, end));
  }
  return out;
}

/** Premier élément `<tag>…</tag>` (non imbriqué), ou null. */
function element(html, tag) {
  return new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(html)?.[1] ?? null;
}

/**
 * Texte utile normalisé de la page (jamais gardé ni servi : il ne sert qu'à l'empreinte). Lève « page sans texte principal » si la
 * page n'a ni article ni contenu principal, « page sans posture Vigipirate lisible » si le texte ne parle pas de Vigipirate et
 * d'un stade (page de maintenance ou d'erreur servie en 200).
 * @param {string} html
 */
function usefulText(html) {
  const page = String(html ?? '').replace(/<!--[\s\S]*?-->/g, ' ');
  const article = element(page, 'article');
  const main = element(page, 'main');
  const prose = divBlocks(article ?? main ?? '', 'fr-prose');
  const source = prose.length > 0 ? prose.join(' ') : article ?? main;
  if (source === null) throw new Error('page sans texte principal');
  const text = cleanText(source.replace(DROPPED_BLOCKS, ' '))
    .toLowerCase()
    .replace(UPDATE_STAMP, ' ')
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/«\s*/g, '«')
    .replace(/\s*»/g, '»')
    .replace(/\s+([;:!?,.])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/vigipirate/.test(text) || !/vigilance|attentat/.test(text)) throw new Error('page sans posture Vigipirate lisible');
  return text;
}

/**
 * Empreinte SHA-256 (hexadécimal) du texte utile de la page Vigipirate ; lève si la page n'a pas de texte Vigipirate lisible.
 * @param {string} html
 * @returns {string}
 */
export function vigipirateFingerprint(html) {
  return createHash('sha256').update(usefulText(html), 'utf8').digest('hex');
}

/** Relevé gardé (VigipiratePageCheck et `attemptedAt`), ou null s'il est absent ou illisible. */
function storedRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isFinite(value.attemptedAt)) return null;
  const text = (v) => (typeof v === 'string' ? v : null);
  return {
    readAt: text(value.readAt),
    fingerprint: text(value.fingerprint),
    pageChangedAt: text(value.pageChangedAt),
    attemptedAt: value.attemptedAt,
    errors: Array.isArray(value.errors) ? value.errors.filter((e) => typeof e === 'string') : [],
  };
}

/** Réponse de la route (VigipiratePageCheck) : empreinte, dates et erreurs seulement. */
function publicCheck(record) {
  return { readAt: record.readAt, fingerprint: record.fingerprint, pageChangedAt: record.pageChangedAt, errors: record.errors };
}

async function refreshIfDue(now) {
  const record = storedRecord(await kvGetJson(VIGIPIRATE_KEY, now));
  const wait = record ? (record.errors.length === 0 ? VIGIPIRATE_INTERVAL_MS : VIGIPIRATE_RETRY_MS) : 0;
  if (record && now - record.attemptedAt < wait - TICK_TOLERANCE_MS) return publicCheck(record);
  let next;
  try {
    const fingerprint = vigipirateFingerprint(await fetchStrictHtml(VIGIPIRATE_PAGE_URL, { timeoutMs: TIMEOUT_MS }));
    const readAt = new Date(now).toISOString();
    const changed = record?.fingerprint != null && record.fingerprint !== fingerprint;
    next = { readAt, fingerprint, pageChangedAt: changed ? readAt : record?.pageChangedAt ?? null, attemptedAt: now, errors: [] };
  } catch (err) {
    next = {
      readAt: record?.readAt ?? null, fingerprint: record?.fingerprint ?? null, pageChangedAt: record?.pageChangedAt ?? null,
      attemptedAt: now, errors: [sourceError(LABEL, err)],
    };
  }
  await kvSetJson(VIGIPIRATE_KEY, next, KEEP_SEC, now);
  return publicCheck(next);
}

let inflight = null;

/** Réservé aux tests : aucune lecture en cours. */
export function __resetVigipirateForTests() {
  inflight = null;
}

/**
 * Relevé à jour de la page Vigipirate (VigipiratePageCheck) : relue si la dernière lecture a 24 h (une heure après un échec) ; une
 * seule lecture à la fois ; ne lève jamais (une erreur imprévue est nommée).
 * @param {number} [now]
 */
export function ensureVigipirateFresh(now = Date.now()) {
  inflight ??= refreshIfDue(now)
    .catch((err) => ({ readAt: null, fingerprint: null, pageChangedAt: null, errors: [sourceError(LABEL, err)] }))
    .finally(() => { inflight = null; });
  return inflight;
}
