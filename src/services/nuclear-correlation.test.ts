import { describe, expect, it } from 'vitest';
import { buildNuclearState } from './nuclear-correlation.ts';
import type { RTEIIPState } from './rte-iip.ts';
import type { NuclearUnavailability } from '../types/index.ts';

const iip = (over: Partial<RTEIIPState> = {}): RTEIIPState => ({
  incidents: [], productionCount: 0, transmissionCount: 0, totalCapacityMW: 0, fetchedAt: new Date('2026-10-02T04:20:00Z'),
  available: true, freshness: 'realtime', productionFeedStatus: 'empty', transmissionFeedStatus: 'empty', hasEverSucceeded: true, ...over,
});

describe('état nucléaire : heures de lecture', () => {
  it('reprend l\'heure de lecture RTE du serveur et celle du flux IIP, pas l\'heure de construction', () => {
    const rteAt = new Date('2026-10-02T04:10:00Z');
    const s = buildNuclearState({ items: [], available: true, fetchedAt: rteAt }, iip());
    expect(s.rteFetchedAt).toEqual(rteAt);
    expect(s.remitFetchedAt).toEqual(new Date('2026-10-02T04:20:00Z'));
    expect(s.fetchedAt.getTime()).toBeGreaterThan(rteAt.getTime());
  });
  it('sans IIP réussi : pas d\'heure REMIT inventée', () => {
    const s = buildNuclearState({ items: [], available: true, fetchedAt: new Date() }, iip({ hasEverSucceeded: false, productionFeedStatus: 'unavailable' as never }));
    expect(s.remitFetchedAt).toBeUndefined();
  });
});

describe('score de tension nucléaire : arrêts imprévus seuls (décision du 08/10/2026)', () => {
  const DAY = 86_400_000;
  const unav = (unitName: string, nominalPowerMW: number, type: NuclearUnavailability['type'], id = unitName): NuclearUnavailability => ({
    id, plantName: unitName.split(' ')[0], unitName, nominalPowerMW, availablePowerMW: 0,
    status: type === 'PLANNED' ? 'OUTAGE_PLANNED' : 'OUTAGE_UNPLANNED',
    startDate: new Date(Date.now() - 2 * DAY), endDate: new Date(Date.now() + 5 * DAY),
    type, updatedAt: new Date(Date.now() - DAY),
  });
  const stressOf = (items: NuclearUnavailability[], mix?: { nuclear: number; total: number }) =>
    buildNuclearState({ items, available: true, fetchedAt: new Date() }, iip(), mix).stress;

  it('la maintenance programmée n\'alerte pas, même massive, mais reste dans la puissance disponible', () => {
    const planned = ['BLAYAIS 1', 'BLAYAIS 2', 'BLAYAIS 3', 'BLAYAIS 4'].map((n) => unav(n, 950, 'PLANNED'));
    const s = stressOf([...planned, unav('BELLEVILLE 1', 1310, 'PLANNED'), unav('BELLEVILLE 2', 1310, 'PLANNED')]);
    expect(s?.level).toBe('NORMAL');
    expect(s?.unplannedLostMW).toBe(0);
    expect(s?.stressRatio).toBe(0);
    expect((s?.installedCapacityMW ?? 0) - (s?.availableCapacityMW ?? 0)).toBe(4 * 950 + 2 * 1310);
  });

  it('paliers du panneau Parc nucléaire : tension dès 3 GW perdus en arrêts imprévus, critique dès 6 GW', () => {
    const three = [unav('BELLEVILLE 1', 1310, 'UNPLANNED'), unav('BELLEVILLE 2', 1310, 'FORCE_MAJEURE'), unav('BLAYAIS 1', 950, 'UNPLANNED')];
    const t = stressOf(three);
    expect(t?.unplannedLostMW).toBe(3570);
    expect(t?.level).toBe('TENSION');
    expect(t?.stressRatio).toBeCloseTo(3570 / (t?.installedCapacityMW ?? 1), 6);

    const six = [...three, ...['BLAYAIS 2', 'BLAYAIS 3', 'BLAYAIS 4'].map((n) => unav(n, 950, 'UNPLANNED'))];
    expect(stressOf(six)?.level).toBe('CRITIQUE');

    expect(stressOf([unav('BELLEVILLE 1', 1310, 'UNPLANNED'), unav('BLAYAIS 1', 950, 'UNPLANNED')])?.level).toBe('NORMAL');
  });

  it('deux messages pour une même tranche ne comptent qu\'une fois', () => {
    const s = stressOf([unav('BELLEVILLE 1', 1310, 'UNPLANNED', 'a'), unav('BELLEVILLE 1', 1310, 'UNPLANNED', 'b')]);
    expect(s?.unplannedLostMW).toBe(1310);
  });

  it('risque réseau : seulement en tension et quand le nucléaire pèse moins de 35 % du mix', () => {
    const planned = ['BLAYAIS 1', 'BLAYAIS 2', 'BLAYAIS 3', 'BLAYAIS 4'].map((n) => unav(n, 950, 'PLANNED'));
    expect(stressOf(planned, { nuclear: 20, total: 100 })?.gridTensionRisk).toBe(false);
    const tense = [unav('BELLEVILLE 1', 1310, 'UNPLANNED'), unav('BELLEVILLE 2', 1310, 'UNPLANNED'), unav('BLAYAIS 1', 950, 'UNPLANNED')];
    expect(stressOf(tense, { nuclear: 20, total: 100 })?.gridTensionRisk).toBe(true);
    expect(stressOf(tense, { nuclear: 60, total: 100 })?.gridTensionRisk).toBe(false);
  });
});
