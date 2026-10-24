import { describe, expect, it } from 'vitest';
import { pulseAllowed } from './pulse.ts';

describe('anneaux pulsants', () => {
  it('antennes coupées : pulsent dans l’onglet Pannes seulement, pas en Vue générale (24/10/2026) ; les autres couches partout', () => {
    expect(pulseAllowed('telecomOutage', false)).toBe(false);
    expect(pulseAllowed('telecomOutage', true)).toBe(true);
    expect(pulseAllowed('disasters', false)).toBe(true);
    expect(pulseAllowed('powerOutage', false)).toBe(true);
  });
});
