import { existsSync, readFileSync } from 'fs';
import { createServer } from 'http';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { parseEnv } from 'util';
import WebSocket, { WebSocketServer } from 'ws';

import { boundStatics, createAisTracker, snapshotResponse } from './api/_lib/ais-snapshot.js';
import { kvReadJson, kvWriteJson } from './api/_lib/kv-history.js';

// Relais AIS (VM : fm-relay.service, 127.0.0.1:8090 ; Caddy sert /relay* en retirant le préfixe).
// - WebSocket « / » : rediffuse tel quel le flux aisstream.io aux cartes des navigateurs (inchangé).
// - GET /snapshot : instantané maritime du panneau (spec 2026-10-03 panneaux trafic § 2.5) calculé sur les
//   messages reçus ; en production le flux amont reste ouvert même sans navigateur connecté (`keepUpstream`),
//   sinon l'instantané serait vide la plupart du temps.
// - GET /health : santé du processus (script de déploiement).

const DEFAULT_RELAY_PORT = 8090;
const DEFAULT_AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60_000;
const MAX_BOUNDING_BOXES_PER_SUBSCRIPTION = 5;
const SNAPSHOT_CACHE_MS = 30_000;
const STATICS_KEY = 'ais:statics';
const STATICS_SAVE_MS = 30 * 60_000;
const STATICS_KEEP_SEC = 7 * 86_400;
const PRUNE_MS = 60_000;
const SHUTDOWN_SAVE_TIMEOUT_MS = 5_000;
/** Zone de chaque boîte, dans l'ordre de `BoundingBoxes` ; `metro` : boîte qui alimente l'instantané (eaux françaises métropolitaines). */
export const BOX_COVERAGE = [
  { label: 'Manche', metro: true }, { label: 'Atlantique', metro: true }, { label: 'golfe du Lion', metro: true }, { label: 'Corse', metro: true },
  { label: 'Dunkerque-Calais', metro: true }, { label: 'Gironde', metro: true }, { label: 'Antilles', metro: false }, { label: 'Guyane', metro: false },
  { label: 'La Réunion', metro: false }, { label: 'Mayotte', metro: false }, { label: 'Saint-Pierre-et-Miquelon', metro: false },
  { label: 'Wallis-et-Futuna', metro: false }, { label: 'Polynésie', metro: false }, { label: 'Nouvelle-Calédonie', metro: false },
];
const SUBSCRIPTION = {
  APIKey: '',
  BoundingBoxes: [
    // Manche française / Pas-de-Calais, recentré pour exclure Rotterdam-Amsterdam
    [[48.2, -6.0], [50.9, 2.4]],
    // Atlantique français + golfe de Gascogne
    [[42.0, -10.5], [48.9, -0.8]],
    // Golfe du Lion + façade méditerranéenne française continentale
    [[41.0, 1.8], [44.8, 8.2]],
    // Corse + Méditerranée proche
    [[41.0, 7.8], [43.8, 10.2]],
    // Dunkerque et Calais (hors de la boîte Manche, relevé du 03/10/2026)
    [[50.9, 1.0], [51.4, 2.6]],
    // Gironde : Bordeaux, Pauillac, Le Verdon (hors de la boîte Atlantique)
    [[44.5, -1.3], [45.4, -0.4]],
    // Antilles françaises
    [[14.0, -62.5], [19.5, -58.0]],
    // Guyane française
    [[2.0, -54.8], [6.0, -51.4]],
    // La Réunion
    [[-21.6, 55.0], [-20.6, 56.1]],
    // Mayotte
    [[-13.2, 44.7], [-12.4, 45.6]],
    // Saint-Pierre-et-Miquelon
    [[46.6, -56.8], [47.4, -55.8]],
    // Wallis-et-Futuna
    [[-14.6, -178.6], [-13.0, -175.8]],
    // Polynésie française : zone large autour des principaux archipels
    [[-28.5, -155.5], [-7.0, -133.0]],
    // Nouvelle-Calédonie
    [[-23.8, 157.5], [-17.6, 173.0]],
  ],
  FilterMessageTypes: ['PositionReport', 'ShipStaticData', 'StandardClassBPositionReport'],
};

export function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Lots d'abonnement (5 boîtes au plus par lot). */
export function subscriptionChunks(apiKey = '') {
  return chunkArray(SUBSCRIPTION.BoundingBoxes, MAX_BOUNDING_BOXES_PER_SUBSCRIPTION)
    .map((boxes) => ({ ...SUBSCRIPTION, APIKey: apiKey, BoundingBoxes: boxes }));
}

// Utilisation de global pour survivre aux rechargements HMR de Vite
let relayInstance = global.__aisRelayInstance || null;

