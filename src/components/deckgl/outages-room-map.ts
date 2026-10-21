// src/components/deckgl/outages-room-map.ts : calques de la control room des pannes (spec 2026-10-21 § 5.1). Pur. Départements
// touchés au niveau de leur panne la plus grave ; contour de la France pulsant tant qu'une panne nationale est en cours.
import type { OutageNetwork, OutageNow } from '../../types/index.ts';

export const SRC_ROOM_DEPTS = 'room-depts';
export const SRC_ROOM_NATIONAL = 'room-national';
export const LYR_ROOM_DEPT_FILL = 'room-dept-fill';
export const LYR_ROOM_NATIONAL_LINE = 'room-national-line';
export const ROOM_OUTLINE_URL = '/data/france-metro-outline.geojson';
/** Pulsation du contour : période (ms), largeur de repos et amplitude (px). */
export const ROOM_PULSE = { period: 1800, width: 3, amp: 9 } as const;

type Level = OutageNow['level'];
const RANK: Readonly<Record<Level, number>> = { jaune: 1, orange: 2, rouge: 3 };
const keep = (filter: OutageNetwork | null) => (o: OutageNow): boolean => filter === null || o.network === filter;

/** Départements touchés (propriétés `code` et `level`), dans l'ordre du fichier des départements. */
export function roomDeptFeatures(outages: readonly OutageNow[], filter: OutageNetwork | null, depts: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const byDept = new Map<string, Level>();
  for (const o of outages.filter(keep(filter))) {
    if (o.dept === null) continue;
    const before = byDept.get(o.dept);
    if (before === undefined || RANK[o.level] > RANK[before]) byDept.set(o.dept, o.level);
  }
  const features = depts.features.flatMap((f) => {
    const code = String(f.properties?.code ?? '');
    const level = byDept.get(code);
    return level === undefined ? [] : [{ ...f, properties: { code, level } }];
  });
  return { type: 'FeatureCollection', features };
}

/** Niveau du contour national : panne nationale la plus grave, null s'il n'y en a pas. */
export function roomNationalLevel(outages: readonly OutageNow[], filter: OutageNetwork | null): Level | null {
  return outages.filter(keep(filter)).filter((o) => o.national)
    .reduce<Level | null>((m, o) => (m === null || RANK[o.level] > RANK[m] ? o.level : m), null);
}

/** Largeur et opacité du contour à l'instant `t` (ms). */
export function roomPulsePaint(t: number): { width: number; opacity: number } {
  const phase = (t % ROOM_PULSE.period) / ROOM_PULSE.period;
  const wave = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  return { width: ROOM_PULSE.width + ROOM_PULSE.amp * wave, opacity: 1 - 0.7 * wave };
}
