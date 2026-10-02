import { describe, expect, it } from 'vitest';
import type { NuclearUnavailability, NuclearUnitReference } from '../types/index.ts';
import {
  activeOutages, availabilityLevel, fleetCalendar, fleetLevel, fleetSummary, outageKind, plantRows, remitMatchWords, shortLabel, unitLabel,
} from './nuclear-fleet.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-02T08:00:00Z');
const UNITS: NuclearUnitReference[] = [
  { id: 'fla-1', plantId: 'nuc-flamanville', plantName: 'Flamanville', unitName: 'FLAMANVILLE 1', nominalPowerMW: 1330 },
  { id: 'fla-2', plantId: 'nuc-flamanville', plantName: 'Flamanville', unitName: 'FLAMANVILLE 2', nominalPowerMW: 1330 },
  { id: 'chz-1', plantId: 'nuc-chooz', plantName: 'Chooz', unitName: 'CHOOZ 1', nominalPowerMW: 1500 },
  { id: 'bug-4', plantId: 'nuc-bugey', plantName: 'Bugey', unitName: 'BUGEY 4', nominalPowerMW: 880 },
];
const u = (over: Partial<NuclearUnavailability>): NuclearUnavailability => ({
  id: 'x', plantName: 'Flamanville', unitName: 'FLAMANVILLE 2', nominalPowerMW: 1330, availablePowerMW: 0,
  status: 'OUTAGE_UNPLANNED', startDate: new Date(NOW - 3 * DAY), endDate: new Date(NOW + 3 * DAY),
  type: 'UNPLANNED', updatedAt: new Date(NOW - DAY), ...over,
});

