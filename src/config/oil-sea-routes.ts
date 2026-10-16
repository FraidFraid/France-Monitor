// src/config/oil-sea-routes.ts
/**
 * oil-sea-routes.ts : routes maritimes simplifiées des imports de pétrole (spec 2026-10-16 § 4.3). Un pétrolier ne traverse
 * pas les terres : la route part de la zone de chargement, passe les détroits obligés et finit au port d'entrée de l'app.
 */
export type ChokeId = 'ormuz' | 'bab-el-mandeb' | 'suez' | 'gibraltar' | 'bosphore' | 'pas-de-calais';

export const OIL_CHOKEPOINTS: ReadonlyArray<{ id: ChokeId; name: string; coordinates: [number, number] }> = [
  { id: 'ormuz', name: 'Ormuz', coordinates: [56.4, 26.4] },
  { id: 'bab-el-mandeb', name: 'Bab-el-Mandeb', coordinates: [43.4, 12.6] },
  { id: 'suez', name: 'Suez', coordinates: [32.55, 29.9] },
  { id: 'gibraltar', name: 'Gibraltar', coordinates: [-5.6, 35.95] },
  { id: 'bosphore', name: 'Bosphore', coordinates: [29.1, 41.2] },
  { id: 'pas-de-calais', name: 'Pas-de-Calais', coordinates: [1.7, 51.0] },
];

type Pt = [number, number];
const GIB: Pt[] = [[-9.6, 36.6], [-5.6, 35.95], [-1.5, 36.4], [3.5, 38.6], [5.6, 41.6]];
const MED_W: Pt[] = [[11.2, 37.3], [8.6, 38.4], [6.4, 41.2]];
const MANCHE: Pt[] = [[-9.6, 43.6], [-6.2, 48.4], [-3.6, 49.5], [-2.0, 50.05], [-0.7, 49.85]];

interface Route { re: RegExp; from: Pt; path: Pt[]; via: ChokeId[] }

/** Ordre significatif : « Afrique du Nord » avant « Afrique ». */
const ROUTES: readonly Route[] = [
  { re: /mer du nord/i, from: [2.2, 57.5], path: [[2.6, 53.5], [1.7, 51.1], [0.4, 50.1]], via: ['pas-de-calais'] },
  {
    re: /moyen-orient/i, from: [50.2, 26.6],
    path: [[53.5, 26.9], [56.4, 26.4], [59.0, 22.5], [52.0, 14.0], [43.4, 12.6], [41.0, 15.5], [36.5, 22.5], [33.6, 27.6], [32.55, 29.9],
      [32.3, 31.4], [25.0, 34.2], [15.5, 36.2], ...MED_W],
    via: ['ormuz', 'bab-el-mandeb', 'suez'],
  },
  { re: /afrique du nord/i, from: [18.4, 30.7], path: [[16.0, 33.6], [12.5, 36.5], ...MED_W], via: [] },
  { re: /afrique/i, from: [6.9, 4.2], path: [[2.0, 3.0], [-8.0, 4.0], [-17.8, 14.6], [-17.6, 21.5], [-13.5, 28.2], ...GIB], via: ['gibraltar'] },
  {
    re: /urss|russ/i, from: [37.8, 44.6],
    path: [[33.0, 43.3], [29.1, 41.2], [26.3, 40.1], [24.8, 37.4], [20.5, 35.6], [12.0, 37.0], [4.0, 37.6], [-1.5, 36.4], [-5.6, 35.95],
      [-9.6, 36.9], ...MANCHE],
    via: ['bosphore', 'gibraltar'],
  },
  {
    re: /am[ée]rique/i, from: [-94.8, 29.2],
    path: [[-88.0, 25.6], [-81.5, 24.2], [-79.6, 27.5], [-72.0, 36.5], [-55.0, 43.0], [-30.0, 47.0], [-12.0, 48.6], [-6.2, 48.6], [-3.6, 49.5],
      [-2.0, 50.05], [-0.7, 49.85]],
    via: [],
  },
];

/** Lissage de Chaikin : coupe chaque angle au quart ; extrémités conservées. */
export function chaikin(points: readonly Pt[], passes: number): Pt[] {
  let q: Pt[] = [...points];
  for (let k = 0; k < passes; k += 1) {
    const r: Pt[] = [q[0]];
    for (let i = 0; i < q.length - 1; i += 1) {
      const [a, b] = [q[i], q[i + 1]];
      r.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    r.push(q[q.length - 1]);
    q = r;
  }
  return q;
}

/** Route d'une origine vers le port de l'app ; null si l'origine n'a pas de route connue (l'arc de l'app est gardé). */
export function seaRoute(originLabel: string, hub: Pt): { coordinates: Pt[]; via: readonly ChokeId[] } | null {
  const r = ROUTES.find((x) => x.re.test(originLabel));
  if (!r) return null;
  return { coordinates: chaikin([r.from, ...r.path, hub], 2), via: r.via };
}
