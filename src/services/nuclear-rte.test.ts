import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/rte-unavailability-2026-10-02.json';
import type { NuclearUnavailability } from '../types/index.ts';
import { NUCLEAR_LEGEND_ITEMS, NUCLEAR_STATUS_COLORS, getPlantWorstStatus, normalizeNuclearItems } from './nuclear-rte.ts';

const NOW = Date.parse('2026-10-02T06:30:00Z');

describe('nuclear-rte', () => {
  it('légende : couleurs alignées sur les statuts et libellés corrects', () => {
    expect(NUCLEAR_LEGEND_ITEMS).toHaveLength(5);

    // Disponible
    expect(NUCLEAR_LEGEND_ITEMS[0]).toMatchObject({
      id: 'nuc-available',
      label: 'Disponible',
      color: NUCLEAR_STATUS_COLORS.AVAILABLE,
      shape: 'circle',
    });

    // Puissance réduite
    expect(NUCLEAR_LEGEND_ITEMS[1]).toMatchObject({
      id: 'nuc-reduced',
      label: 'Puissance réduite',
      color: NUCLEAR_STATUS_COLORS.REDUCED,
      shape: 'circle',
    });

    // Arrêt programmé
    expect(NUCLEAR_LEGEND_ITEMS[2]).toMatchObject({
      id: 'nuc-planned',
      label: 'Arrêt programmé',
      color: NUCLEAR_STATUS_COLORS.OUTAGE_PLANNED,
      shape: 'circle',
    });

    // Arrêt fortuit
    expect(NUCLEAR_LEGEND_ITEMS[3]).toMatchObject({
      id: 'nuc-unplanned',
      label: 'Arrêt fortuit',
      color: NUCLEAR_STATUS_COLORS.OUTAGE_UNPLANNED,
      shape: 'circle',
    });

    // Inconnu
    expect(NUCLEAR_LEGEND_ITEMS[4]).toMatchObject({
      id: 'nuc-unknown',
      label: 'Inconnu',
      color: NUCLEAR_STATUS_COLORS.UNKNOWN,
      shape: 'circle',
    });
  });

  it('légende : pas de dérive entre couleurs et statuts', () => {
    // Verify each color in the legend matches the corresponding status color
    const statusMap = {
      'nuc-available': 'AVAILABLE',
      'nuc-reduced': 'REDUCED',
      'nuc-planned': 'OUTAGE_PLANNED',
      'nuc-unplanned': 'OUTAGE_UNPLANNED',
      'nuc-unknown': 'UNKNOWN',
    } as const;

    for (const item of NUCLEAR_LEGEND_ITEMS) {
      const statusKey = statusMap[item.id as keyof typeof statusMap];
      if (statusKey) {
        expect(item.color).toBe(NUCLEAR_STATUS_COLORS[statusKey as keyof typeof NUCLEAR_STATUS_COLORS]);
      }
    }
  });

  describe('normalisation de la réponse RTE réelle du 02/10/2026', () => {
    const items = normalizeNuclearItems(fixture.items, NOW);
    const of = (name: string) => items.filter((i) => i.unitName === name);

    it('écarte l\'hydraulique', () => {
      expect(items.every((i) => !/GRAND MAISON|SAULT/i.test(i.unitName))).toBe(true);
    });
    it('Paluel 2 : une seule indisponibilité, la version 2 (fin 10:00)', () => {
      const p = of('PALUEL 2');
      expect(p).toHaveLength(1);
      expect(p[0].version).toBe(2);
      expect(p[0].endDate?.toISOString()).toBe('2026-10-02T10:00:00.000Z');
    });
    it('Golfech 1 : la version 4 (INACTIVE) clôt l\'arrêt programmé, seul le fortuit reste', () => {
      const g = of('GOLFECH 1');
      expect(g).toHaveLength(1);
      expect(g[0].type).toBe('UNPLANNED');
    });
    it('en cours à 06:30 : Paluel 2, Golfech 1, Bugey 2 (réduit 160 MW) ; Chinon 4 et Paluel 3 viennent plus tard', () => {
      const active = items.filter((i) => i.startDate.getTime() <= NOW && (!i.endDate || i.endDate.getTime() > NOW));
      expect(active.map((i) => i.unitName).sort()).toEqual(['BUGEY 2', 'GOLFECH 1', 'PALUEL 2']);
    });
  });

  it('écarte DISMISSED et garde la plus haute version même dans le désordre', () => {
    const base = { affected_asset_or_unit_name: 'CRUAS 1', fuel_type: 'NUCLEAR', identifier: 'z', start_date: '2026-10-01T00:00:00Z',
      unavailability_type: 'PLANNED', affected_asset_or_unit_installed_capacity: 900 };
    const out = normalizeNuclearItems([
      { ...base, version: 3, event_status: 'ACTIVE', values: [{ start_date: base.start_date, end_date: '2026-10-09T00:00:00Z', available_capacity: 0 }] },
      { ...base, version: 1, event_status: 'ACTIVE', values: [{ start_date: base.start_date, end_date: '2026-10-05T00:00:00Z', available_capacity: 0 }] },
      { ...base, identifier: 'd', version: 1, event_status: 'DISMISSED', values: [] },
    ], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].endDate?.toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it('lit le segment values[] qui couvre maintenant', () => {
    const out = normalizeNuclearItems([{
      affected_asset_or_unit_name: 'CRUAS 1', fuel_type: 'NUCLEAR', identifier: 's', version: 1, event_status: 'ACTIVE',
      start_date: '2026-10-01T00:00:00Z', unavailability_type: 'PLANNED', affected_asset_or_unit_installed_capacity: 900,
      values: [
        { start_date: '2026-10-01T00:00:00Z', end_date: '2026-10-02T00:00:00Z', available_capacity: 0 },
        { start_date: '2026-10-02T00:00:00Z', end_date: '2026-10-04T00:00:00Z', available_capacity: 450 },
      ],
    }], NOW);
    expect(out[0].availablePowerMW).toBe(450);
    expect(out[0].endDate?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });

  describe('carte : même précédence que le panneau', () => {
    const mk = (status: NuclearUnavailability['status'], unitName: string): NuclearUnavailability => ({
      id: unitName, plantName: 'Gravelines', unitName, nominalPowerMW: 900, availablePowerMW: 0, status,
      startDate: new Date(NOW - 1000), endDate: new Date(NOW + 1e6), type: 'PLANNED', updatedAt: new Date(NOW),
    });
    it('puissance réduite l\'emporte sur arrêt programmé', () => {
      expect(getPlantWorstStatus('Gravelines', [mk('OUTAGE_PLANNED', 'GRAVELINES 1'), mk('REDUCED', 'GRAVELINES 2')], NOW)).toBe('REDUCED');
    });
    it('fortuit l\'emporte sur tout', () => {
      expect(getPlantWorstStatus('Gravelines', [mk('REDUCED', 'GRAVELINES 1'), mk('OUTAGE_UNPLANNED', 'GRAVELINES 2')], NOW)).toBe('OUTAGE_UNPLANNED');
    });
    it('une tranche à 97 % de sa puissance est réduite (pas de seuil 0,95)', () => {
      const [u] = normalizeNuclearItems([{
        affected_asset_or_unit_name: 'GRAVELINES 1', fuel_type: 'NUCLEAR', identifier: 'r', version: 1, event_status: 'ACTIVE',
        start_date: '2026-10-02T00:00:00Z', end_date: '2026-10-03T00:00:00Z', unavailability_type: 'PLANNED',
        affected_asset_or_unit_installed_capacity: 910, values: [{ start_date: '2026-10-02T00:00:00Z', end_date: '2026-10-03T00:00:00Z', available_capacity: 880 }],
      }], NOW);
      expect(u.status).toBe('REDUCED');
    });
  });
});
