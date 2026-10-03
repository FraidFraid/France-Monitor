import { describe, expect, it } from 'vitest';
import type { RegionalAlertLevel, SyndromeKey, SyndromicResponse, SyndromicSeries, SyndromicWeekPoint, WastewaterPoint } from '../types/index.ts';
import {
  URGENCES_PILL_SYNDROMES, alertInSeason, alertsInputLevel, epiWeekLabel, franceRefs, isHealthDataLate, isMetropoleRegion,
  nationalHealthLevel, phaseLabel, phaseLevel, seasonalLevel, sentinellesActivityLevel, urgencesLevel, wastewaterLevel,
  type NationalInput,
} from './health-levels.ts';

const NOW = Date.parse('2026-10-03T08:00:00Z');
const point = (week: string, start: string, er: number | null): SyndromicWeekPoint => ({ week, start, er, hosp: null, sos: null });
// Parts réelles (Odissé, relevé du 03/10/2026) : semaine 39 des saisons 2023 à 2026, et S38 2026.
function series(key: SyndromeKey, values: [number, number, number, number, number]): SyndromicSeries {
  const [s23, s24, s25, s38, s39] = values;
  return {
    key, label: key, ageClass: key === 'bronchio' ? '0 an' : 'Tous âges', ages: {},
    france: [point('2023-S39', '2023-09-25', s23), point('2024-S39', '2024-09-23', s24), point('2025-S39', '2025-09-22', s25),
      point('2026-S38', '2026-09-14', s38), point('2026-S39', '2026-09-21', s39)],
  };
}
const SYNDROMIC: SyndromicResponse = {
  week: { id: '2026-S39', start: '2026-09-21', end: '2026-09-27' },
  publishedAt: '2026-09-30T10:00:20+00:00',
  syndromes: [series('ira', [3.292, 3.451, 2.542, 1.898, 2.108]), series('bronchio', [10.601, 8.051, 7.242, 5.793, 6.598]),
    series('gastro', [1.064, 1.028, 0.975, 1.058, 1.097])],
  departments: [],
  errors: [],
};
const alert = (region: string, phase: 1 | 2 | 3 | 4, start: string): RegionalAlertLevel =>
  ({ region, regionName: region, pathology: 'grippe', phase, week: 'x', start });
const ww = (start: string, national54: number | null): WastewaterPoint => ({ week: start, start, national54, national12: null });
const input = (key: NationalInput['key'], level: NationalInput['level'], late = false): NationalInput =>
  ({ key, level, late, label: key, value: '', period: '', note: '' });

describe('semaine épidémiologique', () => {
  it('même mois, mois différents, changement d’année', () => {
    expect(epiWeekLabel({ id: '2026-S39', start: '2026-09-21', end: '2026-09-27' })).toBe('S39 (21-27 sept.)');
    expect(epiWeekLabel({ id: '2026-S40', start: '2026-09-28', end: '2026-10-04' })).toBe('S40 (28 sept.-4 oct.)');
    expect(epiWeekLabel({ id: '2026-S53', start: '2026-12-28', end: '2027-01-03' })).toBe('S53 (28 déc.-3 janv.)');
  });
});

