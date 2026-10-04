import { describe, expect, it } from 'vitest';
import { NBSP } from './format.ts';
import {
  COLOR_LEVEL, COLOR_WORD, ENVIRONMENT_THEME, FOREST_DANGER_LEVEL, FOREST_DANGER_WORD, PHENOMENON_ICON, PHENOMENON_LABEL, SATELLITE_WORD,
  envBreakable, formatAge, formatChangeM, formatDbz, formatFlowM3s, formatFrp, formatHeightM, formatRainRate, glueEnvUnits, marshallPalmerMmH,
  parisDayWord, slotText,
} from './environment-format.ts';

const NOW = Date.parse('2026-10-04T10:10:00+02:00');
const N = NBSP;

describe('valeurs sur une ligne (R1) et « n.d. » pour une valeur absente', () => {
  it('hauteur, variation signée, débit, FRP, réflectivité', () => {
    expect(formatHeightM(22.29)).toBe(`22,29${N}m`);
    expect(formatChangeM(0.12)).toBe(`+0,12${N}m`);
    expect(formatChangeM(-0.05)).toBe(`−0,05${N}m`);
    expect(formatChangeM(0)).toBe(`0,00${N}m`);
    expect(formatFlowM3s(0.42)).toBe(`0,42${N}m³/s`);
    expect(formatFlowM3s(12.43)).toBe(`12,4${N}m³/s`);
    expect(formatFlowM3s(1250)).toBe(`1${' '}250${N}m³/s`);
    expect(formatFrp(4.15)).toBe(`4,2${N}MW`);
    expect(formatDbz(-9)).toBe(`−9${N}dBZ`);
    for (const f of [formatHeightM, formatChangeM, formatFlowM3s, formatFrp, formatDbz, formatRainRate]) expect(f(null)).toBe('n.d.');
  });
  it('pluie équivalente de Marshall-Palmer : 30 dBZ ≈ 2,7 mm/h ; 20 dBZ ≈ 0,6 ; sous 0,1 dit', () => {
    expect(marshallPalmerMmH(30)).toBeCloseTo(2.73, 2);
    expect(formatRainRate(marshallPalmerMmH(30))).toBe(`2,7${N}mm/h`);
    expect(formatRainRate(marshallPalmerMmH(20))).toBe(`0,6${N}mm/h`);
    expect(formatRainRate(marshallPalmerMmH(50))).toBe(`49${N}mm/h`);
    expect(formatRainRate(marshallPalmerMmH(0))).toBe(`<${N}0,1${N}mm/h`);
  });
  it('âge : minutes, heures et minutes, jours ; jamais négatif', () => {
    expect(formatAge(Date.parse('2026-10-04T04:43:00Z'), NOW)).toBe(`il y a 3${N}h${N}27`);
    expect(formatAge(NOW - 12 * 60_000, NOW)).toBe(`il y a 12${N}min`);
    expect(formatAge(NOW - 5 * 3_600_000, NOW)).toBe(`il y a 5${N}h`);
    expect(formatAge(NOW - 3 * 86_400_000, NOW)).toBe(`il y a 3${N}j`);
    expect(formatAge(NOW + 5 * 60_000, NOW)).toBe(`il y a 0${N}min`);
  });
});

describe('jours et créneaux en heure de Paris', () => {
  it('aujourd’hui, demain, puis le jour écrit', () => {
    expect(parisDayWord('2026-10-04', NOW)).toBe('aujourd’hui');
    expect(parisDayWord('2026-10-05', NOW)).toBe('demain');
    expect(parisDayWord('2026-10-06', NOW)).toBe('mardi 6 octobre');
  });
  it('créneau : couleur et bornes ; minuit dit ; autre jour daté', () => {
    expect(slotText({ from: '2026-10-04T08:00:00Z', to: '2026-10-04T14:00:00Z', color: 3 }, NOW)).toBe('orange de 10:00 à 16:00');
    expect(slotText({ from: '2026-10-04T18:00:00Z', to: '2026-10-04T22:00:00Z', color: 1 }, NOW)).toBe('vert de 20:00 à minuit');
    expect(slotText({ from: '2026-10-05T02:00:00Z', to: '2026-10-05T11:00:00Z', color: 2 }, NOW)).toBe('jaune le 05/10 de 04:00 à 13:00');
  });
});

describe('mots et couleurs', () => {
  it('couleurs officielles et météo des forêts sur l’échelle L1', () => {
    expect(COLOR_LEVEL).toEqual({ 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge' });
    expect(COLOR_WORD[3]).toBe('orange');
    expect(FOREST_DANGER_LEVEL).toEqual({ 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge' });
    expect(FOREST_DANGER_WORD[4]).toBe('très élevé');
    expect(ENVIRONMENT_THEME).toBe('Environnement');
  });
  it('phénomènes : libellés et pictogrammes de la carte', () => {
    expect(PHENOMENON_LABEL['2']).toBe('pluie-inondation');
    expect(PHENOMENON_LABEL['9']).toBe('vagues-submersion');
    expect([PHENOMENON_ICON['1'], PHENOMENON_ICON['3'], PHENOMENON_ICON['4']]).toEqual(['wind', 'cloud-lightning', 'waves']);
  });
  it('satellite nommé exactement, avec son capteur (E3)', () => {
    expect(SATELLITE_WORD['NOAA-21']).toBe('NOAA-21 (VIIRS)');
    expect(SATELLITE_WORD.Aqua).toBe('Aqua (MODIS)');
  });
});

describe('R1 : nombres collés à leur unité', () => {
  it('envBreakable repère une unité détachée ; les valeurs formatées n’en ont pas', () => {
    expect(envBreakable('hauteur 2,23 m')).toBe('2,23 m');
    expect(envBreakable('pluie 2,7 mm/h')).toBe('2,7 mm/h');
    expect(envBreakable('débit 12 m³/s')).toBe('12 m³/s');
    expect(envBreakable('35 dBZ')).toBe('35 dBZ');
    expect(envBreakable(`${formatHeightM(2.23)} ${formatFrp(4.2)} ${formatDbz(35)} ${formatAge(NOW - 207 * 60_000, NOW)}`)).toBeNull();
    expect(envBreakable('5 mètres')).toBeNull();
  });
  it('glueEnvUnits colle les raisons de pastille', () => {
    expect(glueEnvUnits('danger modéré aujourd’hui : 10 départements')).toBe(`danger modéré aujourd’hui : 10${N}départements`);
    expect(glueEnvUnits('foyer confirmé de 413 MW')).toBe(`foyer confirmé de 413${N}MW`);
    expect(glueEnvUnits('orages : Aude, Gard et 3 autres')).toBe(`orages : Aude, Gard et 3${N}autres`);
    expect(envBreakable(glueEnvUnits('foyer confirmé de 413 MW'))).toBeNull();
  });
});

describe('R1 : millimètres', () => {
  it('« 5 mm » détaché est repéré puis collé', () => {
    expect(envBreakable('cumul 5 mm')).toBe('5 mm');
    expect(envBreakable(glueEnvUnits('cumul 5 mm'))).toBeNull();
  });
});
