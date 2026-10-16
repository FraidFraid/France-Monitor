// src/config/oil-sea-routes.test.ts
import { describe, expect, it } from 'vitest';
import { chaikin, OIL_CHOKEPOINTS, seaRoute } from './oil-sea-routes.ts';

const FOS: [number, number] = [4.94, 43.43];
const HAVRE: [number, number] = [-0.15, 49.67];

describe('routes maritimes du pétrole', () => {
  it('six détroits nommés', () => {
    expect(OIL_CHOKEPOINTS.map((c) => c.name)).toEqual(['Ormuz', 'Bab-el-Mandeb', 'Suez', 'Gibraltar', 'Bosphore', 'Pas-de-Calais']);
  });
  it('le Moyen-Orient passe par Ormuz, Bab-el-Mandeb et Suez, et finit au port', () => {
    const r = seaRoute('Moyen-Orient', FOS);
    expect(r?.via).toEqual(['ormuz', 'bab-el-mandeb', 'suez']);
    expect(r?.coordinates[0]).toEqual([50.2, 26.6]);
    expect(r?.coordinates.at(-1)).toEqual(FOS);
  });
  it('l’Afrique du Nord est reconnue avant l’Afrique', () => {
    expect(seaRoute('Afrique du Nord', FOS)?.coordinates[0]).toEqual([18.4, 30.7]);
    expect(seaRoute('Afrique subsaharienne', FOS)?.via).toEqual(['gibraltar']);
  });
  it('ex-URSS et Amérique du Nord vers Le Havre ; origine inconnue : pas de route', () => {
    expect(seaRoute('URSS/ex-URSS', HAVRE)?.via).toEqual(['bosphore', 'gibraltar']);
    expect(seaRoute('Amérique du Nord', HAVRE)?.via).toEqual([]);
    expect(seaRoute('Mer du Nord', HAVRE)?.via).toEqual(['pas-de-calais']);
    expect(seaRoute('Autres', HAVRE)).toBeNull();
  });
  it('le lissage garde les extrémités et densifie', () => {
    const s = chaikin([[0, 0], [10, 0], [10, 10]], 2);
    expect(s[0]).toEqual([0, 0]);
    expect(s.at(-1)).toEqual([10, 10]);
    expect(s.length).toBe(12);
  });
});
