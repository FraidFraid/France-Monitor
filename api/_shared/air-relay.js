export function resolveRelayBaseUrl() {
  const explicit = process.env.AIR_RELAY_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const wsRelay = process.env.WS_RELAY_URL?.trim() || process.env.VITE_WS_RELAY_URL?.trim();
  if (!wsRelay) return null;

  return wsRelay
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/$/, '');
}

export async function fetchAirTrafficSnapshotFromRelay(fetchImpl = fetch, relayBaseUrl = resolveRelayBaseUrl()) {
  if (!relayBaseUrl) {
    throw new Error('Air relay URL is not configured');
  }

  const response = await fetchImpl(`${relayBaseUrl}/opensky`, {
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Air relay HTTP ${response.status}`);
  }

  return response.json();
}