/**
 * Complète process.env avec les fichiers .env du dossier courant, dans l'ordre de priorité de
 * `loadEnv` de Vite (.env.<mode>.local > .env.<mode> > .env.local > .env), sans jamais écraser une
 * variable déjà posée. Sans dépendance à vite : en production (VM, `npm ci --omit=dev`), vite n'est
 * pas installé et les variables viennent de l'EnvironmentFile systemd.
 */
function loadRelayEnv(mode = process.env.NODE_ENV || 'development') {
  for (const file of [`.env.${mode}.local`, `.env.${mode}`, '.env.local', '.env']) {
    const path = join(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
      if (typeof value === 'string' && value.length > 0 && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [key, value] of Object.entries(extraHeaders)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(payload));
}

export function getRelayHttpBaseUrl() {
  return `http://127.0.0.1:${process.env.RELAY_PORT || DEFAULT_RELAY_PORT}`;
}

/**
 * Démarre le relais. Options : port, aisApiKey, upstreamUrl, mode, keepUpstream (flux amont ouvert même sans
 * navigateur ; vrai en production, ou AIS_RELAY_KEEP_UPSTREAM=1), tracker (suivi injecté par les tests).
 */
export function startRelayServer(options = {}) {
  if (relayInstance) return relayInstance;

  loadRelayEnv(options.mode);

  const relayPort = Number(options.port ?? (process.env.RELAY_PORT || DEFAULT_RELAY_PORT));
  const aisApiKey = options.aisApiKey ?? process.env.AISSTREAM_API_KEY ?? process.env.VITE_AISSTREAM_KEY ?? '';
  const upstreamUrl = options.upstreamUrl ?? process.env.AISSTREAM_UPSTREAM_URL ?? DEFAULT_AISSTREAM_URL;
  const keepUpstream = options.keepUpstream ?? process.env.AIS_RELAY_KEEP_UPSTREAM === '1';
  const tracker = options.tracker ?? createAisTracker();
  const chunks = subscriptionChunks(aisApiKey);
  let snapshotCache = null;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        ais: Boolean(aisApiKey),
        upstreamUrl,
      }, { 'Cache-Control': 'no-store' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/snapshot') {
      const now = Date.now();
      if (!snapshotCache || now - snapshotCache.at > SNAPSHOT_CACHE_MS) {
        const upstreamOpen = upstreamStates.some((s) => s.upstream?.readyState === WebSocket.OPEN);
        snapshotCache = { at: now, body: snapshotResponse(tracker, now, { hasKey: Boolean(aisApiKey), upstreamOpen, upstreams: upstreamLots(now) }) };
      }
      sendJson(res, 200, snapshotCache.body, { 'Cache-Control': 'public, max-age=30', 'Access-Control-Allow-Origin': '*' });
      return;
    }

    sendJson(res, 404, { error: 'Not found' }, { 'Cache-Control': 'no-store' });
  });

  /** État de chaque connexion amont pour `snapshotResponse` : ouverte, dernier message (ou ouverture), zones couvertes. */
  const upstreamLots = () => upstreamStates.map((state) => {
    const boxes = chunkStart(state.index);
    const covered = BOX_COVERAGE.slice(boxes, boxes + state.subscription.BoundingBoxes.length);
    return {
      index: state.index,
      open: state.upstream?.readyState === WebSocket.OPEN,
      lastAt: state.lastMessageAt ?? state.openedAt,
      labels: covered.map((c) => c.label),
      metro: covered.some((c) => c.metro),
    };
  });
  const chunkStart = (index) => index * MAX_BOUNDING_BOXES_PER_SUBSCRIPTION;

  const wsServer = new WebSocketServer({ server });
  const upstreamStates = chunks.map((chunk, index) => ({
    index,
    subscription: chunk,
    upstream: null,
    reconnectTimer: null,
    reconnectDelayMs: 2000,
    consecutiveFailures: 0,
    circuitBreakerUntil: 0,
    lastUpstreamError: null,
    pingInterval: null,
    msgCount: 0,
    openedAt: null,
    lastMessageAt: null,
  }));
  let usingExternalRelay = false;
  let staticsTimer = null;
  let pruneTimer = null;

  const hasDownstreamClients = () => {
    for (const client of wsServer.clients) {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        return true;
      }
    }
    return false;
  };

  /** Le flux amont est voulu : instantané serveur (production) ou au moins un navigateur connecté. */
  const wantUpstream = () => keepUpstream || hasDownstreamClients();

  const clearReconnectTimer = (state) => {
    if (!state.reconnectTimer) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  };

  const clearAllReconnectTimers = () => {
    upstreamStates.forEach(clearReconnectTimer);
  };

  let closed = false;
  const closeLocalRelay = () => {
    closed = true;
    clearAllReconnectTimers();
    if (staticsTimer) clearInterval(staticsTimer);
    if (pruneTimer) clearInterval(pruneTimer);
    for (const state of upstreamStates) {
      if (state.pingInterval) clearInterval(state.pingInterval);
      state.pingInterval = null;
      try {
        state.upstream?.close();
      } catch {}
      state.upstream = null;
    }
    try {
      wsServer.close();
    } catch {}
    try {
      server.close();
    } catch {}
  };

  let errorHandled = false;
  const handleListenError = (err) => {
    if (errorHandled) return;
    errorHandled = true;

    if (err?.code === 'EADDRINUSE') {
      usingExternalRelay = true;
      console.log(`[AIS Relay] ♻️  Port ${relayPort} occupé : Réutilisation du relay en arrière-plan (clé: ${aisApiKey ? 'OK' : 'Manquante'})`);
      closeLocalRelay();
      relayInstance = {
        port: relayPort,
        external: true,
        server: null,
        wsServer: null,
        close() {
          relayInstance = null;
          global.__aisRelayInstance = null;
        },
      };
      global.__aisRelayInstance = relayInstance;
      return;
    }

    console.error('[AIS Relay] ❌ Échec démarrage relay:', err);
    closeLocalRelay();
    throw err;
  };

  const scheduleReconnect = (state) => {
    if (closed || state.reconnectTimer || !aisApiKey) return;
    if (!wantUpstream()) return;

    const now = Date.now();
    if (state.circuitBreakerUntil > now) {
      const waitMs = state.circuitBreakerUntil - now;
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        connectUpstream(state);
      }, waitMs);
      console.warn(`[AIS Relay] ⏸️ Circuit breaker actif flux #${state.index + 1} : nouvelle tentative dans ${waitMs}ms`);
      return;
    }

    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connectUpstream(state);
    }, state.reconnectDelayMs);
    state.reconnectDelayMs = Math.min(state.reconnectDelayMs * 2, 30_000);
  };

  const broadcast = (payload) => {
    wsServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  const connectUpstream = (state) => {
    if (closed || !aisApiKey) return;
    if (!wantUpstream()) return;
    if (state.upstream && (state.upstream.readyState === WebSocket.OPEN || state.upstream.readyState === WebSocket.CONNECTING)) {
      return;
    }

    state.upstream = new WebSocket(upstreamUrl);

    state.upstream.on('open', () => {
      state.reconnectDelayMs = 2000;
      state.consecutiveFailures = 0;
      state.circuitBreakerUntil = 0;
      state.lastUpstreamError = null;
      state.openedAt = Date.now();
      state.lastMessageAt = null;
      console.log(`[AIS Relay] ✅ Connecté à ${upstreamUrl} : souscription #${state.index + 1}/${upstreamStates.length} envoyée (${state.subscription.BoundingBoxes.length} bbox)`);
      state.upstream?.send(JSON.stringify(state.subscription));

      // Keep connection alive
      state.pingInterval = setInterval(() => {
        if (state.upstream?.readyState === WebSocket.OPEN) {
          state.upstream.ping();
        }
      }, 30000); // 30s ping
    });

    state.upstream.on('message', (data) => {
      state.msgCount++;
      if (state.msgCount === 1 || state.msgCount % 500 === 0) {
        console.log(`[AIS Relay] 📡 Flux #${state.index + 1} message #${state.msgCount} reçu, ${wsServer.clients.size} client(s) connecté(s)`);
      }
      state.lastMessageAt = Date.now();
      const text = data.toString();
      tracker.ingest(text);
      broadcast(text);
    });

    state.upstream.on('error', (err) => {
      state.lastUpstreamError = err instanceof Error ? err.message : String(err);
      console.error(`[AIS Relay] ❌ Erreur upstream flux #${state.index + 1}:`, state.lastUpstreamError);
      state.upstream?.close();
    });

    state.upstream.on('close', (code, reason) => {
      if (state.pingInterval) clearInterval(state.pingInterval);
      state.pingInterval = null;
      state.upstream = null;

      const reasonText = Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || '');
      if (code !== 1000) {
        state.consecutiveFailures++;
      }
      if (state.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        state.circuitBreakerUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      }

      if (!wantUpstream()) {
        console.warn(`[AIS Relay] ⚠️ Upstream flux #${state.index + 1} déconnecté (code ${code}) : aucun client local, pause des reconnexions`);
        return;
      }

      const extra = [
        state.lastUpstreamError ? `erreur=${state.lastUpstreamError}` : '',
        reasonText ? `reason=${reasonText}` : '',
        state.consecutiveFailures > 1 ? `échecs=${state.consecutiveFailures}` : '',
      ].filter(Boolean).join(' · ');

      console.warn(
        `[AIS Relay] ⚠️ Upstream flux #${state.index + 1} déconnecté (code ${code}) : reconnexion dans ${state.reconnectDelayMs}ms${extra ? ` · ${extra}` : ''}`,
      );
      scheduleReconnect(state);
    });
  };

  wsServer.on('connection', (client, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname !== '/') {
      client.close(1008, 'Unsupported WS path');
      return;
    }

    if (!aisApiKey) {
      client.send(JSON.stringify({
        MessageType: 'Error',
        Error: 'Missing AISSTREAM_API_KEY/VITE_AISSTREAM_KEY in environment',
      }));
      return;
    }

    client.on('close', () => {
      if (wantUpstream()) return;
      clearAllReconnectTimers();
      for (const state of upstreamStates) {
        if (state.upstream && (state.upstream.readyState === WebSocket.OPEN || state.upstream.readyState === WebSocket.CONNECTING)) {
          state.upstream.close(1000, 'No downstream clients');
        }
      }
    });

    upstreamStates.forEach(connectUpstream);
  });

  server.on('error', handleListenError);
  wsServer.on('error', handleListenError);

  /**
   * Sauvegarde la mémoire MMSI (navires vus dans les eaux françaises depuis 7 jours, champs minimaux, bornée à 900 Ko).
   * Écriture stricte : taille et résultat sont journalisés, un échec n'est jamais avalé.
   */
  const saveStatics = async (reason = 'périodique') => {
    const { list, bytes, trimmed } = boundStatics(tracker.exportStatics(Date.now()));
    const ko = `${Math.round(bytes / 1024)} Ko`;
    const result = await kvWriteJson(STATICS_KEY, list, STATICS_KEEP_SEC);
    if (!result.ok) {
      console.error(`[AIS Relay] ❌ Sauvegarde de la mémoire MMSI (${reason}) échouée : ${list.length} navires, ${ko} : ${result.error}`);
    } else if (!result.persisted) {
      console.warn(`[AIS Relay] ⚠️ Mémoire MMSI (${reason}) gardée en mémoire seulement : Redis non configuré (${list.length} navires, ${ko})`);
    } else {
      console.log(`[AIS Relay] 💾 Mémoire MMSI sauvée (${reason}) : ${list.length} navires, ${ko}${trimmed ? `, ${trimmed} plus anciens retirés` : ''}`);
    }
    return { ...result, count: list.length, bytes, trimmed };
  };

  server.listen(relayPort, () => {
    if (usingExternalRelay || closed) return;
    console.log(`[AIS Relay] 🚀 Nouveau relay démarré et à l’écoute sur le port ${relayPort} (clé: ${aisApiKey ? 'OK' : 'Manquante'})`);
    // Élagage des suivis sur minuteur (sans appel HTTP, les tables ne seraient plus bornées).
    pruneTimer = setInterval(() => tracker.prune(Date.now()), PRUNE_MS);
    pruneTimer.unref?.();
    if (!keepUpstream) return;
    // Mémoire MMSI gardée d'un redémarrage à l'autre (les données statiques n'arrivent que toutes les 6 min).
    kvReadJson(STATICS_KEY).then(({ value, failed }) => {
      if (failed) console.error('[AIS Relay] ❌ Relecture de la mémoire MMSI impossible (Redis en panne) : démarrage sans mémoire');
      else tracker.importStatics(value, Date.now());
    }, (err) => console.error('[AIS Relay] ❌ Relecture de la mémoire MMSI échouée :', err instanceof Error ? err.message : String(err)));
    staticsTimer = setInterval(() => {
      void saveStatics();
    }, STATICS_SAVE_MS);
    staticsTimer.unref?.();
    upstreamStates.forEach(connectUpstream);
  });

  relayInstance = {
    port: relayPort,
    server,
    wsServer,
    tracker,
    saveStatics,
    close() {
      closeLocalRelay();
      relayInstance = null;
      global.__aisRelayInstance = null;
    },
  };

  global.__aisRelayInstance = relayInstance;
  return relayInstance;
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  // Production (VM) : flux amont toujours ouvert pour l'instantané /snapshot.
  const relay = startRelayServer({ keepUpstream: true });
  console.log(`Relais AIS démarré sur ${getRelayHttpBaseUrl()} (WS sur même port)`);
  // Arrêt propre (systemd) : la mémoire MMSI apprise depuis la dernière sauvegarde n'est pas perdue.
  process.once('SIGTERM', () => {
    // Délai de 5 s : si l'écriture Redis se bloque, on journalise et on sort quand même (systemd n'a pas à tuer le relais).
    const timeout = new Promise((resolve) => {
      setTimeout(() => {
        console.error('[AIS Relay] ❌ Sauvegarde de la mémoire MMSI (arrêt) sans réponse après 5 s : arrêt sans attendre');
        resolve(null);
      }, SHUTDOWN_SAVE_TIMEOUT_MS).unref?.();
    });
    Promise.race([relay.saveStatics('arrêt'), timeout]).catch(() => {}).finally(() => {
      relay.close();
      process.exit(0);
    });
  });
}
