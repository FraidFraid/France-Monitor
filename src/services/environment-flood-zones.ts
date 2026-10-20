// src/services/environment-flood-zones.ts : zones inondables officielles (Directive inondation, TRI, Géorisques) d'une boîte, lues par
// /api/environment/flood-zones. Cache mémoire de session par boîte arrondie (0,05°), jamais de rejet : null et journal en cas d'échec.
import type { FloodZone, FloodZoneScenario, FloodZonesResponse } from '../types/index.ts';
import { isRecord, isStringArray } from './health-surveillance.ts';

export const FLOOD_ZONES_URL = '/api/environment/flood-zones';
const SCENARIOS: ReadonlySet<string> = new Set(['frequent', 'moyen', 'extreme']);
const STEP = 0.05;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPoint = (p: unknown): boolean => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
const isZone = (v: unknown): v is FloodZone => isRecord(v) && typeof v.id === 'string' && typeof v.scenario === 'string' && SCENARIOS.has(v.scenario)
  && Array.isArray(v.ring) && v.ring.length >= 4 && v.ring.every(isPoint);

export function isFloodZonesResponse(v: unknown): v is FloodZonesResponse {
  if (!isRecord(v)) return false;
  if (!(v.readAt === null || typeof v.readAt === 'string') || typeof v.covered !== 'boolean' || !isStringArray(v.errors)) return false;
  if (!Array.isArray(v.bbox) || v.bbox.length !== 4 || !v.bbox.every(isNum)) return false;
  return Array.isArray(v.zones) && v.zones.every(isZone);
}

/** Boîte élargie à la grille de 0,05° (même règle que le serveur) : clé de cache de session et zone demandée. */
export function roundFloodBbox(bbox: readonly [number, number, number, number]): [number, number, number, number] {
  const r = (v: number): number => Math.round(v * 10_000) / 10_000;
  const lo = (v: number): number => r(Math.floor(v / STEP + 1e-9) * STEP);
  const hi = (v: number): number => r(Math.ceil(v / STEP - 1e-9) * STEP);
  return [lo(bbox[0]), lo(bbox[1]), hi(bbox[2]), hi(bbox[3])];
}

const cache = new Map<string, FloodZonesResponse>();
const pending = new Map<string, Promise<FloodZonesResponse | null>>();

/** Vide le cache de session (tests). */
export function resetFloodZonesCache(): void {
  cache.clear();
  pending.clear();
}

/**
 * Zones inondables de la boîte `[minLon, minLat, maxLon, maxLat]`, scénarios `scenarios` (tous si omis) ; null si la lecture échoue
 * (journalisé, jamais de rejet).
 */
export async function fetchFloodZones(bbox: readonly [number, number, number, number], scenarios?: readonly FloodZoneScenario[]): Promise<FloodZonesResponse | null> {
  const rounded = roundFloodBbox(bbox);
  const key = rounded.join(',') + (scenarios ? `&scenarios=${scenarios.join(',')}` : '');
  const hit = cache.get(key);
  if (hit) return hit;
  const running = pending.get(key);
  if (running) return running;
  const job = (async (): Promise<FloodZonesResponse | null> => {
    try {
      const resp = await fetch(`${FLOOD_ZONES_URL}?bbox=${key}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body: unknown = await resp.json();
      if (!isFloodZonesResponse(body)) throw new Error('réponse inattendue');
      if (body.readAt !== null) cache.set(key, body);
      return body;
    } catch (err) {
      console.warn('[zones inondables]', err instanceof Error ? err.message : err);
      return null;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}
