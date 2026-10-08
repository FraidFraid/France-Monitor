// src/components/layer-panel/health-format.test.ts
import { describe, expect, it } from 'vitest';
import { HEALTH_NOW, surveillanceFixture, syndromicFixture } from './health.fixture.ts';
import { HEALTH_SURVEILLANCE_URLS, type HealthSurveillanceKey } from '../../services/health-surveillance.ts';
import { NBSP } from './format.ts';
import {
  APL_PROFESSIONS, APL_UNIT, HEALTH_PART, HOSPITAL_CATEGORY_LABEL, HOSPITAL_CATEGORY_ORDER, departementName, hospitalCategoryVar, aplMgLevel, aplProfessionLevel, aplRatioLevel, PER_100K, changeHtml, changeLevel, changePct, inSentence, isoWeekId, joinFr, parisDay, positionWords, ratioText, regionIn,
  seasonalDigits, seasonalNote, seasonalReading, shiftDate, sourcePeriod, sourceUnavailable, trendArrowHtml, trendOf, urgencesDriver, weekNumber,
  weekShort, weekYear, URGENCES_SYNDROMES, URGENCES_SYNDROME_LABEL, failedPillSyndromes, partFailed, spfPagePart, syndromeDepartmentsPart,
  syndromeFrancePart,
} from './health-format.ts';

const serie = (key: 'ira' | 'gastro') => {
  const s = syndromicFixture().syndromes.find((x) => x.key === key);
  if (!s) throw new Error(`série ${key} absente`);
  return s;
};
const ira = () => serie('ira');

