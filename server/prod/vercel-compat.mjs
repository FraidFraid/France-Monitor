// server/prod/vercel-compat.mjs
// Compatibilité req/res « à la Vercel » pour le serveur HTTP de production
// (server/prod/http-server.mjs). Sur Vercel, les handlers de api/ comptent sur des
// extensions que Node http.IncomingMessage/ServerResponse n'ont pas nativement :
// req.query, req.body déjà parsé, res.status().json()/.send(). Ce module les ajoute,
// sans jamais écraser un helper déjà présent (utile aussi en test, où un mock peut
// déjà fournir l'un d'eux).
//
// Le corps n'est lu qu'à la demande (readBody), jamais automatiquement en arrière-plan :
// un des trois fichiers de fonction hors routeur (api/sentinel-ndwi.ts) lit lui-même le
// flux brut via req.on('data'/'end'). Si on l'avait déjà consommé ici, ce second lecteur
// resterait bloqué indéfiniment (un flux Node ne se relit pas une fois terminé). Voir
// server/prod/http-server.mjs : readBody() n'est appelé que pour les routes qui passent
// par api/_utils/dispatch.js, jamais pour les trois fichiers de fonction directs.

import { toQueryObject } from '../../api/_utils/dispatch.js';

// Garde-fou générique : aucune route connue de api/ n'a besoin d'un corps plus gros
// (les gros payloads — images, PDF de facture, etc. — transitent par Drive/Storage, pas
// par le corps d'une requête API).
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Ajoute `req.query`, même forme que le helper Vercel (chaîne, ou tableau si la clé est
 * répétée — voir toQueryObject dans api/_utils/dispatch.js, réutilisé ici). Pur,
 * synchrone, ne touche jamais au corps de la requête. N'écrase pas un `req.query` déjà
 * posé (ex. dispatch() le repose de toute façon avec les search params canoniques).
 * @param {import('node:http').IncomingMessage & { query?: Record<string, string | string[]> }} req
 */
export function addQuery(req) {
  if (req.query !== undefined) return;
  const url = new URL(req.url || '/', 'http://localhost');
  const query = toQueryObject(url.searchParams);
  try {
    Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true, enumerable: true });
  } catch {
    req.query = query;
  }
}

/**
 * Ajoute `res.status()` / `.json()` / `.send()` « à la Vercel » si absents. Chaque
 * helper est posé indépendamment : un mock de test peut déjà fournir l'un d'eux sans
 * que les autres soient perdus.
 * @param {import('node:http').ServerResponse} res
 */
export function addResponseHelpers(res) {
  if (typeof res.status !== 'function') {
    res.status = function status(code) {
      res.statusCode = code;
      return res;
    };
  }
  if (typeof res.json !== 'function') {
    res.json = function json(payload) {
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
      return res;
    };
  }
  if (typeof res.send !== 'function') {
    res.send = function send(payload) {
      if (payload === undefined) {
        res.end();
        return res;
      }
      if (typeof payload === 'string') {
        if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(payload);
        return res;
      }
      if (Buffer.isBuffer(payload)) {
        if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/octet-stream');
        res.end(payload);
        return res;
      }
      // Objet / tableau / nombre / booléen : comme res.send de Vercel, on retombe sur JSON.
      return res.json(payload);
    };
  }
}

/**
 * Lit le corps brut une seule fois et pose `req.body`, comme le runtime Node de Vercel :
 * JSON → objet, formulaire encodé → objet, texte → chaîne, autre → Buffer brut (le
 * `readRawBody` de api/_utils/dispatch.js, utilisé pour adapter les handlers « edge »,
 * sait déjà consommer chacune de ces formes — voir son commentaire sur le JSON malformé).
 * Idempotent : si `req.body` est déjà posé (ex. mock de test), ne relit rien.
 * @param {import('node:http').IncomingMessage & { body?: unknown }} req
 * @returns {Promise<unknown>}
 */
export async function readBody(req) {
  if (req.body !== undefined) return req.body;

  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    req.body = undefined;
    return undefined;
  }

  const raw = await readRawChunks(req);
  if (raw.length === 0) {
    req.body = undefined;
    return undefined;
  }

  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType === 'application/json') {
    try {
      req.body = JSON.parse(raw.toString('utf8'));
    } catch {
      // JSON malformé : comme le runtime Vercel (cf. le commentaire sur readRawBody dans
      // dispatch.js), on laisse un corps vide plutôt que de faire planter le serveur —
      // au handler de constater l'absence de corps exploitable.
      req.body = undefined;
    }
  } else if (contentType === 'application/x-www-form-urlencoded') {
    req.body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  } else if (contentType.startsWith('text/')) {
    req.body = raw.toString('utf8');
  } else {
    req.body = raw; // Buffer brut : binaire ou type non reconnu, comme Vercel.
  }
  return req.body;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readRawChunks(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('body_too_large'));
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
