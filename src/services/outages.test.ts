import { describe, it, expect } from 'vitest';
import { selectPowerOutages } from './outages.ts';
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
