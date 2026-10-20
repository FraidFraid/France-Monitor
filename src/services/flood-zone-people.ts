// src/services/flood-zone-people.ts : habitants DANS les zones inondables cartographiées d'un tronçon en crue (20/10/2026). Carreaux
// de 200 m de l'Insee (Filosofi 2019, public/data/carreaux/<dept>.json, scripts/build-carreaux.mjs) : un carreau compte quand son
// centre est dans une zone (crue fréquente ou moyenne). Estimation de résidents, jamais un nombre de sinistrés : le panneau le dit.
import { pointInRing } from './environment-exposure.ts';
import { readHealthJsonShared } from './health-surveillance.ts';

export const CARREAUX_YEAR = 2019;
const carreauxUrl = (dept: string): string => `/data/carreaux/${dept}.json`;

/** Carreaux d'un département, en colonnes : centre (degrés), habitants, 80 ans et plus, commune (indice dans `communes`). */
export interface DeptCarreaux {
  dept: string;
  communes: string[];
  lon: Float64Array;
  lat: Float64Array;
  ind: Float64Array;
  a80: Float64Array;
  commune: Int32Array;
  /** Carreaux par case de 0,01° (« x:y ») : seules les cases d'une zone sont parcourues. */
  grid: Map<string, number[]>;
}

export interface ZonePeople {
  total: number;
  over80: number;
  /** Habitants en zone par commune (code INSEE), les plus nombreux d'abord. */
  communes: Array<{ code: string; people: number }>;
}

const GRID_DEG = 0.01;
const cellKey = (lon: number, lat: number): string => `${Math.floor(lon / GRID_DEG)}:${Math.floor(lat / GRID_DEG)}`;

export function parseCarreaux(dept: string, json: unknown): DeptCarreaux {
  const o = typeof json === 'object' && json !== null ? json as Record<string, unknown> : null;
  const { scale, lon0, lat0, communes, cells } = o ?? {};
  if (typeof scale !== 'number' || typeof lon0 !== 'number' || typeof lat0 !== 'number' || !Array.isArray(communes) || !Array.isArray(cells)) {
    throw new Error('réponse inattendue');
  }
  const n = cells.length;
  const out: DeptCarreaux = {
    dept, communes: communes.filter((c): c is string => typeof c === 'string'),
    lon: new Float64Array(n), lat: new Float64Array(n), ind: new Float64Array(n), a80: new Float64Array(n), commune: new Int32Array(n),
    grid: new Map(),
  };
  for (let i = 0; i < n; i += 1) {
    const c: unknown = cells[i];
    if (!Array.isArray(c) || c.length < 5 || !c.every((v) => typeof v === 'number')) continue;
    const [dlon, dlat, ind, a80, ci] = c as number[];
    const lon = (lon0 + dlon) / scale;
    const lat = (lat0 + dlat) / scale;
    out.lon[i] = lon; out.lat[i] = lat; out.ind[i] = ind; out.a80[i] = a80 / 10; out.commune[i] = ci;
    const key = cellKey(lon, lat);
    const bucket = out.grid.get(key);
    if (bucket) bucket.push(i); else out.grid.set(key, [i]);
  }
  return out;
}

const cache = new Map<string, DeptCarreaux>();

/** Carreaux d'un département, lus une fois par session (relus après un échec) ; null si illisibles ou absents (DROM non carroyés). */
export async function fetchCarreaux(dept: string): Promise<DeptCarreaux | null> {
  const hit = cache.get(dept);
  if (hit) return hit;
  try {
    const parsed = parseCarreaux(dept, await readHealthJsonShared(carreauxUrl(dept)));
    cache.set(dept, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** Département déjà lu (sans réseau). */
export function cachedCarreaux(dept: string): DeptCarreaux | undefined {
  return cache.get(dept);
}

/** Habitants dont le carreau a son centre dans une des zones ; un carreau compte une fois même sous plusieurs zones. */
export function zonePeople(zones: ReadonlyArray<ReadonlyArray<[number, number]>>, depts: readonly DeptCarreaux[]): ZonePeople {
  let total = 0;
  let over80 = 0;
  const byCommune = new Map<string, number>();
  for (const d of depts) {
    const counted = new Uint8Array(d.lon.length);
    for (const ring of zones) {
      let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
      for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
      for (let gx = Math.floor(w / GRID_DEG); gx <= Math.floor(e / GRID_DEG); gx += 1) {
        for (let gy = Math.floor(s / GRID_DEG); gy <= Math.floor(n / GRID_DEG); gy += 1) {
          for (const i of d.grid.get(`${gx}:${gy}`) ?? []) {
            if (counted[i] === 1) continue;
            const lon = d.lon[i] ?? 0;
            const lat = d.lat[i] ?? 0;
            if (lon < w || lon > e || lat < s || lat > n || !pointInRing(lon, lat, ring)) continue;
            counted[i] = 1;
            const ind = d.ind[i] ?? 0;
            total += ind;
            over80 += d.a80[i] ?? 0;
            const code = d.communes[d.commune[i] ?? -1];
            if (code) byCommune.set(code, (byCommune.get(code) ?? 0) + ind);
          }
        }
      }
    }
  }
  const communes = [...byCommune].map(([code, people]) => ({ code, people })).sort((a, b) => b.people - a.people);
  return { total, over80, communes };
}

/** Arrondi d'une estimation : à la dizaine sous 1 000, à la centaine au-delà (jamais un faux chiffre à l'unité). */
export function roundPeople(n: number): number {
  return n < 1000 ? Math.round(n / 10) * 10 : Math.round(n / 100) * 100;
}
