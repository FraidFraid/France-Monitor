/**
 * Cable Proximity Utility
 *
 * Geospatial utility to detect if an AIS ship is near a submarine cable.
 * Uses Turf.js for distance calculations (consistent with spatial-correlation.ts).
 *
 * Convention: All coordinates are [lng, lat] (NOT [lat, lng])
 */

import { point, pointToLineDistance } from '@turf/turf';
import type { FeatureCollection, LineString } from 'geojson';

/**
 * AIS Ship representation for proximity calculations.
 * Compatible with MilitaryShip interface from military-ships.ts
 */
export interface AISShip {
  id: string;
  name: string;
  lat: number;
  lon: number;
  speed: number;      // knots
  isMilitary?: boolean;
}

/**
 * Result of a proximity check against submarine cables
 */
export interface CableProximityResult {
  ship: AISShip;
  nearestCable: {
    id: string;
    name: string;
    distanceMeters: number;
  } | null;
  isNear: boolean;
}

/**
 * Cable properties from submarine-cables.json
 */
interface CableProperties {
  id: string;
  name: string;
  landing_points?: string[];
  length_km?: number;
  rfs_year?: number;
  owner?: string;
  capacity_tbps?: number;
}

/**
 * Check if a ship is within a specified distance of any submarine cable.
 *
 * @param ship - AIS ship with position (lat/lon in degrees)
 * @param cables - GeoJSON FeatureCollection of LineString cables
 * @param maxDistanceMeters - Maximum distance threshold in meters (default: 5000m = 5km)
 * @returns true if ship is within maxDistanceMeters of any cable
 *
 * @example
 * const cables = await fetch('/data/submarine-cables.json').then(r => r.json());
 * const ship = { id: '1', name: 'Vessel', lat: 43.3, lon: 5.4, speed: 10 };
 * const isNear = isNearCable(ship, cables, 5000); // 5km threshold
 */
export function isNearCable(
  ship: AISShip,
  cables: FeatureCollection<LineString>,
  maxDistanceMeters: number = 5000
): boolean {
  // Ship position as Turf point [lng, lat]
  const shipPoint = point([ship.lon, ship.lat]);

  for (const feature of cables.features) {
    if (feature.geometry?.type !== 'LineString') continue;

    // Distance in kilometers (Turf default)
    const distanceKm = pointToLineDistance(shipPoint, feature, { units: 'kilometers' });
    const distanceMeters = distanceKm * 1000;

    if (distanceMeters <= maxDistanceMeters) {
      return true;
    }
  }

  return false;
}

/**
 * Get detailed proximity information for a ship against all cables.
 * Returns the nearest cable and distance.
 *
 * @param ship - AIS ship with position
 * @param cables - GeoJSON FeatureCollection of LineString cables
 * @param maxDistanceMeters - Maximum distance threshold in meters
 * @returns Detailed result with nearest cable info
 *
 * @example
 * const result = getCableProximity(ship, cables, 10000);
 * if (result.isNear) {
 *   console.log(`${ship.name} is ${result.nearestCable.distanceMeters}m from ${result.nearestCable.name}`);
 * }
 */
export function getCableProximity(
  ship: AISShip,
  cables: FeatureCollection<LineString>,
  maxDistanceMeters: number = 5000
): CableProximityResult {
  const shipPoint = point([ship.lon, ship.lat]);

  let nearestCable: CableProximityResult['nearestCable'] = null;
  let minDistance = Infinity;

  for (const feature of cables.features) {
    if (feature.geometry?.type !== 'LineString') continue;

    const distanceKm = pointToLineDistance(shipPoint, feature, { units: 'kilometers' });
    const distanceMeters = distanceKm * 1000;

    if (distanceMeters < minDistance) {
      minDistance = distanceMeters;
      const props = feature.properties as CableProperties | null;
      nearestCable = {
        id: props?.id ?? feature.id?.toString() ?? 'unknown',
        name: props?.name ?? 'Unknown Cable',
        distanceMeters: Math.round(distanceMeters)
      };
    }
  }

  return {
    ship,
    nearestCable,
    isNear: minDistance <= maxDistanceMeters
  };
}

/**
 * Check multiple ships against cables in batch.
 * More efficient than calling isNearCable() repeatedly.
 *
 * @param ships - Array of AIS ships
 * @param cables - GeoJSON FeatureCollection of LineString cables
 * @param maxDistanceMeters - Maximum distance threshold in meters
 * @returns Array of ships that are near cables, with proximity details
 *
 * @example
 * const nearbyShips = findShipsNearCables(allShips, cables, 5000);
 * nearbyShips.forEach(r => {
 *   console.log(`⚠️ ${r.ship.name} near ${r.nearestCable.name}`);
 * });
 */
export function findShipsNearCables(
  ships: AISShip[],
  cables: FeatureCollection<LineString>,
  maxDistanceMeters: number = 5000
): CableProximityResult[] {
  return ships
    .map(ship => getCableProximity(ship, cables, maxDistanceMeters))
    .filter(result => result.isNear);
}

/**
 * Format distance for display (consistent with spatial-correlation.ts)
 *
 * @param meters - Distance in meters
 * @returns Formatted string like "500m" or "2.5km"
 */
export function formatProximityDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}
