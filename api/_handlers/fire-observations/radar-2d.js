const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;
const ISO_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

function sendJson(res, status, payload, cacheControl = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.end(JSON.stringify(payload));
}

function isIsoInstant(value) {
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, fraction = ''] = match;
  const instant = new Date(0);
  instant.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  instant.setUTCHours(Number(hour), Number(minute), Number(second), Number(fraction.padEnd(3, '0')));
  return instant.getUTCFullYear() === Number(year)
    && instant.getUTCMonth() === Number(month) - 1
    && instant.getUTCDate() === Number(day)
    && instant.getUTCHours() === Number(hour)
    && instant.getUTCMinutes() === Number(minute)
    && instant.getUTCSeconds() === Number(second)
    && instant.getUTCMilliseconds() === Number(fraction.padEnd(3, '0'));
}

function isLocalHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function validateUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHostname(url.hostname))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseManifest(value) {
  if (!value || typeof value !== 'object') return null;
  if (
    value.schemaVersion !== 1
    || value.source !== 'Météo-France DPRadar'
    || value.resolutionMeters !== 1000
    || value.license !== 'Licence Ouverte 2.0'
    || typeof value.observedAt !== 'string'
    || !isIsoInstant(value.observedAt)
    || typeof value.generatedAt !== 'string'
    || !isIsoInstant(value.generatedAt)
    || typeof value.imageUrl !== 'string'
    || !validateUrl(value.imageUrl)
    || !Array.isArray(value.bounds)
    || value.bounds.length !== 4
    || value.bounds.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))
  ) return null;
  const [west, south, east, north] = value.bounds;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null;
  const echoTopImageUrl =
    typeof value.echoTopImageUrl === 'string' && validateUrl(value.echoTopImageUrl)
      ? value.echoTopImageUrl
      : undefined;
  return {
    schemaVersion: 1,
    source: 'Météo-France DPRadar',
    observedAt: value.observedAt,
    generatedAt: value.generatedAt,
    bounds: [west, south, east, north],
    imageUrl: value.imageUrl,
    resolutionMeters: 1000,
    license: 'Licence Ouverte 2.0',
    ...(echoTopImageUrl !== undefined ? { echoTopImageUrl } : {}),
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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const configuredValue = process.env.METEO_FRANCE_RADAR_MANIFEST_URL ?? '';
  if (!configuredValue.trim()) {
    sendJson(res, 200, { configured: false });
    return;
  }
  const manifestUrl = validateUrl(configuredValue);
  if (!manifestUrl) {
    sendJson(res, 503, { error: 'Radar manifest URL is not safely configured' });
    return;
  }
  try {
    const upstream = await fetch(manifestUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const contentType = (upstream.headers.get('Content-Type') ?? '').toLowerCase();
    if (!upstream.ok || !contentType.includes('application/json')) {
      sendJson(res, 502, { error: 'Invalid radar manifest response' });
      return;
    }
    const manifest = parseManifest(await readLimitedJson(upstream));
    if (!manifest) {
      sendJson(res, 502, { error: 'Malformed radar manifest' });
      return;
    }
    sendJson(res, 200, manifest, 'public, s-maxage=120');
  } catch {
    sendJson(res, 502, { error: 'Radar manifest upstream unavailable' });
  }
}
