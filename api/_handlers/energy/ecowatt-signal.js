// api/_handlers/energy/ecowatt-signal.js — GET /api/energy/ecowatt-signal
//
// Signal Écowatt OFFICIEL de RTE : { official: EcowattOfficial, rteStatus: 'ok' | 'unavailable' }.
//
// Source principale : API Écowatt v5 de RTE (OAuth2 client credentials, quota 1 appel / 15 min).
// Repli : open data RTE « nouveau_signal_ecowatt » sur ODRÉ (sans authentification, jours passés
// seulement). Le jeton OAuth2 est gardé en mémoire du module jusqu'à expires_in - 60 s, comme
// api/_handlers/nuclear/rte-unavailability.js. Jamais de log des identifiants ni du jeton.
//
// Cache SWR (api/_utils/swr-cache.js) : ttlSec au-dessus du quota RTE pour la source RTE, staleSec
// large pour tolérer une panne RTE/ODRÉ sans faire attendre l'appelant. 503 seulement quand RTE ET
// le repli échouent tous les deux (et qu'aucune valeur, même périmée, n'est en cache).

import { getOrRefresh } from '../../_utils/swr-cache.js';
import { normalizeOdreRecords, normalizeRteSignals } from '../../_lib/ecowatt-official.js';

const RTE_TOKEN_URL = 'https://digital.iservices.rte-france.com/token/oauth/token';
const RTE_SIGNALS_URL = 'https://digital.iservices.rte-france.com/open_api/ecowatt/v5/signals';
const ODRE_URL =
  'https://odre.opendatasoft.com/api/explore/v2.1/catalog/datasets/nouveau_signal_ecowatt/records' +
  '?order_by=-date&limit=4';

const RTE_CACHE_KEY = 'ecowatt:official:rte:v1';
const RTE_TTL_SEC = 960; // > 15 min (quota RTE)
const RTE_STALE_SEC = 6 * 60 * 60;
const RTE_TIMEOUT_MS = 8_000;

const ODRE_CACHE_KEY = 'ecowatt:official:odre:v1';
const ODRE_TTL_SEC = 60 * 60;
const ODRE_STALE_SEC = 24 * 60 * 60;
const ODRE_TIMEOUT_MS = 8_000;

/** Jeton OAuth2 RTE, en mémoire du module (partagé entre requêtes tant que l'instance vit). */
let tokenCache = /** @type {{ accessToken: string, expiresAtMs: number } | null} */ (null);

/**
 * Après un échec RTE (403 tant que l'application n'est pas abonnée à l'API Écowatt, 429 quota,
 * panne), on ne rappelle pas RTE avant 15 min : on sert le repli sans marteler l'API.
 */
const RTE_BACKOFF_MS = 15 * 60 * 1000;
let rteRetryAtMs = 0;

/** Tests uniquement : oublie le jeton et la pause RTE. */
export function __resetEcowattSignalForTests() {
  tokenCache = null;
  rteRetryAtMs = 0;
}

/**
 * @param {string} clientId
 * @param {string} clientSecret
 * @returns {Promise<string>}
 */
async function getRteToken(clientId, clientSecret) {
  if (tokenCache && Date.now() < tokenCache.expiresAtMs) return tokenCache.accessToken;

  const response = await fetch(RTE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(RTE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`RTE token HTTP ${response.status}`);

  const json = await response.json();
  const accessToken = json?.access_token;
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('RTE token : access_token manquant');
  const expiresIn = typeof json?.expires_in === 'number' ? json.expires_in : 3600;

  tokenCache = { accessToken, expiresAtMs: Date.now() + Math.max(0, expiresIn - 60) * 1000 };
  return accessToken;
}

/** @returns {Promise<import('../../../src/types/index.ts').EcowattOfficial>} */
async function fetchRteOfficial() {
  const clientId = process.env.RTE_CLIENT_ID;
  const clientSecret = process.env.RTE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('RTE_CLIENT_ID/RTE_CLIENT_SECRET absents');

  const accessToken = await getRteToken(clientId, clientSecret);
  const response = await fetch(RTE_SIGNALS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(RTE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`RTE ecowatt/v5/signals HTTP ${response.status}`);

  const raw = await response.json();
  return normalizeRteSignals(raw);
}

/** @returns {Promise<import('../../../src/types/index.ts').EcowattOfficial>} */
async function fetchOdreOfficial() {
  const response = await fetch(ODRE_URL, { signal: AbortSignal.timeout(ODRE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`ODRE nouveau_signal_ecowatt HTTP ${response.status}`);

  const json = await response.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  return normalizeOdreRecords(results);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const clientId = process.env.RTE_CLIENT_ID;
  const clientSecret = process.env.RTE_CLIENT_SECRET;

  let official = null;
  let rteStatus = /** @type {'ok' | 'unavailable'} */ ('unavailable');
  let cacheState = /** @type {'hit' | 'stale' | 'miss'} */ ('miss');

  if (clientId && clientSecret && Date.now() >= rteRetryAtMs) {
    try {
      const { value, cache } = await getOrRefresh(
        RTE_CACHE_KEY,
        { ttlSec: RTE_TTL_SEC, staleSec: RTE_STALE_SEC, timeoutMs: RTE_TIMEOUT_MS },
        fetchRteOfficial,
      );
      official = value;
      rteStatus = 'ok';
      cacheState = cache;
    } catch (error) {
      rteRetryAtMs = Date.now() + RTE_BACKOFF_MS;
      // Jamais de log des identifiants/jeton : seulement le statut/le message d'erreur HTTP.
      console.error('[api/energy/ecowatt-signal] RTE indisponible :', error instanceof Error ? error.message : error);
    }
  }

  if (!official) {
    try {
      const { value, cache } = await getOrRefresh(
        ODRE_CACHE_KEY,
        { ttlSec: ODRE_TTL_SEC, staleSec: ODRE_STALE_SEC, timeoutMs: ODRE_TIMEOUT_MS },
        fetchOdreOfficial,
      );
      official = value;
      cacheState = cache;
    } catch (error) {
      console.error('[api/energy/ecowatt-signal] Repli ODRÉ indisponible :', error instanceof Error ? error.message : error);
    }
  }

  if (!official) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'ecowatt unavailable' });
    return;
  }

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  res.setHeader('X-Cache', cacheState);
  res.status(200).json({ official, rteStatus });
}
