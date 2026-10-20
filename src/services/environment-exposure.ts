// src/services/environment-exposure.ts : enjeux exposés aux phénomènes de l'onglet Environnement (spec 2026-10-20 § 3, lot 2).
// Pur, sans réseau ni DOM. Croise les zones de phénomène actives (vigilance orange ou rouge, tronçons Vigicrues, foyers de feu,
// séismes, zones Copernicus EMS) avec les enjeux (centrales nucléaires, sites Seveso, hôpitaux avec urgences, EHPAD).
// Deux sorties : les enjeux proches d'un phénomène localisé, nommés un par un avec leur distance ; et, pour une vigilance
// départementale, un compte par type d'enjeu dans le département (lister tous les hôpitaux d'un département n'aide pas à décider).
// L'exposition est une information d'appui : elle n'entre pas dans le score.
import type {
  EarthquakesResponse, EmsResponse, FiresResponse, FloodsResponse, VigilanceDepartment, VigilancePhenomenonId, VigilanceResponse,
} from '../types/index.ts';
import { LEVEL_RANK, type VigilanceLevel } from './vigilance.ts';
import { OFFICIAL_COLOR_LEVEL, PHENOMENON_WORD, foyerLevel } from './environment-levels.ts';

/** Types d'enjeux, du plus lourd de conséquences au plus diffus (ordre d'affichage à niveau égal). */
export type ExposureAssetKind = 'nucleaire' | 'seveso-haut' | 'hopital' | 'seveso-bas' | 'ehpad';
export const ASSET_KIND_ORDER: readonly ExposureAssetKind[] = ['nucleaire', 'seveso-haut', 'hopital', 'seveso-bas', 'ehpad'];

export interface ExposureAsset {
  id: string;
  kind: ExposureAssetKind;
  name: string;
  commune: string | null;
  dept: string;
  lon: number;
  lat: number;
  /** Précision courte (« urgences adultes », « 120 places ») ; null sans détail. */
  detail: string | null;
  url: string | null;
}

export type HazardKind = 'vigilance' | 'crue' | 'feu' | 'seisme' | 'ems';

/** Phénomène actif et sa zone : départements entiers, cercles autour de points, tracé avec tampon, ou polygones. */
export interface Hazard {
  id: string;
  kind: HazardKind;
  label: string;
  level: VigilanceLevel;
  depts: string[];
  circles: Array<{ lon: number; lat: number; radiusKm: number }>;
  lines: Array<Array<[number, number]>>;
  bufferKm: number;
  rings: Array<Array<[number, number]>>;
  /** Types d'enjeux concernés (canicule : EHPAD et hôpitaux ; vent : pas les EHPAD). */
  kinds: readonly ExposureAssetKind[];
  /** Instant du phénomène (début, détection, origine) ; null si sans objet. */
  since: string | null;
  /**
   * Crue : contours des zones inondables cartographiées (Géorisques, crue fréquente ou moyenne) le long du tronçon. Là où elles
   * existent, l'appartenance à la zone remplace la distance au tronçon ; ailleurs, la distance reste la règle.
   */
  floodZones?: Array<Array<[number, number]>>;
}

export interface Exposure {
  asset: ExposureAsset;
  hazard: Hazard;
  /** Distance en km au phénomène (0 : dedans) ; null pour une vigilance départementale. */
  distanceKm: number | null;
  /** Crue : enjeu dans la zone inondable cartographiée (et non seulement à moins de `bufferKm` du tronçon). */
  inFloodZone?: true;
}

export interface DeptExposure {
  hazard: Hazard;
  dept: string;
  counts: Partial<Record<ExposureAssetKind, number>>;
  /** Centrales et Seveso seuil haut du département, nommés (au plus 4). */
  named: ExposureAsset[];
}

export interface ExposureResult {
  hazards: Hazard[];
  nearby: Exposure[];
  departmental: DeptExposure[];
}

const ALL_KINDS: readonly ExposureAssetKind[] = ASSET_KIND_ORDER;
/** Crue en vigilance jaune : enjeux lourds seulement (un EHPAD près d'une rivière en jaune est courant, pas un signal de décision). */
const HEAVY_KINDS: readonly ExposureAssetKind[] = ['nucleaire', 'seveso-haut', 'hopital'];
const NO_EHPAD: readonly ExposureAssetKind[] = ['nucleaire', 'seveso-haut', 'hopital', 'seveso-bas'];

