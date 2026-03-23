import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { loadEnv } from 'vite';
import WebSocket, { WebSocketServer } from 'ws';

import { fetchAirTrafficSnapshot } from './api/_shared/air-traffic.js';

const DEFAULT_RELAY_PORT = 8090;
const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
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
  ],
  FilterMessageTypes: ['PositionReport', 'ShipStaticData', 'StandardClassBPositionReport'],
};

let relayInstance = null;

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
  const subscription = {
    ...SUBSCRIPTION,
    APIKey: aisApiKey,
  };

  console.log(`[AIS Relay] 🚀 Démarrage sur port ${relayPort} — clé AIS: ${aisApiKey ? '✅ présente' : '❌ manquante'}`);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        ais: Boolean(aisApiKey),
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
  let upstream = null;
  let reconnectTimer = null;
  let reconnectDelayMs = 2000;

  const scheduleReconnect = () => {
    if (reconnectTimer || !aisApiKey) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectUpstream();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
  };

  const broadcast = (payload) => {
    wsServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  };

  const connectUpstream = () => {
    if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
      return;
    }

    upstream = new WebSocket(AISSTREAM_URL);

    upstream.on('open', () => {
      reconnectDelayMs = 2000;
      console.log('[AIS Relay] ✅ Connecté à aisstream.io — souscription envoyée');
      upstream?.send(JSON.stringify(subscription));
    });

    let msgCount = 0;
    upstream.on('message', (data) => {
      msgCount++;
      if (msgCount === 1 || msgCount % 500 === 0) {
        console.log(`[AIS Relay] 📡 Message #${msgCount} reçu, ${wsServer.clients.size} client(s) connecté(s)`);
      }
      broadcast(data.toString());
    });

    upstream.on('error', (err) => {
      console.error('[AIS Relay] ❌ Erreur upstream:', err.message);
      upstream?.close();
    });

    upstream.on('close', (code, reason) => {
      console.warn(`[AIS Relay] ⚠️ Upstream déconnecté (code ${code}) — reconnexion dans ${reconnectDelayMs}ms`);
      upstream = null;
      scheduleReconnect();
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

    connectUpstream();
  });

  server.listen(relayPort);

  relayInstance = {
    port: relayPort,
    server,
    wsServer,
    close() {
      upstream?.close();
      wsServer.close();
      server.close();
      relayInstance = null;
    },
  };

  return relayInstance;
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  startRelayServer();
  console.log(`Relay AIS/OpenSky démarré sur ${getRelayHttpBaseUrl()} (WS sur même port)`);
}
