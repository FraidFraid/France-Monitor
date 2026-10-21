// tests/outages-exposure.test.ts : services publics exposés aux pannes (control room, lot 2, 21/10/2026).
import { describe, expect, it } from 'vitest';
import { exposureOf } from '../api/_lib/outages-exposure.js';

const services = [
  { t: 'police', n: 'Commissariat de police - Auch', c: '32013', d: '32', x: 0.585, y: 43.646 },
  { t: 'gendarmerie', n: 'Brigade de gendarmerie - Auch', c: '32013', d: '32', x: 0.59, y: 43.65 },
  { t: 'prefecture', n: 'Préfecture - Gers', c: '32013', d: '32', x: 0.586, y: 43.645 },
  { t: 'gendarmerie', n: 'Brigade de gendarmerie - Condom', c: '32107', d: '32', x: 0.372, y: 43.958 },
  { t: 'hopital', n: 'CH AUCH (AUCH)', c: null, d: '32', x: 0.6, y: 43.64 },
  { t: 'police', n: 'Commissariat de police - Toulouse', c: '31555', d: '31', x: 1.44, y: 43.6 },
];
const site = (insee: string, operator: string, lon: number, lat: number) => ({ insee, operator, lon, lat, cls: 'recente' });
const outage = (over: Record<string, unknown>) => ({ id: 'x', network: 'mobile', scope: 'departement', operator: null, dept: '32', national: false, ...over });

describe('services publics exposés', () => {
  it('panne d’un département : ses services, par type, liste nommée', () => {
    const e = exposureOf(outage({}), { services, sites: [] });
    expect(e).toMatchObject({ basis: 'departement', total: 5, byType: { police: 1, gendarmerie: 2, prefecture: 1, hopital: 1 } });
    expect(e?.sample.map((s) => s.name)).toContain('Commissariat de police - Auch');
  });
  it('panne d’un opérateur mobile : services des communes de ses antennes coupées, hôpitaux à moins de 3 km', () => {
    const e = exposureOf(outage({ id: 'mobile|op:Orange', scope: 'operateur', operator: 'Orange', dept: null, national: true }), {
      services, sites: [site('32013', 'Orange', 0.59, 43.645), site('31555', 'SFR', 1.44, 43.6)],
    });
    expect(e).toMatchObject({ basis: 'communes', total: 4, byType: { police: 1, gendarmerie: 1, prefecture: 1, hopital: 1 } });
    expect(e?.sample.find((s) => s.type === 'police')).toMatchObject({ name: 'Commissariat de police - Auch', commune: '32013', dept: '32' });
  });
  it('panne nationale sans antenne : décompte national seulement ; réseau sans lieu (cloud, ouvrage) : rien', () => {
    expect(exposureOf(outage({ id: 'internet|national', network: 'internet', scope: 'national', dept: null, national: true }), { services, sites: [] }))
      .toMatchObject({ basis: 'national', total: 6, sample: [] });
    expect(exposureOf(outage({ network: 'cloud', scope: 'operateur', operator: 'OVHcloud', dept: null }), { services, sites: [] })).toBeNull();
    expect(exposureOf(outage({ network: 'electricite', scope: 'inconnu', dept: null }), { services, sites: [] })).toBeNull();
  });
});
