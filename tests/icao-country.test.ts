// tests/icao-country.test.ts : pays par bloc d'adresse OACI (spec 2026-10-04 souveraineté V2 ; faits § 5.3), sur les adresses
// réelles du 04/10/2026 (jeu d'essai adsb-lol-mil.json) ; une adresse non OACI n'a jamais de pays.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICAO_BLOCKS, aircraftFamily, icaoCountry } from '../api/_lib/icao-country.js';

const MIL = JSON.parse(readFileSync(new URL('./fixtures/sovereignty/adsb-lol-mil.json', import.meta.url), 'utf8')) as { ac: Array<{ hex: string }> };

describe('icaoCountry', () => {
  it('adresses réelles du 04/10 : France, Royaume-Uni, États-Unis, Canada, Italie', () => {
    expect(['3bf004', '43c700', 'ae07cd', 'c05325', '33fdd0'].map(icaoCountry)).toEqual(['France', 'Royaume-Uni', 'États-Unis', 'Canada', 'Italie']);
  });
  it('A400 belge, Boeing de Bahreïn ; casse indifférente', () => {
    expect([icaoCountry('44f684'), icaoCountry('894081'), icaoCountry('3B7B65')]).toEqual(['Belgique', 'Bahreïn', 'France']);
  });
  it('adresse non OACI (« ~ », TIS-B), illisible ou hors table : null', () => {
    expect([icaoCountry('~3bf004'), icaoCountry('3b7b'), icaoCountry('zzzzzz'), icaoCountry('f00000')]).toEqual([null, null, null, null]);
  });
  it('45 pays, blocs disjoints ; chaque adresse du jeu d’essai a au plus un pays', () => {
    expect(ICAO_BLOCKS).toHaveLength(45);
    const sorted = [...ICAO_BLOCKS].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) expect(sorted[i].start).toBeGreaterThan(sorted[i - 1].end);
    expect(MIL.ac.length).toBe(139);
    expect(MIL.ac.filter((a) => icaoCountry(a.hex) === 'France').length).toBeGreaterThan(0);
  });
});

describe('aircraftFamily', () => {
  it('bloc France : « francais » ; tout le reste, et l’inconnu : « autres », jamais une hypothèse France', () => {
    expect([aircraftFamily('3bf003'), aircraftFamily('380000'), aircraftFamily('3bffff')]).toEqual(['francais', 'francais', 'francais']);
    expect([aircraftFamily('43c6f6'), aircraftFamily('~3bf003'), aircraftFamily('3c0000')]).toEqual(['autres', 'autres', 'autres']);
  });
});
