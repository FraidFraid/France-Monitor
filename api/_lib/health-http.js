// api/_lib/health-http.js : lecture stricte des sources de santé (spec 2026-10-03 panneaux santé, S3).
// Toute réponse non 2xx, tout corps HTML là où l'on attend du JSON ou du XML, toute page de défi
// anti-robot, tout corps vide est une erreur (HealthFetchError) ; délai borné ; User-Agent fixe ;
// jamais de repli curl -k (l'ancien repli renvoyait le corps d'erreur comme un succès).
// Le corps est lu en UTF-8 (Response.text()) : PEPS annonce ISO-8859-1 dans l'en-tête HTTP mais sert de l'UTF-8.
import { getOrRefresh } from '../_utils/swr-cache.js';

export const HEALTH_USER_AGENT = 'FranceMonitor/1.0 (+https://www.francemonitor.com)';
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Mémoire de panne par source (S3) : un amont en échec n'est pas relancé à chaque requête (Sentiweb bloque l'IP sur 429). */
export const FAILURE_MEMO_SEC = 300;
/** Réponse partielle (une partie en échec) : cache CDN court, une source rétablie arrive vite. */
export const PARTIAL_CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';

const ACCEPT = {
  json: 'application/json',
  xml: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
  html: 'text/html, application/xhtml+xml;q=0.9',
  text: '*/*',
};

/** Erreur d'une source : kind ∈ 'http' | 'timeout' | 'network' | 'challenge' | 'html' | 'parse' | 'empty'. */
export class HealthFetchError extends Error {
  /** @param {string} message @param {{ url?: string | null, status?: number | null, kind?: string }} [info] */
  constructor(message, { url = null, status = null, kind = 'network' } = {}) {
    super(message);
    this.name = 'HealthFetchError';
    this.url = url;
    this.status = status;
    this.kind = kind;
  }
}

// Pages de défi vues le 03/10/2026 : Cegedim « Vérification de sécurité » (captcha, F5 /TSPD/),
// « Request Rejected » ; plus les défis Cloudflare. Aucune page légitime lue ici ne contient ces marques.
// Le mot « captcha » seul ne compte que dans un corps HTML : un JSON ou un flux qui le cite n'est pas un défi.
const CHALLENGE_RE = /<title>\s*(?:v[ée]rification de s[ée]curit[ée]|request rejected|just a moment|attention required)|\/TSPD\/|cf-chl-|challenge-platform/i;

/**
 * Vrai si le texte est une page de contrôle anti-robot. `contentMarker` (facultatif) : repère du contenu attendu,
 * par exemple l'identifiant du tableau lu ; une page qui le contient n'est pas un défi du seul fait qu'elle cite
 * « captcha » (vraie page qui intègre un formulaire reCAPTCHA : annuaire de l'aéroport de Bordeaux, 03/10/2026).
 * Les marques explicites de défi (titre, Cloudflare, F5) comptent toujours.
 * @param {string} text
 * @param {{ contentMarker?: string }} [options]
 */
export function isChallengePage(text, { contentMarker } = {}) {
  const body = String(text ?? '');
  const head = body.slice(0, 200_000);
  if (CHALLENGE_RE.test(head)) return true;
  if (!looksLikeHtml(head) || !/captcha/i.test(head)) return false;
  return !(contentMarker && body.includes(contentMarker));
}

/** Vrai si le texte commence comme une page HTML. */
export function looksLikeHtml(text) {
  return /^\s*(?:<!doctype html|<html[\s>])/i.test(String(text ?? '').replace(/^\uFEFF/, ''));
}

function looksLikeXml(text) {
  return /^\s*(?:<\?xml|<rss[\s>]|<feed[\s>])/i.test(String(text ?? '').replace(/^\uFEFF/, ''));
}

function errorName(err) {
  return err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
}

/** Corps de la réponse ; délai dépassé ou coupure pendant la lecture : HealthFetchError en français (jamais une DOMException brute). */
async function readBody(resp, url, timeoutMs) {
  try {
    return await resp.text();
  } catch (err) {
    const name = errorName(err);
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new HealthFetchError(`délai dépassé (${timeoutMs} ms)`, { url, status: resp.status, kind: 'timeout' });
    }
    throw new HealthFetchError('réseau : lecture de la réponse interrompue', { url, status: resp.status, kind: 'network' });
  }
}

