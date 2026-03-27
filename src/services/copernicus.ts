/**
 * copernicus.ts — Copernicus / Sentinel URL builders and AOI bbox helpers.
 * Builds EO Browser deep-links for flood segments and news items.
 * STAC / scene fetching removed — satellite analysis is delegated to EO Browser.
 */

import type { SatelliteCollection } from '../types/index.ts';
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

function formatBrowserDayBounds(date: Date): { fromTime: string; toTime: string } {
  const day = date.toISOString().split('T')[0];
  return {
    fromTime: `${day}T00:00:00.000Z`,
    toTime: `${day}T23:59:59.999Z`,
  };
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
  const d = date ?? new Date();
  const { fromTime, toTime } = formatBrowserDayBounds(d);

  if (collection === 'sentinel-1-grd') {
    // Copernicus Browser rejects the old S1GRD datasetId used in the MVP.
    // Keep the fallback usable by opening Browser centered on the AOI without
    // forcing an invalid dataset selection.
    return `${base}?zoom=${zoom}&lat=${centerLat}&lng=${centerLng}&themeId=DEFAULT-THEME&fromTime=${encodeURIComponent(fromTime)}&toTime=${encodeURIComponent(toTime)}`;
  }

  // S2: use the current Copernicus Browser dataset id.
  return `${base}?zoom=${zoom}&lat=${centerLat}&lng=${centerLng}&themeId=DEFAULT-THEME&datasetId=S2_L2A_CDAS&fromTime=${encodeURIComponent(fromTime)}&toTime=${encodeURIComponent(toTime)}&layerId=1_TRUE_COLOR&cloudCoverage=30&dateMode=SINGLE`;
}

