import { distance, lineString, nearestPointOnLine, point, pointToLineDistance } from '@turf/turf';
import type {
  FloodDataSource,
  FloodGeometryFidelity,
  FloodSegment,
  FloodVigilanceLevel,
} from '../types/index.ts';
import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';

type FloodGeometry = LineString | MultiLineString;
type Coordinate = [number, number];

interface PrepareFloodSegmentInput {
  id: string;
  name: string;
  level: FloodVigilanceLevel;
  geometry: FloodGeometry;
  dataSource: FloodDataSource;
  displayGeometry?: FloodGeometry;
  geometryFidelity?: FloodGeometryFidelity;
  matchConfidence?: number;
}

export interface FloodGeometryResolution {
  displayGeometry: FloodGeometry;
  geometryFidelity: FloodGeometryFidelity;
  matchConfidence: number;
}

interface TopageProperties {
  gid?: number;
  CdOH?: string;
  CdCoursEau_1?: string;
  CdCoursEau_2?: string;
  CdCoursEau_3?: string;
  TopoOH?: string;
  NatureTH?: string;
  TronconFictifTH?: number;
  PersistanceTH?: string;
  BrasTH?: string;
  ReseauPrincipalCoulantTH?: number;
  CdNoeudDebut?: string;
  CdNoeudFin?: string;
}

type TopageFeature = Feature<LineString, TopageProperties>;

interface GraphEdge {
  startNode: string;
  endNode: string;
  featureId: string;
  coordinates: Coordinate[];
  weightKm: number;
}

interface DirectedEdge {
  edge: GraphEdge;
  fromNode: string;
  toNode: string;
  reversed: boolean;
}

const TOPAGE_PROXY_URL = '/api/environment/topage-hydro';
const HYDRO_BBOX_PADDING_DEG = 0.12;
const MAX_FEATURES_PER_QUERY = 600;
const FETCH_TIMEOUT_MS = 20_000;
const hydroCache = new Map<string, Promise<TopageFeature[]>>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function flattenCoordinates(geometry: FloodGeometry): Coordinate[] {
  return geometry.type === 'LineString'
    ? geometry.coordinates as Coordinate[]
    : (geometry.coordinates as Coordinate[][]).flat();
}

function bboxKey(bbox: [number, number, number, number]): string {
  return bbox.map((value) => value.toFixed(4)).join(',');
}

function computeGeometryBBox(geometry: FloodGeometry): [number, number, number, number] {
  const coords = flattenCoordinates(geometry);

  if (coords.length === 0) {
    return [-5, 41, 10, 52];
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }

  return [minLng, minLat, maxLng, maxLat];
}

function expandBBox(
  bbox: [number, number, number, number],
  paddingDeg = HYDRO_BBOX_PADDING_DEG,
): [number, number, number, number] {
  return [
    bbox[0] - paddingDeg,
    bbox[1] - paddingDeg,
    bbox[2] + paddingDeg,
    bbox[3] + paddingDeg,
  ];
}

function getGeometryEndpoints(geometry: FloodGeometry): { start: Coordinate; end: Coordinate } | null {
  const coords = flattenCoordinates(geometry);
  if (coords.length < 2) return null;

  return {
    start: coords[0],
    end: coords[coords.length - 1],
  };
}

function countVertices(coordinates: Coordinate[]): number {
  return coordinates.length;
}

function isUsableTopageFeature(feature: TopageFeature): boolean {
  const props = feature.properties ?? {};
  if (!feature.geometry || feature.geometry.type !== 'LineString') return false;
  if ((feature.geometry.coordinates?.length ?? 0) < 2) return false;
  if (props.TronconFictifTH === 1) return false;
  if (props.CdNoeudDebut == null || props.CdNoeudFin == null) return false;
  return true;
}

function computeTopageFeatureScore(feature: TopageFeature): number {
  const props = feature.properties ?? {};
  let score = 0;

  if ((props.TopoOH ?? '').trim().length > 0) score += 1;
  if ((props.NatureTH ?? '').toLowerCase().includes('naturel')) score += 1;
  if ((props.PersistanceTH ?? '').toLowerCase() === 'permanent') score += 1;
  if ((props.BrasTH ?? '').toLowerCase() === 'principal') score += 1;
  if ((props.ReseauPrincipalCoulantTH ?? 0) === 1) score += 1;

  return score;
}

