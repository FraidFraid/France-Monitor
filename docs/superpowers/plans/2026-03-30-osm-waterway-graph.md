# OSM Waterway Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le fallback OSM heuristique (chaînage par location) par une reconstruction topologique basée sur un graphe de ways OSM + Dijkstra, produisant un `LineString` continu plus long et correct.

**Architecture:** Nouveau module `osm-waterway-graph.ts` qui implémente le même pattern que le graphe Topage existant (node keys, directed edges, Dijkstra) mais fondé sur les endpoints de ways OSM (coordonnées arrondies) au lieu de `CdNoeudDebut`/`CdNoeudFin`. `flood-geometry.ts` appelle ce module depuis `matchFloodGeometryToOsmWaterway` avant de retomber sur l'heuristique actuelle.

**Tech Stack:** TypeScript strict, `@turf/turf` (distance), aucune nouvelle dépendance.

---

## File Map

| Fichier | Action | Responsabilité |
|---------|--------|----------------|
| `src/services/osm-waterway-graph.ts` | **Créer** | Types OSM graph, buildOsmWayGraph, nearestOsmWayNode, dijkstraOsmPath, reconstructOsmLineString |
| `src/services/flood-geometry.ts` | **Modifier** | Import nouveau module, remplacer pipeline dans `matchFloodGeometryToOsmWaterway` (garder heuristique en fallback interne) |

---

## Task 1 — Créer `osm-waterway-graph.ts` : types + buildOsmWayGraph

**Files:**
- Create: `src/services/osm-waterway-graph.ts`

- [ ] **Step 1 : Créer le fichier avec les types et `buildOsmWayGraph`**

```typescript
import { distance } from '@turf/turf';
import type { Feature, LineString } from 'geojson';

// ─── Types ───────────────────────────────────────────────────────────────────

type Coordinate = [number, number];

export interface OsmWaterwayProperties {
  id?: number | string;
  name?: string;
  waterway?: string;
}

type OsmWaterwayFeature = Feature<LineString, OsmWaterwayProperties>;

export interface OsmEdge {
  startNodeKey: string;
  endNodeKey: string;
  wayId: string | number;
  coordinates: Coordinate[]; // tous les points du way
  weightKm: number;
}

export interface OsmDirectedEdge {
  edge: OsmEdge;
  fromNodeKey: string;
  toNodeKey: string;
  reversed: boolean;
}

export interface OsmWayNode {
  key: string;
  coord: Coordinate;
}

export interface OsmWayGraph {
  adjacency: Map<string, OsmDirectedEdge[]>;
  nodeCoords: Map<string, Coordinate>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nodeKey(lng: number, lat: number): string {
  const roundedLng = Math.round(lng * 1e6) / 1e6;
  const roundedLat = Math.round(lat * 1e6) / 1e6;
  return `${roundedLng},${roundedLat}`;
}

function wayLengthKm(coords: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += distance(
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coords[i - 1] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coords[i] } },
      { units: 'kilometers' },
    );
  }
  return total;
}

// ─── Graph builder ───────────────────────────────────────────────────────────

/**
 * Construit un graphe de ways OSM où :
 *   - nœud  = endpoint d'un way (clé = coordonnée arrondie à 6 décimales)
 *   - arête = way entier (connectivité via endpoints partagés)
 */
export function buildOsmWayGraph(features: OsmWaterwayFeature[]): OsmWayGraph {
  const adjacency = new Map<string, OsmDirectedEdge[]>();
  const nodeCoords = new Map<string, Coordinate>();

  for (const feature of features) {
    const coords = feature.geometry.coordinates as Coordinate[];
    if (coords.length < 2) continue;

    const [startLng, startLat] = coords[0];
    const [endLng, endLat] = coords[coords.length - 1];
    const startKey = nodeKey(startLng, startLat);
    const endKey = nodeKey(endLng, endLat);

    // Les deux endpoints sont identiques → way fermé (lac, étang) : ignorer
    if (startKey === endKey) continue;

    nodeCoords.set(startKey, coords[0]);
    nodeCoords.set(endKey, coords[coords.length - 1]);

    const wayId = feature.id ?? feature.properties?.id ?? crypto.randomUUID();
    const edge: OsmEdge = {
      startNodeKey: startKey,
      endNodeKey: endKey,
      wayId,
      coordinates: coords,
      weightKm: wayLengthKm(coords),
    };

    const forward: OsmDirectedEdge = { edge, fromNodeKey: startKey, toNodeKey: endKey, reversed: false };
    const backward: OsmDirectedEdge = { edge, fromNodeKey: endKey, toNodeKey: startKey, reversed: true };

    adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), forward]);
    adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), backward]);
  }

  return { adjacency, nodeCoords };
}
```

