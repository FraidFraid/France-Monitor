import { describe, expect, it } from 'vitest';
import type { EcowattResponse, GridSnapshot, EcowattOfficialDay } from '../../types/index.ts';
import { buildGridView, formatGw, gridLead, hourLevel, importDependencyIndex, riskWindow } from './grid.ts';
import { renderLayerView } from './frame.ts';

const NOW = Date.parse('2026-10-02T05:00:00Z'); // 07:00 Paris
const open = (_id: string, d: boolean): boolean => d;
const green = (date: string): EcowattOfficialDay => ({ date, level: 'green', message: 'Pas d’alerte.', hours: Array(24).fill(1) });
const GRID: GridSnapshot = {
  dataTime: Date.parse('2026-10-02T04:45:00Z'), consumptionMw: 40563, forecastMw: 41200, co2gPerKwh: 50, netImportMw: -3664,
  mix: { nuclear: 30871, hydro: 6638, wind: 1750, solar: 0, thermal: 3968, bio: 992 },
  day: [
    { at: Date.parse('2026-10-01T22:00:00Z'), consumptionMw: 45000, forecastMw: 45200 },
    { at: Date.parse('2026-10-02T04:45:00Z'), consumptionMw: 40563, forecastMw: 41200 },
    { at: Date.parse('2026-10-02T17:30:00Z'), consumptionMw: null, forecastMw: 52300 },
  ],
};
function data(over: Partial<EcowattResponse> = {}): EcowattResponse {
  return {
    official: { source: 'rte', generatedAt: '2026-10-02T04:00:00Z', days: [green('2026-10-02'), green('2026-10-03'), green('2026-10-04'), green('2026-10-05')] },
    mixes: {}, national: { timestamp: new Date(NOW), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 },
    interconnections: [{ country: 'Royaume-Uni', flowMW: 2200, coordinates: [1, 51] }, { country: 'Italie', flowMW: -2800, coordinates: [7, 45] }],
    grid: GRID, ...over,
  };
}
const html = (d: EcowattResponse | null): string => renderLayerView('powerGrid', buildGridView({ data: d, space: null, now: NOW, open }));