/**
 * Réponse d'une URL, lue strictement : corps texte, statut et lecture d'en-tête (`header('x-rate-limit-remaining')`).
 * `headers` complète les en-têtes envoyés (Authorization, Content-Type…) ; le User-Agent reste fixe.
 * `contentMarker` : repère du contenu attendu (voir isChallengePage).
 * @param {string} url
 * @param {{ expect?: 'json' | 'xml' | 'html' | 'text', timeoutMs?: number, headers?: Record<string, string>, method?: string, body?: BodyInit, contentMarker?: string }} [options]
 * @returns {Promise<{ text: string, status: number, header(name: string): string | null }>}
 */
export async function fetchStrictResponse(url, { expect = 'text', timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, method = 'GET', body, contentMarker } = {}) {
  let resp;
  try {
    resp = await fetch(url, {
      method,
      body,
      headers: { Accept: ACCEPT[expect] ?? ACCEPT.text, ...headers, 'User-Agent': HEALTH_USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = errorName(err);
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new HealthFetchError(`délai dépassé (${timeoutMs} ms)`, { url, kind: 'timeout' });
    }
    throw new HealthFetchError(`réseau : ${err instanceof Error ? err.message : String(err)}`, { url, kind: 'network' });
  }
  if (!resp.ok) {
    // Défi anti-robot servi en 403 ou 429 : nommé comme tel ; corps illisible : l'erreur HTTP suffit.
    if (resp.status === 403 || resp.status === 429) {
      const errorBody = await readBody(resp, url, timeoutMs).catch(() => '');
      if (isChallengePage(errorBody)) {
        throw new HealthFetchError(`page de contrôle anti-robot (HTTP ${resp.status})`, { url, status: resp.status, kind: 'challenge' });
      }
    }
    throw new HealthFetchError(`HTTP ${resp.status}`, { url, status: resp.status, kind: 'http' });
  }
  const text = await readBody(resp, url, timeoutMs);
  if (isChallengePage(text, { contentMarker })) throw new HealthFetchError('page de contrôle anti-robot', { url, status: resp.status, kind: 'challenge' });
  if ((expect === 'json' || expect === 'xml') && looksLikeHtml(text)) {
    throw new HealthFetchError('page HTML reçue au lieu de données', { url, status: resp.status, kind: 'html' });
  }
  if (!text.trim()) throw new HealthFetchError('réponse vide', { url, status: resp.status, kind: 'empty' });
  if (expect === 'xml' && !looksLikeXml(text)) throw new HealthFetchError('XML attendu', { url, status: resp.status, kind: 'parse' });
  const responseHeaders = resp.headers;
  return {
    text,
    status: resp.status,
    header: (name) => (responseHeaders && typeof responseHeaders.get === 'function' ? responseHeaders.get(name) : null),
  };
}

/**
 * Corps texte d'une URL, lu strictement (`contentMarker` : repère du contenu attendu, voir isChallengePage).
 * @param {string} url
 * @param {{ expect?: 'json' | 'xml' | 'html' | 'text', timeoutMs?: number, headers?: Record<string, string>, method?: string, body?: BodyInit, contentMarker?: string }} [options]
 * @returns {Promise<string>}
 */
export async function fetchStrictText(url, options = {}) {
  return (await fetchStrictResponse(url, options)).text;
}

/** JSON d'une URL, lu strictement (options : timeoutMs, headers, method, body). */
export async function fetchStrictJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers, method, body } = {}) {
  const text = await fetchStrictText(url, { expect: 'json', timeoutMs, headers, method, body });
  try {
    return JSON.parse(text);
  } catch {
    throw new HealthFetchError('JSON illisible', { url, kind: 'parse' });
  }
}

/** XML (RSS, DATEX II, SIRI) d'une URL, lu strictement. */
export function fetchStrictXml(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers } = {}) {
  return fetchStrictText(url, { expect: 'xml', timeoutMs, headers });
}

