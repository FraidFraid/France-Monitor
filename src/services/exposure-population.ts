// src/services/exposure-population.ts : population des communes touchées par un phénomène de l'onglet Environnement (20/10/2026).
// Communes INSEE avec leur centre (public/data/communes.json, scripts/build-communes.mjs). Une commune est « touchée » quand son
// centre est dans la zone du phénomène : département en vigilance, rayon d'un feu ou d'un séisme, zone Copernicus, zone inondable
// cartographiée (Géorisques) à moins de 1,5 km, à défaut à moins de 3 km du tronçon en crue. Ce sont les habitants des communes
// touchées, jamais un nombre de personnes sinistrées : le panneau le dit.
import { distanceKm, pointInRing, pointLineKm, type Hazard } from './environment-exposure.ts';
import { readHealthJsonShared } from './health-surveillance.ts';

export const COMMUNES_URL = '/data/communes.json';

/** Commune : code INSEE, nom, département, population légale (null si inconnue), centre. */
export interface Commune { code: string; name: string; dept: string; pop: number | null; lon: number; lat: number }

export interface HazardPopulation {
  /** Communes touchées, les plus peuplées d'abord. */
  communes: Commune[];
  total: number;
  /** Comment la zone a été tracée (dit dans le panneau). */
  method: 'departement' | 'rayon' | 'zone-inondable' | 'troncon' | 'zone-copernicus';
}

/** Distance d'une commune riveraine à une zone inondable cartographiée, et à défaut au tronçon en crue (km). */
export const NEAR_FLOOD_ZONE_KM = 1.5;
export const NEAR_SECTION_KM = 3;

export function parseCommunes(json: unknown): Commune[] {
  const rows = typeof json === 'object' && json !== null && Array.isArray((json as { communes?: unknown }).communes)
    ? (json as { communes: unknown[] }).communes : null;
  if (!rows) throw new Error('réponse inattendue');
  const out: Commune[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const [code, name, dept, pop, lon, lat] = r as [unknown, unknown, unknown, unknown, unknown, unknown];
    if (typeof code !== 'string' || typeof name !== 'string' || typeof dept !== 'string' || typeof lon !== 'number' || typeof lat !== 'number') continue;
    out.push({ code, name, dept, pop: typeof pop === 'number' && Number.isFinite(pop) ? pop : null, lon, lat });
  }
  return out;
}

let communesCache: Commune[] | null = null;

/** Lecture unique par session (relue après un échec) ; null si le fichier est illisible. */
export async function fetchCommunes(): Promise<Commune[] | null> {
  if (communesCache) return communesCache;
  try {
    communesCache = parseCommunes(await readHealthJsonShared(COMMUNES_URL));
    return communesCache;
  } catch {
    return null;
  }
}

/** Plus courte distance d'un point aux contours (0 dedans). */
function distanceToRings(lon: number, lat: number, rings: ReadonlyArray<ReadonlyArray<[number, number]>>): number {
  let best = Infinity;
  for (const ring of rings) {
    if (pointInRing(lon, lat, ring)) return 0;
    best = Math.min(best, pointLineKm(lon, lat, ring));
  }
  return best;
}

function result(list: Commune[], method: HazardPopulation['method']): HazardPopulation {
  const communes = [...list].sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0));
  return { communes, total: communes.reduce((s, c) => s + (c.pop ?? 0), 0), method };
}

/**
 * Communes touchées par un phénomène. `floodZones` : contours des zones inondables cartographiées rattachées à ce tronçon (crue) ;
 * absents ou vides : distance au tronçon.
 */
export function hazardPopulation(h: Hazard, communes: readonly Commune[], floodZones?: ReadonlyArray<ReadonlyArray<[number, number]>>): HazardPopulation {
  if (h.depts.length > 0) {
    const depts = new Set(h.depts);
    return result(communes.filter((c) => depts.has(c.dept)), 'departement');
  }
  if (h.rings.length > 0) return result(communes.filter((c) => distanceToRings(c.lon, c.lat, h.rings) === 0), 'zone-copernicus');
  if (h.circles.length > 0) {
    return result(communes.filter((c) => h.circles.some((k) => distanceKm(c.lon, c.lat, k.lon, k.lat) <= k.radiusKm)), 'rayon');
  }
  if (h.lines.length > 0) {
    // Boîte de présélection (0,1° ≈ 8 à 11 km) : on ne mesure la distance que pour les communes proches du tracé.
    const pts = h.lines.flat();
    const w = Math.min(...pts.map((p) => p[0])) - 0.1;
    const e = Math.max(...pts.map((p) => p[0])) + 0.1;
    const s = Math.min(...pts.map((p) => p[1])) - 0.1;
    const n = Math.max(...pts.map((p) => p[1])) + 0.1;
    const near = communes.filter((c) => c.lon >= w && c.lon <= e && c.lat >= s && c.lat <= n);
    if (floodZones && floodZones.length > 0) {
      // Boîte de chaque zone élargie de 1,5 km (≈ 0,02°) : seules les zones voisines d'une commune sont mesurées.
      const pad = 0.02;
      const boxes = floodZones.map((ring) => {
        let w = Infinity; let s2 = Infinity; let e2 = -Infinity; let n2 = -Infinity;
        for (const [x, y] of ring) { w = Math.min(w, x); e2 = Math.max(e2, x); s2 = Math.min(s2, y); n2 = Math.max(n2, y); }
        return { ring, w: w - pad, s: s2 - pad, e: e2 + pad, n: n2 + pad };
      });
      return result(near.filter((c) => {
        const rings = boxes.filter((b) => c.lon >= b.w && c.lon <= b.e && c.lat >= b.s && c.lat <= b.n).map((b) => b.ring);
        return rings.length > 0 && distanceToRings(c.lon, c.lat, rings) <= NEAR_FLOOD_ZONE_KM;
      }), 'zone-inondable');
    }
    return result(near.filter((c) => h.lines.some((l) => pointLineKm(c.lon, c.lat, l) <= NEAR_SECTION_KM)), 'troncon');
  }
  return result([], 'rayon');
}

/** « 12 communes, 85 000 habitants (Nîmes, Alès…) » ; « aucune commune » ; jamais un nombre de sinistrés. */
export function populationText(p: HazardPopulation, fmt: (n: number) => string): string {
  if (p.communes.length === 0) return 'aucune commune touchée';
  const names = p.communes.slice(0, 2).map((c) => c.name).join(', ');
  const n = p.communes.length;
  return `${n > 1 ? `${fmt(n)}\u00a0communes` : '1\u00a0commune'}, ${fmt(p.total)}\u00a0habitants (${names}${n > 2 ? '…' : ''})`;
}
