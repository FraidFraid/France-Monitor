// server/prod/http-server.mjs
// Serveur HTTP Node de production : sert toutes les routes /api sans Vercel, pour la VM
// Oracle Always Free (voir la spec de migration). Remplace api/index.js (fonction Vercel
// unique) par un http.Server nu, devant lequel Caddy fait le reverse proxy public (statique,
// TLS, en-têtes de sécurité — voir vercel.json et la spec pour la parité à reproduire côté Caddy).
//
// Mêmes trois fichiers de fonction restés hors routeur que sous Vercel (limite de 12
// fonctions du palier Hobby, cf. api/_utils/dispatch.js) : ils gardent leur chemin dédié
// ici aussi, chargés paresseusement comme api/_routes.js le fait pour le reste. Tout le
// reste de /api/* passe par dispatch() (même routeur qu'en prod Vercel aujourd'hui).
//
// /healthz est une sonde de santé du PROCESS (pour le script de déploiement — voir
// deploy/**), distincte de /api/health-check qui sonde la santé APPLICATIVE (ingestion +
// fraîcheur des articles). Le reste (fichiers statiques de dist/) est servi par Caddy, pas
// par ce serveur : tout chemin hors /api et /healthz répond 404 ici.

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { dispatch } from '../../api/_utils/dispatch.js';
import { addResponseHelpers, addQuery, readBody } from './vercel-compat.mjs';
import { COLLECTORS, startTrafficCollectors } from './traffic-collectors.mjs';
import { ENVIRONMENT_COLLECTORS } from './environment-collectors.mjs';
import { SOVEREIGNTY_COLLECTORS } from './sovereignty-collectors.mjs';
import { OUTAGES_COLLECTORS } from './outages-collectors.mjs';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3000;

// Les trois fichiers de fonction Vercel restés hors routeur (voir l'en-tête de
// api/_utils/dispatch.js pour le pourquoi de cette exception).
const STANDALONE_ROUTES = {
  '/api/ingest/news': () => import('../../api/ingest/news.ts'),
  '/api/fuel-price-series-refresh': () => import('../../api/fuel-price-series-refresh.js'),
  '/api/sentinel-ndwi': () => import('../../api/sentinel-ndwi.ts'),
};

/**
 * Résout un chemin vers son chargeur de fonction hors routeur, SANS l'exécuter (fonction
 * pure, testable sans déclencher l'import dynamique ni le handler — voir tests/prod-server.test.ts).
 * @param {string} pathname
 * @returns {(() => Promise<Record<string, unknown>>) | null}
 */
export function resolveEntry(pathname) {
  const clean = String(pathname || '/').replace(/\/+$/, '') || '/';
  return Object.prototype.hasOwnProperty.call(STANDALONE_ROUTES, clean) ? STANDALONE_ROUTES[clean] : null;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
function requestPathname(req) {
  try {
    return new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    return req.url || '/';
  }
}

/**
 * Journal d'une ligne par requête : méthode, chemin (sans query string), statut, durée.
 * Ne journalise jamais la query ni les en-têtes (donc jamais Authorization) — seule la
 * forme du chemin est loggée, déjà nettoyée de sa query par requestPathname().
 * @param {string} method
 * @param {string} pathname
 * @param {number} status
 * @param {number} durationMs
 */
function logRequest(method, pathname, status, durationMs) {
  console.log(`${method} ${pathname} ${status} ${durationMs.toFixed(1)}ms`);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} pathname
 */
async function handleRequest(req, res, pathname) {
  if (pathname === '/healthz') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname !== '/api' && !pathname.startsWith('/api/')) {
    // Le statique (dist/) est servi par Caddy sur la VM — voir la spec de migration.
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Parité vercel.json : la règle d'en-tête "/api/(.*)" → Access-Control-Allow-Origin: *.
  res.setHeader('Access-Control-Allow-Origin', '*');

  addResponseHelpers(res);
  addQuery(req);

  const entry = resolveEntry(pathname);
  if (entry) {
    // Ces trois handlers gèrent leur requête eux-mêmes (dont, pour api/sentinel-ndwi.ts, sa
    // propre lecture du corps brut) : on ne touche pas au flux avant de les appeler — voir
    // le commentaire en tête de vercel-compat.mjs sur le risque de double consommation.
    const mod = await entry();
    const handler = /** @type {unknown} */ (mod.default);
    if (typeof handler !== 'function') {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Handler invalide', path: pathname }));
      return;
    }
    await handler(req, res);
    return;
  }

  // Tout le reste de /api/* : même routeur qu'en prod Vercel aujourd'hui. req.body est
  // préparé ici (une seule fois) pour que dispatch()/toWebRequest() le retrouvent déjà
  // posé et n'aillent jamais relire le flux (voir readRawBody dans api/_utils/dispatch.js).
  await readBody(req);
  await dispatch(req, res);
}

/**
 * Crée le serveur HTTP de production sans démarrer l'écoute (voir le bas de ce fichier
 * pour le démarrage réel). Exportée pour les tests (tests/prod-server.test.ts).
 * @returns {import('node:http').Server}
 */
export function createApiServer() {
  return createServer((req, res) => {
    const startedAt = Date.now();
    const pathname = requestPathname(req);
    const method = String(req.method || 'GET').toUpperCase();

    let logged = false;
    const logOnce = () => {
      if (logged) return;
      logged = true;
      logRequest(method, pathname, res.statusCode, Date.now() - startedAt);
    };
    res.once('finish', logOnce);
    res.once('close', logOnce);

    handleRequest(req, res, pathname).catch((err) => {
      console.error(`[prod-server] ${method} ${pathname}`, err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'Internal error' }));
      } else {
        res.end();
      }
    });
  });
}

// N'écoute que si ce fichier est exécuté directement (`node server/prod/http-server.mjs`),
// jamais quand il est importé (tests, ou un futur script qui réutiliserait createApiServer()).
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const host = process.env.HOST || DEFAULT_HOST;
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const server = createApiServer();

  server.listen(port, host, () => {
    console.log(`[prod-server] écoute sur http://${host}:${port}`);
  });

  // Collectes serveur : TomTom et OpenSky (quota, spec trafic T4), FIRMS et archive de la vigilance (spec environnement § 2.4, E5).
  // Souveraineté : vols militaires, veille des câbles, vigilance cyber et page Vigipirate (spec 2026-10-04 souveraineté § 2, O14).
  const stopCollectors = startTrafficCollectors({ collectors: [...COLLECTORS, ...ENVIRONMENT_COLLECTORS, ...SOVEREIGNTY_COLLECTORS, ...OUTAGES_COLLECTORS] });

  let shuttingDown = false;
  /** @param {string} signal */
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    stopCollectors();
    console.log(`[prod-server] ${signal} reçu, arrêt en cours…`);
    server.close(() => {
      console.log('[prod-server] arrêt propre.');
      process.exit(0);
    });
    // Filet de sécurité : force l'arrêt si des connexions traînent (ex. requête longue en cours).
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
