// Proxy colonne radar PAM. MIROIR de la validation TypeScript de
// src/services/radar-column.ts — toute évolution se fait dans les deux.
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MAX_LEVELS = 16;

function sendJson(res, status, payload, cacheControl = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.end(JSON.stringify(payload));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseLevel(value) {
  if (value === null || typeof value !== 'object') return null;
  const { elevationDeg, altitudeM, dbz } = value;
  if (!isFiniteNumber(elevationDeg) || elevationDeg < 0 || elevationDeg > 90) return null;
  if (!isFiniteNumber(altitudeM) || altitudeM < 0 || altitudeM > 30_000) return null;
  if (dbz !== null && (!isFiniteNumber(dbz) || dbz < -35 || dbz > 80)) return null;
  return { elevationDeg, altitudeM, dbz };
}

function parseProfile(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  if (raw.schemaVersion !== 1) return null;
  if (raw.source !== 'Météo-France DPRadar') return null;
  if (raw.license !== 'Licence Ouverte 2.0') return null;
  if (typeof raw.observedAt !== 'string' || !ISO_INSTANT.test(raw.observedAt)) return null;
  if (!isFiniteNumber(raw.distanceKm) || raw.distanceKm < 0 || raw.distanceKm > 200) return null;
  const station = raw.station;
  if (
    station === null || typeof station !== 'object'
    || !Number.isInteger(station.id)
    || typeof station.name !== 'string' || station.name.length === 0 || station.name.length > 40
    || !isFiniteNumber(station.lat) || station.lat < 41 || station.lat > 52
    || !isFiniteNumber(station.lon) || station.lon < -6 || station.lon > 10
  ) return null;
  if (!Array.isArray(raw.levels) || raw.levels.length > MAX_LEVELS) return null;
  const levels = [];
  for (const entry of raw.levels) {
    const level = parseLevel(entry);
    if (level === null) return null;
    if (levels.length > 0 && level.altitudeM < levels[levels.length - 1].altitudeM) return null;
    levels.push(level);
  }
  return {
    schemaVersion: 1,
    source: 'Météo-France DPRadar',
    license: 'Licence Ouverte 2.0',
    station: { id: station.id, name: station.name, lat: station.lat, lon: station.lon },
    distanceKm: raw.distanceKm,
    observedAt: raw.observedAt,
    levels,
  };
}

async function readLimitedJson(response) {
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new Error('body too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('body unavailable');
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('body too large');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function workerOrigin(configuredValue) {
  try {
    const url = new URL(configuredValue);
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHostname(url.hostname))) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  // Non configurée (variable absente/vide) : cas nominal en dev, 200.
  // Configurée mais invalide/dangereuse (URL non sûre) : erreur de config, 503.
  // Miroir de la distinction déjà faite par radar-2d.js.
  const configuredValue = process.env.METEO_FRANCE_RADAR_MANIFEST_URL ?? '';
  if (!configuredValue.trim()) {
    sendJson(res, 200, { configured: false });
    return;
  }
  const origin = workerOrigin(configuredValue);
  if (!origin) {
    sendJson(res, 503, { error: 'Radar column upstream is not safely configured' });
    return;
  }
  const requestUrl = new URL(req.url, 'http://localhost');
  const lat = Number(requestUrl.searchParams.get('lat'));
  const lon = Number(requestUrl.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 41 || lat > 52 || lon < -6 || lon > 10) {
    sendJson(res, 400, { error: 'lat/lon hors métropole' });
    return;
  }
  try {
    const upstream = await fetch(
      `${origin}/volume/column?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`,
      { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (upstream.status === 404) {
      sendJson(res, 404, { error: 'hors_couverture' }, 'public, s-maxage=120');
      return;
    }
    const contentType = (upstream.headers.get('Content-Type') ?? '').toLowerCase();
    if (!upstream.ok || !contentType.includes('application/json')) {
      sendJson(res, 502, { error: 'Invalid radar column response' });
      return;
    }
    const profile = parseProfile(await readLimitedJson(upstream));
    if (!profile) {
      sendJson(res, 502, { error: 'Malformed radar column' });
      return;
    }
    sendJson(res, 200, profile, 'public, s-maxage=120');
  } catch {
    sendJson(res, 502, { error: 'Radar column upstream unavailable' });
  }
}