describe('vue Réseau électrique', () => {
  it('synthèse : conforme sous 3 % d’écart, production, bas-carbone, CO2, export', () => {
    expect(gridLead(GRID)).toBe('Consommation de 40,6 GW, conforme à la prévision. Production de 44,2 GW, 91 % bas-carbone, 50 g CO₂/kWh. La France exporte 3,7 GW.');
    expect(gridLead({ ...GRID, consumptionMw: 42436, forecastMw: 41200 })).toContain('supérieure de 3 % à la prévision');
    expect(gridLead({ ...GRID, consumptionMw: 39964, forecastMw: 41200 })).toContain('inférieure de 3 % à la prévision');
    expect(gridLead({ ...GRID, netImportMw: 1500 })).toContain('La France importe 1,5 GW.');
  });
  it('synthèse sans prévision ni CO2 : rien d’inventé', () => {
    const lead = gridLead({ ...GRID, forecastMw: null, co2gPerKwh: null });
    expect(lead).toContain('Consommation de 40,6 GW.');
    expect(lead).not.toMatch(/prévision|CO₂|NaN|undefined/);
  });
  it('fenêtre de risque Écowatt et niveaux horaires', () => {
    const hours = Array(24).fill(1) as Array<0 | 1 | 2 | 3>;
    expect(riskWindow(hours)).toBeNull();
    hours[8] = 2; hours[9] = 3; hours[12] = 2;
    expect(riskWindow(hours)).toEqual({ from: 8, to: 13 });
    expect(hourLevel(0)).toBe('vert');
    expect(hourLevel(2)).toBe('orange');
    expect(hourLevel(3)).toBe('rouge');
  });
  it('formats et indice de dépendance inchangé', () => {
    expect(formatGw(30871)).toBe('30,9 GW');
    expect(formatGw(null)).toBe('n.d.');
    expect(importDependencyIndex([{ country: 'A', flowMW: 5000, coordinates: [0, 0] }, { country: 'B', flowMW: -9000, coordinates: [0, 0] }])).toBe(10);
  });
  it('en-tête : pastille Écowatt du jour, ligne de niveau, synthèse', () => {
    const v = buildGridView({ data: data(), space: null, now: NOW, open });
    expect(v.head).toMatchObject({ theme: 'Énergie', title: 'Réseau électrique', level: 'vert' });
    expect(v.head.status).toEqual(['Écowatt : pas d’alerte', 'données de 06:45', 'RTE, ODRÉ']);
  });
  it('repli ODRÉ J-1 : pastille grise et signal différé', () => {
    const v = buildGridView({ data: data({ official: { source: 'odre', generatedAt: null, days: [green('2026-10-01')] } }), space: null, now: NOW, open });
    expect(v.head.level).toBe('nd');
    expect(v.head.status[0]).toBe('Écowatt : signal différé J-1 (ODRÉ)');
  });
  it('Écowatt orange : message RTE en synthèse et heures nommées', () => {
    const today: EcowattOfficialDay = { date: '2026-10-02', level: 'orange', message: 'Système <b>tendu</b>.', hours: Array(24).fill(1) as Array<0 | 1 | 2 | 3> };
    today.hours[8] = 2; today.hours[12] = 2;
    const v = buildGridView({ data: data({ official: { source: 'rte', generatedAt: null, days: [today] } }), space: null, now: NOW, open });
    expect(v.head.level).toBe('orange');
    expect(v.head.lead).toBe('Système <b>tendu</b>. Coupures possibles de 08:00 à 13:00.');
    expect(renderLayerView('powerGrid', v)).not.toContain('<b>tendu</b>');
  });
  it('sections dans l’ordre, ouvertes et repliées comme la spec', () => {
    const v = buildGridView({ data: data(), space: null, now: NOW, open });
    expect(v.sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['ecowatt', true], ['consumption', true], ['production', true], ['exchanges', false], ['space', false], ['sources', false],
    ]);
    expect(v.sections.find((s) => s.id === 'sources')?.tone).toBe('reference');
  });
  it('production : barre colorée par filière, légende, bilan', () => {
    const h = html(data());
    expect(h).toContain('var(--mix-nuclear)');
    expect(h).toMatch(/Nucléaire[^]*30,9 GW/);
    expect(h).toMatch(/Intensité carbone[^]*50 g CO₂\/kWh/);
    expect(h).toMatch(/Part bas-carbone[^]*91 %/);
  });
  it('consommation : courbe réalisé et prévision, pic prévu', () => {
    const v = buildGridView({ data: data(), space: null, now: NOW, open });
    expect(v.sections.find((s) => s.id === 'consumption')?.summary).toBe('40,6 GW · pic prévu 52,3 GW à 19:30');
    const h = html(data());
    expect(h).toContain('role="img"');
    expect(h).toMatch(/Pic prévu[^]*52,3 GW à 19:30/);
  });
  it('échanges : texte neutre, solde, indice expliqué', () => {
    const v = buildGridView({ data: data(), space: null, now: NOW, open });
    expect(v.sections.find((s) => s.id === 'exchanges')?.summary).toBe('export net 3,7 GW');
    const h = html(data());
    expect(h).toMatch(/Royaume-Uni[^]*import 2,2 GW/);
    expect(h).toMatch(/Italie[^]*export 2,8 GW/);
    expect(h).toContain('Indice de dépendance aux imports');
  });
  it('sans données réseau : n.d. et phrases, jamais vide', () => {
    const h = html(data({ grid: null }));
    expect(h).toContain('Courbe du jour indisponible.');
    expect(h).not.toMatch(/NaN|undefined/);
  });
  it('aucune donnée du tout : vue de chargement', () => {
    const v = buildGridView({ data: null, space: null, now: NOW, open });
    expect(v.head.status).toEqual(['chargement…']);
    expect(v.bodyHtml).toContain('Chargement des données…');
  });
  it('aucun tiret cadratin, aucune police à chasse fixe', () => {
    const h = html(data());
    expect(h).not.toMatch(/—|&mdash;|monospace/);
  });
});
