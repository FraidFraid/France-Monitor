// Extracted from DeckGLMap.ts — pure geometry helpers.

export function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

export function getFeatureCenter(feature: GeoJSON.Feature): [number, number] | null {
  const geom = feature.geometry;
  if (!geom) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const push = (coord: number[]) => {
    if (coord.length < 2) return;
    const lng = coord[0];
    const lat = coord[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  };
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === 'number') {
      push(node as number[]);
      return;
    }
    for (const child of node) walk(child);
  };
  walk((geom as { coordinates?: unknown }).coordinates);
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
    return null;
  }
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

/**
 * Generate a curved arc between two points using a quadratic bezier.
 * The curve bows perpendicular to the line connecting the points.
 * @param from Starting coordinates [lng, lat]
 * @param to Ending coordinates [lng, lat]
 * @param curvature How much the curve bows (0.2-0.4 recommended)
 * @param steps Number of points to generate
 */
export function generateArc(
  from: [number, number],
  to: [number, number],
  curvature = 0.3,
  steps = 40
): [number, number][] {
  const [x1, y1] = from;
  const [x2, y2] = to;

  // Midpoint
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // Perpendicular direction (rotated 90 degrees)
  const dx = x2 - x1;
  const dy = y2 - y1;

  // Control point offset perpendicular to the line
  const offsetX = -dy * curvature;
  const offsetY = dx * curvature;

  // Control point for quadratic bezier
  const cx = mx + offsetX;
  const cy = my + offsetY;

  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    // Quadratic bezier formula
    const x = u * u * x1 + 2 * u * t * cx + t * t * x2;
    const y = u * u * y1 + 2 * u * t * cy + t * t * y2;
    points.push([x, y]);
  }
  return points;
}

export function computeBearingDegrees(from: [number, number], to: [number, number]): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}
