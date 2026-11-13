/**
 * api/rss.js — Vercel Edge Function
 * Proxy RSS → JSON pour cyber.ts (CERT-FR) et autres flux configurés.
 * Miroir prod du plugin Vite src/plugins/rss-json-proxy.ts.
 *
 * Endpoint: GET /api/rss?url=<feed_url>
 * Response: { items: [{ title, link, pubDate, description }, ...] }
 *
 * Domaines whitelistés : flux RSS utilisés par FranceMonitor uniquement.
 */

export const config = { runtime: 'edge' };

import { parseRssXml, detectSourceFormat } from '../_lib/parse-rss.js';
import { safeFetch, readCapped, decodeBody, SafeFetchError, MAX_RESPONSE_BYTES } from '../_utils/safe-fetch.js';
import { checkRateLimit, rateLimitResponse } from '../_utils/rate-limit.js';

/** Appels par adresse et par minute : la page lit une cinquantaine de flux à l'ouverture, puis par vagues. */
const RSS_RATE_LIMIT_PER_MIN = 240;

const ALLOWED_DOMAINS = [
  // RTE / Énergie — REMIT / IIP
  'iip.cloud-rte-france.com',
  // Nationales
  'franceinfo.fr',
  'lemonde.fr',
  'lefigaro.fr',
  'rfi.fr',
  'liberation.fr',
  '20minutes.fr',
  'bfmtv.com',
  'france24.com',
  'europe1.fr',
  'courrierinternational.com',
  'mediapart.fr',
  'nouvelobs.com',
  'marianne.net',
  'slate.fr',
  'challenges.fr',
  'lesechos.fr',
  'numerama.com',
  '01net.com',
  'futura-sciences.com',
  'sciencesetavenir.fr',
  'francetvinfo.fr',
  'francebleu.fr',
  'atlantico.fr',
  'valeursactuelles.com',
  'guadeloupe.fr',
  // PQR régionale
  'ouest-france.fr',
  'letelegramme.fr',
  'sudouest.fr',
  'ladepeche.fr',
  'midilibre.fr',
  'leprogres.fr',
  'ledauphine.com',
  'nicematin.com',
  'estrepublicain.fr',
  'dna.fr',
  'lavoixdunord.fr',
  'paris-normandie.fr',
  'actu.fr',
  // DOM-TOM
  'zinfos974.com',
  'imazpress.com',
  'mayottehebdo.com',
];

/** @param {string} url */
function isAllowedDomain(url) {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

// Logique de parsing XML→items extraite vers api/_lib/parse-rss.js
// (réutilisée par l'ingestion serveur api/ingest/news.ts). Comportement identique.

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export default async function handler(request) {
  const rl = await checkRateLimit('rss', request, RSS_RATE_LIMIT_PER_MIN);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const feedUrl = searchParams.get('url');

  if (!feedUrl) {
    return new Response(JSON.stringify({ error: 'Missing ?url= parameter', items: [] }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  if (!isAllowedDomain(feedUrl)) {
    return new Response(JSON.stringify({ error: 'Domain not allowed', items: [] }), {
      status: 403,
      headers: JSON_HEADERS,
    });
  }

  let parsed;
  try {
    parsed = new URL(feedUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL', items: [] }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    // safeFetch : chaque redirection est revalidée contre la liste (une redirection ouverte chez un titre de presse ne doit
    // pas mener vers une adresse interne), IP littérales refusées.
    const { response: resp } = await safeFetch(feedUrl, ALLOWED_DOMAINS, {
      headers: {
        'User-Agent': ua,
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `Upstream ${resp.status}`, items: [] }), {
        status: resp.status,
        headers: JSON_HEADERS,
      });
    }

    const xml = decodeBody(await readCapped(resp, MAX_RESPONSE_BYTES), resp.headers.get('content-type'));
    const items = parseRssXml(xml);
    const sourceFormat = detectSourceFormat(xml);

    return new Response(JSON.stringify({ items, sourceFormat }), {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    if (err instanceof SafeFetchError) {
      const refused = err.code === 'DOMAIN_NOT_ALLOWED' || err.code === 'INVALID_URL';
      return new Response(JSON.stringify({ error: 'Fetch refused', code: err.code, items: [] }), {
        status: refused ? 403 : 502,
        headers: JSON_HEADERS,
      });
    }
    return new Response(JSON.stringify({ error: 'Fetch failed', items: [] }), {
      status: 502,
      headers: JSON_HEADERS,
    });
  }
}
