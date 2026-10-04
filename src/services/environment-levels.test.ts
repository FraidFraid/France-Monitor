import { describe, expect, it } from 'vitest';
import type {
  FireFoyer, FiresResponse, FloodSection, FloodStation, FloodsResponse, ForestDanger, ForestDangerDept, VigilanceDepartment, VigilancePeriod,
  VigilanceResponse,
} from '../types/index.ts';
import {
  ENVIRONMENT_LATE_AFTER_MIN, ORANGE_FOYER_MW, dayWordOf, firesLevel, floodsLevel, forestDangerCurrent, forestDangerSeason, foyerLevel,
  isEnvironmentDataLate, isMajorFoyer, nextVigilanceMap, parisDayOf, stationLate, vigilanceLevel,
} from './environment-levels.ts';

const T = (iso: string): number => Date.parse(iso);
/** 4 octobre 2026, 10 h 10 à Paris (08:10Z) : heure des relevés de la spec. */
const NOW = T('2026-10-04T10:10:00+02:00');

// ─── Vigilance : valeurs réelles de la carte du 04/10 à 10 h (update_time 08:00:12Z) ───

function dept(code: string, name: string, color: 2 | 3 | 4, phenomena: VigilanceDepartment['phenomena']): VigilanceDepartment {
  return { code, name, color, phenomena };
}

const AUDE = dept('11', 'Aude', 3, [
  { id: '2', color: 3, slots: [
    { from: '2026-10-04T08:00:00Z', to: '2026-10-04T14:00:00Z', color: 3 },
    { from: '2026-10-04T14:00:00Z', to: '2026-10-04T18:00:00Z', color: 2 },
    { from: '2026-10-04T18:00:00Z', to: '2026-10-04T22:00:00Z', color: 1 },
  ] },
  { id: '3', color: 2, slots: [{ from: '2026-10-04T08:00:00Z', to: '2026-10-04T18:00:00Z', color: 2 }, { from: '2026-10-04T18:00:00Z', to: '2026-10-04T22:00:00Z', color: 1 }] },
]);
const PO = dept('66', 'Pyrénées-Orientales', 3, [
  { id: '2', color: 3, slots: [{ from: '2026-10-04T08:00:00Z', to: '2026-10-04T14:00:00Z', color: 3 }] },
  { id: '3', color: 2, slots: [{ from: '2026-10-04T08:00:00Z', to: '2026-10-04T16:00:00Z', color: 2 }] },
  { id: '4', color: 2, slots: [] },
]);
const GARD = dept('30', 'Gard', 2, [{ id: '3', color: 2, slots: [{ from: '2026-10-04T17:00:00Z', to: '2026-10-04T22:00:00Z', color: 2 }] }]);

function period(over: Partial<VigilancePeriod>): VigilancePeriod {
  return {
    echeance: 'J', begin: '2026-10-04T08:00:00Z', end: '2026-10-04T22:00:00Z', maxColor: 3,
    comment: 'Un nouvel épisode pluvio-orageux actif est attendu sur les Pyrénées-orientales et l’Aude.',
    departments: [AUDE, PO, GARD], greenDepartments: 93,
    coast: [{ code: '3010', departement: '30', name: 'Gard, littoral', color: 1, slots: [] }],
    counts: [{ color: 2, count: 5 }, { color: 3, count: 2 }], perPhenomenon: [], ...over,
  };
}

function vigilance(periods: VigilancePeriod[], updateTime: string | null = '2026-10-04T08:00:12Z'): VigilanceResponse {
  return { updateTime, textsUpdateTime: updateTime, periods, bulletins: [], history: { days: [], since: null }, readAt: '2026-10-04T08:05:00Z', errors: [] };
}

