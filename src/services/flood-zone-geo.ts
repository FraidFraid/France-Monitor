// src/services/flood-zone-geo.ts : géométrie pure des zones inondables officielles (Géorisques) : appartenance d'un point et zones
// proches d'un tronçon de rivière. Aucune lecture réseau.
import type { FloodZone, FloodZoneScenario } from '../types/index.ts';

const KM_PER_DEG = 111.32;

/** Point dans un anneau (lancer de rayon, anneau fermé ou non). */
function inRing(lon: number, lat: number, ring: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Zones, parmi `scenarios` (tous si omis), qui contiennent le point `[lon, lat]`. Liste vide : hors de toute zone cartographiée,
 * ce qui ne dit rien hors d'un TRI (voir `FloodZonesResponse.covered`).
 */
export function pointInZones(lon: number, lat: number, zones: readonly FloodZone[], scenarios?: readonly FloodZoneScenario[]): FloodZone[] {
  return zones.filter((z) => (!scenarios || scenarios.includes(z.scenario)) && inRing(lon, lat, z.ring));
}

/** Distance en km d'un point au segment [a, b] (projection plane locale, suffisante à l'échelle d'un tronçon). */
function segmentKm(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180)) * KM_PER_DEG;
  const ax = a[0] * k; const ay = a[1] * KM_PER_DEG;
  const dx = b[0] * k - ax; const dy = b[1] * KM_PER_DEG - ay;
  const px = p[0] * k - ax; const py = p[1] * KM_PER_DEG - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len));
  return Math.hypot(px - t * dx, py - t * dy);
}

/**
 * Zones dont un sommet de l'anneau est à `maxKm` au plus du tracé `[lon, lat]` d'un tronçon de rivière (segments compris). Les
 * segments sont rangés dans une grille dont la maille couvre `maxKm` : chaque sommet ne mesure que les segments des 9 mailles voisines.
 */
export function zonesNearLine(zones: readonly FloodZone[], line: ReadonlyArray<readonly [number, number]>, maxKm: number): FloodZone[] {
  if (line.length === 0) return [];
  const midLat = line[0][1];
  const cellLat = Math.max(maxKm / KM_PER_DEG, 1e-4);
  const cellLon = Math.max(maxKm / (KM_PER_DEG * Math.max(0.2, Math.cos(midLat * (Math.PI / 180)))), 1e-4);
  const key = (i: number, j: number): string => `${i},${j}`;
  const grid = new Map<string, number[]>();
  const segs: Array<[readonly [number, number], readonly [number, number]]> = line.length === 1
    ? [[line[0], line[0]]] : line.slice(1).map((q, i) => [line[i], q]);
  segs.forEach(([a, b], n) => {
    const i0 = Math.floor(Math.min(a[0], b[0]) / cellLon); const i1 = Math.floor(Math.max(a[0], b[0]) / cellLon);
    const j0 = Math.floor(Math.min(a[1], b[1]) / cellLat); const j1 = Math.floor(Math.max(a[1], b[1]) / cellLat);
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const list = grid.get(key(i, j));
        if (list) list.push(n);
        else grid.set(key(i, j), [n]);
      }
    }
  });
  const near = (p: readonly [number, number]): boolean => {
    const i = Math.floor(p[0] / cellLon); const j = Math.floor(p[1] / cellLat);
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        for (const n of grid.get(key(i + di, j + dj)) ?? []) if (segmentKm(p, segs[n][0], segs[n][1]) <= maxKm) return true;
      }
    }
    return false;
  };
  return zones.filter((z) => z.ring.some(near));
}

/**
 * Côté des cases demandées le long d'un tronçon (°), la maille du serveur : à Nîmes, une case de 0,1° dépasse déjà le plafond de 300
 * polygones par scénario (sous-ensemble arbitraire) ; 0,05° le tient dans les vallées denses.
 */
export const FLOOD_CELL_DEG = 0.05;
/** Scénarios retenus pour l'exposition : crue fréquente et moyenne (la crue extrême déborde trop largement pour décider). */
export const EXPOSURE_SCENARIOS: readonly FloodZoneScenario[] = ['frequent', 'moyen'];
/** Distance maximale entre un sommet de zone et le tracé du tronçon pour rattacher la zone à ce tronçon (km). */
export const SECTION_ZONE_KM = 1;

/** Cases de `FLOOD_CELL_DEG` traversées par les tracés (échantillonnés tous les 0,02°), au plus `maxCells`, en ordre stable. */
export function floodCells(lines: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, maxCells: number): Array<[number, number, number, number]> {
  const keys = new Set<string>();
  const add = (lon: number, lat: number): void => { keys.add(`${Math.floor(lon / FLOOD_CELL_DEG)},${Math.floor(lat / FLOOD_CELL_DEG)}`); };
  for (const line of lines) {
    line.forEach((p, i) => {
      add(p[0], p[1]);
      const q = line[i + 1];
      if (!q) return;
      const steps = Math.ceil(Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) / 0.02);
      for (let k = 1; k < steps; k += 1) add(p[0] + ((q[0] - p[0]) * k) / steps, p[1] + ((q[1] - p[1]) * k) / steps);
    });
  }
  const r = (v: number): number => Math.round(v * 10_000) / 10_000;
  return [...keys].slice(0, maxCells).map((k) => {
    const [i, j] = k.split(',').map(Number);
    return [r(i * FLOOD_CELL_DEG), r(j * FLOOD_CELL_DEG), r((i + 1) * FLOOD_CELL_DEG), r((j + 1) * FLOOD_CELL_DEG)];
  });
}

/** Zones d'exposition d'un tronçon : scénarios retenus, rattachées au tracé, sans doublon (une zone peut chevaucher deux cases). */
export function sectionFloodZones(zones: readonly FloodZone[], lines: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): FloodZone[] {
  const kept = new Map<string, FloodZone>();
  const candidates = zones.filter((z) => EXPOSURE_SCENARIOS.includes(z.scenario));
  for (const line of lines) for (const z of zonesNearLine(candidates, line, SECTION_ZONE_KM)) kept.set(z.id, z);
  return [...kept.values()];
}
