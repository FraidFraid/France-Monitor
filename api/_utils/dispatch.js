// api/_utils/dispatch.js
// Routeur unique des handlers API (voir api/index.js et scripts/generate-api-routes.mjs).
//
// Pourquoi : sur le palier Vercel Hobby, un projet Vite + api/ ne peut pas créer plus de 12 fonctions
// par déploiement. Les handlers vivent sous api/_handlers/ (ignoré par Vercel) et une seule fonction
// les sert. vercel.json réécrit /api/(.*) vers /api?__fmroute=$1 ; les fichiers de fonction réels
// (api/ingest/news.ts, api/fuel-price-series-refresh.js, api/sentinel-ndwi.ts) passent avant la
// réécriture car Vercel consulte le système de fichiers d'abord.
//
// Deux styles de handler coexistent :
//   - Node (req, res) avec les helpers Vercel (req.query, res.status().json()) : appelé tel quel ;
//   - « Edge » (Request) → Response, repéré par `export const config = { runtime: 'edge' }` :
//     adapté ici (IncomingMessage → Request, Response → ServerResponse), sans réécrire le handler.

import { ROUTES, ALIASES } from '../_routes.js';

export const ROUTE_HINT_PARAM = '__fmroute';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'content-length',
]);

/**
 * Normalise l'URL vue par le routeur, qu'elle soit l'URL d'origine (/api/news?since=…)
 * ou la destination réécrite (/api?__fmroute=news&since=…).
 * @param {string | undefined} rawUrl
 * @param {Record<string, () => Promise<Record<string, unknown>>>} [routes]
 * @param {Record<string, string>} [aliases]
 */
export function resolveRoute(rawUrl, routes = ROUTES, aliases = ALIASES) {
  const url = new URL(rawUrl || '/', 'http://router.local');
  let pathname = url.pathname.replace(/\/+$/, '') || '/';
  const hint = url.searchParams.get(ROUTE_HINT_PARAM);
  url.searchParams.delete(ROUTE_HINT_PARAM);
  if (!routes[pathname] && !aliases[pathname] && hint) {
    pathname = '/api/' + hint.replace(/^\/+/, '').replace(/\/+$/, '');
  }
  const canonical = aliases[pathname] ?? pathname;
  const qs = url.searchParams.toString();
  return {
    pathname,
    canonical,
    search: qs ? `?${qs}` : '',
    searchParams: url.searchParams,
    load: Object.prototype.hasOwnProperty.call(routes, canonical) ? routes[canonical] : null,
  };
}

/**
 * Même forme que le helper Vercel `req.query` : chaîne, ou tableau si la clé est répétée.
 * @param {URLSearchParams} searchParams
 * @returns {Record<string, string | string[]>}
 */
export function toQueryObject(searchParams) {
  /** @type {Record<string, string | string[]>} */
  const query = {};
  for (const [key, value] of searchParams) {
    const prev = query[key];
    if (prev === undefined) query[key] = value;
    else query[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return query;
}

/** @param {any} req */
async function readRawBody(req) {
  // Le runtime Vercel a déjà mis le corps en mémoire derrière le getter `req.body` :
  // on le relit par là quand il existe (le flux brut peut être consommé).
  let parsed;
  try {
    parsed = req.body;
  } catch {
    parsed = undefined; // JSON malformé : le handler répondra 400 sur un corps vide.
  }
  if (parsed !== undefined && parsed !== null) {
    if (typeof parsed === 'string' || parsed instanceof Uint8Array) return parsed;
    return JSON.stringify(parsed);
  }
  if (req.readableEnded || typeof req[Symbol.asyncIterator] !== 'function') return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

/**
 * @param {any} req  IncomingMessage (avec ou sans helpers Vercel)
 * @param {string} pathWithSearch
 */
export async function toWebRequest(req, pathWithSearch) {
  const source = req.headers ?? {};
  const first = (value) => String(value).split(',')[0].trim();
  const proto = first(source['x-forwarded-proto'] ?? 'https');
  const host = first(source['x-forwarded-host'] ?? source.host ?? 'localhost');
  const headers = new Headers();
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, String(item));
    else headers.set(key, String(value));
  }
  const method = String(req.method ?? 'GET').toUpperCase();
  /** @type {RequestInit & { duplex?: 'half' }} */
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    const body = await readRawBody(req);
    if (body !== undefined) {
      init.body = body;
      init.duplex = 'half';
    }
  }
  return new Request(`${proto}://${host}${pathWithSearch}`, init);
}

/**
 * @param {any} res  ServerResponse
 * @param {Response} response
 * @param {string} method
 */
export async function sendWebResponse(res, response, method = 'GET') {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    // Le corps lu via arrayBuffer() est déjà décodé : l'en-tête d'encodage amont deviendrait faux.
    if (key === 'set-cookie' || key === 'content-encoding' || HOP_BY_HOP.has(key)) return;
    res.setHeader(key, value);
  });
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  const body = response.body && method !== 'HEAD' ? Buffer.from(await response.arrayBuffer()) : null;
  if (body) res.setHeader('content-length', String(body.length));
  res.end(body ?? undefined);
}

/** @param {any} res @param {number} status @param {unknown} payload */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * @param {any} req
 * @param {any} res
 * @param {{ routes?: Record<string, () => Promise<Record<string, unknown>>>, aliases?: Record<string, string> }} [options]
 */
export async function dispatch(req, res, options = {}) {
  const route = resolveRoute(req.url, options.routes ?? ROUTES, options.aliases ?? ALIASES);
  if (!route.load) {
    sendJson(res, 404, { error: 'Not found', path: route.pathname });
    return;
  }
  const pathWithSearch = route.canonical + route.search;
  try {
    const mod = await route.load();
    const handler = /** @type {unknown} */ (mod.default);
    if (typeof handler !== 'function') {
      sendJson(res, 500, { error: 'Handler invalide', path: route.canonical });
      return;
    }
    const config = /** @type {{ runtime?: string } | undefined} */ (mod.config);
    if (config?.runtime === 'edge') {
      const request = await toWebRequest(req, pathWithSearch);
      const response = await handler(request);
      await sendWebResponse(res, response, request.method);
      return;
    }
    req.url = pathWithSearch;
    const query = toQueryObject(route.searchParams);
    try {
      Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true, enumerable: true });
    } catch {
      req.query = query;
    }
    await handler(req, res);
  } catch (err) {
    console.error(`[api-router] ${route.canonical}`, err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal error', path: route.canonical });
    else res.end();
  }
}