describe('isEnvironmentDataLate (tableau S2)', () => {
  it.each(Object.entries(ENVIRONMENT_LATE_AFTER_MIN).filter(([s]) => s !== 'mdf'))('%s : en retard au-delà de %i min, pas à la limite', (source, minutes) => {
    const s = source as keyof typeof ENVIRONMENT_LATE_AFTER_MIN;
    expect(isEnvironmentDataLate(s, new Date(NOW - minutes * 60_000).toISOString(), NOW)).toBe(false);
    expect(isEnvironmentDataLate(s, new Date(NOW - minutes * 60_000 - 1000).toISOString(), NOW)).toBe(true);
  });
  it('vigilance du 04/10 à 08:00:12Z : à l’heure à 10 h 10, en retard 15 h plus tard (23:00:12Z, 01:00 à Paris)', () => {
    expect(isEnvironmentDataLate('vigilance', '2026-10-04T08:00:12Z', NOW)).toBe(false);
    expect(isEnvironmentDataLate('vigilance', '2026-10-04T08:00:12Z', T('2026-10-04T23:00:13Z'))).toBe(true);
  });
  it('date absente ou illisible : en retard', () => {
    expect(isEnvironmentDataLate('radar', null, NOW)).toBe(true);
    expect(isEnvironmentDataLate('firms', 'hier', NOW)).toBe(true);
  });
  it('météo des forêts : en retard après 30 h en saison ; jamais hors saison', () => {
    expect(isEnvironmentDataLate('mdf', '2026-10-03T14:50:06Z', NOW)).toBe(false);
    expect(isEnvironmentDataLate('mdf', '2026-10-03T14:50:06Z', T('2026-10-04T20:51:00Z'))).toBe(true); // moins de 72 h : encore en saison
    expect(isEnvironmentDataLate('mdf', '2026-09-30T14:50:00Z', T('2026-10-15T10:00:00+02:00'))).toBe(false);
  });
  it('météo des forêts : limite exacte de 30 h, puis une seconde de plus', () => {
    const published = '2026-10-03T14:50:06Z';
    expect(isEnvironmentDataLate('mdf', published, Date.parse(published) + 30 * 3_600_000)).toBe(false);
    expect(isEnvironmentDataLate('mdf', published, Date.parse(published) + 30 * 3_600_000 + 1000)).toBe(true);
  });
});

describe('saison de la météo des forêts', () => {
  it('juin à septembre (Paris) : en saison ; octobre : selon l’âge de la publication (72 h)', () => {
    expect(forestDangerSeason(null, T('2026-06-01T00:30:00+02:00'))).toBe('en-saison');
    expect(forestDangerSeason('2026-09-30T14:50:00Z', T('2026-09-30T23:59:00+02:00'))).toBe('en-saison');
    expect(forestDangerSeason('2026-10-03T14:50:06Z', NOW)).toBe('en-saison');
    expect(forestDangerSeason('2026-10-03T14:50:06Z', T('2026-10-06T14:50:07Z'))).toBe('hors-saison');
    expect(forestDangerSeason(null, NOW)).toBe('hors-saison');
  });
  it('bornes de saison à minuit de Paris', () => {
    expect(forestDangerSeason(null, T('2026-05-31T23:59:59+02:00'))).toBe('hors-saison');
    expect(forestDangerSeason(null, T('2026-06-01T00:00:00+02:00'))).toBe('en-saison');
    expect(forestDangerSeason(null, T('2026-09-30T23:59:59+02:00'))).toBe('en-saison');
    expect(forestDangerSeason(null, T('2026-10-01T00:00:00+02:00'))).toBe('hors-saison');
  });
});

