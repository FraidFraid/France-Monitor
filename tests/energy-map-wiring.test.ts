// tests/energy-map-wiring.test.ts
// Carte de l'énergie (spec 2026-10-16) : DeckGLMap.ts ne s'instancie pas en entier sous vitest ; ce test lit sa source.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const deck = readFileSync(new URL('../src/components/DeckGLMap.ts', import.meta.url), 'utf8');

describe('DeckGLMap : disques des installations', () => {
  it('plus de calques de pictos d’alerte : le halo et le disque d’état les remplacent', () => {
    expect(deck).not.toContain('LYR_ENERGY_ALERT_DISC');
    expect(deck).not.toContain('syncEnergyAlerts');
  });
  it('chaque disque à compagnons pose son halo et son picto juste après son ajout', () => {
    for (const id of ['LYR_ENERGY_INFRA_CIRCLE', 'LYR_GAS_STORAGES', 'LYR_GAS_TERMINALS', 'LYR_OIL_REFINERIES', 'LYR_HYDRO_BACKBONE_CIRCLE', 'LYR_WIND_PARK_CIRCLE']) {
      const add = deck.indexOf(`id: ${id},`);
      const comp = deck.indexOf(`this.addDiscCompanions(${id},`);
      expect(add, id).toBeGreaterThan(0);
      expect(comp, id).toBeGreaterThan(add);
    }
  });
});
