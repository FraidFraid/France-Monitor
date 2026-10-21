import { describe, expect, it } from 'vitest';
import { cumulFocusKey, usesEnergyFocus } from './env-focus.ts';

describe('pastilles cumulables : onglet Pannes comme Santé et Environnement (21/10/2026)', () => {
  it('onglet Pannes : les quatre pastilles Pannes cumulables, Électricité comprise, hors du mécanisme Énergie', () => {
    for (const k of ['outagesTelecom', 'outagesInternet', 'outagesCloud', 'outagesElec']) expect(cumulFocusKey('outages', k)).toBe(true);
    expect(cumulFocusKey('outages', 'brief')).toBe(false);
    expect(usesEnergyFocus('outages', 'outagesElec')).toBe(false);
  });
  it('ailleurs : Environnement inchangé, Électricité garde le mécanisme Énergie', () => {
    expect(cumulFocusKey('environment', 'floods')).toBe(true);
    expect(cumulFocusKey('environment', 'outagesTelecom')).toBe(false);
    expect(cumulFocusKey('general', 'floods')).toBe(false);
    expect(usesEnergyFocus('energy', 'outagesElec')).toBe(true);
    expect(usesEnergyFocus('general', 'outagesElec')).toBe(true);
    expect(usesEnergyFocus('outages', 'outagesTelecom')).toBe(false);
  });
});