describe('heures et jours de Paris', () => {
  it('prochaine carte régulière : 14:00Z (16 h) à 10 h 10 ; 04:00Z le lendemain après 16 h ; 04:00Z avant 06 h', () => {
    expect(new Date(nextVigilanceMap(NOW)).toISOString()).toBe('2026-10-04T14:00:00.000Z');
    expect(new Date(nextVigilanceMap(T('2026-10-04T16:30:00+02:00'))).toISOString()).toBe('2026-10-05T04:00:00.000Z');
    expect(new Date(nextVigilanceMap(T('2026-10-04T05:00:00+02:00'))).toISOString()).toBe('2026-10-04T04:00:00.000Z');
    // Heure d'hiver : 04:00Z = 05 h à Paris.
    // Heure d'hiver : 06 h Paris = 05:00Z, 16 h Paris = 15:00Z.
    expect(new Date(nextVigilanceMap(T('2026-11-02T03:00:00+01:00'))).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
  it('cartes à 06 h et 16 h de Paris toute l’année, autour du changement d’heure du 25/10/2026', () => {
    expect(new Date(nextVigilanceMap(T('2026-10-25T13:00:00Z'))).toISOString()).toBe('2026-10-25T15:00:00.000Z');
    expect(new Date(nextVigilanceMap(T('2026-10-24T13:00:00Z'))).toISOString()).toBe('2026-10-24T14:00:00.000Z');
    // Juste après une carte : la suivante est le prochain 06 h de Paris (lendemain, heure d'hiver).
    expect(new Date(nextVigilanceMap(T('2026-10-24T14:00:01Z'))).toISOString()).toBe('2026-10-25T05:00:00.000Z');
    expect(new Date(nextVigilanceMap(T('2026-10-25T15:00:00Z'))).toISOString()).toBe('2026-10-26T05:00:00.000Z');
    expect(new Date(nextVigilanceMap(T('2026-10-25T04:00:00Z'))).toISOString()).toBe('2026-10-25T05:00:00.000Z');
  });
  it('jour de Paris, mots du jour (minuit de Paris et changement d’heure compris)', () => {
    expect(parisDayOf(T('2026-10-04T23:30:00Z'))).toBe('2026-10-05');
    expect(dayWordOf('2026-10-04', NOW)).toBe('aujourd’hui');
    expect(dayWordOf('2026-10-05', NOW)).toBe('demain');
    expect(dayWordOf('2026-10-06', NOW)).toBe('le 06/10');
    expect(dayWordOf('2027-03-28', T('2027-03-27T23:30:00+01:00'))).toBe('demain');
  });
});

describe('vigilanceLevel', () => {
  it('J du 04/10 : orange, pluie-inondation dans l’Aude et les Pyrénées-Orientales', () => {
    expect(vigilanceLevel(vigilance([period({})]))).toEqual({ level: 'orange', reason: 'pluie-inondation : Aude, Pyrénées-Orientales' });
  });
  it('J1 : jaune, orages dans le plus de départements (liste triée par nom)', () => {
    const storms = { id: '3' as const, color: 2 as const, slots: [] };
    const j1 = period({
      echeance: 'J1', begin: '2026-10-04T22:00:00Z', end: '2026-10-05T22:00:00Z', maxColor: 2, comment: null,
      departments: [
        dept('11', 'Aude', 2, [{ id: '2', color: 2, slots: [] }, storms]), dept('13', 'Bouches-du-Rhône', 2, [storms]),
        dept('2A', 'Corse-du-Sud', 2, [storms]), dept('30', 'Gard', 2, [storms]), dept('2B', 'Haute-Corse', 2, [storms]),
        dept('66', 'Pyrénées-Orientales', 2, [{ id: '2', color: 2, slots: [] }, storms, { id: '4', color: 2, slots: [] }]),
      ],
      counts: [{ color: 2, count: 6 }],
    });
    expect(vigilanceLevel(vigilance([period({}), j1]), 'J1')).toEqual({ level: 'jaune', reason: 'orages : Aude, Bouches-du-Rhône, Corse-du-Sud et 3 autres' });
    expect(vigilanceLevel(vigilance([period({ departments: [AUDE, PO, GARD, dept('34', 'Hérault', 3, [{ id: '2', color: 3, slots: [] }]), dept('13', 'Bouches-du-Rhône', 3, [{ id: '2', color: 3, slots: [] }])] })])))
      .toEqual({ level: 'orange', reason: 'pluie-inondation : Aude, Pyrénées-Orientales, Hérault et 1 autre' });
  });
  it('domaine littoral seul à la couleur maximale (amendement 8) : vagues-submersion', () => {
    const coastOnly = period({ maxColor: 3, departments: [GARD], coast: [{ code: '6610', departement: '66', name: 'Pyrénées-Orientales, littoral', color: 3, slots: [] }] });
    expect(vigilanceLevel(vigilance([coastOnly]))).toEqual({ level: 'orange', reason: 'vagues-submersion : Pyrénées-Orientales, littoral' });
  });
  it('J1 absent : n.d., jamais « aucune vigilance »', () => {
    expect(vigilanceLevel(vigilance([period({})]), 'J1')).toEqual({ level: 'nd', reason: 'carte de vigilance Météo-France indisponible' });
  });
  it('carte lue sans vigilance : vert, et c’est dit ; carte jamais lue : n.d., jamais « aucune vigilance »', () => {
    expect(vigilanceLevel(vigilance([period({ maxColor: 1, departments: [], counts: [] })]))).toEqual({ level: 'vert', reason: 'aucune vigilance jaune ou plus' });
    expect(vigilanceLevel(vigilance([], null))).toEqual({ level: 'nd', reason: 'carte de vigilance Météo-France indisponible' });
  });
});

// ─── Crues : tronçons du 04/10 (TCC21, Méditerranée Ouest) ───

function section(id: string, name: string, level: 2 | 3 | 4): FloodSection {
  return { id, name, level, territory: { code: '21', name: 'Méditerranée Ouest', url: 'https://www.vigicrues.gouv.fr/territoire/21' }, path: [[[2.37, 42.59], [2.38, 42.6]]], stations: [] };
}

function floods(sections: FloodSection[], counts: FloodsResponse['counts'], readAt: string | null = '2026-10-04T08:05:00Z'): FloodsResponse {
  return { readAt, total: 337, counts, sections, stationsReadAt: readAt, stationsOmitted: 0, errors: [] };
}

describe('floodsLevel', () => {
  it('04/10 : 4 tronçons jaunes de la Têt à la Tech', () => {
    const f = floods([section('MO12', 'Têt', 2), section('MO11', 'Agly', 2), section('MO13', 'Réart', 2), section('MO14', 'Tech', 2)], { vert: 333, jaune: 4, orange: 0, rouge: 0 });
    expect(floodsLevel(f)).toEqual({ level: 'jaune', reason: 'Têt, Agly, Réart, Tech (Méditerranée Ouest)' });
  });
  it('niveau maximal seulement, par territoire ; vert dit ; n.d. sans relevé', () => {
    const loire = { ...section('LC104', 'Loire bourguignonne', 3), territory: { code: '30', name: 'Loire-Allier-Cher-Indre', url: 'https://www.vigicrues.gouv.fr/territoire/30' } };
    expect(floodsLevel(floods([section('MO12', 'Têt', 2), loire], { vert: 335, jaune: 1, orange: 1, rouge: 0 })))
      .toEqual({ level: 'orange', reason: 'Loire bourguignonne (Loire-Allier-Cher-Indre)' });
    expect(floodsLevel(floods([], { vert: 337, jaune: 0, orange: 0, rouge: 0 }))).toEqual({ level: 'vert', reason: 'aucun tronçon en vigilance jaune ou plus' });
    expect(floodsLevel(floods([], { vert: 0, jaune: 0, orange: 0, rouge: 0 }, null))).toEqual({ level: 'nd', reason: 'Vigicrues indisponible' });
  });
  it('niveau et raison viennent des mêmes tronçons, même si les compteurs disent autre chose', () => {
    const f = floods([section('MO12', 'Têt', 2)], { vert: 336, jaune: 0, orange: 1, rouge: 0 });
    expect(floodsLevel(f)).toEqual({ level: 'jaune', reason: 'Têt (Méditerranée Ouest)' });
  });
  it('station en retard une heure après sa dernière mesure (Vinca, 07:55Z)', () => {
    const vinca: FloodStation = {
      code: 'Y046401001', name: 'Vinca', lat: 42.64, lon: 2.53, lastAt: '2026-10-04T07:55:00Z', heightM: 22.29, flowM3s: null, change1hM: 0, heightSeries: [], flowSeries: [],
    };
    expect(stationLate(vinca, NOW)).toBe(false);
    expect(stationLate(vinca, T('2026-10-04T08:55:01Z'))).toBe(true);
    expect(stationLate({ ...vinca, lastAt: null }, NOW)).toBe(true);
  });
});

// ─── Feux : météo des forêts du 03/10 (J1 = 04/10) et foyers ───

function foyer(over: Partial<FireFoyer>): FireFoyer {
  return {
    id: 'f1', dept: '13', depts: ['13'], lat: 43.44, lon: 4.89, detections: 1, passes: 1, confirmed: false, recurrent: false,
    frpTotalMw: 4.15, frpMaxMw: 4.15, firstAt: '2026-10-04T01:37:00Z', lastAt: '2026-10-04T01:37:00Z', satellites: ['Suomi NPP'],
    confidenceMax: 'nominale', nightDetections: 1, ...over,
  };
}

const LEVEL2 = ['04', '06', '13', '2A', '2B', '31', '44', '51', '83', '84'];
function forestDanger(over: Partial<ForestDanger> = {}, depts: ForestDangerDept[] = []): ForestDanger {
  const base: ForestDangerDept[] = depts.length > 0 ? depts : [
    ...LEVEL2.map((d): ForestDangerDept => ({ dept: d, name: `dépt ${d}`, j1: 2, j2: 1 })),
    { dept: '01', name: 'Ain', j1: 1, j2: 1 },
  ];
  return {
    publishedAt: '2026-10-03T14:50:06Z', j1Date: '2026-10-04', j2Date: '2026-10-05', season: 'en-saison', departments: base,
    history: [{ date: '2026-10-04', n1: 86, n2: 10, n3: 0, n4: 0 }], ...over,
  };
}

function fires(foyers: FireFoyer[], fd: ForestDanger | null = forestDanger(), readAt: string | null = '2026-10-04T08:00:00Z'): FiresResponse {
  return {
    readAt, lastAcquisitionAt: '2026-10-04T04:43:00Z', sources: [], detections: [], abroadCount: 0, abroad: [], foyers,
    daily: { days: [], since: null }, nextPasses: [], forestDanger: fd, errors: [],
  };
}

describe('foyers', () => {
  it('couleur : récurrent gris ; isolé jaune ; confirmé de moins de 10 MW jaune (arbitrage 14) ; confirmé d’au moins 10 MW orange ; d’au moins 100 MW rouge ; confiance faible jamais rouge', () => {
    expect(foyerLevel(foyer({ recurrent: true, confirmed: true, frpTotalMw: 300 }))).toBe('gris');
    expect(foyerLevel(foyer({}))).toBe('jaune');
    expect(ORANGE_FOYER_MW).toBe(10);
    expect(foyerLevel(foyer({ confirmed: true, passes: 2 }))).toBe('jaune');
    expect(foyerLevel(foyer({ confirmed: true, passes: 2, frpTotalMw: 9.99 }))).toBe('jaune');
    expect(foyerLevel(foyer({ confirmed: true, passes: 2, frpTotalMw: 10 }))).toBe('orange');
    expect(foyerLevel(foyer({ confirmed: true, passes: 3, frpTotalMw: 100 }))).toBe('rouge');
    expect(foyerLevel(foyer({ confirmed: true, passes: 3, frpTotalMw: 100, confidenceMax: 'faible' }))).toBe('orange');
    expect(isMajorFoyer(foyer({ confirmed: true, frpTotalMw: 99.9 }))).toBe(false);
  });
});

describe('firesLevel', () => {
  it('10 départements au niveau 2 aujourd’hui (publication du 03/10), seules sources récurrentes de Fos-sur-Mer et de Dunkerque : jaune', () => {
    const recurrent = [foyer({ id: 'fos', recurrent: true, confirmed: true, passes: 5 }), foyer({ id: 'dunkerque', dept: '59', lat: 51.04, lon: 2.29, recurrent: true, confirmed: true, passes: 9, frpTotalMw: 194.06, confidenceMax: 'haute' })];
    expect(firesLevel(fires(recurrent), NOW)).toEqual({ level: 'jaune', reason: 'danger modéré aujourd’hui : 10 départements' });
  });
  it('rouge : niveau 4, ou foyer confirmé d’au moins 100 MW ; causes du même niveau réunies', () => {
    const fd4 = forestDanger({}, [{ dept: '2B', name: 'Haute-Corse', j1: 4, j2: 3 }, { dept: '13', name: 'Bouches-du-Rhône', j1: 3, j2: 3 }]);
    expect(firesLevel(fires([], fd4), NOW)).toEqual({ level: 'rouge', reason: 'danger très élevé aujourd’hui : Haute-Corse' });
    const big = foyer({ confirmed: true, passes: 4, frpTotalMw: 412.6 });
    expect(firesLevel(fires([big], fd4), NOW)).toEqual({ level: 'rouge', reason: 'foyer confirmé de 413 MW ; danger très élevé aujourd’hui : Haute-Corse' });
  });
  it('orange : foyer confirmé non récurrent d’au moins 10 MW ; jaune : foyer confirmé plus petit (arbitrage 14) ou détection isolée', () => {
    const ain = forestDanger({}, [{ dept: '01', name: 'Ain', j1: 1, j2: 1 }]);
    expect(firesLevel(fires([foyer({ confirmed: true, passes: 2, frpTotalMw: 12.4 })], ain), NOW))
      .toEqual({ level: 'orange', reason: 'un foyer confirmé en France' });
    expect(firesLevel(fires([foyer({ confirmed: true, passes: 2 })], ain), NOW))
      .toEqual({ level: 'jaune', reason: 'un foyer confirmé de moins de 10 MW en France' });
    // Le 04/10 : petits foyers confirmés (3,91 et 2,58 MW) et 10 départements au niveau 2 : jaune, causes réunies.
    const small = [foyer({ confirmed: true, passes: 2, frpTotalMw: 3.91 }), foyer({ id: 'f2', confirmed: true, passes: 2, frpTotalMw: 2.58 }), foyer({ id: 'f3' })];
    expect(firesLevel(fires(small), NOW))
      .toEqual({ level: 'jaune', reason: '2 foyers confirmés de moins de 10 MW en France ; danger modéré aujourd’hui : 10 départements' });
    expect(firesLevel(fires([foyer({})], null), NOW)).toEqual({ level: 'jaune', reason: 'une détection isolée en France ; météo des forêts indisponible' });
    // Foyer majeur de confiance faible : jamais rouge dans la pastille, orange au plus.
    const faible = foyer({ confirmed: true, passes: 4, frpTotalMw: 250, confidenceMax: 'faible' });
    expect(firesLevel(fires([faible], ain), NOW)).toEqual({ level: 'orange', reason: 'un foyer confirmé en France' });
    // Département au niveau 3 : orange.
    const fd3 = forestDanger({}, [{ dept: '13', name: 'Bouches-du-Rhône', j1: 3, j2: 2 }]);
    expect(firesLevel(fires([], fd3), NOW)).toEqual({ level: 'orange', reason: 'danger élevé aujourd’hui : Bouches-du-Rhône' });
  });
  it('hors saison : niveaux échus sans couleur (publication du 30/09 lue le 15/10)', () => {
    const old = forestDanger({ publishedAt: '2026-09-30T14:50:00Z', j1Date: '2026-10-01', j2Date: '2026-10-02', season: 'hors-saison' });
    const later = T('2026-10-15T10:00:00+02:00');
    expect(forestDangerCurrent(old, later)).toBe(false);
    expect(firesLevel(fires([], old), later)).toEqual({ level: 'vert', reason: 'aucun foyer en France ; météo des forêts hors saison' });
  });
  it('pannes : n.d. si les deux sources manquent, ou FIRMS en panne hors saison ; une seule source : niveau sur l’autre, panne dite', () => {
    expect(firesLevel(fires([], null, null), NOW)).toEqual({ level: 'nd', reason: 'FIRMS et météo des forêts indisponibles' });
    const old = forestDanger({ j1Date: '2026-10-01' });
    expect(firesLevel(fires([], old, null), NOW)).toEqual({ level: 'nd', reason: 'FIRMS indisponible ; météo des forêts hors saison' });
    expect(firesLevel(fires([], forestDanger(), null), NOW)).toEqual({ level: 'jaune', reason: 'danger modéré aujourd’hui : 10 départements ; détections FIRMS indisponibles' });
    expect(firesLevel(fires([foyer({ recurrent: true })], null), NOW))
      .toEqual({ level: 'vert', reason: 'aucun foyer en France hors 1 source récurrente à vérifier ; météo des forêts indisponible' });
  });
});
