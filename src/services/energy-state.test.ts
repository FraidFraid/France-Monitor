// src/services/energy-state.test.ts
import { describe, expect, it } from 'vitest';
import {
  ENERGY_CHOKE_HEX, ENERGY_DISC_STATE_HEX, ENERGY_FLOW_COLORS, ENERGY_FLOW_KIND_LABEL, ENERGY_SECTOR_GLYPH_DARK, ENERGY_SECTOR_HEX,
  ENERGY_STATE_HEX, ENERGY_STATES, fuelTensionVigilance, gasStorageState, hydroState, isEnergyAlert, nuclearState,
  powerOutageState, refineryState, windState,
} from './energy-state.ts';

describe('états de l’énergie', () => {
  it('rouge, orange, jaune et vert sont ceux de la vigilance ; maintenance et sans état restent lisibles sur fond sombre', () => {
    expect(ENERGY_STATE_HEX.arret).toBe('#ff3b30');
    expect(ENERGY_STATE_HEX.tension).toBe('#ff9500');
    expect(ENERGY_STATE_HEX.reduit).toBe('#ffcc00');
    expect(ENERGY_STATE_HEX.normal).toBe('#34c759');
    expect(ENERGY_STATE_HEX.maintenance).toBe('#6e6e80');
    expect(ENERGY_STATE_HEX.nonSuivi).toBe('#c7c7cc');
    expect(ENERGY_STATES).toEqual(['arret', 'tension', 'reduit', 'maintenance', 'normal', 'nonSuivi']);
  });
  it('seuls l’arrêt et la tension sont des alertes', () => {
    expect(ENERGY_STATES.filter(isEnergyAlert)).toEqual(['arret', 'tension']);
  });
  it('nucléaire : imprévu = arrêt, réduit, programmé = maintenance, disponible = normal, inconnu = sans état', () => {
    expect(nuclearState('OUTAGE_UNPLANNED')).toBe('arret');
    expect(nuclearState('REDUCED')).toBe('reduit');
    expect(nuclearState('OUTAGE_PLANNED')).toBe('maintenance');
    expect(nuclearState('AVAILABLE')).toBe('normal');
    expect(nuclearState('UNKNOWN')).toBe('nonSuivi');
  });
  it('stockage de gaz : sous 30 % tension, 30 à 50 % réduit, 50 % et plus normal, valeur absente sans état', () => {
    expect(gasStorageState(29.9)).toBe('tension');
    expect(gasStorageState(30)).toBe('reduit');
    expect(gasStorageState(49.9)).toBe('reduit');
    expect(gasStorageState(50)).toBe('normal');
    expect(gasStorageState(null)).toBe('nonSuivi');
    expect(gasStorageState(Number.NaN)).toBe('nonSuivi');
  });
  it('hydraulique : stress = tension, haut = réduit, normal et bas = normal', () => {
    expect(hydroState('stress')).toBe('tension');
    expect(hydroState('high')).toBe('reduit');
    expect(hydroState('normal')).toBe('normal');
    expect(hydroState('low')).toBe('normal');
  });
  it('éolien : démantelé = hors service, le reste n’a pas d’état mesuré', () => {
    expect(windState('inactive')).toBe('maintenance');
    expect(windState('operating')).toBe('nonSuivi');
    expect(windState('unknown')).toBe('nonSuivi');
  });
  it('raffinerie : statut déclaré, active sans état suivi, maintenance et arrêt en maintenance', () => {
    expect(refineryState('active')).toBe('nonSuivi');
    expect(refineryState('maintenance')).toBe('maintenance');
    expect(refineryState('offline')).toBe('maintenance');
  });
  it('unité EDF : imprévue = arrêt, planifiée = maintenance, donnée en retard = sans état', () => {
    expect(powerOutageState('imprevue', false)).toBe('arret');
    expect(powerOutageState('planifiee', false)).toBe('maintenance');
    expect(powerOutageState('imprevue', true)).toBe('nonSuivi');
  });
  it('tension carburants sur la vigilance', () => {
    expect(fuelTensionVigilance('CRITICAL')).toBe('rouge');
    expect(fuelTensionVigilance('HIGH')).toBe('orange');
    expect(fuelTensionVigilance('MEDIUM')).toBe('jaune');
    expect(fuelTensionVigilance('LOW')).toBe('vert');
  });
});

describe('palettes de la carte Énergie', () => {
  it('une couleur franche par filière, distinctes deux à deux', () => {
    expect(ENERGY_SECTOR_HEX).toEqual({
      nucleaire: '#8b5cf6', hydraulique: '#2f80ff', eolien: '#14c8d8', gaz: '#e64bb4', petrole: '#8fa3bf', electricite: '#eef2f7',
    });
    expect(new Set(Object.values(ENERGY_SECTOR_HEX)).size).toBe(6);
  });
  it('picto foncé sur les disques clairs seulement', () => {
    expect([...ENERGY_SECTOR_GLYPH_DARK].sort()).toEqual(['electricite', 'eolien', 'petrole']);
  });
  it('couleurs d’état des disques', () => {
    expect(ENERGY_DISC_STATE_HEX).toEqual({ arret: '#ff3b30', tension: '#ff9500', reduit: '#ffcc00', maintenance: '#5c5f6b' });
  });
  it('six couleurs de flux distinctes, libellés en français', () => {
    const all = Object.values(ENERGY_FLOW_COLORS).flatMap((c) => [c.export, c.import]);
    expect(new Set(all).size).toBe(6);
    expect(ENERGY_FLOW_COLORS.elec).toEqual({ export: '#2ee59d', import: '#e9f542' });
    expect(ENERGY_FLOW_COLORS.gaz).toEqual({ export: '#4dc9ff', import: '#ff8a65' });
    expect(ENERGY_FLOW_COLORS.petrole).toEqual({ export: '#e2e8f0', import: '#e3c58f' });
    expect(ENERGY_FLOW_KIND_LABEL).toEqual({ elec: 'électricité', gaz: 'gaz', petrole: 'pétrole' });
    expect(ENERGY_CHOKE_HEX).toBe('#e3c58f');
  });
});