describe('flotte nucléaire', () => {
  it('libellé lisible de tranche', () => {
    expect(unitLabel(UNITS[1])).toBe('Flamanville 2');
  });
  it('nature : fortuit (UNPLANNED, FORCE_MAJEURE), puis puissance réduite, sinon programmé', () => {
    expect(outageKind(u({ type: 'FORCE_MAJEURE' }))).toBe('fortuit');
    expect(outageKind(u({ type: 'UNPLANNED', availablePowerMW: 400 }))).toBe('fortuit');
    expect(outageKind(u({ type: 'PLANNED', availablePowerMW: 400, status: 'REDUCED' }))).toBe('reduit');
    expect(outageKind(u({ type: 'PLANNED', status: 'OUTAGE_PLANNED' }))).toBe('programme');
  });
  it('une tranche avec deux indisponibilités en cours compte une fois, la plus pénalisante', () => {
    const list = [u({ id: 'a', availablePowerMW: 600 }), u({ id: 'b', availablePowerMW: 0 })];
    const out = activeOutages(list, UNITS, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'fortuit', lostMw: 1330 });
  });
  it('fin absente = en cours ; fin passée ou début futur = pas en cours', () => {
    expect(activeOutages([u({ endDate: null })], UNITS, NOW)[0]?.end).toBeNull();
    expect(activeOutages([u({ endDate: new Date(NOW - 1) })], UNITS, NOW)).toHaveLength(0);
    expect(activeOutages([u({ startDate: new Date(NOW + DAY) })], UNITS, NOW)).toHaveLength(0);
  });
  it('tranche inconnue du référentiel ignorée', () => {
    expect(activeOutages([u({ unitName: 'INCONNUE 9' })], UNITS, NOW)).toHaveLength(0);
  });
  it('synthèse : installé, disponible, par nature, tri fortuits d\'abord puis puissance perdue', () => {
    const out = activeOutages([
      u({ id: 'p', unitName: 'CHOOZ 1', plantName: 'Chooz', nominalPowerMW: 1500, type: 'PLANNED', status: 'OUTAGE_PLANNED' }),
      u({ id: 'f' }),
    ], UNITS, NOW);
    const s = fleetSummary(UNITS, out);
    expect(s.installedMw).toBe(5040);
    expect(s.availableMw).toBe(5040 - 1330 - 1500);
    expect(s.byKind.fortuit).toEqual({ count: 1, lostMw: 1330 });
    expect(s.byKind.programme).toEqual({ count: 1, lostMw: 1500 });
    expect(s.outages.map((o) => o.unit.id)).toEqual(['fla-2', 'chz-1']);
  });
  it('niveau du parc : bornes 1, 3 et 6 GW de puissance perdue en fortuit', () => {
    expect(fleetLevel(0)).toBe('vert');
    expect(fleetLevel(999)).toBe('vert');
    expect(fleetLevel(1000)).toBe('jaune');
    expect(fleetLevel(2999)).toBe('jaune');
    expect(fleetLevel(3000)).toBe('orange');
    expect(fleetLevel(5999)).toBe('orange');
    expect(fleetLevel(6000)).toBe('rouge');
  });
  it('calendrier : J-3 à J+14, arrêts à venir, retours dans la fenêtre', () => {
    const cal = fleetCalendar([
      u({ id: 'f' }), // retour J+3
      u({ id: 'n', unitName: 'BUGEY 4', plantName: 'Bugey', nominalPowerMW: 880, type: 'PLANNED', status: 'OUTAGE_PLANNED',
        startDate: new Date(NOW + 8 * DAY), endDate: new Date(NOW + 40 * DAY) }),
      u({ id: 'old', unitName: 'CHOOZ 1', plantName: 'Chooz', startDate: new Date(NOW - 30 * DAY), endDate: new Date(NOW - 10 * DAY) }),
    ], UNITS, NOW);
    expect(cal.from).toBe(NOW - 3 * DAY);
    expect(cal.to).toBe(NOW + 14 * DAY);
    expect(cal.rows.map((r) => [r.unit.id, r.segments.map((x) => x.upcoming)])).toEqual([['fla-2', [false]], ['bug-4', [true]]]);
    expect(cal.returns).toEqual([{ unit: UNITS[1], at: NOW + 3 * DAY, gainMw: 1330 }]);
    expect(cal.upcoming).toEqual([{ unit: UNITS[3], at: NOW + 8 * DAY, lostMw: 880 }]);
  });
  it('calendrier : une ligne par tranche, un segment par message', () => {
    const cal = fleetCalendar([
      u({ id: 'a', startDate: new Date(NOW - DAY), endDate: new Date(NOW + DAY) }),
      u({ id: 'b', startDate: new Date(NOW + 5 * DAY), endDate: new Date(NOW + 6 * DAY), type: 'PLANNED', status: 'OUTAGE_PLANNED' }),
    ], UNITS, NOW);
    expect(cal.rows).toHaveLength(1);
    expect(cal.rows[0].segments.map((x) => [x.kind, x.upcoming])).toEqual([['fortuit', false], ['programme', true]]);
  });
  it('retours : fin de l\'arrêt en cours seulement, jamais d\'un arrêt pas encore commencé', () => {
    const cal = fleetCalendar([
      u({ id: 'a', endDate: new Date(NOW + 2 * DAY) }),
      u({ id: 'short', unitName: 'BUGEY 4', plantName: 'Bugey', nominalPowerMW: 880, availablePowerMW: 700, type: 'PLANNED', status: 'REDUCED',
        startDate: new Date(NOW + DAY), endDate: new Date(NOW + DAY + 3600_000) }),
    ], UNITS, NOW);
    expect(cal.returns.map((r) => r.unit.id)).toEqual(['fla-2']);
    expect(cal.upcoming.map((r) => r.unit.id)).toEqual(['bug-4']);
  });
  it('à venir : une entrée par tranche, le plus tôt', () => {
    const mk = (id: string, d: number) => u({ id, unitName: 'BUGEY 4', plantName: 'Bugey', nominalPowerMW: 880, startDate: new Date(NOW + d * DAY), endDate: new Date(NOW + (d + 1) * DAY) });
    const cal = fleetCalendar([mk('a', 6), mk('b', 3)], UNITS, NOW);
    expect(cal.upcoming).toEqual([{ unit: UNITS[3], at: NOW + 3 * DAY, lostMw: 880 }]);
  });
  it('libellés courts du calendrier, bornés', () => {
    const r = (plantName: string, unitName: string): NuclearUnitReference => ({ id: 'x', plantId: 'p', plantName, unitName, nominalPowerMW: 900 });
    expect([
      shortLabel(r('Belleville-sur-Loire', 'BELLEVILLE 1')), shortLabel(r('Saint-Laurent-des-Eaux', 'SAINT-LAURENT 1')),
      shortLabel(r('Dampierre-en-Burly', 'DAMPIERRE 3')), shortLabel(r('Nogent-sur-Seine', 'NOGENT 2')),
      shortLabel(r('Cruas-Meysse', 'CRUAS 4')), shortLabel(r('Saint-Alban', 'SAINT-ALBAN 1')), shortLabel(r('Flamanville', 'FLAMANVILLE 3')),
    ]).toEqual(['Belleville 1', 'St-Laurent 1', 'Dampierre 3', 'Nogent 2', 'Cruas 4', 'St-Alban 1', 'Flamanville 3']);
  });
  it('sites : une tranche en puissance réduite compte comme disponible', () => {
    const red = plantRows(UNITS, activeOutages([u({ availablePowerMW: 600, type: 'PLANNED', status: 'REDUCED' })], UNITS, NOW));
    expect(red.find((r) => r.name === 'Flamanville')).toMatchObject({ worst: 'reduit', unitsAvailable: 2, unitsTotal: 2 });
  });
  it('sites : pire nature, tranches disponibles, puissance', () => {
    const rows = plantRows(UNITS, activeOutages([u({})], UNITS, NOW));
    const fla = rows.find((r) => r.name === 'Flamanville');
    expect(fla).toEqual({ name: 'Flamanville', worst: 'fortuit', unitsTotal: 2, unitsAvailable: 1, availableMw: 1330, installedMw: 2660 });
    expect(rows.find((r) => r.name === 'Chooz')?.worst).toBeNull();
  });
  it('niveau de disponibilité du parc : 85, 70 et 55 %', () => {
    expect(availabilityLevel(0.85)).toBe('vert');
    expect(availabilityLevel(0.849)).toBe('jaune');
    expect(availabilityLevel(0.70)).toBe('jaune');
    expect(availabilityLevel(0.699)).toBe('orange');
    expect(availabilityLevel(0.55)).toBe('orange');
    expect(availabilityLevel(0.49)).toBe('rouge');
  });
  it('mots de correspondance REMIT', () => {
    expect(remitMatchWords(0.8)).toBe('correspondance probable');
    expect(remitMatchWords(0.5)).toBe('correspondance incertaine');
    expect(remitMatchWords(0.49)).toBe('correspondance faible');
  });
});