describe('aides des panneaux Santé', () => {
  it('« pour 100 000 habitants » insécable', () => {
    expect(PER_100K).toBe('pour 100 000 habitants');
  });
  it('semaines : libellé court, numéro, année, semaine ISO d’une date, décalage', () => {
    expect([weekShort('2026-S39'), weekShort('2027-S01'), weekNumber('2026-S39'), weekYear('2026-S39'), weekNumber('x')]).toEqual(['S39', 'S1', 39, 2026, null]);
    expect([isoWeekId('2026-09-21'), isoWeekId('2026-09-27'), isoWeekId('2026-01-01'), isoWeekId('2027-01-03')]).toEqual(['2026-S39', '2026-S39', '2026-S01', '2026-S53']);
    expect([shiftDate('2026-09-21', -7), shiftDate('2026-03-30', -1), shiftDate('2026-12-28', 7)]).toEqual(['2026-09-14', '2026-03-29', '2027-01-04']);
  });
  it('jour de Paris « jj/mm », jamais une date brute', () => {
    expect([parisDay('2026-09-30T10:01:00Z'), parisDay('2026-04-13'), parisDay(null), parisDay('x')]).toEqual(['30/09', '13/04', 'n.d.', 'n.d.']);
  });
  it('évolution : hausse de 10 % ou plus rouge, baisse de 10 % ou plus verte, sur la valeur affichée', () => {
    expect(changePct(2.108, 1.898)).toBeCloseTo(11.064, 2);
    expect([changePct(1, 0), changePct(null, 1), changePct(1, undefined)]).toEqual([null, null, null]);
    expect([9.6, 9.4, -9.58, -9.4, null].map(changeLevel)).toEqual(['rouge', null, 'vert', null, null]);
    expect(changeHtml(11.06)).toBe(`<span class="lp-val fmk-num lp-lvl lp-lvl--rouge">+11${NBSP}%</span>`);
    expect(changeHtml(-13)).toContain('lp-lvl--vert');
    expect(changeHtml(11.06, true)).toBe(`<span class="lp-val fmk-num">+11${NBSP}%</span>`);
    expect(changeHtml(null)).toBe('<span class="lp-val fmk-num">n.d.</span>');
  });
  it('tendance en mots du réseau Sentinelles : flèche rouge en hausse, verte en baisse, sans couleur en retard', () => {
    expect(['en augmentation', 'légère augmentation', 'stable', 'en diminution', 'en baisse', null, 'autre'].map(trendOf))
      .toEqual(['up', 'up', 'stable', 'down', 'down', null, null]);
    expect(trendArrowHtml('up')).toBe('<span class="lp-trend lp-lvl lp-lvl--rouge" aria-label="en hausse">▲</span>');
    expect(trendArrowHtml('down')).toBe('<span class="lp-trend lp-lvl lp-lvl--vert" aria-label="en baisse">▼</span>');
    expect(trendArrowHtml('up', true)).toBe('<span class="lp-trend" aria-label="en hausse">▲</span>');
    expect(trendArrowHtml('stable')).toBe('<span class="lp-trend" aria-label="stable">=</span>');
    expect(trendArrowHtml(null)).toBe('');
  });
  it('phrases : source indisponible, rapport, sigles, listes, lieux', () => {
    expect(sourceUnavailable('réseau <b>')).toBe('<p class="fiche-empty">Source indisponible : réseau &lt;b&gt;.</p>');
    expect([ratioText(1.98), ratioText(2.58), ratioText(1.5)]).toEqual(['×2', '×2,6', '×1,5']);
    expect(['IRA', 'COVID-19', 'Bronchiolite', 'Gastro-entérite'].map(inSentence)).toEqual(['IRA', 'COVID-19', 'bronchiolite', 'gastro-entérite']);
    expect([joinFr([]), joinFr(['a']), joinFr(['a', 'b']), joinFr(['a', 'b', 'c'])]).toEqual(['', 'a', 'a et b', 'a, b et c']);
    expect([regionIn('06', 'Mayotte'), regionIn('11', 'Île-de-France'), regionIn('32', 'Hauts-de-France'), regionIn('99', 'Ailleurs')])
      .toEqual(['à Mayotte', 'en Île-de-France', 'dans les Hauts-de-France', 'en Ailleurs']);
  });
  it('lecture saisonnière S39 : IRA 2,1 % contre 2,5 / 3,5 / 3,3 % : vert, sous les trois saisons', () => {
    const r = seasonalReading(ira(), '2026-S39');
    expect(r).toEqual({ value: 2.108, previous: 1.898, refs: [2.542, 3.451, 3.292], level: 'vert' });
    expect(seasonalDigits(r)).toBe(1);
    expect(seasonalNote(r)).toBe(`sous les 3 saisons précédentes à la même semaine (2,5${NBSP}% à 3,5${NBSP}%)`);
    expect(seasonalNote({ ...r, value: 3, level: 'vert' })).toBe(`dans la fourchette des 3 saisons précédentes à la même semaine (2,5${NBSP}% à 3,5${NBSP}%)`);
    expect(seasonalNote({ ...r, value: 3.6, level: 'jaune' })).toBe(`au-dessus des 3 saisons précédentes à la même semaine (maximum 3,5${NBSP}%)`);
    expect(seasonalNote({ ...r, value: 4, level: 'orange' })).toBe(`au moins 1,15 fois le maximum des 3 saisons précédentes à la même semaine (3,5${NBSP}%)`);
    expect(seasonalNote({ ...r, value: 5.3, level: 'rouge' })).toBe(`au moins 1,5 fois le maximum des 3 saisons précédentes à la même semaine (3,5${NBSP}%)`);
    expect(seasonalNote({ ...r, refs: [2.5], level: 'nd' })).toBe('comparaison saisonnière n.d. (moins de deux saisons de référence)');
    expect(seasonalReading(ira(), '2026-S40')).toMatchObject({ value: null, level: 'nd' });
  });
  it('gastro-entérite S39 : 1,097 % contre 1,064 / 1,028 / 0,975 % : jaune (au-dessus du maximum, moins de 1,15 fois), deux décimales', () => {
    const r = seasonalReading(serie('gastro'), '2026-S39');
    expect(r.level).toBe('jaune');
    expect(seasonalDigits(r)).toBe(2);
    expect(seasonalNote(r)).toBe(`au-dessus des 3 saisons précédentes à la même semaine (maximum 1,06${NBSP}%)`);
  });
  it('position par rapport aux saisons précédentes ; syndrome du niveau des urgences : le premier au plus haut niveau', () => {
    const r = seasonalReading(ira(), '2026-S39');
    expect(positionWords(r)).toBe('sous les saisons précédentes');
    expect(positionWords({ ...r, value: 3, level: 'vert' })).toBe('dans la fourchette des saisons précédentes');
    expect((['jaune', 'orange', 'rouge', 'nd'] as const).map((level) => positionWords({ ...r, level }))).toEqual([
      'au-dessus des saisons précédentes', 'bien au-dessus des saisons précédentes', 'très au-dessus des saisons précédentes', null,
    ]);
    expect(urgencesDriver(syndromicFixture(), 'jaune')).toBe('gastro');
    expect(urgencesDriver(syndromicFixture(), 'vert')).toBe('ira');
  });
  it('sélecteur des urgences : IRA, bronchiolite, gastro-entérite, IRA par défaut (spec § 3.2)', () => {
    expect(URGENCES_SYNDROMES).toEqual(['ira', 'bronchio', 'gastro']);
    expect(URGENCES_SYNDROME_LABEL).toEqual({ ira: 'IRA', bronchio: 'Bronchiolite', gastro: 'Gastro-entérite' });
  });
  it('APL : cinq professions ; généralistes rouge sous 2,5, orange de 2,5 à 3,5, jaune de 3,5 à 4 ; autres en rapport à la moyenne nationale', () => {
    expect(APL_PROFESSIONS).toEqual(['mg', 'inf', 'kine', 'sf', 'dent']);
    expect([2.49, 2.5, 3.49, 3.5, 3.99, 4].map(aplMgLevel)).toEqual(['rouge', 'orange', 'orange', 'jaune', 'jaune', 'vert']);
    expect([49, 50, 74, 75, 99, 100].map((v) => aplRatioLevel(v, 100))).toEqual(['rouge', 'orange', 'orange', 'jaune', 'jaune', 'vert']);
    expect(aplRatioLevel(10, 0)).toBeNull();
    expect([aplProfessionLevel('mg', 2.37, 3.72), aplProfessionLevel('inf', 67.9, 154.8), aplProfessionLevel('kine', null, 123.2), aplProfessionLevel('sf', 20, null)])
      .toEqual(['rouge', 'rouge', null, null]);
    expect(APL_UNIT.sf).toBe('ETP pour 100 000 femmes');
    expect(APL_UNIT.inf).toBe('ETP pour 100 000 habitants');
  });
  it('hôpitaux : six catégories en jetons de catégorie, noms de départements dans l’ordre des codes INSEE', () => {
    expect(HOSPITAL_CATEGORY_ORDER).toEqual(['chu', 'ch', 'private', 'gcs', 'army', 'other']);
    expect(HOSPITAL_CATEGORY_LABEL.private).toBe('Cliniques privées');
    expect(HOSPITAL_CATEGORY_ORDER.map(hospitalCategoryVar)).toEqual([
      'var(--cat-hosp-chu)', 'var(--cat-hosp-ch)', 'var(--cat-hosp-private)', 'var(--cat-hosp-gcs)', 'var(--cat-hosp-army)', 'var(--mix-other)',
    ]);
    expect(['01', '19', '2A', '2B', '21', '59', '75', '95', '971', '976', '20'].map(departementName)).toEqual([
      'Ain', 'Corrèze', 'Corse-du-Sud', 'Haute-Corse', 'Côte-d’Or', 'Nord', 'Paris', 'Val-d’Oise', 'Guadeloupe', 'Mayotte', '20',
    ]);
  });
});