/** Enjeux concernés par une vigilance départementale, selon le phénomène. Seveso seuil bas : trop nombreux à l'échelle du département. */
const VIGILANCE_KINDS: Readonly<Record<VigilancePhenomenonId, readonly ExposureAssetKind[]>> = {
  1: ['nucleaire', 'seveso-haut', 'hopital'],
  2: ['nucleaire', 'seveso-haut', 'hopital', 'ehpad'],
  3: ['nucleaire', 'seveso-haut', 'hopital'],
  4: ['nucleaire', 'seveso-haut', 'hopital', 'ehpad'],
  5: ['hopital', 'ehpad'],
  6: ['nucleaire', 'hopital', 'ehpad'],
  7: ['hopital', 'ehpad'],
  8: ['hopital'],
  9: ['nucleaire', 'seveso-haut', 'hopital', 'ehpad'],
};

/** Tampon autour d'un tronçon de crue, rayon autour d'un foyer de feu (km). */
export const FLOOD_BUFFER_KM = 2;
export const FIRE_RADIUS_KM = 5;
/** Séismes : en France, magnitude 4 et plus, 72 dernières heures ; rayon de 10 km à M4, 30 km à M5, au plus 50 km. */
export const QUAKE_MIN_MAGNITUDE = 4;
const QUAKE_WINDOW_MS = 72 * 3600_000;
export function quakeRadiusKm(magnitude: number): number {
  return Math.min(50, Math.max(10, 10 + (magnitude - 4) * 20));
}

const KM_PER_DEG_LAT = 111.32;

/** Distance approchée en km (équirectangulaire, juste à mieux que 1 % sous 100 km en France). */
export function distanceKm(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const x = (bLon - aLon) * Math.cos(((aLat + bLat) / 2) * Math.PI / 180) * KM_PER_DEG_LAT;
  const y = (bLat - aLat) * KM_PER_DEG_LAT;
  return Math.hypot(x, y);
}

/** Distance d'un point à un segment, en km (projection locale). */
function pointSegmentKm(lon: number, lat: number, a: [number, number], b: [number, number]): number {
  const k = Math.cos(lat * Math.PI / 180) * KM_PER_DEG_LAT;
  const ax = (a[0] - lon) * k; const ay = (a[1] - lat) * KM_PER_DEG_LAT;
  const bx = (b[0] - lon) * k; const by = (b[1] - lat) * KM_PER_DEG_LAT;
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Distance d'un point à une ligne brisée, en km. */
export function pointLineKm(lon: number, lat: number, line: ReadonlyArray<[number, number]>): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return distanceKm(lon, lat, line[0][0], line[0][1]);
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) best = Math.min(best, pointSegmentKm(lon, lat, line[i - 1], line[i]));
  return best;
}

/** Point dans un anneau (lancer de rayon). */
export function pointInRing(lon: number, lat: number, ring: ReadonlyArray<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function bboxOf(points: ReadonlyArray<[number, number]>, padKm: number): [number, number, number, number] {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const [x, y] of points) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const dLat = padKm / KM_PER_DEG_LAT;
  const dLon = padKm / (KM_PER_DEG_LAT * Math.max(0.2, Math.cos(((s + n) / 2) * Math.PI / 180)));
  return [w - dLon, s - dLat, e + dLon, n + dLat];
}

const inBox = (a: ExposureAsset, b: [number, number, number, number]): boolean => a.lon >= b[0] && a.lon <= b[2] && a.lat >= b[1] && a.lat <= b[3];

export interface HazardInput {
  vigilance: VigilanceResponse | null;
  floods: FloodsResponse | null;
  fires: FiresResponse | null;
  earthquakes: EarthquakesResponse | null;
  ems: EmsResponse | null;
  now: number;
}

function vigilanceHazards(v: VigilanceResponse | null): Hazard[] {
  const period = v?.periods.find((p) => p.echeance === 'J');
  if (!period) return [];
  const out: Hazard[] = [];
  const byPhenomenon = new Map<string, { level: VigilanceLevel; id: VigilancePhenomenonId; depts: VigilanceDepartment[] }>();
  for (const d of period.departments) {
    for (const ph of d.phenomena) {
      const level = OFFICIAL_COLOR_LEVEL[ph.color];
      if (LEVEL_RANK[level] < LEVEL_RANK.orange) continue;
      const key = `${ph.id}-${level}`;
      const g = byPhenomenon.get(key) ?? { level, id: ph.id, depts: [] };
      g.depts.push(d);
      byPhenomenon.set(key, g);
    }
  }
  for (const [key, g] of byPhenomenon) {
    out.push({
      id: `vigilance-${key}`, kind: 'vigilance', label: `Vigilance ${g.level} ${PHENOMENON_WORD[g.id]}`, level: g.level,
      depts: g.depts.map((d) => d.code), circles: [], lines: [], bufferKm: 0, rings: [], kinds: VIGILANCE_KINDS[g.id], since: period.begin,
    });
  }
  return out;
}

