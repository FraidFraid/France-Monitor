/**
 * api/transport/disruptions.js — Vercel serverless proxy for SNCF disruptions.
 * Mirrors src/plugins/sncf-proxy.ts for production deployment.
 * Route: GET /api/transport/disruptions
 */

const SNCF_API_BASE = 'https://api.sncf.com/v1';
const CACHE_TTL_MS = 5 * 60_000; // 5 min
const SNCF_PAGE_SIZE = 1000;
const SNCF_MAX_PAGES = 10;
const SNCF_ACTIVE_MAX_PAGES = 2;
const SNCF_CANCEL_TRIP_ENRICH_LIMIT = 120;
const SNCF_TRIP_CACHE_TTL_MS = 5 * 60_000;
const SNCF_TRIP_ENRICH_CONCURRENCY = 4;

const _cacheByMode = new Map();
const _tripStopTimesCache = new Map();

async function fetchTripStopTimes(authHeader, tripId, cause) {
  const cached = _tripStopTimesCache.get(tripId);
  if (cached && Date.now() - cached.at < SNCF_TRIP_CACHE_TTL_MS) {
    return cached.stops;
  }

  const url = `${SNCF_API_BASE}/coverage/sncf/trips/${encodeURIComponent(tripId)}/vehicle_journeys?depth=3`;
  const upstream = await fetch(url, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!upstream.ok) return [];

  const payload = await upstream.json();
  const stopTimes = payload.vehicle_journeys?.[0]?.stop_times ?? [];
  const stops = stopTimes
    .filter((stopTime) => stopTime.stop_point)
    .map((stopTime) => ({
      stop_point: stopTime.stop_point,
      base_arrival_time: stopTime.arrival_time,
      base_departure_time: stopTime.departure_time,
      amended_arrival_time: stopTime.arrival_time,
      amended_departure_time: stopTime.departure_time,
      cause,
      stop_time_effect: 'deleted',
      departure_status: 'deleted',
      arrival_status: 'deleted',
      is_detour: false,
    }));

  _tripStopTimesCache.set(tripId, { at: Date.now(), stops });
  return stops;
}

async function enrichNoServiceTrips(payload, authHeader) {
  const candidates = (payload.disruptions ?? [])
    .filter((disruption) => disruption.severity?.effect === 'NO_SERVICE')
    .flatMap((disruption) => (disruption.impacted_objects ?? [])
      .filter((obj) => obj.pt_object?.embedded_type === 'trip' && (obj.impacted_stops?.length ?? 0) === 0)
      .map((obj) => ({ disruption, obj, tripId: obj.pt_object?.id ?? obj.pt_object?.trip?.id })))
    .filter((entry) => entry.tripId)
    .slice(0, SNCF_CANCEL_TRIP_ENRICH_LIMIT);

  let cursor = 0;
  const workers = Array.from({ length: Math.min(SNCF_TRIP_ENRICH_CONCURRENCY, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor];
      cursor += 1;
      const cause = candidate.disruption.messages?.[0]?.text ?? 'Train supprimé';
      try {
        const stops = await fetchTripStopTimes(authHeader, candidate.tripId, cause);
        if (stops.length > 0) {
          candidate.obj.impacted_stops = stops;
        }
      } catch (err) {
        console.warn('[sncf-disruptions] trip stop enrichment failed:', candidate.tripId, err);
      }
    }
  });

  await Promise.all(workers);
}

async function fetchAllSncfDisruptions(authHeader) {
  const allDisruptions = [];
  let firstPayload = null;
  let totalResult = Infinity;

  for (let page = 0; page < SNCF_MAX_PAGES && allDisruptions.length < totalResult; page += 1) {
    const params = new URLSearchParams({
      count: String(SNCF_PAGE_SIZE),
      depth: '2',
      start_page: String(page),
    });
    const url = `${SNCF_API_BASE}/coverage/sncf/disruptions?${params.toString()}`;
    const upstream = await fetch(url, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error('[sncf-disruptions] upstream error:', upstream.status, body);
      throw new Error(`SNCF API error ${upstream.status}`);
    }

    const payload = await upstream.json();
    if (!firstPayload) firstPayload = payload;
    allDisruptions.push(...(payload.disruptions ?? []));
    totalResult = payload.pagination?.total_result ?? allDisruptions.length;

    if ((payload.pagination?.items_on_page ?? 0) === 0) break;
  }

  const result = {
    ...firstPayload,
    disruptions: allDisruptions,
    pagination: {
      ...(firstPayload?.pagination ?? {}),
      total_result: Number.isFinite(totalResult) ? totalResult : allDisruptions.length,
      items_per_page: SNCF_PAGE_SIZE,
      items_on_page: allDisruptions.length,
      start_page: 0,
    },
  };
  await enrichNoServiceTrips(result, authHeader);
  return result;
}

function franceStartOfTodaySncf() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}${month}${day}T000000`;
}

function franceEndOfTodaySncf() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}${month}${day}T235959`;
}

async function fetchRecentSncfDisruptions(authHeader) {
  const allDisruptions = [];
  let firstPayload = null;
  let totalResult = Infinity;

  for (let page = 0; page < SNCF_ACTIVE_MAX_PAGES && allDisruptions.length < totalResult; page += 1) {
    const params = new URLSearchParams({
      count: String(SNCF_PAGE_SIZE),
      depth: '2',
      start_page: String(page),
      since: franceStartOfTodaySncf(),
      until: franceEndOfTodaySncf(),
    });
    const url = `${SNCF_API_BASE}/coverage/sncf/disruptions?${params.toString()}`;
    const upstream = await fetch(url, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error('[sncf-disruptions] upstream error:', upstream.status, body);
      throw new Error(`SNCF API error ${upstream.status}`);
    }

    const payload = await upstream.json();
    if (!firstPayload) firstPayload = payload;
    allDisruptions.push(...(payload.disruptions ?? []));
    totalResult = payload.pagination?.total_result ?? allDisruptions.length;

    if ((payload.pagination?.items_on_page ?? 0) === 0) break;
  }

  const result = {
    ...firstPayload,
    disruptions: allDisruptions,
    pagination: {
      ...(firstPayload?.pagination ?? {}),
      total_result: Number.isFinite(totalResult) ? totalResult : allDisruptions.length,
      items_per_page: SNCF_PAGE_SIZE,
      items_on_page: allDisruptions.length,
      start_page: 0,
    },
  };
  await enrichNoServiceTrips(result, authHeader);
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const mode = req.query?.mode === 'all' ? 'all' : 'active';

  // In-process cache — reused across warm lambda invocations
  const cached = _cacheByMode.get(mode);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(cached.data);
    return;
  }

  const apiKey = process.env.SNCF_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: 'SNCF_API_KEY not configured' } });
    return;
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');
    const data = mode === 'all'
      ? await fetchAllSncfDisruptions(authHeader)
      : await fetchRecentSncfDisruptions(authHeader);
    _cacheByMode.set(mode, { data, at: Date.now() });

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(data);
  } catch (err) {
    console.error('[sncf-disruptions] fetch failed:', err);
    res.status(502).json({ error: { message: 'SNCF API fetch failed' } });
  }
}
