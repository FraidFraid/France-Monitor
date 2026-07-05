// api/utils/safe-fetch.js
// fetch protégé contre le SSRF par redirection + plafond de taille de réponse.
// Compatible runtime Edge (Web APIs uniquement : fetch, URL, ReadableStream).
//
// Problème couvert : un domaine autorisé qui répond 302 vers une IP interne
// (169.254.169.254, localhost, 127.0.0.1…) serait suivi si on laissait
// `redirect: 'follow'`. Ici on suit les redirections MANUELLEMENT et on revalide
// CHAQUE Location contre l'allowlist du proxy appelant (host exact ou sous-domaine,
// refus des IP littérales et des schémas non http/https).

/** Nombre maximum de redirections suivies manuellement. */
export const MAX_REDIRECTS = 3;

/** Plafond de taille de réponse par défaut : 5 Mo. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Erreur typée pour distinguer les refus SSRF des dépassements de taille.
 * `code` ∈ 'INVALID_URL' | 'DOMAIN_NOT_ALLOWED' | 'TOO_MANY_REDIRECTS' | 'RESPONSE_TOO_LARGE'
 */
export class SafeFetchError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

/**
 * Vrai si le host est une IP littérale (v4 pointée, v6, ou entier décimal) — toujours refusé.
 * @param {string} host
 * @returns {boolean}
 */
export function isIpLiteral(host) {
  if (!host) return true;
  // IPv6 : URL.hostname conserve les crochets et contient ':'
  if (host.includes(':') || host.startsWith('[')) return true;
  // IPv4 pointée (0.0.0.0 → 255.255.255.255)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // Forme entière décimale (ex: 2130706433 == 127.0.0.1)
  if (/^\d+$/.test(host)) return true;
  return false;
}

/**
 * Vrai si `hostname` correspond exactement à un domaine autorisé ou en est un sous-domaine.
 * Refuse les IP littérales. Accepte un Set ou un Array de domaines.
 * @param {string} hostname
 * @param {Iterable<string>} allowedDomains
 * @returns {boolean}
 */
export function isHostAllowed(hostname, allowedDomains) {
  const host = String(hostname || '').toLowerCase();
  if (!host || isIpLiteral(host)) return false;
  for (const d of allowedDomains) {
    const dom = String(d).toLowerCase();
    if (host === dom || host.endsWith('.' + dom)) return true;
  }
  return false;
}

/**
 * Valide une URL : schéma http/https, host autorisé (exact ou sous-domaine), pas d'IP.
 * @param {string} rawUrl
 * @param {Iterable<string>} allowedDomains
 * @returns {URL}
 * @throws {SafeFetchError}
 */
function validateUrl(rawUrl, allowedDomains) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SafeFetchError('URL invalide', 'INVALID_URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SafeFetchError('Schéma non autorisé', 'INVALID_URL');
  }
  if (!isHostAllowed(parsed.hostname, allowedDomains)) {
    throw new SafeFetchError('Domaine non autorisé', 'DOMAIN_NOT_ALLOWED');
  }
  return parsed;
}

/**
 * fetch anti-SSRF : suit les redirections manuellement (max `maxRedirects`) en
 * revalidant chaque Location contre l'allowlist. Ne consomme PAS le corps de la
 * réponse finale (à lire ensuite avec readCapped).
 *
 * @param {string} url — URL initiale
 * @param {Iterable<string>} allowedDomains — allowlist du proxy appelant
 * @param {RequestInit} [fetchOptions] — options fetch (headers, signal, method…) ; `redirect` est forcé à 'manual'
 * @param {{ maxRedirects?: number, maxBytes?: number }} [opts]
 * @returns {Promise<{ response: Response, finalUrl: string }>}
 * @throws {SafeFetchError}
 */
export async function safeFetch(url, allowedDomains, fetchOptions = {}, opts = {}) {
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;

  let current = validateUrl(url, allowedDomains).toString();
  let redirects = 0;

  while (true) {
    const resp = await fetch(current, { ...fetchOptions, redirect: 'manual' });

    if (!REDIRECT_STATUSES.has(resp.status)) {
      // Réponse finale — pré-check content-length si présent (early-out avant lecture)
      const len = resp.headers.get('content-length');
      if (len && Number(len) > maxBytes) {
        throw new SafeFetchError('Réponse trop volumineuse', 'RESPONSE_TOO_LARGE');
      }
      return { response: resp, finalUrl: current };
    }

    // Redirection : revalider la cible avant de la suivre.
    const location = resp.headers.get('location');
    if (!location) {
      // Redirection sans Location : rien à suivre, on renvoie tel quel.
      return { response: resp, finalUrl: current };
    }
    redirects++;
    if (redirects > maxRedirects) {
      throw new SafeFetchError('Trop de redirections', 'TOO_MANY_REDIRECTS');
    }
    // Libère la connexion de la réponse de redirection.
    try { await resp.body?.cancel(); } catch { /* ignore */ }

    let next;
    try {
      next = new URL(location, current).toString();
    } catch {
      throw new SafeFetchError('Location de redirection invalide', 'INVALID_URL');
    }
    current = validateUrl(next, allowedDomains).toString();
  }
}

/**
 * Lit le corps d'une réponse en imposant un plafond d'octets via streaming.
 * Nécessaire car beaucoup d'upstreams n'envoient pas de content-length (chunked).
 * @param {Response} response
 * @param {number} [maxBytes]
 * @returns {Promise<Uint8Array>}
 * @throws {SafeFetchError} si le corps dépasse maxBytes
 */
export async function readCapped(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new SafeFetchError('Réponse trop volumineuse', 'RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Décode des octets en texte, en respectant le charset du Content-Type si présent
 * (repli utf-8). Reproduit le comportement de Response.text().
 * @param {Uint8Array} bytes
 * @param {string | null} [contentType]
 * @returns {string}
 */
export function decodeBody(bytes, contentType) {
  let charset = 'utf-8';
  if (contentType) {
    const m = /charset=([^;]+)/i.exec(contentType);
    if (m) charset = m[1].trim().replace(/["']/g, '');
  }
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
