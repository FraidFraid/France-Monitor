// api/_handlers/opendata-proxy.js — Vercel Serverless Function (Node)
//
// Proxy CDN-caché générique pour les APIs open data publiques françaises
// aujourd'hui appelées directement par le navigateur (Hub'Eau, ODRE, Enedis,
// EDF, geo.api.gouv.fr, API Adresse, Géoplateforme…) — 88+ appels par visiteur
// sans cache mutualisé (cf. docs/audit-2026-09-chargement-jev-ui.md). Ce proxy
// centralise la mise en cache CDN par host/chemin pour dédupliquer entre
// visiteurs, sans changer le format de réponse (JSON/GeoJSON transmis tel quel).
//
// Route : GET /api/opendata-proxy?url=<URL amont https encodée>
// Domaines whitelistés (host exact ou sous-domaine) : voir ALLOWED_HOSTS.
// HTTPS uniquement, GET uniquement, 15s de timeout amont, taille plafonnée
// (safe-fetch.js), 600 req/min/IP (rate-limit.js, fail-open sans Redis).

import { safeFetch, readCapped, SafeFetchError, MAX_RESPONSE_BYTES } from '../_utils/safe-fetch.js';
import { checkRateLimit } from '../_utils/rate-limit.js';

const ALLOWED_HOSTS = [
  'hubeau.eaufrance.fr',
  'odre.opendatasoft.com',
  'opendata.enedis.fr',
  'opendata.edf.fr',
  'opendata-corse-outremer.edf.fr',
  'opendata-reunion.edf.fr',
  'geo.api.gouv.fr',
  'api-adresse.data.gouv.fr',
  'data.geopf.fr',
];

const RATE_LIMIT_PER_MIN = 600;

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;
const ONE_DAY_SEC = 24 * 60 * 60;
const TEN_MIN_SEC = 10 * 60;
const FIVE_MIN_SEC = 5 * 60;

/**
 * TTL CDN par host/chemin. geo.api.gouv.fr / API Adresse / Géoplateforme :
 * référentiels quasi statiques → 7j. Hub'Eau `/referentiel/*` : liste de
 * stations, stable → 1j ; les autres routes Hub'Eau (observations temps réel)
 * → 5 min. ODRE : 10 min. EDF (metropole + Corse + Réunion) : 1j. Enedis :
 * pas de TTL spécifié par l'audit → 10 min par défaut (données de flux).
 * @param {URL} url
 * @returns {number}
 */
function cacheTtlSeconds(url) {
  const { hostname, pathname } = url;
  if (hostname === 'geo.api.gouv.fr' || hostname === 'api-adresse.data.gouv.fr' || hostname === 'data.geopf.fr') {
    return SEVEN_DAYS_SEC;
  }
  if (hostname === 'hubeau.eaufrance.fr') {
    return pathname.includes('/referentiel/') ? ONE_DAY_SEC : FIVE_MIN_SEC;
  }
  if (hostname === 'odre.opendatasoft.com') return TEN_MIN_SEC;
  if (hostname === 'opendata.edf.fr' || hostname === 'opendata-corse-outremer.edf.fr' || hostname === 'opendata-reunion.edf.fr') {
    return ONE_DAY_SEC;
  }
  return TEN_MIN_SEC;
}

/** @param {number} ttlSec */
function cacheControlHeader(ttlSec) {
  return `public, s-maxage=${ttlSec}, stale-while-revalidate=${ttlSec * 2}`;
}

/**
 * Adapte req.headers (Node IncomingMessage) à l'interface `{ headers: { get } }`
 * attendue par checkRateLimit (écrit pour la Web API Request des handlers edge).
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req
 */
function toRateLimitRequest(req) {
  return {
    headers: {
      /** @param {string} name */
      get(name) {
        const value = req.headers?.[name.toLowerCase()];
        if (Array.isArray(value)) return value[0] ?? null;
        return value ?? null;
      },
    },
  };
}

/**
 * @param {{ statusCode: number, setHeader: (k: string, v: string) => void, end: (b?: unknown) => unknown }} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * @param {{ method?: string, url?: string, headers?: Record<string, string | string[] | undefined> }} req
 * @param {{ statusCode: number, setHeader: (k: string, v: string) => void, end: (b?: unknown) => unknown }} res
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method && req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const targetUrl = query.get('url');
  if (!targetUrl) {
    sendJson(res, 400, { error: 'Missing ?url= parameter' });
    return;
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    sendJson(res, 400, { error: 'URL invalide' });
    return;
  }
  if (parsed.protocol !== 'https:') {
    sendJson(res, 403, { error: 'HTTPS uniquement' });
    return;
  }
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    sendJson(res, 403, { error: 'Domaine non autorisé' });
    return;
  }

  const rl = await checkRateLimit('opendata-proxy', toRateLimitRequest(req), RATE_LIMIT_PER_MIN);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retryAfter || 60));
    sendJson(res, 429, { error: 'Too Many Requests' });
    return;
  }

  try {
    // safeFetch : redirections revalidées contre l'allowlist (anti-SSRF), GET implicite.
    const { response: upstream } = await safeFetch(
      parsed.toString(),
      ALLOWED_HOSTS,
      { headers: { Accept: 'application/json, application/geo+json;q=0.9, */*;q=0.5' }, signal: AbortSignal.timeout(15_000) },
    );

    const bytes = await readCapped(upstream, MAX_RESPONSE_BYTES);
    const contentType = upstream.headers.get('content-type') ?? 'application/json';

    res.statusCode = upstream.status;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', upstream.ok ? cacheControlHeader(cacheTtlSeconds(parsed)) : 'no-store');
    res.end(Buffer.from(bytes));
  } catch (err) {
    if (err instanceof SafeFetchError) {
      const status = err.code === 'DOMAIN_NOT_ALLOWED' || err.code === 'INVALID_URL' ? 403 : 502;
      sendJson(res, status, { error: 'Fetch refused', code: err.code });
      return;
    }
    sendJson(res, 502, { error: err instanceof Error ? err.message : 'Fetch failed' });
  }
}
