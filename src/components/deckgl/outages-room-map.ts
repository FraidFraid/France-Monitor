// src/components/deckgl/outages-room-map.ts : calque de la control room des pannes (spec 2026-10-21 § 5.1). Pur. Départements touchés
// au niveau de leur panne la plus grave. Ce qui pulse, ce sont les points urgents (antennes coupées, arrêts imprévus : outages-map.ts),
// pas le contour du pays (décision de l'utilisateur, 21/10/2026).
import type { OutageNetwork, OutageNow } from '../../types/index.ts';

export const SRC_ROOM_DEPTS = 'room-depts';
export const LYR_ROOM_DEPT_FILL = 'room-dept-fill';

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
