import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { loadEnv } from 'vite';
import WebSocket, { WebSocketServer } from 'ws';

import { fetchAirTrafficSnapshot } from './api/_shared/air-traffic.js';

const DEFAULT_RELAY_PORT = 8090;
const DEFAULT_AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60_000;
const MAX_BOUNDING_BOXES_PER_SUBSCRIPTION = 5;
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
    // Polynésie française — zone large autour des principaux archipels
    [[-28.5, -155.5], [-7.0, -133.0]],
    // Nouvelle-Calédonie
    [[-23.8, 157.5], [-17.6, 173.0]],
  ],
  FilterMessageTypes: ['PositionReport', 'ShipStaticData', 'StandardClassBPositionReport'],
};

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Utilisation de global pour survivre aux rechargements HMR de Vite
let relayInstance = global.__aisRelayInstance || null;

function loadRelayEnv(mode = process.env.NODE_ENV || 'development') {
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.length > 0 && !process.env[key]) {
      process.env[key] = value;
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
  return process.env.AIR_RELAY_URL?.trim() || `http://127.0.0.1:${process.env.RELAY_PORT || DEFAULT_RELAY_PORT}`;
}

export function startRelayServer(options = {}) {
  if (relayInstance) return relayInstance;

  loadRelayEnv(options.mode);

  const relayPort = Number(options.port || process.env.RELAY_PORT || DEFAULT_RELAY_PORT);
  const aisApiKey = options.aisApiKey ?? process.env.AISSTREAM_API_KEY ?? process.env.VITE_AISSTREAM_KEY ?? '';
  const upstreamUrl = options.upstreamUrl ?? process.env.AISSTREAM_UPSTREAM_URL ?? DEFAULT_AISSTREAM_URL;
  const subscription = {
    ...SUBSCRIPTION,
    APIKey: aisApiKey,
  };
  const subscriptionChunks = chunkArray(subscription.BoundingBoxes, MAX_BOUNDING_BOXES_PER_SUBSCRIPTION)
    .map((boxes) => ({ ...subscription, BoundingBoxes: boxes }));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        ais: Boolean(aisApiKey),
        upstreamUrl,
        opensky: Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET),
      }, { 'Cache-Control': 'no-store' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/opensky') {
      try {
        const snapshot = await fetchAirTrafficSnapshot(fetch);
        sendJson(res, 200, snapshot, {
          'Cache-Control': 'no-cache',
          'X-Relay-Source': 'local-ais-relay',
        });
      } catch (error) {
        sendJson(res, 502, {
          error: error instanceof Error ? error.message : 'OpenSky relay failed',
        }, { 'Cache-Control': 'no-store' });
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' }, { 'Cache-Control': 'no-store' });
  });

  const wsServer = new WebSocketServer({ server });
  const upstreamStates = subscriptionChunks.map((chunk, index) => ({
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
  }));
  let usingExternalRelay = false;

  const hasDownstreamClients = () => {
    for (const client of wsServer.clients) {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        return true;
      }
    }
    return false;
  };

  const clearReconnectTimer = (state) => {
    if (!state.reconnectTimer) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  };

  const clearAllReconnectTimers = () => {
    upstreamStates.forEach(clearReconnectTimer);
  };

  const closeLocalRelay = () => {
    clearAllReconnectTimers();
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
    if (state.reconnectTimer || !aisApiKey) return;
    if (!hasDownstreamClients()) return;

    const now = Date.now();
    if (state.circuitBreakerUntil > now) {
      const waitMs = state.circuitBreakerUntil - now;
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        connectUpstream(state);
      }, waitMs);
      console.warn(`[AIS Relay] ⏸️ Circuit breaker actif flux #${state.index + 1} — nouvelle tentative dans ${waitMs}ms`);
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
    if (!aisApiKey) return;
    if (!hasDownstreamClients()) return;
    if (state.upstream && (state.upstream.readyState === WebSocket.OPEN || state.upstream.readyState === WebSocket.CONNECTING)) {
      return;
    }

    state.upstream = new WebSocket(upstreamUrl);

    state.upstream.on('open', () => {
      state.reconnectDelayMs = 2000;
      state.consecutiveFailures = 0;
      state.circuitBreakerUntil = 0;
      state.lastUpstreamError = null;
      console.log(`[AIS Relay] ✅ Connecté à ${upstreamUrl} — souscription #${state.index + 1}/${upstreamStates.length} envoyée (${state.subscription.BoundingBoxes.length} bbox)`);
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
      broadcast(data.toString());
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

      if (!hasDownstreamClients()) {
        console.warn(`[AIS Relay] ⚠️ Upstream flux #${state.index + 1} déconnecté (code ${code}) — aucun client local, pause des reconnexions`);
        return;
      }

      const extra = [
        state.lastUpstreamError ? `erreur=${state.lastUpstreamError}` : '',
        reasonText ? `reason=${reasonText}` : '',
        state.consecutiveFailures > 1 ? `échecs=${state.consecutiveFailures}` : '',
      ].filter(Boolean).join(' · ');

      console.warn(
        `[AIS Relay] ⚠️ Upstream flux #${state.index + 1} déconnecté (code ${code}) — reconnexion dans ${state.reconnectDelayMs}ms${extra ? ` · ${extra}` : ''}`,
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
      if (hasDownstreamClients()) return;
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

  server.listen(relayPort, () => {
    if (usingExternalRelay) return;
    console.log(`[AIS Relay] 🚀 Nouveau relay démarré et à l’écoute sur le port ${relayPort} (clé: ${aisApiKey ? 'OK' : 'Manquante'})`);
  });

  relayInstance = {
    port: relayPort,
    server,
    wsServer,
    close() {
      for (const state of upstreamStates) {
        state.upstream?.close();
      }
      wsServer.close();
      server.close();
      relayInstance = null;
      global.__aisRelayInstance = null;
    },
  };

  global.__aisRelayInstance = relayInstance;
  return relayInstance;
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  startRelayServer();
  console.log(`Relay AIS/OpenSky démarré sur ${getRelayHttpBaseUrl()} (WS sur même port)`);
}
