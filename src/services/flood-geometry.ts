import { distance, lineString, nearestPointOnLine, point, pointToLineDistance } from '@turf/turf';
import type {
  FloodDataSource,
  FloodGeometryFidelity,
  FloodSegment,
  FloodVigilanceLevel,
} from '../types/index.ts';
import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';
import {
  buildOsmWayGraph,
  dijkstraOsmPath,
  projectToNearestGraphNode,
  osmPathLengthKm,
  reconstructOsmLineString,
  type OsmWaterwayFeature,
  type OsmWaterwayProperties,
} from './osm-waterway-graph.ts';

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

interface OSMCoverageDebug {
  bbox: string;
  wayCount: number;
  nodeCount: number;
  edgeCount: number;
  totalEdgeLengthKm: number;
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
const OSM_WATERWAY_PROXY_URL = '/api/environment/osm-waterways';
const HYDRO_BBOX_PADDING_DEG = 0.12;
const MAX_FEATURES_PER_QUERY = 600;
const FETCH_TIMEOUT_MS = 20_000;
const hydroCache = new Map<string, Promise<TopageFeature[]>>();
const osmWaterwayCache = new Map<string, Promise<OsmWaterwayFeature[]>>();
let lastOsmWaterwaysGeoJson: FeatureCollection<LineString, OsmWaterwayProperties> = { type: 'FeatureCollection', features: [] };
let lastOsmCoverageDebug: OSMCoverageDebug | null = null;

export function getLastOsmWaterwaysGeoJson(): FeatureCollection<LineString, OsmWaterwayProperties> {
  return lastOsmWaterwaysGeoJson;
}

export function getLastOsmCoverageDebug(): OSMCoverageDebug | null {
  return lastOsmCoverageDebug;
}

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

function splitBBoxIntoQuadrants(
  bbox: [number, number, number, number],
): Array<[number, number, number, number]> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const midLng = (minLng + maxLng) / 2;
  const midLat = (minLat + maxLat) / 2;
  return [
    [minLng, minLat, midLng, midLat],
    [midLng, minLat, maxLng, midLat],
    [minLng, midLat, midLng, maxLat],
    [midLng, midLat, maxLng, maxLat],
  ];
}

function dedupeTopageFeatures(features: TopageFeature[]): TopageFeature[] {
  const deduped = new Map<string, TopageFeature>();
  for (const feature of features) {
    const key = `${getFeatureId(feature)}:${feature.geometry.coordinates.length}`;
    if (!deduped.has(key)) deduped.set(key, feature);
  }
  return [...deduped.values()];
}

async function fetchTopageFeaturesForBBoxRaw(
  bbox: [number, number, number, number],
): Promise<{ usable: TopageFeature[]; total: number }> {
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
  const total = geojson.features.length;
  const usable = geojson.features.filter((feature): feature is TopageFeature => isUsableTopageFeature(feature));
  return { usable, total };
}

async function fetchTopageFeaturesForBBox(
  bbox: [number, number, number, number],
  depth = 0,
): Promise<TopageFeature[]> {
  const key = `${bboxKey(bbox)}:d${depth}`;
  const cached = hydroCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const { usable, total } = await fetchTopageFeaturesForBBoxRaw(bbox);
    const bboxLabel = bboxKey(bbox);
    const truncated = total >= MAX_FEATURES_PER_QUERY;

    if (truncated && depth < 2) {
      console.warn(`[FloodGeometry/WFS] Réponse tronquée à ${MAX_FEATURES_PER_QUERY} features — subdivision bbox ${bboxLabel}`);
      const quadrants = splitBBoxIntoQuadrants(bbox);
      console.info(`[FloodGeometry/WFS] subdivision en ${quadrants.length} sous-bboxes`);
      const nested = await Promise.all(quadrants.map((subBbox) => fetchTopageFeaturesForBBox(subBbox, depth + 1)));
      const merged = dedupeTopageFeatures(nested.flat());
      console.info(`[FloodGeometry/WFS] bbox=${bboxLabel} → merged total:${merged.length}`);
      return merged;
    }

    if (truncated) {
      console.warn(`[FloodGeometry/WFS] Réponse tronquée à ${MAX_FEATURES_PER_QUERY} features — certains candidats peuvent manquer`);
    }

    console.debug(`[FloodGeometry/WFS] bbox=${bboxLabel} → total:${total} usable:${usable.length} (rejetés:${total - usable.length})`);
    return usable;
  })();

  hydroCache.set(key, pending);

  try {
    return await pending;
  } catch (error) {
    hydroCache.delete(key);
    throw error;
  }
}

