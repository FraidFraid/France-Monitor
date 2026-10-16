// src/components/deckgl/energy-hover.test.ts
import { describe, expect, it } from 'vitest';
import {
  chokeCard, clusterCard, flowCard, fmtNum, fmtTime, infraCard, powerUnitCard, regionCard, tooltipCardHtml, gasCard,
} from './energy-hover.ts';

describe('gabarit de bulle', () => {
  it('nombres au format français avec unité insécable ; n.d. si absent', () => {
    expect(fmtNum(1310, 'MW')).toBe(`${(1310).toLocaleString('fr-FR')} MW`);
    expect(fmtNum(10.12, '%', 1)).toBe('10,1 %');
    expect(fmtNum(undefined, 'MW')).toBe('n.d.');
    expect(fmtNum(Number.NaN, 'MW')).toBe('n.d.');
  });
  it('heure courte ; null si illisible', () => {
    expect(fmtTime('2026-10-16T07:45:00Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(fmtTime('')).toBeNull();
  });
  it('titre, état en mots et en couleur, lignes, source ; jamais de tiret cadratin ni de undefined', () => {
    const html = tooltipCardHtml({ sectorHex: '#8b5cf6', title: 'Belleville <1>', time: '09:45', state: 'maintenance',
      rows: [['Indisponible', '1 310 MW']], source: 'EDF' });
    expect(html).toContain('Belleville &lt;1&gt;');
    expect(html).toContain('Arrêt annoncé ou hors service');
    expect(html).toContain('Source : EDF · 09:45');
    expect(html).not.toMatch(/—|undefined|NaN/);
    const nd = tooltipCardHtml({ sectorHex: '#fff', title: 'X', time: null, state: null, rows: [], source: null });
    expect(nd).toContain('Source : n.d.');
  });
  it('site nucléaire : liste trois unités indisponibles au plus, puis le reste', () => {
    const units = ['A', 'B', 'C', 'D'].map((n) => ({ name: n, lostMw: 900, kind: 'planifiee' }));
    const c = infraCard({ type: 'nuclear', name: 'Tricastin', energyState: 'maintenance', available: 2700, power: 3600 }, units);
    expect(c.rows.map((r) => r[0])).toEqual(['Disponible', 'A', 'B', 'C', 'Autres unités']);
    expect(c.rows[4][1]).toBe('1');
  });
  it('unité EDF : nom lisible, indisponibilité et nature', () => {
    const c = powerUnitCard({ name: 'FR_MAREGES_G3', kind: 'planifiee', lostMw: 120, energyState: 'maintenance', sector: 'Hydraulique' });
    expect(c.title).toBe('Marèges G3');
    expect(c.rows).toEqual([['Filière', 'Hydraulique'], ['Indisponible', fmtNum(120, 'MW')], ['Nature', 'maintenance']]);
  });
  it('stockage de gaz : sans relevé, état « sans état suivi » et remplissage n.d.', () => {
    const c = gasCard({ type: 'storage', name: 'Lussagnet', energyState: 'nonSuivi', fillLevel: null, capacity: 3.5 });
    expect(c.state).toBe('nonSuivi');
    expect(c.rows[0]).toEqual(['Remplissage', 'n.d.']);
  });
  it('groupe : nombre, alertes, invitation à zoomer', () => {
    const c = clusterCard('wind', 42, 2);
    expect(c.title).toBe('42 éoliennes');
    expect(c.rows).toEqual([['Dont en alerte', '2']]);
    expect(c.hint).toBe('Zoomer pour le détail');
  });
  it('flux et détroit', () => {
    const f = flowCard({ kind: 'petrole', isImport: true, who: 'Afrique', flowValue: 336, flowUnit: 'kb/j', hubName: 'Fos / Lavera' });
    expect(f.title).toBe('Afrique · pétrole');
    expect(f.rows).toContainEqual(['Port d’arrivée', 'Fos / Lavera']);
    const d = chokeCard({ name: 'Suez', flows: JSON.stringify([{ who: 'Moyen-Orient', value: 93, unit: 'kb/j' }]) });
    expect(d.rows).toEqual([['Moyen-Orient', fmtNum(93, 'kb/j')], ['Total', fmtNum(93, 'kb/j')]]);
  });
  it('région', () => {
    const r = regionCard({ name: 'Grand Est', consumptionMw: 4700, productionMw: 6100, deltaPct: -8.2, updatedAt: null });
    expect(r.rows).toEqual([['Consommation', fmtNum(4700, 'MW')], ['Production', fmtNum(6100, 'MW')], ['Solde', `+${fmtNum(1400, 'MW')}`]]);
  });
});
