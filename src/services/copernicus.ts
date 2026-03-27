/**
 * copernicus.ts — Copernicus / Sentinel satellite imagery service.
 * Fetches Sentinel-2 and Sentinel-1 SAR scene thumbnails via /api/copernicus
 * (proxy to AWS Earth Search STAC v1, no auth required).
 * Builds EO Browser deep-links as fallback.
 */

import type { CopernicusScene, SatelliteCollection } from '../types/index.ts';
import type { LineString, MultiLineString } from 'geojson';

// ─── Constants ───

const PADDING_NEWS_DEG = 0.08;    // ~8 km radius around a news point
const PADDING_FLOOD_DEG = 0.02;   // ~2 km padding around flood segment extent

// ─── Bbox helpers ───

/** Compute a square bbox around a news point [lng, lat]. */
export function computeNewsItemBbox(lat: number, lon: number): [number, number, number, number] {
  return [
    lon - PADDING_NEWS_DEG,
    lat - PADDING_NEWS_DEG,
    lon + PADDING_NEWS_DEG,
    lat + PADDING_NEWS_DEG,
  ];
}

/**
 * Compute bbox from a Vigicrues LineString or MultiLineString geometry.
 * Returns extent of all coordinates + padding.
 */
export function computeFloodSegmentBbox(
  geometry: LineString | MultiLineString,
  paddingDeg = PADDING_FLOOD_DEG,
): [number, number, number, number] {
  const allCoords: [number, number][] = geometry.type === 'LineString'
    ? (geometry.coordinates as [number, number][])
    : (geometry.coordinates as [number, number][][]).flat();

  if (allCoords.length === 0) {
    // Fallback: bounding box over Metropolitan France
    return [-5, 41, 10, 52];
  }

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of allCoords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }

  return [
    minLng - paddingDeg,
    minLat - paddingDeg,
    maxLng + paddingDeg,
    maxLat + paddingDeg,
  ];
}

// ─── EO Browser URL builder ───

function computeZoom(bbox: [number, number, number, number]): number {
  const extent = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  if (extent < 0.2) return 13;
  if (extent < 1) return 11;
  if (extent < 3) return 9;
  return 7;
}

/**
 * Build a Copernicus EO Browser deep-link URL centered on the bbox.
 * When date is omitted, defaults to today (required for S2 toTime param).
 */
export function buildEoBrowserUrl(
  bbox: [number, number, number, number],
  collection: SatelliteCollection,
  date?: Date,
): string {
  const centerLng = ((bbox[0] + bbox[2]) / 2).toFixed(5);
  const centerLat = ((bbox[1] + bbox[3]) / 2).toFixed(5);
  const zoom = computeZoom(bbox);
  const base = 'https://browser.dataspace.copernicus.eu/';

  if (collection === 'sentinel-1-grd') {
    // S1: no toTime needed — EO Browser defaults to latest available
    return `${base}?zoom=${zoom}&lat=${centerLat}&lng=${centerLng}&datasetId=S1GRD`;
  }

  // S2: always include toTime to land on a specific date window
  const d = date ?? new Date();
  const toTime = d.toISOString().split('T')[0] + 'T23:59:59.000Z';
  return `${base}?zoom=${zoom}&lat=${centerLat}&lng=${centerLng}&datasetId=S2L2A&toTime=${encodeURIComponent(toTime)}&cloudCoverage=30`;
}

// ─── STAC fetch ───

interface CopernicusApiResponse {
  scenes: CopernicusScene[];
  eoBrowserUrl: string;
  mode: 'thumbnail' | 'wms';
  fallbackReason?: string;
  wmsUrl?: string;  // present only if COPERNICUS_CLIENT_ID/SECRET are set (Approach C)
}

async function fetchFromApi(
  collection: SatelliteCollection,
  bbox: [number, number, number, number],
  options: { cloudMax?: number; limit?: number } = {},
): Promise<CopernicusScene[]> {
  const params = new URLSearchParams({
    collection,
    bbox: bbox.join(','),
    limit: String(options.limit ?? 5),
  });
  if (collection === 'sentinel-2-l2a' && options.cloudMax != null) {
    params.set('cloud_max', String(options.cloudMax));
  }

  try {
    const resp = await fetch(`/api/copernicus?${params.toString()}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) {
      console.warn(`[copernicus] HTTP ${resp.status}`);
      return [];
    }
    const data = await resp.json() as CopernicusApiResponse;
    return data.scenes ?? [];
  } catch (err) {
    console.warn('[copernicus] Fetch failed:', err);
    return [];
  }
}

/** Fetch Sentinel-2 L2A scenes for the given bbox. Returns [] on error. */
export async function fetchSentinel2Scenes(
  bbox: [number, number, number, number],
  _eventDate?: Date,
): Promise<CopernicusScene[]> {
  return fetchFromApi('sentinel-2-l2a', bbox, { cloudMax: 30, limit: 6 });
}

/** Fetch Sentinel-1 GRD (SAR) scenes for the given bbox. Returns [] on error. */
export async function fetchSentinel1Scenes(
  bbox: [number, number, number, number],
): Promise<CopernicusScene[]> {
  return fetchFromApi('sentinel-1-grd', bbox, { limit: 3 });
}
