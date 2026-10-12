// src/utils/iso3.test.ts : noms français des pays GDACS (codes ISO3).
import { describe, expect, it } from 'vitest';
import { countryNameFr } from './iso3.ts';

describe('countryNameFr', () => {
  it('ISO3 → nom français ; code inconnu gardé tel quel', () => {
    expect(countryNameFr('PAN')).toBe('Panama');
    expect(countryNameFr('MEX')).toBe('Mexique');
    expect(countryNameFr('ZZZ')).toBe('ZZZ');
  });
});
