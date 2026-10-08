// src/components/layer-panel/traffic-format.test.ts
import { describe, expect, it } from 'vitest';
import { TRAFFIC_NOW, paris } from './traffic.fixture.ts';
import { NBSP } from './format.ts';
import {
  IMPORTANCE_LEVEL, RAIL_AXIS_LABEL, RAIL_EFFECT_WORD, ROAD_EVENT_LEVEL, SQUAWK_LEVEL, anomalyLabel, clockOf, coordText, dateOf, dirLoadLevel,
  emptyOrDown, fold, formatCount, formatKm, formatKmh, formatKnots, formatMeters, formatMinutes, formatNm, formatShare, glueUnits, jamLevel,
  plural, railDelayLevel, railGroupLevel, readErrors, shortDate, speedLevel, stamp, trafficBreakable,
} from './traffic-format.ts';

describe('formats des trafics (R1)', () => {
  it('unités insécables, milliers en espace fine insécable, « n.d. » pour une valeur absente', () => {
    expect(formatKm(169.5)).toBe(`169,5${NBSP}km`);
    expect(formatMinutes(1193)).toBe(`1\u202F193${NBSP}min`);
    expect(formatMinutes(56.7, { signed: true })).toBe(`+57${NBSP}min`);
    expect(formatKmh(89)).toBe(`89${NBSP}km/h`);
    expect(formatMeters(3000)).toBe(`3\u202F000${NBSP}m`);
    expect(formatNm(3.4)).toBe(`3,4${NBSP}milles`);
    expect(formatKnots(4.1)).toBe(`4,1${NBSP}nœuds`);
    // Revue finale M12 : singulier sous 2, jamais de décimale inutile (« 0,0 nœuds », « 14,0 nœuds »).
    expect([formatKnots(0), formatKnots(0.04), formatKnots(1.4), formatKnots(1.96), formatKnots(14), formatKnots(450, 0), formatKnots(null)])
      .toEqual([`0${NBSP}nœud`, `0${NBSP}nœud`, `1,4${NBSP}nœud`, `2${NBSP}nœuds`, `14${NBSP}nœuds`, `450${NBSP}nœuds`, 'n.d.']);
    expect(formatCount(1196)).toBe('1\u202F196');
    expect(formatShare(0.4)).toBe(`0,4${NBSP}%`);
    expect(formatShare(7.07)).toBe(`7${NBSP}%`);
    expect(formatShare(12.4)).toBe(`12${NBSP}%`);
    expect(formatShare(0.04)).toBe(`<${NBSP}0,1${NBSP}%`);
    expect(formatShare(0.1)).toBe(`0,1${NBSP}%`);
    expect(formatShare(0.96)).toBe(`1${NBSP}%`);
    expect(formatShare(0)).toBe(`0${NBSP}%`);
    for (const f of [formatKm, formatKmh, formatMeters, formatNm, formatKnots, formatCount, formatShare]) expect(f(null)).toBe('n.d.');
    expect(formatMinutes(Number.NaN)).toBe('n.d.');
  });
  it('contrôle R1 des trafics : repère « 12 km », « 50 km/h », « 2 h », « 3 milles », jamais une valeur insécable', () => {
    expect(trafficBreakable('bouchon de 12 km')).toBe('12 km');
    expect(trafficBreakable('sous 50 km/h')).toBe('50 km/h');
    expect(trafficBreakable('en 2 h')).toBe('2 h');
    expect(trafficBreakable('à 3,4 milles')).toBe('3,4 milles');
    expect(trafficBreakable('un taux de 7 %')).toBe('7 %');
    expect(trafficBreakable('à 5 mètres, 2 heures, 3 minutes')).toBeNull();
    expect(glueUnits('à 5 mètres, 7 % de 12 km')).toBe(`à 5 mètres, 7${NBSP}% de 12${NBSP}km`);
    expect(trafficBreakable(`bouchon de 12${NBSP}km, 50${NBSP}km/h, 4 accidents, le 1 mars`)).toBeNull();
  });
  it('raisons de la partie A rendues insécables ; libellés des trajectoires inhabituelles', () => {
    expect(glueUnits('retard moyen de 57 min : Sud-Est (6 trains)')).toBe(`retard moyen de 57${NBSP}min : Sud-Est (6${NBSP}trains)`);
    expect(glueUnits('2 coupures non planifiées de moins de 24 h')).toBe(`2${NBSP}coupures non planifiées de moins de 24${NBSP}h`);
    expect(trafficBreakable(glueUnits('15 trains grandes lignes à 15 min ou plus'))).toBeNull();
    expect(glueUnits('4 accidents et 1 coupure en cours')).toBe(`4${NBSP}accidents et 1${NBSP}coupure en cours`);
    expect([anomalyLabel('holding'), anomalyLabel('go-around'), anomalyLabel('rapid-manoeuvre'), anomalyLabel('reroute-probable')])
      .toEqual(['circuit d’attente', 'approche interrompue', 'manœuvre brusque', 'déroutement probable']);
    expect(anomalyLabel('autre')).toBe('autre');
  });
  it('heures et dates de Paris : heure le jour même, date sinon, année quand elle diffère', () => {
    expect(clockOf(paris('14:57'), TRAFFIC_NOW)).toBe('14:57');
    expect(clockOf(paris('13:50', '2026-09-28'), TRAFFIC_NOW)).toBe('28/09 13:50');
    expect(clockOf(null, TRAFFIC_NOW)).toBe('n.d.');
    expect(clockOf('pas une date', TRAFFIC_NOW)).toBe('n.d.');
    expect(dateOf('2026-01-31T08:00:00+01:00')).toBe('31/01/2026');
    expect(shortDate(paris('00:00', '2026-06-01'), TRAFFIC_NOW)).toBe('01/06');
    expect(shortDate('2024-10-22T08:00:00+02:00', TRAFFIC_NOW)).toBe('22/10/2024');
    expect(stamp('DIR', paris('14:57'), false, TRAFFIC_NOW)).toBe(`DIR${NBSP}14:57`);
    expect(stamp('DIR', paris('14:57'), true, TRAFFIC_NOW)).toBe(`DIR${NBSP}14:57${NBSP}(en retard)`);
    expect(stamp('DIR', null, true, TRAFFIC_NOW)).toBe(`DIR${NBSP}n.d.`);
  });
  it('pluriels, repliement des accents, coordonnées', () => {
    expect(plural(4, 'accident')).toBe('4 accidents');
    expect(plural(1, 'bouchon')).toBe('1 bouchon');
    expect(plural(0, 'coupure')).toBe('0 coupure');
    expect(plural(1301, 'aéronef')).toBe('1\u202F301 aéronefs');
    expect(fold(' Île-de-France ')).toBe('ile-de-france');
    expect(coordText(48.5, 2.1)).toBe(`48,500${NBSP}N${NBSP}2,100${NBSP}E`);
    expect(coordText(45.673, -0.099)).toBe(`45,673${NBSP}N${NBSP}0,099${NBSP}O`);
  });
  it('panne partielle : « source indisponible » quand la réponse signale une erreur, jamais « aucun »', () => {
    expect(emptyOrDown(['CNIR : HTTP 503'], 'Aucun bouchon.', 'CNIR')).toContain('Source indisponible : CNIR.');
    expect(emptyOrDown([], 'Aucun bouchon.', 'CNIR')).toContain('Aucun bouchon.');
    expect(readErrors([])).toBe('');
    expect(readErrors(['a <b>', 'c'])).toBe('<p class="fmk-note">Incidents de lecture : a &lt;b&gt; ; c.</p>');
  });
  it('couleurs partagées par les vues et la carte (maquette, arbitrage 7)', () => {
    expect(ROAD_EVENT_LEVEL).toEqual({ accident: 'rouge', queue: 'orange', closure: 'orange', weather: 'orange', obstruction: 'jaune', lane: 'jaune', works: 'gris', info: 'gris' });
    expect([dirLoadLevel(6), dirLoadLevel(7), dirLoadLevel(20), dirLoadLevel(40)]).toEqual(['vert', 'jaune', 'orange', 'rouge']);
    expect(IMPORTANCE_LEVEL).toEqual({ 1: 'vert', 2: 'jaune', 3: 'orange' });
    expect([speedLevel(14), speedLevel(45), speedLevel(60), speedLevel(89)]).toEqual(['rouge', 'orange', 'jaune', 'vert']);
    expect([jamLevel(1), jamLevel(2), jamLevel(3)]).toEqual(['jaune', 'orange', 'rouge']);
    expect(SQUAWK_LEVEL).toEqual({ '7500': 'rouge', '7700': 'orange', '7600': 'jaune' });
    expect([railGroupLevel({ avgDelayMin: 15, cancelled: 0 }), railGroupLevel({ avgDelayMin: 23.6, cancelled: 0 }),
      railGroupLevel({ avgDelayMin: 56.7, cancelled: 0 }), railGroupLevel({ avgDelayMin: 90, cancelled: 0 }),
      railGroupLevel({ avgDelayMin: 5, cancelled: 10 }), railGroupLevel({ avgDelayMin: null, cancelled: 0 })])
      .toEqual(['vert', 'jaune', 'orange', 'rouge', 'rouge', 'gris']);
    expect([railDelayLevel(14, false), railDelayLevel(15, false), railDelayLevel(45, false), railDelayLevel(140, false),
      railDelayLevel(null, true), railDelayLevel(null, false)]).toEqual(['vert', 'jaune', 'orange', 'rouge', 'rouge', 'gris']);
    expect(RAIL_EFFECT_WORD.supprime).toBe('supprimé');
    expect(RAIL_AXIS_LABEL.province).toBe('Province, transversales');
  });
});