async function fetchOsmWaterwayFeaturesForBBox(
  bbox: [number, number, number, number],
): Promise<OsmWaterwayFeature[]> {
  const key = `osm:${bboxKey(bbox)}`;
  const cached = osmWaterwayCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const params = new URLSearchParams({
      bbox: `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`,
    });

    const response = await fetch(`${OSM_WATERWAY_PROXY_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const geojson = await response.json() as FeatureCollection<LineString, OsmWaterwayProperties>;
    lastOsmWaterwaysGeoJson = geojson;
    return geojson.features.filter((feature): feature is OsmWaterwayFeature => (
      !!feature.geometry &&
      feature.geometry.type === 'LineString' &&
      (feature.geometry.coordinates?.length ?? 0) >= 2
    ));
  })();

  osmWaterwayCache.set(key, pending);

  try {
    return await pending;
  } catch (error) {
    osmWaterwayCache.delete(key);
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

function minRawPointDistanceKmToOsm(rawCoords: Coordinate[], feature: OsmWaterwayFeature): number {
  let minDistance = Infinity;

  for (const coord of rawCoords) {
    const distKm = pointToLineDistance(point(coord), feature, { units: 'kilometers' });
    if (distKm < minDistance) minDistance = distKm;
  }

  return minDistance;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function computeOsmNameScore(segmentLabel: string, feature: OsmWaterwayFeature): number {
  const featureName = normalizeName(feature.properties?.name ?? '');
  const label = normalizeName(segmentLabel);
  if (!featureName || !label) return 0;
  if (label.includes(featureName) || featureName.includes(label)) return 3;

  const labelTokens = new Set(label.split(' ').filter((token) => token.length >= 3));
  const featureTokens = featureName.split(' ').filter((token) => token.length >= 3);
  let matches = 0;
  for (const token of featureTokens) {
    if (labelTokens.has(token)) matches += 1;
  }
  return matches;
}

function computeOsmFeatureLocation(rawLine: Feature<LineString>, feature: OsmWaterwayFeature): number {
  const coords = feature.geometry.coordinates as Coordinate[];
  const midpoint = coords[Math.floor(coords.length / 2)] ?? coords[0];
  const snapped = nearestPointOnLine(rawLine, point(midpoint), { units: 'kilometers' });
  return Number(snapped.properties?.location ?? 0);
}

function mergeOsmWaterwayFeatures(
  rawGeometry: FloodGeometry,
  scored: Array<{
    feature: OsmWaterwayFeature;
    distanceKm: number;
    nameScore: number;
    endpointGap: number;
  }>,
): Coordinate[] | null {
  if (scored.length === 0) return null;

  const rawCoords = flattenCoordinates(rawGeometry);
  const rawLine = lineString(rawCoords);
  const best = scored[0];
  const bestName = normalizeName(best.feature.properties?.name ?? '');

  const selected = scored
    .filter((item) => {
      const itemName = normalizeName(item.feature.properties?.name ?? '');
      const sameName = bestName.length > 0 && itemName === bestName;
      const closeEnough = item.distanceKm <= Math.max(1.6, best.distanceKm + 0.9);
      const acceptableName = sameName || (best.nameScore === 0 ? item.distanceKm <= 0.7 : item.nameScore > 0);
      return closeEnough && acceptableName;
    })
    .map((item) => ({
      ...item,
      location: computeOsmFeatureLocation(rawLine, item.feature),
    }))
    .sort((a, b) => a.location - b.location || a.distanceKm - b.distanceKm)
    .slice(0, 24);

  if (selected.length === 0) return null;

  const merged: Coordinate[] = [];

  for (const item of selected) {
    const coords = item.feature.geometry.coordinates as Coordinate[];
    if (coords.length < 2) continue;

    let oriented = coords;
    if (merged.length === 0) {
      const rawStart = rawCoords[0];
      const startGap = distance(point(rawStart), point(coords[0]), { units: 'kilometers' });
      const endGap = distance(point(rawStart), point(coords[coords.length - 1]), { units: 'kilometers' });
      oriented = endGap < startGap ? [...coords].reverse() : coords;
      merged.push(...oriented);
      continue;
    }

    const last = merged[merged.length - 1];
    const forwardGap = distance(point(last), point(coords[0]), { units: 'kilometers' });
    const reverseGap = distance(point(last), point(coords[coords.length - 1]), { units: 'kilometers' });
    const bestGap = Math.min(forwardGap, reverseGap);
    if (bestGap > 1.2) continue;

    oriented = reverseGap < forwardGap ? [...coords].reverse() : coords;
    const [nextLng, nextLat] = oriented[0];
    const [lastLng, lastLat] = last;
    if (nextLng === lastLng && nextLat === lastLat) {
      merged.push(...oriented.slice(1));
    } else {
      merged.push(...oriented);
    }
  }

  return merged.length >= 2 ? merged : null;
}

async function matchFloodGeometryToOsmWaterwayHeuristic(
  rawGeometry: FloodGeometry,
  segmentLabel: string,
): Promise<FloodGeometryResolution | null> {
  const rawCoords = flattenCoordinates(rawGeometry);
  if (rawCoords.length < 2) return null;

  const bbox = expandBBox(computeGeometryBBox(rawGeometry), 0.08);
  const features = await fetchOsmWaterwayFeaturesForBBox(bbox);
  if (features.length === 0) return null;

  const scored = features
    .map((feature) => {
      const distanceKm = minRawPointDistanceKmToOsm(rawCoords, feature);
      const nameScore = computeOsmNameScore(segmentLabel, feature);
      const geom = feature.geometry.coordinates as Coordinate[];
      const endpoints = getGeometryEndpoints(rawGeometry);
      const startGap = endpoints ? distance(point(endpoints.start), point(geom[0]), { units: 'kilometers' }) : 0;
      const endGap = endpoints ? distance(point(endpoints.end), point(geom[geom.length - 1]), { units: 'kilometers' }) : 0;
      return { feature, distanceKm, nameScore, endpointGap: startGap + endGap };
    })
    .filter(({ distanceKm }) => Number.isFinite(distanceKm) && distanceKm <= 3);

  if (scored.length === 0) return null;

  scored.sort((a, b) => {
    if (a.nameScore !== b.nameScore) return b.nameScore - a.nameScore;
    if (Math.abs(a.distanceKm - b.distanceKm) > 0.15) return a.distanceKm - b.distanceKm;
    return a.endpointGap - b.endpointGap;
  });

  const best = scored[0];
  const mergedCoords = mergeOsmWaterwayFeatures(rawGeometry, scored);
  const displayGeometry = mergedCoords
    ? { type: 'LineString' as const, coordinates: mergedCoords }
    : best.feature.geometry;
  const confidence = clamp(0.82 + best.nameScore * 0.04 - Math.min(0.32, best.distanceKm * 0.12), 0.45, 0.96);

  return {
    displayGeometry,
    geometryFidelity: 'fallback',
    matchConfidence: confidence,
  };
}

async function matchFloodGeometryToOsmWaterway(
  rawGeometry: FloodGeometry,
  segmentLabel: string,
): Promise<FloodGeometryResolution | null> {
  const rawCoords = flattenCoordinates(rawGeometry);
  if (rawCoords.length < 2) return null;

  const bbox = expandBBox(computeGeometryBBox(rawGeometry), 0.08);
  const bboxStr = bboxKey(bbox);
  const features = await fetchOsmWaterwayFeaturesForBBox(bbox);
  const wayCount = features.length;
  console.info(`[OSM graph] ${wayCount} ways recuperes, bbox ${bboxStr}`);
  if (wayCount === 0) return null;

  const graph = buildOsmWayGraph(features);
  const nodeCount = graph.nodeCoords.size;
  const edgeCount = Array.from(graph.adjacency.values()).reduce((sum, edges) => sum + edges.length, 0) / 2;
  const totalEdgeLengthKm = Array.from(graph.adjacency.values())
    .flat()
    .filter((edge) => edge.fromNodeKey < edge.toNodeKey)
    .reduce((sum, edge) => sum + edge.edge.weightKm, 0);
  lastOsmCoverageDebug = {
    bbox: bboxStr,
    wayCount,
    nodeCount,
    edgeCount,
    totalEdgeLengthKm: Number(totalEdgeLengthKm.toFixed(1)),
  };
  console.info(`[OSM graph] ${nodeCount} noeuds, ${edgeCount} aretes construites`);
  console.info(`[OSM graph] longueur totale graphe: ${totalEdgeLengthKm.toFixed(1)} km`);

  const endpoints = getGeometryEndpoints(rawGeometry);
  if (!endpoints) return matchFloodGeometryToOsmWaterwayHeuristic(rawGeometry, segmentLabel);

  const startNodeMatch = projectToNearestGraphNode(endpoints.start, features);
  const endNodeMatch = projectToNearestGraphNode(endpoints.end, features);

  if (!startNodeMatch || !endNodeMatch) {
    console.info('[OSM graph] endpoints introuvables -> fallback heuristique');
    return matchFloodGeometryToOsmWaterwayHeuristic(rawGeometry, segmentLabel);
  }

  console.info(
    `[OSM graph] start=${startNodeMatch.node.key} end=${endNodeMatch.node.key} ` +
    `(dist: ${startNodeMatch.distanceKm.toFixed(2)}km / ${endNodeMatch.distanceKm.toFixed(2)}km)`,
  );

  const path = dijkstraOsmPath(graph, startNodeMatch.node.key, endNodeMatch.node.key);
  if (path == null) {
    console.info('[OSM graph] Dijkstra sans chemin -> fallback heuristique');
    return matchFloodGeometryToOsmWaterwayHeuristic(rawGeometry, segmentLabel);
  }

  const coords = reconstructOsmLineString(path);
  if (coords.length < 2) {
    console.info('[OSM graph] reconstruction vide -> fallback heuristique');
    return matchFloodGeometryToOsmWaterwayHeuristic(rawGeometry, segmentLabel);
  }

  const pathLengthKm = osmPathLengthKm(path);
  console.info(`[OSM graph] chemin trouve: ${path.length} aretes, ${pathLengthKm.toFixed(1)} km`);

  const directGapKm = distance(point(endpoints.start), point(endpoints.end), { units: 'kilometers' });
  const pathRatio = directGapKm > 0.1 ? pathLengthKm / directGapKm : 1;
  const confidence = clamp(
    0.82
      - Math.min(0.24, startNodeMatch.distanceKm * 0.08)
      - Math.min(0.24, endNodeMatch.distanceKm * 0.08)
      - (pathRatio > 4 ? 0.18 : pathRatio > 2.5 ? 0.08 : 0),
    0.45,
    0.94,
  );

  return {
    displayGeometry: {
      type: 'LineString',
      coordinates: coords,
    },
    geometryFidelity: 'fallback',
    matchConfidence: confidence,
  };
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
    const distGap = a.distKm - b.distKm;
    if (Math.abs(distGap) > 0.35) return distGap;
    if (b.score !== a.score) return b.score - a.score;
    return distGap;
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

function computeRawMidlineLocation(rawCoords: Coordinate[]): number {
  if (rawCoords.length < 2) return 0;
  const rawLine = lineString(rawCoords);
  const midpoint = rawCoords[Math.floor(rawCoords.length / 2)] ?? rawCoords[0];
  const snapped = nearestPointOnLine(rawLine, point(midpoint), { units: 'kilometers' });
  return Number(snapped.properties?.location ?? 0);
}

function buildCorridorFallback(
  rawGeometry: FloodGeometry,
  candidates: TopageFeature[],
): FloodGeometryResolution | null {
  if (candidates.length === 0) return null;

  const rawCoords = flattenCoordinates(rawGeometry);
  const rawLine = lineString(rawCoords);
  const rawMidLocation = computeRawMidlineLocation(rawCoords);
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

  const scopedFeatures = scoped.slice(0, 24).map(({ feature }) => feature);
  const endpoints = getGeometryEndpoints(rawGeometry);
  let displayGeometry: FloodGeometry | null = null;

  if (endpoints && scopedFeatures.length > 0) {
    const startEdge = nearestDirectedEdge(endpoints.start, scopedFeatures);
    const endEdge = nearestDirectedEdge(endpoints.end, scopedFeatures);

    if (startEdge && endEdge) {
      const adjacency = buildHydroGraph(scopedFeatures);
      const path = startEdge.toNode === endEdge.fromNode
        ? []
        : dijkstraPath(adjacency, startEdge.toNode, endEdge.fromNode);

      if (path != null || startEdge.edge.featureId === endEdge.edge.featureId) {
        const mergedCoords = mergeDirectedEdges(startEdge, path, endEdge);
        if (mergedCoords.length >= 2) {
          displayGeometry = {
            type: 'LineString',
            coordinates: mergedCoords,
          };
        }
      }
    }
  }

  if (displayGeometry == null) {
    const bestFeature = [...scoped].sort((a, b) => {
      if (a.courseMatch !== b.courseMatch) return a.courseMatch ? -1 : 1;
      const distGap = a.distanceKm - b.distanceKm;
      if (Math.abs(distGap) > 0.15) return distGap;
      const locationGap = Math.abs(a.location - rawMidLocation) - Math.abs(b.location - rawMidLocation);
      if (Math.abs(locationGap) > 0.001) return locationGap;
      return b.hydroScore - a.hydroScore;
    })[0]?.feature ?? anchor;
    const bestCoords = bestFeature.geometry.coordinates as Coordinate[];
    if (bestCoords.length < 2) return null;
    displayGeometry = {
      type: 'LineString',
      coordinates: bestCoords,
    };
  }

  const avgDistanceKm = scoped.slice(0, Math.min(24, scoped.length))
    .reduce((sum, item) => sum + item.distanceKm, 0) / Math.min(24, scoped.length);
  const confidenceBase = scoped.some((item) => item.courseMatch) ? 0.7 : 0.54;
  const confidence = clamp(confidenceBase - Math.min(0.18, avgDistanceKm * 0.08), 0.45, 0.82);
  console.info('[FloodGeometry] Corridor fallback', {
    selected: scopedFeatures.length,
    avgDistanceKm: Number(avgDistanceKm.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
  });

  return {
    displayGeometry,
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
  segmentLabel = '?',
): Promise<FloodGeometryResolution> {
  const endpoints = getGeometryEndpoints(rawGeometry);
  if (!endpoints) {
    console.warn(`[FloodGeometry] "${segmentLabel}" — géométrie sans endpoints valides → raw`);
    return resolveFloodDisplayGeometry(rawGeometry, dataSource);
  }

  try {
    const bbox = expandBBox(computeGeometryBBox(rawGeometry));
    const features = await fetchTopageFeaturesForBBox(bbox);
    const candidates = selectCandidateFeatures(rawGeometry, features);

    if (candidates.length === 0) {
      console.warn(`[FloodGeometry] "${segmentLabel}" — 0 candidats Topage dans la bbox (${features.length} features WFS, aucun à ≤10 km)`);
      const osmFallback = await matchFloodGeometryToOsmWaterway(rawGeometry, segmentLabel);
      console.info(`[FloodGeometry] "${segmentLabel}" — source finale: ${osmFallback ? 'osm-graph/heuristic' : 'raw'}`);
      return osmFallback ?? resolveFloodDisplayGeometry(rawGeometry, dataSource);
    }

    const startEdge = nearestDirectedEdge(endpoints.start, candidates);
    const endEdge = nearestDirectedEdge(endpoints.end, candidates);
    if (!startEdge || !endEdge) {
      console.warn(`[FloodGeometry] "${segmentLabel}" — arête start/end introuvable (${candidates.length} candidats)`);
      const osmFallback = await matchFloodGeometryToOsmWaterway(rawGeometry, segmentLabel);
      console.info(`[FloodGeometry] "${segmentLabel}" — source finale: ${osmFallback ? 'osm-graph/heuristic' : 'raw'}`);
      return osmFallback ?? resolveFloodDisplayGeometry(rawGeometry, dataSource);
    }

    const adjacency = buildHydroGraph(candidates);
    const path = startEdge.toNode === endEdge.fromNode
      ? []
      : dijkstraPath(adjacency, startEdge.toNode, endEdge.fromNode);

    if (path == null && startEdge.edge.featureId !== endEdge.edge.featureId) {
      console.info(`[FloodGeometry] "${segmentLabel}" — Dijkstra sans chemin → corridor fallback`);
      const result = buildCorridorFallback(rawGeometry, candidates)
        ?? await matchFloodGeometryToOsmWaterway(rawGeometry, segmentLabel)
        ?? resolveFloodDisplayGeometry(rawGeometry, dataSource);
      console.info(`[FloodGeometry] "${segmentLabel}" — source finale: ${result.geometryFidelity === 'matched' ? 'topage' : result.geometryFidelity === 'fallback' ? 'topage-corridor-or-osm' : 'raw'}`);
      return result;
    }

    const matchedCoords = mergeDirectedEdges(startEdge, path, endEdge);
    if (matchedCoords.length < 2) {
      console.info(`[FloodGeometry] "${segmentLabel}" — merge vide → corridor fallback`);
      const result = buildCorridorFallback(rawGeometry, candidates)
        ?? await matchFloodGeometryToOsmWaterway(rawGeometry, segmentLabel)
        ?? resolveFloodDisplayGeometry(rawGeometry, dataSource);
      console.info(`[FloodGeometry] "${segmentLabel}" — source finale: ${result.geometryFidelity === 'matched' ? 'topage' : result.geometryFidelity === 'fallback' ? 'topage-corridor-or-osm' : 'raw'}`);
      return result;
    }

    const confidence = computeMatchConfidence(rawGeometry, matchedCoords, startEdge, endEdge);

    if (confidence < 0.45) {
      console.info(`[FloodGeometry] "${segmentLabel}" — confiance trop faible (${confidence.toFixed(2)}) → corridor fallback`);
      const result = buildCorridorFallback(rawGeometry, candidates)
        ?? await matchFloodGeometryToOsmWaterway(rawGeometry, segmentLabel)
        ?? resolveFloodDisplayGeometry(rawGeometry, dataSource);
      console.info(`[FloodGeometry] "${segmentLabel}" — source finale: ${result.geometryFidelity === 'matched' ? 'topage' : result.geometryFidelity === 'fallback' ? 'topage-corridor-or-osm' : 'raw'}`);
      return result;
    }

    console.info(`[FloodGeometry] "${segmentLabel}" — matched ✓ (confiance:${confidence.toFixed(2)}, sommets:${matchedCoords.length})`);

    return {
      displayGeometry: {
        type: 'LineString',
        coordinates: matchedCoords,
      },
      geometryFidelity: 'matched',
      matchConfidence: confidence,
    };
  } catch (error) {
    console.warn(`[FloodGeometry] "${segmentLabel}" — Topage KO:`, error);
    const osmFallback = await matchFloodGeometryToOsmWaterway(rawGeometry, segmentLabel).catch(() => null);
    console.info(`[FloodGeometry] "${segmentLabel}" — source finale: ${osmFallback ? 'osm-graph/heuristic' : 'raw'}`);
    return osmFallback ?? resolveFloodDisplayGeometry(rawGeometry, dataSource);
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
  const resolution = await matchFloodGeometryToTopage(segment.rawGeometry, segment.dataSource, `${segment.name} (${segment.id})`);

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