describe('niveau saisonnier', () => {
  const refs = [2.542, 3.451, 3.292];
  it('vérification du 03/10 : IRA 2,108 % contre 2,542 / 3,451 / 3,292 % : vert', () => {
    expect(seasonalLevel(2.108, refs)).toBe('vert');
  });
  it('vert jusqu’au maximum, jaune au-dessus, orange dès 1,15 fois le maximum, rouge dès 1,5 fois', () => {
    expect(seasonalLevel(3.4, refs)).toBe('vert');
    expect(seasonalLevel(3.451, refs)).toBe('vert');
    expect(seasonalLevel(3.5, refs)).toBe('jaune');
    expect(seasonalLevel(3.96, refs)).toBe('jaune');
    expect(seasonalLevel(3.97, refs)).toBe('orange');
    expect(seasonalLevel(5.17, refs)).toBe('orange');
    expect(seasonalLevel(5.18, refs)).toBe('rouge');
  });
  it('vérification du 03/10 : gastro-entérite 1,097 % contre 1,064 / 1,028 / 0,975 % : jaune (3 % au-dessus du maximum)', () => {
    expect(seasonalLevel(1.097, [1.064, 1.028, 0.975])).toBe('jaune');
  });
  it('nd sans valeur ou avec moins de deux saisons de référence', () => {
    expect(seasonalLevel(null, refs)).toBe('nd');
    expect(seasonalLevel(2, [2.5])).toBe('nd');
    expect(seasonalLevel(2, [])).toBe('nd');
  });
  it('références toutes nulles : zéro vert, toute hausse jaune au plus (petits effectifs)', () => {
    expect(seasonalLevel(0, [0, 0, 0])).toBe('vert');
    expect(seasonalLevel(0.1, [0, 0, 0])).toBe('jaune');
  });
  it('références de la même semaine ISO, plus récente d’abord ; S53 retombe sur S52', () => {
    expect(franceRefs(SYNDROMIC.syndromes[0].france, '2026-S39')).toEqual([2.542, 3.451, 3.292]);
    expect(franceRefs(SYNDROMIC.syndromes[0].france, '2026-S39', 2)).toEqual([2.542, 3.451]);
    expect(franceRefs([point('2025-S52', '2025-12-22', 1.5)], '2026-S53')).toEqual([1.5]);
    expect(franceRefs(SYNDROMIC.syndromes[0].france, 'S39')).toEqual([]);
  });
  it('autre champ de la série (hospitalisations après passage) : même semaine ISO, même repli S53 sur S52', () => {
    const s39 = [2023, 2024, 2025].map((y, i) => ({ ...point(`${y}-S39`, `${y}-09-2${i}`, 2), hosp: 5 + i / 10 }));
    expect(franceRefs(s39, '2026-S39', 3, (p) => p.hosp)).toEqual([5.2, 5.1, 5]);
    const s53 = [{ ...point('2025-S52', '2025-12-22', 1.5), hosp: 4.4 }, { ...point('2024-S52', '2024-12-23', 1.2), hosp: 3.9 }];
    expect(franceRefs(s53, '2026-S53', 3, (p) => p.hosp)).toEqual([4.4, 3.9]);
  });
});

describe('échelle d’alerte Odissé', () => {
  it('1 vert, 2 jaune, 3 orange, 4 jaune (post-épidémie, pas plus grave que 3)', () => {
    expect([1, 2, 3, 4].map((p) => phaseLevel(p as 1 | 2 | 3 | 4))).toEqual(['vert', 'jaune', 'orange', 'jaune']);
    expect([1, 2, 3, 4].map((p) => phaseLabel(p as 1 | 2 | 3 | 4))).toEqual(['pas d’alerte', 'pré-épidémie', 'épidémie', 'post-épidémie']);
  });
  it('en saison : lundi + 28 jours ≥ maintenant', () => {
    expect(alertInSeason(alert('06', 2, '2026-09-21'), NOW)).toBe(true);
    expect(alertInSeason(alert('11', 1, '2026-04-06'), NOW)).toBe(false);
    expect(alertInSeason(alert('11', 1, '2026-09-05'), Date.parse('2026-10-03T00:00:00Z'))).toBe(true);
    expect(alertInSeason(alert('11', 1, '2026-09-05'), Date.parse('2026-10-03T00:00:01Z'))).toBe(false);
  });
  it('Hexagone et Corse : 11 à 94 ; DROM et codes sans libellé exclus', () => {
    expect(['11', '94', '93', '06', '01', '07', '08', '1'].map(isMetropoleRegion)).toEqual([true, true, true, false, false, false, false, false]);
  });
  it('vérification du 03/10 : grippe en pré-épidémie à Mayotte, le reste hors saison : jaune', () => {
    expect(alertsInputLevel([alert('06', 2, '2026-09-21'), alert('11', 1, '2026-04-06'), alert('02', 3, '2026-04-06')], NOW)).toBe('jaune');
  });
  it('épidémie dans l’Hexagone : orange ; épidémie outre-mer seulement : jaune ; rien : vert', () => {
    expect(alertsInputLevel([alert('84', 3, '2026-09-21'), alert('06', 2, '2026-09-21')], NOW)).toBe('orange');
    expect(alertsInputLevel([alert('02', 3, '2026-09-21')], NOW)).toBe('jaune');
    expect(alertsInputLevel([alert('11', 1, '2026-09-21')], NOW)).toBe('vert');
    expect(alertsInputLevel([alert('11', 3, '2026-04-06')], NOW)).toBe('vert');
    expect(alertsInputLevel([], NOW)).toBe('vert');
  });
});

