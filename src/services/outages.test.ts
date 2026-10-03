import { describe, it, expect } from 'vitest';
import { selectPowerOutages, arcepFeatureToOutage, arcepReasonLabel, type ArcepFeature } from './outages.ts';
import type { PowerOutage } from '../types/index.ts';

function powerOutage(over: Partial<PowerOutage> = {}): PowerOutage {
  return {
    departmentCode: '75',
    departmentName: 'Paris',
    offGridCount: 0,
    totalPDL: 20_000,
    eventCause: 'Indicateurs Historiques DataFair · continuité=0.00% · BT national(freq=n/a, dur=n/a)',
    trend: 'stable',
    ...over,
  };
}

describe('selectPowerOutages — plus d’injection par Écowatt (signal national, affiché ailleurs)', () => {
  it('ne garde que les départements avec une mesure réelle (offGridCount >= 1200)', () => {
    const computed = [
      powerOutage({ departmentCode: '01', offGridCount: 500 }),
      powerOutage({ departmentCode: '02', offGridCount: 1500 }),
      powerOutage({ departmentCode: '03', offGridCount: 300 }),
    ];
    const results = selectPowerOutages(computed);
    expect(results.map((r) => r.departmentCode)).toEqual(['02']);
  });

  it('aucun eventCause ne mentionne un signal Écowatt ou une "tension réseau" spéculative', () => {
    const computed = [powerOutage({ departmentCode: '02', offGridCount: 1500 })];
    const results = selectPowerOutages(computed);
    for (const r of results) {
      expect(r.eventCause).not.toMatch(/Signal (vert|orange|rouge)/);
      expect(r.eventCause).not.toContain('Risque tension réseau');
    }
  });

  it('repli « top 6 » par impact quand aucun département ne franchit le seuil', () => {
    const computed = Array.from({ length: 8 }, (_, i) =>
      powerOutage({ departmentCode: String(i).padStart(2, '0'), offGridCount: i * 10 }));
    const results = selectPowerOutages(computed);
    expect(results).toHaveLength(6);
    expect(results.map((r) => r.offGridCount)).toEqual([70, 60, 50, 40, 30, 20]);
  });

  it('résultat trié par impact décroissant', () => {
    const computed = [
      powerOutage({ departmentCode: '01', offGridCount: 1300 }),
      powerOutage({ departmentCode: '02', offGridCount: 4000 }),
      powerOutage({ departmentCode: '03', offGridCount: 1500 }),
    ];
    const results = selectPowerOutages(computed);
    expect(results.map((r) => r.departmentCode)).toEqual(['02', '03', '01']);
  });
});

describe('ARCEP : debut et libellés de cause', () => {
  const feature = (props: Partial<ArcepFeature['properties']>): ArcepFeature => ({
    properties: { operateur: 'Orange', departement: '59 ', commune: 'Lille', station_anfr: '1', ...props },
    geometry: { coordinates: [3.06, 50.63] },
  });

  it('debut d\'été et d\'hiver converti en ISO UTC', () => {
    expect(arcepFeatureToOutage(feature({ debut: '2026-09-15 15:42:13' }), 0).since).toBe('2026-09-15T13:42:13.000Z');
    expect(arcepFeatureToOutage(feature({ debut: '2026-01-23 18:06:16' }), 1).since).toBe('2026-01-23T17:06:16.000Z');
  });

  it('since reste null sans debut ou avec un debut illisible', () => {
    expect(arcepFeatureToOutage(feature({ debut: null }), 0).since).toBeNull();
    expect(arcepFeatureToOutage(feature({}), 0).since).toBeNull();
    expect(arcepFeatureToOutage(feature({ debut: 'n/a' }), 0).since).toBeNull();
  });

  it('département nettoyé', () => {
    expect(arcepFeatureToOutage(feature({}), 0).department).toBe('59');
  });

  it('libellés : INT incident, MAINT maintenance, repli sur le détail', () => {
    expect(arcepReasonLabel('INT', 'Incident en cours')).toBe('Incident');
    expect(arcepReasonLabel('MAINT', 'Maintenance en cours')).toBe('Maintenance');
    expect(arcepReasonLabel('MNT', undefined)).toBe('Maintenance');
    expect(arcepReasonLabel('INC', undefined)).toBe('Incident technique');
    expect(arcepReasonLabel(undefined, 'Détail libre')).toBe('Détail libre');
    expect(arcepReasonLabel(undefined, undefined)).toBe('Incident');
  });
});
