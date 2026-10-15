// tests/energy-map-wiring.test.ts
// Carte de l'énergie (spec 2026-10-15) : DeckGLMap.ts ne s'instancie pas en entier sous vitest ; ce test lit sa source.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const deck = readFileSync(new URL('../src/components/DeckGLMap.ts', import.meta.url), 'utf8');

describe('DeckGLMap : pictos d’alerte de l’énergie', () => {
  it('remontés au-dessus des pannes EDF, dont le rond cerclé de blanc cachait le picto', () => {
    const outages = deck.indexOf('for (const layer of OUT_LAYERS) this.map.addLayer(layer);');
    const disc = deck.indexOf('this.map.moveLayer(LYR_ENERGY_ALERT_DISC);');
    const icon = deck.indexOf('this.map.moveLayer(LYR_ENERGY_ALERT_ICON);');
    expect(outages).toBeGreaterThan(0);
    expect(disc).toBeGreaterThan(outages);
    expect(icon).toBeGreaterThan(disc);
  });
});
