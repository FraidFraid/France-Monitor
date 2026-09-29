// src/services/departement-lookup.ts — département d'un point (spec 2026-09-29 § 6) : lieu d'une
// ligne du fil déduit des coordonnées d'un événement, nom d'un code (« 01 » → « Ain »). Même
// géométrie que la carte (/data/departements.geojson : 96 départements métropolitains). Pur, sauf
// loadDepartementIndex.

import { loadDepartementsGeojson } from './departements-geojson.ts';

type Ring = ReadonlyArray<readonly [number, number]>;

interface Shape {
  code: string;
  nom: string;
  /** minLon, minLat, maxLon, maxLat. */
  bbox: [number, number, number, number];
  /** Chaque polygone : anneau extérieur, puis trous. */
  polygons: Ring[][];
}

export interface GeoFeature {
  properties: { code?: unknown; nom?: unknown } | null;
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] }
    | null;
}

export interface DepartementIndex {
  at(lon: number, lat: number): { code: string; nom: string } | null;
  nameOf(code: string): string | null;
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lon: number, lat: number, rings: Ring[]): boolean {
  if (rings.length === 0 || !inRing(lon, lat, rings[0])) return false;
  return !rings.slice(1).some((hole) => inRing(lon, lat, hole));
}

export function buildDepartementIndex(features: readonly GeoFeature[]): DepartementIndex {
  const shapes: Shape[] = [];
  for (const f of features) {
    const code = typeof f.properties?.code === 'string' ? f.properties.code : null;
    const nom = typeof f.properties?.nom === 'string' ? f.properties.nom : null;
    if (!code || !nom || !f.geometry) continue;
    const raw = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const polygons: Ring[][] = raw.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x, y] as const)));
    const bbox: Shape['bbox'] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const poly of polygons) {
      for (const [x, y] of poly[0] ?? []) {
        bbox[0] = Math.min(bbox[0], x);
        bbox[1] = Math.min(bbox[1], y);
        bbox[2] = Math.max(bbox[2], x);
        bbox[3] = Math.max(bbox[3], y);
      }
    }
    shapes.push({ code, nom, bbox, polygons });
  }
  const names = new Map(shapes.map((s) => [s.code, s.nom]));
  return {
    at(lon, lat) {
      for (const s of shapes) {
        const [minLon, minLat, maxLon, maxLat] = s.bbox;
        if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
        if (s.polygons.some((rings) => inPolygon(lon, lat, rings))) return { code: s.code, nom: s.nom };
      }
      return null;
    },
    nameOf(code) {
      return names.get(code) ?? null;
    },
  };
}

export async function loadDepartementIndex(fetchImpl: typeof fetch = fetch): Promise<DepartementIndex | null> {
  try {
    // Géométrie partagée avec la carte : un seul téléchargement de departements.geojson.
    const body = await loadDepartementsGeojson(fetchImpl);
    return body && Array.isArray(body.features) ? buildDepartementIndex(body.features as GeoFeature[]) : null;
  } catch {
    return null;
  }
}