- [ ] **Step 2 : Vérifier la compilation partielle**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npx tsc --noEmit --skipLibCheck 2>&1 | grep "osm-waterway-graph" | head -20
```

Expected : aucune erreur sur ce fichier (autres erreurs éventuelles dans le reste du projet sont OK à ce stade).

---

## Task 2 — Ajouter `nearestOsmWayNode` et `dijkstraOsmPath`

**Files:**
- Modify: `src/services/osm-waterway-graph.ts`

- [ ] **Step 1 : Ajouter `nearestOsmWayNode` à la suite du fichier**

```typescript
/**
 * Trouve l'endpoint de way OSM le plus proche d'une coordonnée cible.
 * Cherche parmi tous les endpoints de tous les ways passés.
 */
export function nearestOsmWayNode(
  target: Coordinate,
  features: OsmWaterwayFeature[],
): OsmWayNode | null {
  let best: OsmWayNode | null = null;
  let bestDist = Infinity;

  const targetPt = { type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: target } };

  for (const feature of features) {
    const coords = feature.geometry.coordinates as Coordinate[];
    if (coords.length < 2) continue;

    for (const coord of [coords[0], coords[coords.length - 1]]) {
      const [lng, lat] = coord;
      const key = nodeKey(lng, lat);
      const d = distance(targetPt, { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coord } }, { units: 'kilometers' });
      if (d < bestDist) {
        bestDist = d;
        best = { key, coord: coord as Coordinate };
      }
    }
  }

  return best;
}
```

- [ ] **Step 2 : Ajouter `dijkstraOsmPath` à la suite du fichier**

```typescript
/**
 * Dijkstra sur le graphe OSM.
 * Retourne la liste d'arêtes ordonnées du chemin start→end, ou null si aucun chemin.
 *
 * Identique en structure au dijkstraPath Topage existant dans flood-geometry.ts,
 * adapté aux clés de nœuds OSM.
 */