describe('Sentinelles et eaux usées', () => {
  it('niveau d’activité en mots', () => {
    expect(['faible', 'modérée', 'forte', 'très forte', ' Faible ', 'similaire', null].map(sentinellesActivityLevel))
      .toEqual(['vert', 'jaune', 'orange', 'rouge', 'vert', 'nd', 'nd']);
  });
  // national54 réels (SUM'eau, livraison du 30/09/2026) : S35 711,7 ; S36 928,7 ; S37 1 279,7 ; S38 1 838,9 ; S38 2025 : 3 072,8.
  const points = [ww('2026-08-24', 711.7), ww('2026-08-31', 928.7), ww('2026-09-07', 1279.7), ww('2026-09-14', 1838.9)];
  it('vérification du 03/10 : ×1,98 en deux semaines, sous l’an dernier : jaune', () => {
    expect(wastewaterLevel(points, ww('2025-09-15', 3072.8))).toBe('jaune');
  });
  it('deux critères : orange ; aucun : vert ; aucune comparaison : nd', () => {
    expect(wastewaterLevel(points, ww('2025-09-15', 1000))).toBe('orange');
    expect(wastewaterLevel([ww('2026-08-31', 1500), ww('2026-09-07', 1600), ww('2026-09-14', 1838.9)], ww('2025-09-15', 3072.8))).toBe('vert');
    expect(wastewaterLevel([ww('2026-09-14', 1838.9)], null)).toBe('nd');
    expect(wastewaterLevel([...points.slice(0, 3), ww('2026-09-14', null)], null)).toBe('nd');
    expect(wastewaterLevel([], null)).toBe('nd');
  });
});

describe('retard par source (S2)', () => {
  it('urgences : dimanche + 17 jours', () => {
    expect(isHealthDataLate('syndromic', '2026-09-27', NOW)).toBe(false);
    expect(isHealthDataLate('syndromic', '2026-09-27', Date.parse('2026-10-14T00:00:01Z'))).toBe(true);
  });
  it('Sentinelles dimanche + 13 j, eaux usées lundi + 28 j, ANSM + 7 j, rappels + 4 j', () => {
    expect(isHealthDataLate('sentinelles', '2026-09-27', Date.parse('2026-10-10T00:00:00Z'))).toBe(false);
    expect(isHealthDataLate('sentinelles', '2026-09-27', Date.parse('2026-10-10T00:00:01Z'))).toBe(true);
    expect(isHealthDataLate('wastewater', '2026-09-14', NOW)).toBe(false);
    expect(isHealthDataLate('wastewater', '2026-09-14', Date.parse('2026-10-12T00:00:01Z'))).toBe(true);
    expect(isHealthDataLate('ansm', '2026-10-02', NOW)).toBe(false);
    expect(isHealthDataLate('recalls', '2026-10-02T17:50:11+00:00', Date.parse('2026-10-06T17:50:12Z'))).toBe(true);
  });
  it('date illisible : en retard', () => {
    expect(isHealthDataLate('ansm', 'n.d.', NOW)).toBe(true);
  });
});

describe('pastille Urgences et niveau national', () => {
  it('trois syndromes : IRA, bronchiolite, gastro-entérite', () => {
    expect(URGENCES_PILL_SYNDROMES).toEqual(['ira', 'bronchio', 'gastro']);
  });
  it('données réelles S39 : IRA vert, bronchiolite vert, gastro-entérite 1,097 % au-dessus du maximum 1,064 % : jaune', () => {
    expect(urgencesLevel(SYNDROMIC)).toEqual({ level: 'jaune', driver: 'gastro' });
  });
  it('sans séries exploitables : nd', () => {
    expect(urgencesLevel({ ...SYNDROMIC, syndromes: [] })).toEqual({ level: 'nd', driver: null });
    expect(urgencesLevel({ ...SYNDROMIC, week: null, syndromes: [series('ira', [3.292, 3.451, 2.542, 1.898, 2.108])] }))
      .toEqual({ level: 'vert', driver: 'ira' });
  });
  it('plus haut niveau des entrées à jour ; à égalité, la première ; en retard et nd écartées', () => {
    const r = nationalHealthLevel([input('alerts', 'jaune'), input('sentinelles', 'vert'), input('urgences', 'orange', true), input('wastewater', 'jaune')]);
    expect(r.level).toBe('jaune');
    expect(r.driver?.key).toBe('alerts');
    expect(r.excluded.map((i) => i.key)).toEqual(['urgences']);
    const nd = nationalHealthLevel([input('alerts', 'nd'), input('wastewater', 'rouge', true)]);
    expect(nd).toEqual({ level: 'nd', driver: null, excluded: [input('alerts', 'nd'), input('wastewater', 'rouge', true)] });
  });
});