function floodHazards(f: FloodsResponse | null): Hazard[] {
  return (f?.sections ?? []).filter((s) => s.level >= 2).map((s) => ({
    id: `crue-${s.id}`, kind: 'crue' as const, label: `Crue ${OFFICIAL_COLOR_LEVEL[s.level]} · ${s.name}`, level: OFFICIAL_COLOR_LEVEL[s.level],
    depts: [], circles: [], lines: s.path, bufferKm: FLOOD_BUFFER_KM, rings: [], kinds: s.level >= 3 ? ALL_KINDS : HEAVY_KINDS, since: null,
  }));
}

function fireHazards(f: FiresResponse | null): Hazard[] {
  const out: Hazard[] = [];
  for (const foyer of f?.foyers ?? []) {
    const level = foyerLevel(foyer);
    if (level !== 'orange' && level !== 'rouge') continue;
    out.push({
      id: `feu-${foyer.id}`, kind: 'feu', label: `Feu ${level === 'rouge' ? 'majeur' : 'confirmé'}`, level,
      depts: [], circles: [{ lon: foyer.lon, lat: foyer.lat, radiusKm: FIRE_RADIUS_KM }], lines: [], bufferKm: 0, rings: [],
      kinds: ALL_KINDS, since: foyer.firstAt,
    });
  }
  return out;
}

function quakeHazards(q: EarthquakesResponse | null, now: number): Hazard[] {
  return (q?.quakes ?? [])
    .filter((x) => x.inFrance && x.magnitude >= QUAKE_MIN_MAGNITUDE && now - Date.parse(x.at) <= QUAKE_WINDOW_MS)
    .map((x) => ({
      id: `seisme-${x.id}`, kind: 'seisme' as const, label: `Séisme de magnitude ${x.magnitude.toFixed(1).replace('.', ',')}`,
      level: (x.magnitude >= 5 ? 'rouge' : 'orange') as VigilanceLevel,
      depts: [], circles: [{ lon: x.lon, lat: x.lat, radiusKm: quakeRadiusKm(x.magnitude) }], lines: [], bufferKm: 0, rings: [],
      kinds: NO_EHPAD, since: x.at,
    }));
}

function emsHazards(e: EmsResponse | null): Hazard[] {
  return (e?.active ?? []).filter((a) => a.zones.length > 0).map((a) => ({
    id: `ems-${a.code}`, kind: 'ems' as const, label: `Cartographie d’urgence ${a.code} · ${a.place}`, level: 'orange' as VigilanceLevel,
    depts: [], circles: [], lines: [], bufferKm: 0, rings: a.zones.map((z) => z.ring), kinds: ALL_KINDS, since: a.activationTime,
  }));
}

/** Phénomènes actifs, du plus grave au moins grave. */
export function buildHazards(input: HazardInput): Hazard[] {
  const all = [
    ...vigilanceHazards(input.vigilance), ...floodHazards(input.floods), ...fireHazards(input.fires),
    ...quakeHazards(input.earthquakes, input.now), ...emsHazards(input.ems),
  ];
  return all.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
}

/** Boîte englobante des zones inondables d'une crue : le territoire où l'appartenance à la zone fait foi. */
function floodZonesBox(h: Hazard): [number, number, number, number] | null {
  const pts = (h.floodZones ?? []).flat();
  return pts.length === 0 ? null : bboxOf(pts, 0);
}

/**
 * Distance d'un enjeu à la zone localisée d'un phénomène (0 dedans), Infinity hors de portée. Crue avec zones cartographiées : dans
 * la zone, distance au tronçon et `inZone` ; hors zone mais sur le territoire cartographié, hors de portée ; ailleurs, tampon.
 */