export function dijkstraOsmPath(
  graph: OsmWayGraph,
  startKey: string,
  endKey: string,
): OsmDirectedEdge[] | null {
  if (startKey === endKey) return [];

  const { adjacency } = graph;
  const queue = new Set<string>([startKey]);
  const distances = new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, OsmDirectedEdge>();

  while (queue.size > 0) {
    // Nœud avec la distance minimale dans la queue
    let currentKey: string | null = null;
    let currentDist = Infinity;
    for (const key of queue) {
      const d = distances.get(key) ?? Infinity;
      if (d < currentDist) {
        currentDist = d;
        currentKey = key;
      }
    }

    if (currentKey == null) break;
    if (currentKey === endKey) break;

    queue.delete(currentKey);

    for (const directedEdge of adjacency.get(currentKey) ?? []) {
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

  const path: OsmDirectedEdge[] = [];
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
```

- [ ] **Step 3 : Vérifier la compilation partielle**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npx tsc --noEmit --skipLibCheck 2>&1 | grep "osm-waterway-graph" | head -20
```

Expected : toujours aucune erreur sur ce fichier.

---

## Task 3 — Ajouter `reconstructOsmLineString` et finaliser le module

**Files:**
- Modify: `src/services/osm-waterway-graph.ts`

- [ ] **Step 1 : Ajouter `reconstructOsmLineString` à la suite du fichier**

```typescript
/**
 * Reconstruit un LineString continu à partir d'un chemin de directed edges OSM.
 * Oriente chaque way dans le bon sens et évite les doublons aux jonctions.
 */
export function reconstructOsmLineString(
  startNode: OsmWayNode,
  path: OsmDirectedEdge[],
  endNode: OsmWayNode,
): Coordinate[] {
  if (path.length === 0) return [];

  const result: Coordinate[] = [];

  const appendCoords = (coords: Coordinate[]) => {
    if (coords.length === 0) return;
    if (result.length === 0) {
      result.push(...coords);
      return;
    }
    const [lastLng, lastLat] = result[result.length - 1];
    const [nextLng, nextLat] = coords[0];
    // Dédupliquer le nœud de jonction partagé
    if (lastLng === nextLng && lastLat === nextLat) {
      result.push(...coords.slice(1));
    } else {
      result.push(...coords);
    }
  };

  for (const directedEdge of path) {
    const coords = directedEdge.reversed
      ? ([...directedEdge.edge.coordinates].reverse() as Coordinate[])
      : (directedEdge.edge.coordinates as Coordinate[]);
    appendCoords(coords);
  }

  return result.length >= 2 ? result : [];
}

/**
 * Calcule la longueur totale d'un chemin OSM en km.
 * Utile pour les logs de debug.
 */
export function osmPathLengthKm(path: OsmDirectedEdge[]): number {
  return path.reduce((sum, e) => sum + e.edge.weightKm, 0);
}
```

- [ ] **Step 2 : Vérifier la compilation complète du module**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npx tsc --noEmit --skipLibCheck 2>&1 | grep "osm-waterway-graph" | head -20
```

Expected : aucune erreur.

---

## Task 4 — Modifier `flood-geometry.ts` : brancher le graphe OSM

**Files:**
- Modify: `src/services/flood-geometry.ts`

- [ ] **Step 1 : Ajouter l'import du nouveau module en tête de fichier**

Ajouter après la ligne `import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';` :

```typescript
import {
  buildOsmWayGraph,
  dijkstraOsmPath,
  nearestOsmWayNode,
  osmPathLengthKm,
  reconstructOsmLineString,
} from './osm-waterway-graph.ts';
```

- [ ] **Step 2 : Remplacer le corps de `matchFloodGeometryToOsmWaterway`**

Localiser la fonction `matchFloodGeometryToOsmWaterway` (ligne ~378) et remplacer entièrement son corps par :

```typescript
async function matchFloodGeometryToOsmWaterway(
  rawGeometry: FloodGeometry,
  segmentLabel: string,
): Promise<FloodGeometryResolution | null> {
  const rawCoords = flattenCoordinates(rawGeometry);
  if (rawCoords.length < 2) return null;

  const bbox = expandBBox(computeGeometryBBox(rawGeometry), 0.08);
  const bboxStr = bboxKey(bbox);
  const features = await fetchOsmWaterwayFeaturesForBBox(bbox);

  console.debug(`[OSM graph] "${segmentLabel}" — ${features.length} ways récupérés, bbox ${bboxStr}`);

  if (features.length === 0) return null;

  // ── Graphe topologique ────────────────────────────────────────────────────
  const graph = buildOsmWayGraph(features);
  const nodeCount = graph.nodeCoords.size;
  const edgeCount = [...graph.adjacency.values()].reduce((n, edges) => n + edges.length, 0) / 2;
  console.debug(`[OSM graph] "${segmentLabel}" — ${nodeCount} nœuds, ${edgeCount} arêtes construits`);

  const endpoints = getGeometryEndpoints(rawGeometry);

  if (endpoints && nodeCount >= 2) {
    const startNode = nearestOsmWayNode(endpoints.start, features);
    const endNode = nearestOsmWayNode(endpoints.end, features);

    if (startNode && endNode && startNode.key !== endNode.key) {
      const startDistKm = distance(
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: endpoints.start } },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: startNode.coord } },
        { units: 'kilometers' },
      );
      const endDistKm = distance(
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: endpoints.end } },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: endNode.coord } },
        { units: 'kilometers' },
      );
      console.debug(
        `[OSM graph] "${segmentLabel}" — start=${startNode.key} end=${endNode.key}` +
        ` (dist: ${startDistKm.toFixed(2)} km / ${endDistKm.toFixed(2)} km)`,
      );

      const path = dijkstraOsmPath(graph, startNode.key, endNode.key);

      if (path != null && path.length > 0) {
        const pathCoords = reconstructOsmLineString(startNode, path, endNode);

        if (pathCoords.length >= 2) {
          const lengthKm = osmPathLengthKm(path);
          console.info(
            `[OSM graph] "${segmentLabel}" — chemin trouvé: ${path.length} arêtes, ${lengthKm.toFixed(1)} km`,
          );

          // Score de confiance : pénalise la distance de projection aux endpoints
          const confidence = clamp(
            0.82 - Math.min(0.18, startDistKm * 0.06) - Math.min(0.18, endDistKm * 0.06),
            0.45,
            0.93,
          );

          return {
            displayGeometry: { type: 'LineString', coordinates: pathCoords },
            geometryFidelity: 'fallback',
            matchConfidence: confidence,
          };
        }
      } else {
        console.debug(`[OSM graph] "${segmentLabel}" — Dijkstra sans chemin → fallback heuristique`);
      }
    }
  }

  // ── Fallback heuristique (ancien comportement) ────────────────────────────
  const scored = features
    .map((feature) => {
      const distanceKm = minRawPointDistanceKmToOsm(rawCoords, feature);
      const nameScore = computeOsmNameScore(segmentLabel, feature);
      const geom = feature.geometry.coordinates as Coordinate[];
      const endptsVigicrues = getGeometryEndpoints(rawGeometry);
      const startGap = endptsVigicrues
        ? distance(
            { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: endptsVigicrues.start } },
            { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: geom[0] } },
            { units: 'kilometers' },
          )
        : 0;
      const endGap = endptsVigicrues
        ? distance(
            { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: endptsVigicrues.end } },
            { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: geom[geom.length - 1] } },
            { units: 'kilometers' },
          )
        : 0;
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
```

Note : Ce step remplace la fonction entière. `mergeOsmWaterwayFeatures`, `computeOsmNameScore`, `computeOsmFeatureLocation` et `minRawPointDistanceKmToOsm` restent dans le fichier — ils sont encore utilisés par le fallback heuristique ci-dessus.

- [ ] **Step 3 : Vérifier que l'import `distance` de `@turf/turf` est déjà présent dans le fichier**

La ligne 1 de `flood-geometry.ts` importe déjà `distance` depuis `@turf/turf`. Aucun ajout nécessaire.

---

## Task 5 — Typecheck final et commit

**Files:**
- No new files

- [ ] **Step 1 : Lancer `npm run typecheck`**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1
```

Expected : `0 errors`. Si erreurs, les corriger avant de continuer.

- [ ] **Step 2 : Lancer `npm run build`**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run build 2>&1 | tail -20
```

Expected : build réussi, aucune erreur TypeScript.

- [ ] **Step 3 : Commit**

```bash
cd /Users/fraid/Desktop/FranceMonitor && git add src/services/osm-waterway-graph.ts src/services/flood-geometry.ts && git commit -m "feat(flood): remplacer heuristique OSM par graphe topologique + Dijkstra

- nouveau module osm-waterway-graph.ts : buildOsmWayGraph, nearestOsmWayNode,
  dijkstraOsmPath, reconstructOsmLineString, osmPathLengthKm
- nœud = endpoint de way OSM (clé coordonnée arrondie 6 décimales)
- arête = way entier, connectivité via endpoints partagés
- Dijkstra produit un tronçon continu et topologiquement correct
- fallback heuristique conservé si Dijkstra ne trouve pas de chemin
- logs de debug [OSM graph] sur ways/nœuds/arêtes/chemin/fallback

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Résumé des changements attendus

| Périmètre | Détail |
|-----------|--------|
| **Nouveau** `osm-waterway-graph.ts` | Types (`OsmEdge`, `OsmDirectedEdge`, `OsmWayNode`, `OsmWayGraph`) + 5 fonctions exportées. Aucune dépendance externe nouvelle. |
| **Modifié** `flood-geometry.ts` | Import du nouveau module + remplacement du corps de `matchFloodGeometryToOsmWaterway`. Toutes les autres fonctions inchangées. |
| **Fallback heuristique** | Encore utilisé : si Dijkstra ne trouve pas de chemin OSM, on tombe sur `mergeOsmWaterwayFeatures` + scoring nom/distance. Si même ça échoue → null → géométrie brute Vigicrues. |
| **Topage** | Inchangé, prioritaire dans tous les cas. |