/** Page HTML d'une URL, lue strictement (page de défi refusée ; `contentMarker` : voir isChallengePage). */
export function fetchStrictHtml(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers, contentMarker } = {}) {
  return fetchStrictText(url, { expect: 'html', timeoutMs, headers, contentMarker });
}

/** Message d'erreur d'une source pour `errors[]` : « Odissé, IRA France : HTTP 429 ». */
export function sourceError(label, err) {
  return `${label} : ${err instanceof Error ? err.message : String(err)}`;
}

/** Client clé-valeur vide : cache gardé en mémoire du processus seulement (option `shared: false`). */
const MEMORY_ONLY = { get: async () => null, set: async () => {} };

/**
 * Valeur d'une source mise en cache (mémoire et Redis, api/_utils/swr-cache.js) : fraîche pendant ttlSec ;
 * au-delà, nouvelle lecture, et la dernière valeur connue est servie si elle échoue. Lève si la source
 * échoue sans valeur connue. Une valeur servie périmée garde sa propre date (S1) : le retard se voit.
 * Le producteur lit ET analyse (arbitrage 2 de la phase A) : il lève sur un résultat vide ou illisible, qui
 * n'est donc jamais mis en cache. Un échec est mémorisé FAILURE_MEMO_SEC secondes : l'amont n'est pas relancé.
 * `shared: false` garde la valeur dans la mémoire du processus seulement (sources à cadence courte : pas
 * d'écriture Redis toutes les 2 à 5 minutes).
 */
export async function cachedSource(key, { ttlSec, staleSec = 7 * 86_400, shared = true }, producer) {
  const options = { ttlSec, staleSec, timeoutMs: 8_000, negativeTtlSec: FAILURE_MEMO_SEC };
  const { value } = await getOrRefresh(`health:${key}`, shared ? options : { ...options, redis: MEMORY_ONLY }, producer);
  return value;
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: ' : ', deg: '°', reg: '®', copy: '©', euro: '€',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', auml: 'ä', icirc: 'î', iuml: 'ï',
  ocirc: 'ô', ouml: 'ö', ugrave: 'ù', ucirc: 'û', uuml: 'ü', ccedil: 'ç', oelig: 'œ',
  Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Agrave: 'À', Acirc: 'Â', Icirc: 'Î', Ocirc: 'Ô', Ccedil: 'Ç', OElig: 'Œ',
};

/** Décode les entités HTML usuelles (nommées et numériques). */
export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => (Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m));
}

/**
 * Texte lisible d'un fragment HTML ou d'un texte tiers : balises retirées, entités décodées, espaces
 * resserrés, tiret cadratin remplacé par « : » (règle de l'application : aucun tiret cadratin affiché).
 */
export function cleanText(html) {
  return decodeEntities(String(html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s*\u2014\s*/g, ' : ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** En-têtes CORS ; vrai si la requête est déjà traitée (OPTIONS, méthode refusée). */
export function handlePreflight(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'méthode non autorisée' });
    return true;
  }
  return false;
}

/** Durée `s-maxage` (secondes) d'un en-tête Cache-Control ; Infinity sans directive lisible. */
function sMaxAge(cacheControl) {
  const m = /s-maxage=(\d+)/.exec(String(cacheControl ?? ''));
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/**
 * Réponse JSON d'un gestionnaire santé ou trafic : 200 avec `cacheControl` si au moins une source a répondu, sinon 502 non mis
 * en cache (le corps garde `errors[]`). Une partie en échec raccourcit le cache CDN (PARTIAL_CACHE_CONTROL, 5 min) sans
 * jamais l'allonger : une route au cache déjà plus court (panneau aérien, 60 s) garde le sien. Routes Santé (30 min et plus) :
 * inchangées.
 */
export function sendHealthJson(res, body, { ok, cacheControl }) {
  if (!ok) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json(body);
    return;
  }
  const partial = Array.isArray(body?.errors) && body.errors.length > 0;
  const shorter = sMaxAge(cacheControl) <= sMaxAge(PARTIAL_CACHE_CONTROL) ? cacheControl : PARTIAL_CACHE_CONTROL;
  res.setHeader('Cache-Control', partial ? shorter : cacheControl);
  res.status(200).json(body);
}
