// src/components/layer-panel/sovereignty-legend-b.test.ts : jetons de la phase B recopiés pour MapLibre (contrats § 3.9) : égaux à
// ceux de main.css, distincts des couleurs de niveau.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { levelHex } from '../../services/vigilance.ts';
import { DRONE_ZONE_HEX, GELS_HEX, KP_CALM_HEX } from './sovereignty-legend.ts';

const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');

describe('jetons de la phase B', () => {
  it('zones drones, Kp calme et registre des gels : mêmes valeurs dans main.css', () => {
    expect([DRONE_ZONE_HEX, KP_CALM_HEX, GELS_HEX]).toEqual(['#5e5ce6', '#64d2ff', '#ac8e68']);
    expect(css).toContain(`--cat-zone-drone: ${DRONE_ZONE_HEX};`);
    expect(css).toContain(`--cat-kp-calme: ${KP_CALM_HEX};`);
    expect(css).toContain(`--cat-gels: ${GELS_HEX};`);
  });
  it('aucun jeton de catégorie n’est une couleur de niveau', () => {
    const levels = (['vert', 'jaune', 'orange', 'rouge'] as const).map(levelHex);
    for (const hex of [DRONE_ZONE_HEX, KP_CALM_HEX, GELS_HEX]) expect(levels).not.toContain(hex);
  });
});
