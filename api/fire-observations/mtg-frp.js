const UPSTREAM_URL = 'https://adaguc.lsasvcs.ipma.pt/adagucserver';
const FETCH_TIMEOUT_MS = 10_000;
const WEB_MERCATOR_LIMIT = 20_037_508.342789244;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function sendJson(res, status, payload, cacheControl = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.end(JSON.stringify(payload));
}

function isIsoInstant(value) {
  return ISO_INSTANT_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function parseCapabilities(xml) {
  const frpLayer = xml.match(
    /<Layer\b[^>]*>(?:(?!<Layer\b)[\s\S])*?<Name\b[^>]*>\s*FRP\s*<\/Name>(?:(?!<Layer\b)[\s\S])*?<\/Layer>/i,
  )?.[0];
  if (!frpLayer) {
    throw new Error('FRP layer missing');
  }
  for (const match of frpLayer.matchAll(/<Dimension\b([^>]*)>/gi)) {
    const attributes = match[1] ?? '';
    const name = attributes.match(/\bname\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
    if (name?.toLowerCase() !== 'time') continue;
    const observedAt = attributes.match(/\bdefault\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
    if (observedAt && isIsoInstant(observedAt)) return observedAt;
  }
  throw new Error('Default ISO time missing');
}

function parseDimension(value, name) {
  if (value === null || !/^\d+$/.test(value)) throw new Error(`${name} must be an integer between 1 and 1024`);
  const parsed = Number(value);
  if (parsed < 1 || parsed > 1024) throw new Error(`${name} must be an integer between 1 and 1024`);
  return parsed;
}

function validateMapRequest(url) {
  const bbox = url.searchParams.get('bbox');
  if (!bbox) throw new Error('bbox is required');
  const parts = bbox.split(',');
  if (parts.length !== 4 || parts.some((part) => part.trim() === '')) {
    throw new Error('bbox must contain four EPSG:3857 coordinates');
  }
  const coordinates = parts.map(Number);
  if (coordinates.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error('bbox must contain finite EPSG:3857 coordinates');
  }
  if (coordinates.some((coordinate) => Math.abs(coordinate) > WEB_MERCATOR_LIMIT)) {
    throw new Error('bbox is outside EPSG:3857 bounds');
  }
  const [minX, minY, maxX, maxY] = coordinates;
  if (minX >= maxX || minY >= maxY) throw new Error('bbox minimums must be lower than maximums');

  const width = parseDimension(url.searchParams.get('width'), 'width');
  const height = parseDimension(url.searchParams.get('height'), 'height');
  const time = url.searchParams.get('time')?.trim();
  if (time && !isIsoInstant(time)) throw new Error('time must be an ISO UTC instant');
  return { bbox: coordinates.join(','), width, height, time };
}

function buildUpstreamUrl(params) {
  const url = new URL(UPSTREAM_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

function isXmlException(body) {
  if (body.byteLength === 0) return false;
  const prefix = new TextDecoder().decode(body.subarray(0, 4096)).trimStart();
  return /^<\?xml\b/i.test(prefix) || /^<(?:\w+:)?(?:ServiceExceptionReport|ExceptionReport)\b/i.test(prefix);
}

async function fetchUpstream(url, accept) {
  return fetch(url, {
    headers: { Accept: accept },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function handleMetadata(res) {
  const upstream = await fetchUpstream(buildUpstreamUrl({
    SERVICE: 'WMS',
    REQUEST: 'GetCapabilities',
    VERSION: '1.3.0',
    DATASET: 'MTG-FRP',
  }), 'application/xml,text/xml');
  const contentType = (upstream.headers.get('Content-Type') ?? '').toLowerCase();
  if (!upstream.ok || (!contentType.includes('/xml') && !contentType.includes('+xml'))) {
    sendJson(res, 502, { error: 'Invalid MTG-FRP capabilities response' });
    return;
  }
  const xml = await upstream.text();
  if (/<(?:\w+:)?(?:ServiceExceptionReport|ExceptionReport)\b/i.test(xml)) {
    sendJson(res, 502, { error: 'MTG-FRP capabilities exception' });
    return;
  }
  const observedAt = parseCapabilities(xml);
  sendJson(res, 200, {
    observedAt,
    fetchedAt: Date.now(),
    cadenceMinutes: 10,
    attribution: 'EUMETSAT LSA SAF · CC BY 4.0',
    demonstration: true,
  }, 'public, s-maxage=120');
}

async function handleMap(url, res) {
  let request;
  try {
    request = validateMapRequest(url);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid map request' });
    return;
  }

  const upstream = await fetchUpstream(buildUpstreamUrl({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    DATASET: 'MTG-FRP',
    LAYERS: 'FRP',
    STYLES: 'pointdata/point',
    FORMAT: 'image/png',
    EXCEPTIONS: 'XML',
    TRANSPARENT: 'TRUE',
    CRS: 'EPSG:3857',
    BBOX: request.bbox,
    WIDTH: String(request.width),
    HEIGHT: String(request.height),
    TIME: request.time,
  }), 'image/png');
  const body = new Uint8Array(await upstream.arrayBuffer());
  const contentType = (upstream.headers.get('Content-Type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (!upstream.ok || contentType !== 'image/png' || isXmlException(body)) {
    sendJson(res, 502, { error: 'Invalid MTG-FRP map response' });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
  res.end(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers?.host ?? 'localhost'}`);
  try {
    const operation = url.searchParams.get('operation');
    if (operation === 'metadata') {
      await handleMetadata(res);
      return;
    }
    if (operation === 'map') {
      await handleMap(url, res);
      return;
    }
    sendJson(res, 400, { error: 'operation must be metadata or map' });
  } catch {
    sendJson(res, 502, { error: 'MTG-FRP upstream unavailable' });
  }
}