function localDistance(a: ExposureAsset, h: Hazard): { d: number; inZone: boolean } {
  let best = Infinity;
  for (const c of h.circles) {
    const d = distanceKm(a.lon, a.lat, c.lon, c.lat);
    if (d <= c.radiusKm) best = Math.min(best, d);
  }
  const zonesBox = floodZonesBox(h);
  if (zonesBox !== null && (h.floodZones ?? []).some((ring) => pointInRing(a.lon, a.lat, ring))) {
    const toLine = Math.min(Infinity, ...h.lines.map((line) => pointLineKm(a.lon, a.lat, line)));
    return { d: Number.isFinite(toLine) ? Math.min(best, toLine) : 0, inZone: true };
  }
  if (zonesBox === null || !inBox(a, zonesBox)) {
    for (const line of h.lines) {
      const d = pointLineKm(a.lon, a.lat, line);
      if (d <= h.bufferKm) best = Math.min(best, d);
    }
  }
  for (const ring of h.rings) if (pointInRing(a.lon, a.lat, ring)) best = 0;
  return { d: best, inZone: false };
}

function hazardBox(h: Hazard): [number, number, number, number] | null {
  const pts: Array<[number, number]> = [...h.lines.flat(), ...h.rings.flat(), ...(h.floodZones ?? []).flat()];
  const pad = Math.max(h.bufferKm, ...h.circles.map((c) => c.radiusKm), 0);
  for (const c of h.circles) pts.push([c.lon, c.lat]);
  return pts.length === 0 ? null : bboxOf(pts, pad);
}

const rankKind = (k: ExposureAssetKind): number => ASSET_KIND_ORDER.indexOf(k);

/**
 * Enjeux exposés : proches d'un phénomène localisé (un par enjeu, le phénomène le plus grave, puis le plus proche) ; comptes par
 * département pour les vigilances. Tri : niveau, type d'enjeu, distance.
 */
export function computeExposure(hazards: readonly Hazard[], assets: readonly ExposureAsset[]): ExposureResult {
  const best = new Map<string, Exposure>();
  for (const h of hazards) {
    const box = hazardBox(h);
    if (box === null) continue;
    for (const a of assets) {
      if (!h.kinds.includes(a.kind) || !inBox(a, box)) continue;
      const { d, inZone } = localDistance(a, h);
      if (!Number.isFinite(d)) continue;
      const prev = best.get(a.id);
      const better = !prev || LEVEL_RANK[h.level] > LEVEL_RANK[prev.hazard.level]
        || (LEVEL_RANK[h.level] === LEVEL_RANK[prev.hazard.level] && d < (prev.distanceKm ?? Infinity));
      if (better) best.set(a.id, { asset: a, hazard: h, distanceKm: Math.round(d * 10) / 10, ...(inZone ? { inFloodZone: true as const } : {}) });
    }
  }
  const nearby = [...best.values()].sort((x, y) => LEVEL_RANK[y.hazard.level] - LEVEL_RANK[x.hazard.level]
    || rankKind(x.asset.kind) - rankKind(y.asset.kind) || (x.distanceKm ?? 0) - (y.distanceKm ?? 0));

  const byDept = new Map<string, ExposureAsset[]>();
  for (const a of assets) {
    const list = byDept.get(a.dept);
    if (list) list.push(a);
    else byDept.set(a.dept, [a]);
  }
  const departmental: DeptExposure[] = [];
  for (const h of hazards) {
    for (const dept of h.depts) {
      const inDept = (byDept.get(dept) ?? []).filter((a) => h.kinds.includes(a.kind));
      if (inDept.length === 0) continue;
      const counts: Partial<Record<ExposureAssetKind, number>> = {};
      for (const a of inDept) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
      const named = inDept.filter((a) => a.kind === 'nucleaire' || a.kind === 'seveso-haut')
        .sort((x, y) => rankKind(x.kind) - rankKind(y.kind) || x.name.localeCompare(y.name, 'fr')).slice(0, 4);
      departmental.push({ hazard: h, dept, counts, named });
    }
  }
  departmental.sort((x, y) => LEVEL_RANK[y.hazard.level] - LEVEL_RANK[x.hazard.level]
    || (y.counts.nucleaire ?? 0) - (x.counts.nucleaire ?? 0) || (y.counts['seveso-haut'] ?? 0) - (x.counts['seveso-haut'] ?? 0)
    || x.dept.localeCompare(y.dept));
  return { hazards: [...hazards], nearby, departmental };
}
