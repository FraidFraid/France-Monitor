import { describe, expect, it } from 'vitest';
import { NUCLEAR_LEGEND_ITEMS, NUCLEAR_STATUS_COLORS } from './nuclear-rte.ts';

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
});