function featureLengthKm(feature: TopageFeature): number {
  const coords = feature.geometry.coordinates as Coordinate[];
  let total = 0;

  for (let index = 1; index < coords.length; index += 1) {
    total += distance(point(coords[index - 1]), point(coords[index]), { units: 'kilometers' });
  }

  return total;
}

function getFeatureId(feature: TopageFeature): string {
  return String(feature.properties?.CdOH ?? feature.id ?? crypto.randomUUID());
}

async function fetchTopageFeaturesForBBox(
  bbox: [number, number, number, number],
): Promise<TopageFeature[]> {
  const key = bboxKey(bbox);
  const cached = hydroCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const params = new URLSearchParams({
      bbox: `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]},EPSG:4326`,
      count: String(MAX_FEATURES_PER_QUERY),
    });

    const response = await fetch(`${TOPAGE_PROXY_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const geojson = await response.json() as FeatureCollection<LineString, TopageProperties>;
    return geojson.features.filter((feature): feature is TopageFeature => isUsableTopageFeature(feature));
  })();

  hydroCache.set(key, pending);

  try {
    return await pending;
  } catch (error) {
    hydroCache.delete(key);
    throw error;
  }
}

function minRawPointDistanceKm(rawCoords: Coordinate[], feature: TopageFeature): number {
  let minDistance = Infinity;

  for (const coord of rawCoords) {
    const distKm = pointToLineDistance(point(coord), feature, { units: 'kilometers' });
    if (distKm < minDistance) minDistance = distKm;
  }

  return minDistance;
}

function selectCandidateFeatures(rawGeometry: FloodGeometry, features: TopageFeature[]): TopageFeature[] {
  const rawCoords = flattenCoordinates(rawGeometry);

  const scored = features
    .map((feature) => {
      const score = computeTopageFeatureScore(feature);
      const distKm = minRawPointDistanceKm(rawCoords, feature);
      return { feature, score, distKm };
    })
    .filter(({ distKm }) => Number.isFinite(distKm) && distKm <= 10);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.distKm - b.distKm;
  });

  return scored.slice(0, Math.min(150, scored.length)).map(({ feature }) => feature);
}

function buildHydroGraph(features: TopageFeature[]): Map<string, DirectedEdge[]> {
  const adjacency = new Map<string, DirectedEdge[]>();

  for (const feature of features) {
    const props = feature.properties ?? {};
    const startNode = props.CdNoeudDebut;
    const endNode = props.CdNoeudFin;
    if (!startNode || !endNode) continue;

    const coordinates = feature.geometry.coordinates as Coordinate[];
    const edge: GraphEdge = {
      startNode,
      endNode,
      featureId: getFeatureId(feature),
      coordinates,
      weightKm: featureLengthKm(feature),
    };

    const forward: DirectedEdge = { edge, fromNode: startNode, toNode: endNode, reversed: false };
    const backward: DirectedEdge = { edge, fromNode: endNode, toNode: startNode, reversed: true };

    adjacency.set(startNode, [...(adjacency.get(startNode) ?? []), forward]);
    adjacency.set(endNode, [...(adjacency.get(endNode) ?? []), backward]);
  }

  return adjacency;
}

function nearestDirectedEdge(target: Coordinate, features: TopageFeature[]): DirectedEdge | null {
  const targetPoint = point(target);
  let best: DirectedEdge | null = null;
  let bestDistance = Infinity;

  for (const feature of features) {
    const props = feature.properties ?? {};
    const startNode = props.CdNoeudDebut;
    const endNode = props.CdNoeudFin;
    if (!startNode || !endNode) continue;

    const distKm = pointToLineDistance(targetPoint, feature, { units: 'kilometers' });
    if (distKm >= bestDistance) continue;

    const coords = feature.geometry.coordinates as Coordinate[];
    const startDist = distance(targetPoint, point(coords[0]), { units: 'kilometers' });
    const endDist = distance(targetPoint, point(coords[coords.length - 1]), { units: 'kilometers' });
    const reversed = endDist < startDist;

    bestDistance = distKm;
    best = {
      edge: {
        startNode,
        endNode,
        featureId: getFeatureId(feature),
        coordinates: coords,
        weightKm: featureLengthKm(feature),
      },
      fromNode: reversed ? endNode : startNode,
      toNode: reversed ? startNode : endNode,
      reversed,
    };
  }

  return best;
}

function dijkstraPath(
  adjacency: Map<string, DirectedEdge[]>,
  startNode: string,
  endNode: string,
): DirectedEdge[] | null {
  const queue = new Set<string>([startNode]);
  const distances = new Map<string, number>([[startNode, 0]]);
  const previous = new Map<string, DirectedEdge>();

  while (queue.size > 0) {
    let currentNode: string | null = null;
    let currentDistance = Infinity;

    for (const node of queue) {
      const nodeDistance = distances.get(node) ?? Infinity;
      if (nodeDistance < currentDistance) {
        currentDistance = nodeDistance;
        currentNode = node;
      }
    }

    if (currentNode == null) break;
    if (currentNode === endNode) break;

    queue.delete(currentNode);

    for (const edge of adjacency.get(currentNode) ?? []) {
      const candidateDistance = currentDistance + edge.edge.weightKm;
      const existingDistance = distances.get(edge.toNode) ?? Infinity;

      if (candidateDistance < existingDistance) {
        distances.set(edge.toNode, candidateDistance);
        previous.set(edge.toNode, edge);
        queue.add(edge.toNode);
      }
    }
  }

  if (!previous.has(endNode)) return null;

  const path: DirectedEdge[] = [];
  let cursor = endNode;

  while (cursor !== startNode) {
    const edge = previous.get(cursor);
    if (!edge) return null;
    path.push(edge);
    cursor = edge.fromNode;
  }

  path.reverse();
  return path;
}

function mergeDirectedEdges(
  startEdge: DirectedEdge,
  path: DirectedEdge[] | null,
  endEdge: DirectedEdge,
): Coordinate[] {
  const merged: Coordinate[] = [];
  const appendCoords = (coords: Coordinate[]) => {
    if (coords.length === 0) return;
    if (merged.length === 0) {
      merged.push(...coords);
      return;
    }

    const [lastLng, lastLat] = merged[merged.length - 1];
    const [nextLng, nextLat] = coords[0];
    if (lastLng === nextLng && lastLat === nextLat) {
      merged.push(...coords.slice(1));
    } else {
      merged.push(...coords);
    }
  };

  const orient = (edge: DirectedEdge) => edge.reversed
    ? [...edge.edge.coordinates].reverse()
    : edge.edge.coordinates;

  appendCoords(orient(startEdge));
  for (const edge of path ?? []) {
    if (edge.edge.featureId === startEdge.edge.featureId || edge.edge.featureId === endEdge.edge.featureId) {
      continue;
    }
    appendCoords(orient(edge));
  }
  if (endEdge.edge.featureId !== startEdge.edge.featureId) {
    appendCoords(orient(endEdge));
  }

  return merged;
}

function getCourseIdentifiers(feature: TopageFeature): string[] {
  const props = feature.properties ?? {};
  return [
    props.CdCoursEau_1,
    props.CdCoursEau_2,
    props.CdCoursEau_3,
    props.TopoOH?.trim().toLowerCase(),
  ].filter((value): value is string => Boolean(value && value.trim().length > 0));
}

function computeFeatureMidpoint(feature: TopageFeature): Coordinate {
  const coords = feature.geometry.coordinates as Coordinate[];
  return coords[Math.floor(coords.length / 2)] ?? coords[0];
}

function computeCorridorLocation(rawLine: Feature<LineString>, feature: TopageFeature): number {
  const snapped = nearestPointOnLine(rawLine, point(computeFeatureMidpoint(feature)), { units: 'kilometers' });
  return Number(snapped.properties?.location ?? 0);
}

function buildCorridorFallback(
  rawGeometry: FloodGeometry,
  candidates: TopageFeature[],
): FloodGeometryResolution | null {
  if (candidates.length === 0) return null;

  const rawCoords = flattenCoordinates(rawGeometry);
  const rawLine = lineString(rawCoords);
  const anchor = candidates[0];
  const anchorIds = new Set(getCourseIdentifiers(anchor));

  const enriched = candidates
    .map((feature) => {
      const distanceKm = minRawPointDistanceKm(rawCoords, feature);
      const identifiers = getCourseIdentifiers(feature);
      const courseMatch = identifiers.some((identifier) => anchorIds.has(identifier));
      return {
        feature,
        distanceKm,
        courseMatch,
        hydroScore: computeTopageFeatureScore(feature),
        location: computeCorridorLocation(rawLine, feature),
      };
    })
    .filter(({ distanceKm, hydroScore, courseMatch }) => (
      distanceKm <= 2.5 && (courseMatch || hydroScore >= 2)
    ));

  const scoped = enriched.length > 0 ? enriched : candidates
    .map((feature) => ({
      feature,
      distanceKm: minRawPointDistanceKm(rawCoords, feature),
      courseMatch: false,
      hydroScore: computeTopageFeatureScore(feature),
      location: computeCorridorLocation(rawLine, feature),
    }))
    .filter(({ distanceKm }) => distanceKm <= 1.2);

  if (scoped.length === 0) return null;

  scoped.sort((a, b) => a.location - b.location || a.distanceKm - b.distanceKm);

  const selected = scoped
    .slice(0, 24)
    .map(({ feature }) => feature.geometry.coordinates as Coordinate[])
    .filter((coords) => coords.length >= 2);

  if (selected.length === 0) return null;

  const avgDistanceKm = scoped.slice(0, Math.min(24, scoped.length))
    .reduce((sum, item) => sum + item.distanceKm, 0) / Math.min(24, scoped.length);
  const confidenceBase = scoped.some((item) => item.courseMatch) ? 0.74 : 0.58;
  const confidence = clamp(confidenceBase - Math.min(0.18, avgDistanceKm * 0.08), 0.45, 0.82);
  console.info('[FloodGeometry] Corridor fallback', {
    selected: selected.length,
    avgDistanceKm: Number(avgDistanceKm.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
  });

  return {
    displayGeometry: {
      type: selected.length === 1 ? 'LineString' : 'MultiLineString',
      coordinates: selected.length === 1 ? selected[0] : selected,
    } as FloodGeometry,
    geometryFidelity: 'fallback',
    matchConfidence: confidence,
  };
}

function computeMatchConfidence(
  rawGeometry: FloodGeometry,
  matchedCoords: Coordinate[],
  startEdge: DirectedEdge,
  endEdge: DirectedEdge,
): number {
  const endpoints = getGeometryEndpoints(rawGeometry);
  if (!endpoints || matchedCoords.length < 2) return 0;

  const matchedLine = lineString(matchedCoords);
  const startSnapKm = pointToLineDistance(point(endpoints.start), matchedLine, { units: 'kilometers' });
  const endSnapKm = pointToLineDistance(point(endpoints.end), matchedLine, { units: 'kilometers' });
  const directGapKm = distance(point(endpoints.start), point(endpoints.end), { units: 'kilometers' });
  const matchedLengthKm = featureLengthKm({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: matchedCoords },
  });

  const startEdgeDistKm = pointToLineDistance(point(endpoints.start), lineString(startEdge.edge.coordinates), { units: 'kilometers' });
  const endEdgeDistKm = pointToLineDistance(point(endpoints.end), lineString(endEdge.edge.coordinates), { units: 'kilometers' });
  const pathRatio = directGapKm > 0.1 ? matchedLengthKm / directGapKm : 1;

  let confidence = 0.92;
  confidence -= Math.min(0.28, startSnapKm * 0.06);
  confidence -= Math.min(0.28, endSnapKm * 0.06);
  confidence -= Math.min(0.15, startEdgeDistKm * 0.04);
  confidence -= Math.min(0.15, endEdgeDistKm * 0.04);

  if (pathRatio < 0.8 || pathRatio > 3.5) {
    confidence -= 0.22;
  } else if (pathRatio > 2.2) {
    confidence -= 0.1;
  }

  return clamp(confidence, 0.4, 0.97);
}

export function countFloodGeometryVertices(geometry: FloodGeometry): number {
  return countVertices(flattenCoordinates(geometry));
}

export function resolveFloodDisplayGeometry(
  rawGeometry: FloodGeometry,
  dataSource: FloodDataSource,
): FloodGeometryResolution {
  if (dataSource === 'mock') {
    return {
      displayGeometry: rawGeometry,
      geometryFidelity: 'raw',
      matchConfidence: 0,
    };
  }

  return {
    displayGeometry: rawGeometry,
    geometryFidelity: 'raw',
    matchConfidence: 0.35,
  };
}

export async function matchFloodGeometryToTopage(
  rawGeometry: FloodGeometry,
  dataSource: FloodDataSource,
): Promise<FloodGeometryResolution> {
  if (dataSource !== 'live') {
    return resolveFloodDisplayGeometry(rawGeometry, dataSource);
  }

  const endpoints = getGeometryEndpoints(rawGeometry);
  if (!endpoints) {
    return resolveFloodDisplayGeometry(rawGeometry, dataSource);
  }

  try {
    const bbox = expandBBox(computeGeometryBBox(rawGeometry));
    const features = await fetchTopageFeaturesForBBox(bbox);
    const candidates = selectCandidateFeatures(rawGeometry, features);

    if (candidates.length === 0) {
      console.info('[FloodGeometry] No Topage candidates in bbox');
      return resolveFloodDisplayGeometry(rawGeometry, dataSource);
    }

    const startEdge = nearestDirectedEdge(endpoints.start, candidates);
    const endEdge = nearestDirectedEdge(endpoints.end, candidates);
    if (!startEdge || !endEdge) {
      console.info('[FloodGeometry] Missing start/end edge');
      return resolveFloodDisplayGeometry(rawGeometry, dataSource);
    }

    const adjacency = buildHydroGraph(candidates);
    const path = startEdge.toNode === endEdge.fromNode
      ? []
      : dijkstraPath(adjacency, startEdge.toNode, endEdge.fromNode);

    if (path == null && startEdge.edge.featureId !== endEdge.edge.featureId) {
      console.info('[FloodGeometry] Graph path not found, trying corridor fallback');
      return buildCorridorFallback(rawGeometry, candidates)
        ?? resolveFloodDisplayGeometry(rawGeometry, dataSource);
    }

    const matchedCoords = mergeDirectedEdges(startEdge, path, endEdge);
    if (matchedCoords.length < 2) {
      console.info('[FloodGeometry] Empty merged path, trying corridor fallback');
      return buildCorridorFallback(rawGeometry, candidates)
        ?? resolveFloodDisplayGeometry(rawGeometry, dataSource);
    }

    const confidence = computeMatchConfidence(rawGeometry, matchedCoords, startEdge, endEdge);

    if (confidence < 0.45) {
      console.info('[FloodGeometry] Low confidence exact path, trying corridor fallback');
      return buildCorridorFallback(rawGeometry, candidates)
        ?? resolveFloodDisplayGeometry(rawGeometry, dataSource);
    }

    console.info('[FloodGeometry] Exact match', {
      confidence: Number(confidence.toFixed(2)),
      vertices: matchedCoords.length,
    });

    return {
      displayGeometry: {
        type: 'LineString',
        coordinates: matchedCoords,
      },
      geometryFidelity: 'matched',
      matchConfidence: confidence,
    };
  } catch (error) {
    console.warn('[FloodGeometry] Topage matching failed:', error);
    return resolveFloodDisplayGeometry(rawGeometry, dataSource);
  }
}

export function prepareFloodSegment(input: PrepareFloodSegmentInput): FloodSegment {
  const rawGeometry = input.geometry;
  const resolvedGeometry = input.displayGeometry && input.geometryFidelity && input.matchConfidence != null
    ? {
      displayGeometry: input.displayGeometry,
      geometryFidelity: input.geometryFidelity,
      matchConfidence: input.matchConfidence,
    }
    : resolveFloodDisplayGeometry(rawGeometry, input.dataSource);
  const displayGeometry = input.displayGeometry ?? resolvedGeometry.displayGeometry;
  const geometryFidelity = input.geometryFidelity ?? resolvedGeometry.geometryFidelity;
  const defaultConfidence = resolvedGeometry.matchConfidence;

  return {
    id: input.id,
    name: input.name,
    level: input.level,
    dataSource: input.dataSource,
    geometryFidelity,
    matchConfidence: clamp(input.matchConfidence ?? defaultConfidence, 0, 1),
    rawVertexCount: countFloodGeometryVertices(rawGeometry),
    displayVertexCount: countFloodGeometryVertices(displayGeometry),
    geometry: displayGeometry,
    rawGeometry,
    displayGeometry,
  };
}

export async function enhanceFloodSegmentGeometry(segment: FloodSegment): Promise<FloodSegment> {
  const resolution = await matchFloodGeometryToTopage(segment.rawGeometry, segment.dataSource);

  return {
    ...segment,
    geometry: resolution.displayGeometry,
    displayGeometry: resolution.displayGeometry,
    geometryFidelity: resolution.geometryFidelity,
    matchConfidence: clamp(resolution.matchConfidence, 0, 1),
    displayVertexCount: countFloodGeometryVertices(resolution.displayGeometry),
  };
}

export function inspectFloodSnapPoint(
  geometry: FloodGeometry,
  coordinate: Coordinate,
): Coordinate {
  const snapped = nearestPointOnLine(lineString(flattenCoordinates(geometry)), point(coordinate), { units: 'kilometers' });
  return snapped.geometry.coordinates as Coordinate;
}
