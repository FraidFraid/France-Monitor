// src/components/layer-panel/sovereignty-format-b.test.ts : formats de la phase B (contrats § 3.6, § 3.8) : Kp au tiers, échelles
// NOAA en français, visibilité en %, échelle G d'un Kp et sa couleur, contrôle R1 des unités de la souveraineté.
import { describe, expect, it } from 'vitest';
import {
  CAT_GELS, CAT_KP_CALME, CAT_ZONE_DRONE, SCALE_WORD, formatKp, formatPctVisibility, gScaleLevel, glueSovUnits, kpGScale, sovBreakable,
} from './sovereignty-format.ts';

const NBSP = '\u00A0';
const MINUS = '\u2212';

describe('indice Kp et échelles NOAA', () => {
  it('Kp au tiers : 5− pour 4,67, 5 pour 5,0, 5+ pour 5,33 ; n.d. sans valeur', () => {
    expect([4.67, 5, 5.33, 4.33, 0.33, 0, 8.67, 9].map(formatKp)).toEqual([
      `Kp${NBSP}5${MINUS}`, `Kp${NBSP}5`, `Kp${NBSP}5+`, `Kp${NBSP}4+`, `Kp${NBSP}0+`, `Kp${NBSP}0`, `Kp${NBSP}9${MINUS}`, `Kp${NBSP}9`,
    ]);
    expect([formatKp(null), formatKp(undefined), formatKp(Number.NaN)]).toEqual(['n.d.', 'n.d.', 'n.d.']);
  });
  it('échelle G d’un Kp (NOAA : 5− est G1, 9− est G4) et sa couleur ; G0 prend le jeton « calme »', () => {
    expect([4.33, 4.67, 5.33, 5.67, 6.33, 6.67, 7.33, 7.67, 8.67, 9].map(kpGScale)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
    expect([0, 1, 2, 3, 4, 5].map(gScaleLevel)).toEqual([null, 'jaune', 'orange', 'orange', 'rouge', 'rouge']);
    expect([CAT_KP_CALME, CAT_GELS, CAT_ZONE_DRONE]).toEqual(['var(--cat-kp-calme)', 'var(--cat-gels)', 'var(--cat-zone-drone)']);
  });
  it('échelles en français, valeur insécable', () => {
    expect(SCALE_WORD.G[1]).toBe(`G1${NBSP}mineur`);
    expect(SCALE_WORD.R[0]).toBe(`R0${NBSP}aucun`);
    expect(SCALE_WORD.S[3]).toBe(`S3${NBSP}fort`);
    expect(SCALE_WORD.G[5]).toBe(`G5${NBSP}extrême`);
  });
});

describe('visibilité et R1', () => {
  it('visibilité : une décimale, entier quand il tombe juste ; n.d. sans valeur', () => {
    expect(formatPctVisibility((323 / 325) * 100)).toBe(`99,4${NBSP}%`);
    expect(formatPctVisibility(100)).toBe(`100${NBSP}%`);
    expect(formatPctVisibility(null)).toBe('n.d.');
  });
  it('unités et mots comptés collés à leur nombre ; « Kp 5 » insécable', () => {
    expect(glueSovUnits('3 mailles à 12,5 % · Kp 5 · 24 h · 720 lectures · 14 jours · 200 milles'))
      .toBe(`3${NBSP}mailles à 12,5${NBSP}% · Kp${NBSP}5 · 24${NBSP}h · 720${NBSP}lectures · 14${NBSP}jours · 200${NBSP}milles`);
    expect(sovBreakable('fenêtre de 24 h')).toBe('24 h');
    expect(sovBreakable('indice Kp 5')).toBe('Kp 5');
    expect(sovBreakable(glueSovUnits('fenêtre de 24 h, indice Kp 5, 99,4 %'))).toBeNull();
  });
});
