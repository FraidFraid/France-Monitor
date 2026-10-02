import { describe, expect, it } from 'vitest';
import type { EcowattResponse, GridSnapshot, EcowattOfficialDay } from '../../types/index.ts';
import { buildGridView, consumptionFigure, formatGw, gridLead, hourLevel, importDependencyIndex, importDependencyLevel, rangesText, riskWindow } from './grid.ts';
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
  it('gros chiffre : consommation avec son unité, comparaison à la prévision en légende (seuil brut 3 %)', () => {
    const NB = '\u00a0';
    expect(consumptionFigure(GRID)).toEqual({ value: `40,6${NB}GW`, caption: `consommation · conforme à la prévision (41,2${NB}GW)` });
    // Seuil sur l'écart brut : 2,9 % reste conforme, 3,0 % ne l'est plus.
    expect(consumptionFigure({ ...GRID, consumptionMw: 41200 * 1.029, forecastMw: 41200 })?.caption).toContain('conforme à la prévision');
    expect(consumptionFigure({ ...GRID, consumptionMw: 41200 * 1.03, forecastMw: 41200 })?.caption).toContain(`supérieure de 3${NB}% à la prévision`);
    expect(consumptionFigure({ ...GRID, consumptionMw: 39964, forecastMw: 41200 })?.caption).toContain(`inférieure de 3${NB}% à la prévision`);
    expect(consumptionFigure({ ...GRID, forecastMw: null })).toEqual({ value: `40,6${NB}GW`, caption: 'consommation' });
    expect(consumptionFigure({ ...GRID, consumptionMw: null })).toEqual({ value: 'n.d.', caption: 'consommation' });
  });
  it('synthèse : production, bas-carbone, CO2, export ; la consommation est dans le gros chiffre', () => {
    const NB = '\u00a0';
    expect(gridLead(GRID)).toBe(`Production de 44,2${NB}GW, 91${NB}% bas-carbone, 50${NB}g${NB}CO₂/kWh. La France exporte 3,7${NB}GW.`);
    expect(gridLead({ ...GRID, netImportMw: 1500 })).toContain(`La France importe 1,5${NB}GW.`);
  });
  it('synthèse sans CO2 : rien d’inventé', () => {
    const lead = gridLead({ ...GRID, forecastMw: null, co2gPerKwh: null });
    expect(lead).not.toMatch(/Consommation|prévision|CO₂|NaN|undefined/);
  });
  it('fenêtre de risque Écowatt et niveaux horaires', () => {
    const hours = Array(24).fill(1) as Array<0 | 1 | 2 | 3>;
    expect(riskWindow(hours)).toBeNull();
    hours[8] = 2; hours[9] = 3; hours[12] = 2;
    expect(riskWindow(hours)).toEqual({ ranges: [{ from: 8, to: 10 }, { from: 12, to: 13 }], level: 'rouge' });
    expect(rangesText(riskWindow(hours)!.ranges)).toBe('de 08:00 à 10:00 et de 12:00 à 13:00');
    expect(hourLevel(0)).toBe('vert');
    expect(hourLevel(2)).toBe('orange');
    expect(hourLevel(3)).toBe('rouge');
  });
  it('niveau de l’indice de dépendance : 5, 10 et 15 sur 20', () => {
    expect([0, 5, 6, 10, 11, 15, 16, 20].map(importDependencyLevel)).toEqual(['vert', 'vert', 'jaune', 'jaune', 'orange', 'orange', 'rouge', 'rouge']);
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
    expect(v.head.figure).toEqual({ value: '40,6\u00a0GW', caption: 'consommation · conforme à la prévision (41,2\u00a0GW)' });
  });
  it('éCO2mix « en retard » au-delà de 45 min (pas 15 min + délai de publication), pas avant', () => {
    const at = (ageMin: number) => buildGridView({ data: data({ grid: { ...GRID, dataTime: NOW - ageMin * 60_000 } }), space: null, now: NOW, open }).head.status[1];
    expect(at(40)).not.toContain('en retard');
    expect(at(46)).toContain('(en retard)');
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
    expect(v.head.lead).toBe('Système <b>tendu</b>. Système tendu de 08:00 à 09:00 et de 12:00 à 13:00.');
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
  it('échanges : import en rouge, export en vert, solde, indice expliqué', () => {
    const v = buildGridView({ data: data(), space: null, now: NOW, open });
    expect(v.sections.find((s) => s.id === 'exchanges')?.summary).toBe('<span class="lp-exp">export net 3,7 GW</span>');
    const h = html(data());
    expect(h).toMatch(/Royaume-Uni[^]*import 2,2 GW/);
    expect(h).toMatch(/Italie[^]*export 2,8 GW/);
    expect(h).toContain('Par frontière, échanges commerciaux');
    // Indice : ligne mise en avant, jauge colorée par niveau (2,2 GW d'import brut → 4/20, vert).
    expect(h).toMatch(/<div class="lp-index"><div class="fmk-meter"><span class="fmk-meter-label">Dépendance aux imports<\/span><span class="fmk-bar"><i style="width:20%;background:var\(--sev-green\)"><\/i><\/span><span class="fmk-meter-v fmk-num">4\/20<\/span>/);
    // Explications déplacées dans Sources : la section reste visuelle.
    const exch = v.sections.find((s) => s.id === 'exchanges')?.html ?? '';
    expect(exch).not.toContain('fmk-note');
    expect(v.sections.find((s) => s.id === 'sources')?.html).toContain('import en rouge, export en vert');
    expect(h).toMatch(/Solde physique[^]*export net 3,7 GW/);
    expect(h).toContain('<span class="lp-imp">import 2,2 GW</span>');
    expect(h).toContain('<span class="lp-exp">export 2,8 GW</span>');
  });
  it('échanges : flèche selon la moyenne des 7 jours, rouge si la position de la France se dégrade', () => {
    const series = (mw: number): number[] => Array(96).fill(mw);
    const withHistory = (h: Map<string, number[]>): string =>
      renderLayerView('powerGrid', buildGridView({ data: data(), space: null, now: NOW, open, borderHistory: h }));
    // Royaume-Uni : import 2,2 GW contre 1,0 GW en moyenne → import en hausse, rouge.
    // Italie : export 2,8 GW contre 1,0 GW en moyenne → export en hausse, vert.
    const h = withHistory(new Map([['FR-GB', series(1000)], ['FR-IT', series(-1000)]]));
    expect(h).toMatch(/import 2,2 GW<\/span><span class="lp-trend lp-trend--bad"[^>]*title="en hausse par rapport à la moyenne sur 7 jours \(\+1,2 GW\)"[^>]*>▲<\/span>/);
    expect(h).toMatch(/export 2,8 GW<\/span><span class="lp-trend lp-trend--good"[^>]*title="en hausse par rapport à la moyenne sur 7 jours \(\+1,8 GW\)"[^>]*>▲<\/span>/);
    // Import en baisse : vert ▼ ; export en baisse : rouge ▼.
    const down = withHistory(new Map([['FR-GB', series(3000)], ['FR-IT', series(-4000)]]));
    expect(down).toMatch(/import 2,2 GW<\/span><span class="lp-trend lp-trend--good"[^>]*>▼<\/span>/);
    expect(down).toMatch(/export 2,8 GW<\/span><span class="lp-trend lp-trend--bad"[^>]*>▼<\/span>/);
    // Écart sous 200 MW, ou historique absent ou trop court : pas de flèche.
    expect(withHistory(new Map([['FR-GB', series(2100)], ['FR-IT', series(-2800)]]))).not.toContain('lp-trend');
    expect(withHistory(new Map([['FR-GB', [1000, 1000]]]))).not.toContain('lp-trend');
    expect(html(data())).not.toContain('lp-trend');
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

  it('minuit à Paris : bande Écowatt et courbe du jour de Paris, pas de l’UTC', () => {
    const now = Date.parse('2026-10-02T22:30:00Z'); // 00:30 Paris le 03/10
    const d02 = green('2026-10-02');
    const d03: EcowattOfficialDay = { ...green('2026-10-03'), level: 'orange', hours: Array(24).fill(1) as Array<0 | 1 | 2 | 3> };
    d03.hours[5] = 2;
    const grid: GridSnapshot = {
      ...GRID, dataTime: Date.parse('2026-10-02T22:15:00Z'), consumptionMw: 41000, forecastMw: 41000,
      day: [
        { at: Date.parse('2026-10-02T10:00:00Z'), consumptionMw: 50000, forecastMw: 51000 },
        { at: Date.parse('2026-10-02T22:00:00Z'), consumptionMw: 41000, forecastMw: 41000 },
        { at: Date.parse('2026-10-03T10:00:00Z'), consumptionMw: null, forecastMw: 47000 },
      ],
    };
    const d = data({ grid, official: { source: 'rte', generatedAt: null, days: [d02, d03] } });
    const v = buildGridView({ data: d, space: null, now, open });
    const h = renderLayerView('powerGrid', v);
    expect(h).toContain('Écowatt heure par heure : vert de 00:00 à 05:00, orange de 05:00 à 06:00, vert de 06:00 à 24:00');
    expect(v.sections.find((s) => s.id === 'consumption')?.summary).toContain('pic prévu 47,0 GW');
    expect(h).not.toContain('51,0 GW');
    expect(h).toMatch(/<polyline points="0\.0,[^"]*" fill="none" stroke="var\(--text-muted\)"/);
  });
  it('textes tiers hostiles toujours échappés', () => {
    const d = data({ interconnections: [{ country: '<img src=x onerror=1>', flowMW: 100, coordinates: [0, 0] }] });
    const space = { kpIndex: 4, level: 'active', levelLabel: '<b>Actif</b>', riskFrance: '<img src=y onerror=2>', color: '#fff', fetchedAt: new Date(NOW) } as const;
    const h = renderLayerView('powerGrid', buildGridView({ data: d, space, now: NOW, open }));
    expect(h).not.toContain('<img');
    expect(h).not.toContain('<b>Actif');
    expect(h).toContain('&lt;img src=x onerror=1&gt;');
  });
  it('résumé Écowatt : fenêtre du jour, risque à venir, aucune coupure, signal du jour non publié', () => {
    const sum = (days: EcowattOfficialDay[]): string | undefined => buildGridView({
      data: data({ official: { source: 'rte', generatedAt: null, days } }), space: null, now: NOW, open,
    }).sections.find((s) => s.id === 'ecowatt')?.summary;
    const risky = { ...green('2026-10-02'), level: 'orange' as const, hours: Array(24).fill(1) as Array<0 | 1 | 2 | 3> };
    risky.hours[8] = 2; risky.hours[12] = 2;
    expect(sum([risky])).toBe('système tendu aujourd’hui de 08:00 à 09:00 et de 12:00 à 13:00');
    const red = { ...risky, level: 'red' as const, hours: [...risky.hours] };
    red.hours[9] = 3;
    expect(sum([red])).toBe('coupures possibles aujourd’hui de 08:00 à 10:00 et de 12:00 à 13:00');
    expect(sum([green('2026-10-02'), green('2026-10-03'), { ...green('2026-10-04'), level: 'orange' }])).toBe('système tendu dimanche');
    expect(sum([green('2026-10-02'), green('2026-10-03'), { ...green('2026-10-04'), level: 'red' }])).toBe('coupures possibles dimanche');
    expect(sum([green('2026-10-02'), green('2026-10-03'), green('2026-10-05')])).toBe('aucune coupure envisagée d’ici lundi');
    expect(sum([green('2026-10-01')])).toBe('signal du jour non publié');
  });
  it('chapeau : orange = « Système tendu », rouge = « Coupures possibles », plages séparées', () => {
    const day = (level: 'orange' | 'red', hours: Array<0 | 1 | 2 | 3>): EcowattOfficialDay =>
      ({ ...green('2026-10-02'), level, message: 'Message RTE.', hours });
    const base = Array(24).fill(1) as Array<0 | 1 | 2 | 3>;
    const orange = [...base]; orange[8] = 2; orange[9] = 2; orange[12] = 2;
    const lead = (d: EcowattOfficialDay): string | null | undefined => buildGridView({
      data: data({ official: { source: 'rte', generatedAt: null, days: [d] } }), space: null, now: NOW, open }).head.lead;
    expect(lead(day('orange', orange))).toBe('Message RTE. Système tendu de 08:00 à 10:00 et de 12:00 à 13:00.');
    const red = [...orange]; red[9] = 3;
    expect(lead(day('red', red))).toBe('Message RTE. Coupures possibles de 08:00 à 10:00 et de 12:00 à 13:00.');
  });
  it('écart à la prévision avec le signe moins typographique', () => {
    expect(html(data())).toContain('41,2 GW (écart −1,5 %)');
  });
});
