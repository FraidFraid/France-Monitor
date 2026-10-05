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
  it('57 pays, blocs disjoints ; chaque adresse du jeu d’essai a au plus un pays', () => {
    expect(ICAO_BLOCKS).toHaveLength(57);
    const sorted = [...ICAO_BLOCKS].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) expect(sorted[i].start).toBeGreaterThan(sorted[i - 1].end);
    expect(MIL.ac.length).toBe(139);
    expect(MIL.ac.filter((a) => icaoCountry(a.hex) === 'France').length).toBeGreaterThan(0);
  });
});

describe('bornes du tableau 9-1 de l’OACI (revue finale M4)', () => {
  const at = (n: number): string | null => icaoCountry(n.toString(16).padStart(6, '0'));
  it('quatre blocs de 1 024 adresses : dernière adresse attribuée comprise, la suivante hors du pays', () => {
    for (const [country, start] of [['Luxembourg', 0x4d0000], ['Biélorussie', 0x510000], ['Qatar', 0x06a000], ['Oman', 0x70c000]] as const) {
      expect([at(start), at(start + 0x3ff), at(start + 0x400)], country).toEqual([country, country, null]);
    }
  });
  it('membres de l’OTAN ajoutés, avec Malte et Chypre : première et dernière adresse du bloc', () => {
    const blocks: ReadonlyArray<readonly [string, number, number]> = [
      ['Albanie', 0x501000, 0x5013ff], ['Croatie', 0x501c00, 0x501fff], ['Estonie', 0x511000, 0x5113ff], ['Islande', 0x4cc000, 0x4ccfff],
      ['Lettonie', 0x502c00, 0x502fff], ['Lituanie', 0x503c00, 0x503fff], ['Macédoine du Nord', 0x512000, 0x5123ff],
      ['Monténégro', 0x516000, 0x5163ff], ['Slovaquie', 0x505c00, 0x505fff], ['Slovénie', 0x506c00, 0x506fff], ['Malte', 0x4d2000, 0x4d23ff],
      ['Chypre', 0x4c8000, 0x4c83ff],
    ];
    for (const [country, start, end] of blocks) {
      expect([at(start), at(end), at(start - 1) === country, at(end + 1) === country], country).toEqual([country, country, false, false]);
    }
  });
  it('bloc France inchangé : 380000 à 3BFFFF, voisins hors de France', () => {
    expect([at(0x380000), at(0x3bffff), at(0x37ffff), at(0x3c0000)]).toEqual(['France', 'France', 'Espagne', 'Allemagne']);
  });
});

describe('aircraftFamily', () => {
  it('bloc France : « francais » ; tout le reste, et l’inconnu : « autres », jamais une hypothèse France', () => {
    expect([aircraftFamily('3bf003'), aircraftFamily('380000'), aircraftFamily('3bffff')]).toEqual(['francais', 'francais', 'francais']);
    expect([aircraftFamily('43c6f6'), aircraftFamily('~3bf003'), aircraftFamily('3c0000')]).toEqual(['autres', 'autres', 'autres']);
  });
});