describe('panneau des sources : période réelle de la donnée (spec 2026-10-03 S1, S2)', () => {
  const KEYS = Object.keys(HEALTH_SURVEILLANCE_URLS) as HealthSurveillanceKey[];
  it('semaine et publication, date du dernier message, de la liste ou du dernier rappel ; jamais « temps réel »', () => {
    const s = surveillanceFixture();
    expect(Object.fromEntries(KEYS.map((k) => [k, sourcePeriod(s, k, HEALTH_NOW)]))).toEqual({
      syndromic: 'S39 · publiée le 30/09', alerts: 'S39', sentinelles: 'S39 provisoire', wastewater: 'S38 · publiée le 30/09',
      international: 'message du 02/10', ministry: 'message du 28/09', drugs: 'liste du 02/10', recalls: 'rappel du 02/10',
    });
  });
  it('donnée en retard : « (en retard) » ; source sans donnée : aucune période', () => {
    const s = surveillanceFixture();
    expect(sourcePeriod(s, 'sentinelles', Date.parse('2026-10-20T12:00:00Z'))).toBe('S39 provisoire (en retard)');
    expect(sourcePeriod({ ...s, alerts: { data: null, error: 'HTTP 502', fetchedAt: null } }, 'alerts', HEALTH_NOW)).toBeUndefined();
  });
  it('donnée reçue sans période lisible (Odissé en échec, pages régionales lues) : « n.d. », jamais undefined ni « temps réel »', () => {
    const s = surveillanceFixture();
    const alerts = s.alerts.data;
    if (!alerts) throw new Error('fixture');
    const partial = { ...s, alerts: { ...s.alerts, data: { ...alerts, levels: [], latestWeek: null, errors: ['Odissé, niveaux d’alerte : HTTP 429'] } } };
    expect(sourcePeriod(partial, 'alerts', HEALTH_NOW)).toBe('n.d.');
  });
});

describe('pannes partielles (S3) : parties nommées par les libellés d’erreur des gestionnaires', () => {
  it('partFailed : libellé de la partie suivi de « : » ; aucune confusion entre parties voisines', () => {
    const errors = ['Odissé, niveaux d’alerte : HTTP 429', 'Odissé, IRA départements : HTTP 500', 'Santé publique France, page Océan Indien : HTTP 503'];
    expect(partFailed(errors, HEALTH_PART.alerts)).toBe(true);
    expect(partFailed(errors, syndromeDepartmentsPart('ira'))).toBe(true);
    expect(partFailed(errors, syndromeFrancePart('ira'))).toBe(false);
    expect(partFailed(errors, spfPagePart('Océan Indien'))).toBe(true);
    expect(partFailed(errors, spfPagePart('Antilles'))).toBe(false);
    expect(partFailed(errors, HEALTH_PART.who)).toBe(false);
    expect(partFailed([], HEALTH_PART.alerts)).toBe(false);
    expect([syndromeFrancePart('bronchio'), syndromeDepartmentsPart('gastro')]).toEqual(['Odissé, Bronchiolite France', 'Odissé, Gastro-entérite départements']);
  });
  it('syndromes de la pastille des urgences dont l’export France a échoué', () => {
    const d = syndromicFixture();
    expect(failedPillSyndromes(d)).toEqual([]);
    d.errors = ['Odissé, Asthme France : HTTP 500', 'Odissé, IRA France : HTTP 500', 'Odissé, Gastro-entérite départements : HTTP 500'];
    expect(failedPillSyndromes(d)).toEqual(['ira']);
  });
});
