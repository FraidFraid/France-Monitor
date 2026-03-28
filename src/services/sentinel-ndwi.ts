import type { LineString, MultiLineString, Polygon } from 'geojson';
import type { SentinelNdwiDateInput, SentinelNdwiRequest, SentinelNdwiResponse } from '../types/index.ts';

function normalizeDateInput(date: SentinelNdwiDateInput): SentinelNdwiDateInput {
  if (typeof date === 'string') {
    return date;
  }
  return {
    from: date.from,
    to: date.to,
  };
}

export function bboxToPolygon(bbox: [number, number, number, number]): Polygon {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return {
    type: 'Polygon',
    coordinates: [[
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ]],
  };
}

export function geometryToBufferedPolygon(
  geometry: LineString | MultiLineString,
  paddingDeg = 0.004,
): Polygon {
  const allCoords: [number, number][] = geometry.type === 'LineString'
    ? (geometry.coordinates as [number, number][])
    : (geometry.coordinates as [number, number][][]).flat();

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of allCoords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }

  return bboxToPolygon([
    minLng - paddingDeg,
    minLat - paddingDeg,
    maxLng + paddingDeg,
    maxLat + paddingDeg,
  ]);
}

export async function fetchSentinelNdwi(
  aoi: Polygon,
  date: SentinelNdwiDateInput,
  maxCloudCoverage = 30,
): Promise<SentinelNdwiResponse> {
  const payload: SentinelNdwiRequest = {
    aoi,
    date: normalizeDateInput(date),
    maxCloudCoverage,
  };

  const response = await fetch('/api/sentinel-ndwi', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000),
  });

  const data = await response.json() as SentinelNdwiResponse & { error?: string };

  if (!response.ok) {
    throw new Error(data.error ?? `Sentinel NDWI HTTP ${response.status}`);
  }

  return data;
}
