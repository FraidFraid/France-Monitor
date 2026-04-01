import { distance, lineString, nearestPointOnLine, point } from '@turf/turf';
import type { Feature, LineString } from 'geojson';

type Coordinate = [number, number];

export interface OsmRailwayProperties {
  id?: number | string;
  name?: string;
  railway?: string;
  service?: string;
  usage?: string;
}

export type OsmRailwayFeature = Feature<LineString, OsmRailwayProperties>;

export interface OsmRailSegmentEdge {
  fromNodeKey: string;
  toNodeKey: string;
  coordinates: Coordinate[];
  weightKm: number;
  wayId: string | number;
}

export interface OsmRailDirectedEdge {
  edge: OsmRailSegmentEdge;
  fromNodeKey: string;
  toNodeKey: string;
  reversed: boolean;
}

export interface OsmRailGraphNode {
  key: string;
  coord: Coordinate;
}

export interface OsmRailProjectedNode {
  node: OsmRailGraphNode;
  distanceKm: number;
  wayId: string | number;
}

export interface OsmRailGraph {
  adjacency: Map<string, OsmRailDirectedEdge[]>;
  nodeCoords: Map<string, Coordinate>;
}

function nodeKey(coord: Coordinate): string {
  const roundedLng = Math.round(coord[0] * 1e6) / 1e6;
  const roundedLat = Math.round(coord[1] * 1e6) / 1e6;
  return `${roundedLng},${roundedLat}`;
}

function segmentLengthKm(a: Coordinate, b: Coordinate): number {
  return distance(point(a), point(b), { units: 'kilometers' });
}

export function buildOsmRailGraph(features: OsmRailwayFeature[]): OsmRailGraph {
  const adjacency = new Map<string, OsmRailDirectedEdge[]>();
  const nodeCoords = new Map<string, Coordinate>();

  for (const feature of features) {
    const coords = feature.geometry.coordinates as Coordinate[];
    if (coords.length < 2) continue;
    const wayId = feature.id ?? feature.properties?.id ?? crypto.randomUUID();

    for (let index = 1; index < coords.length; index += 1) {
      const startCoord = coords[index - 1];
      const endCoord = coords[index];
      const startKey = nodeKey(startCoord);
      const endKey = nodeKey(endCoord);
      if (startKey === endKey) continue;

      nodeCoords.set(startKey, startCoord);
      nodeCoords.set(endKey, endCoord);

      const edge: OsmRailSegmentEdge = {
        fromNodeKey: startKey,
        toNodeKey: endKey,
        coordinates: [startCoord, endCoord],
        weightKm: segmentLengthKm(startCoord, endCoord),
        wayId,
      };

      const forward: OsmRailDirectedEdge = { edge, fromNodeKey: startKey, toNodeKey: endKey, reversed: false };
      const backward: OsmRailDirectedEdge = { edge, fromNodeKey: endKey, toNodeKey: startKey, reversed: true };

      adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), forward]);
      adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), backward]);
    }
  }

  return { adjacency, nodeCoords };
}

export function projectToNearestRailNode(
  target: Coordinate,
  features: OsmRailwayFeature[],
): OsmRailProjectedNode | null {
  let best: OsmRailProjectedNode | null = null;
  let bestDistance = Infinity;

  for (const feature of features) {
    const coords = feature.geometry.coordinates as Coordinate[];
    if (coords.length < 2) continue;

    const snapped = nearestPointOnLine(lineString(coords), point(target), { units: 'kilometers' });
    const snapDistanceKm = distance(point(target), point(snapped.geometry.coordinates as Coordinate), { units: 'kilometers' });
    if (snapDistanceKm > bestDistance) continue;

    const location = Number(snapped.properties?.index ?? 0);
    const lowerIndex = Math.max(0, Math.min(coords.length - 2, location));
    const startCoord = coords[lowerIndex];
    const endCoord = coords[lowerIndex + 1];
    const startGap = distance(point(target), point(startCoord), { units: 'kilometers' });
    const endGap = distance(point(target), point(endCoord), { units: 'kilometers' });
    const chosenCoord = endGap < startGap ? endCoord : startCoord;

    bestDistance = snapDistanceKm;
    best = {
      node: { key: nodeKey(chosenCoord), coord: chosenCoord },
      distanceKm: snapDistanceKm,
      wayId: feature.id ?? feature.properties?.id ?? 'unknown',
    };
  }

  return best;
}

export function dijkstraRailPath(
  graph: OsmRailGraph,
  startKey: string,
  endKey: string,
): OsmRailDirectedEdge[] | null {
  if (startKey === endKey) return [];

  const queue = new Set<string>([startKey]);
  const distances = new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, OsmRailDirectedEdge>();

  while (queue.size > 0) {
    let currentKey: string | null = null;
    let currentDist = Infinity;

    for (const key of queue) {
      const dist = distances.get(key) ?? Infinity;
      if (dist < currentDist) {
        currentDist = dist;
        currentKey = key;
      }
    }

    if (currentKey == null) break;
    if (currentKey === endKey) break;

    queue.delete(currentKey);

    for (const directedEdge of graph.adjacency.get(currentKey) ?? []) {
      const candidate = currentDist + directedEdge.edge.weightKm;
      const existing = distances.get(directedEdge.toNodeKey) ?? Infinity;
      if (candidate < existing) {
        distances.set(directedEdge.toNodeKey, candidate);
        previous.set(directedEdge.toNodeKey, directedEdge);
        queue.add(directedEdge.toNodeKey);
      }
    }
  }

  if (!previous.has(endKey)) return null;

  const path: OsmRailDirectedEdge[] = [];
  let cursor = endKey;
  while (cursor !== startKey) {
    const edge = previous.get(cursor);
    if (!edge) return null;
    path.push(edge);
    cursor = edge.fromNodeKey;
  }

  path.reverse();
  return path;
}

export function reconstructRailLineString(path: OsmRailDirectedEdge[]): Coordinate[] {
  if (path.length === 0) return [];

  const result: Coordinate[] = [];
  for (const directedEdge of path) {
    const coords = directedEdge.reversed
      ? [...directedEdge.edge.coordinates].reverse() as Coordinate[]
      : directedEdge.edge.coordinates as Coordinate[];

    if (result.length === 0) {
      result.push(...coords);
      continue;
    }

    const [lastLng, lastLat] = result[result.length - 1];
    const [nextLng, nextLat] = coords[0];
    if (lastLng === nextLng && lastLat === nextLat) {
      result.push(...coords.slice(1));
    } else {
      result.push(...coords);
    }
  }

  return result.length >= 2 ? result : [];
}

export function railPathLengthKm(path: OsmRailDirectedEdge[]): number {
  return path.reduce((sum, edge) => sum + edge.edge.weightKm, 0);
}
