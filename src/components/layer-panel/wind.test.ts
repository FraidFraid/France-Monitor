// src/components/layer-panel/wind.test.ts
import { describe, expect, it } from 'vitest';
import type { GridSnapshot } from '../../types/index.ts';
import type { EolienLive, EolienParkSummary } from '../../services/eolien/types.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { buildWindView, windWord, type WindViewInput } from './wind.ts';

const NOW = Date.parse('2026-10-02T07:00:00Z'); // 09:00 Paris
const open = (_: string, d: boolean): boolean => d;
const LIVE: EolienLive = {
  production: 2.1, production_gw: 2.1, puissance_installee: 26.1, facteur_charge: 0.08, parcs_actifs: 1487,
  timestamp: new Date('2026-10-02T06:30:00Z'), alertLevel: 'low-production', terre_mer_split: { terre: 2.02, mer: 0.08 },
};
const park = (id: string, kind: EolienParkSummary['kind'], capacityMw: number, est: number): EolienParkSummary => ({
  id, groupId: id, name: `Parc ${id}`, status: 'operating', kind, capacityMw, turbineCount: 10, operator: null, commune: 'Fécamp',
  department: '76', region: 'Normandie', commissioningYear: 2015, estimatedProductionMw: est, coordinates: [0.3, 49.8], sourceType: 'park',
});
const PARKS = [park('off', 'offshore', 497, 34), ...Array.from({ length: 13 }, (_, i) => park(`p${i}`, 'onshore', 100 - i, 8))];
const GRID: GridSnapshot = {
  dataTime: Date.parse('2026-10-02T06:30:00Z'), consumptionMw: null, forecastMw: null, co2gPerKwh: null, netImportMw: null,
  mix: { nuclear: null, hydro: null, wind: 2081, solar: null, thermal: null, bio: null },
  hydroDetail: { runOfRiver: null, lakes: null, stepTurbine: null, pumping: null }, windDetail: { onshore: 2006, offshore: 75 },
  day: [
    { at: Date.parse('2026-10-02T02:00:00Z'), consumptionMw: null, forecastMw: null, windMw: 1600 },
    { at: Date.parse('2026-10-02T06:30:00Z'), consumptionMw: null, forecastMw: null, windMw: 2081 },
    { at: Date.parse('2026-10-02T15:00:00Z'), consumptionMw: null, forecastMw: 50000, windMw: null },
  ],
};
const input = (over: Partial<WindViewInput> = {}): WindViewInput => ({ live: LIVE, parks: PARKS, grid: GRID, error: null, now: NOW, open, ...over });
const view = (over: Partial<WindViewInput> = {}) => buildWindView(input(over));

describe('vue Éolien', () => {
  it('état du vent en mots, seuils actuels du suivi', () => {
    expect([windWord('low-production'), windWord('watch'), windWord('normal')]).toEqual(['faible', 'modéré', 'soutenu']);
  });
  it('en-tête : production en gros chiffre avec unité, colorée par l’état du vent (faible : orange), pas de pastille', () => {
    const v = view();
    expect(v.head.title).toBe('Éolien');
    expect(v.head.figure).toMatchObject({ value: `2,1${NBSP}GW`, level: 'orange', caption: `8${NBSP}% des 26,1${NBSP}GW installés · éCO2mix 08:30` });
    expect(v.head.figure?.captionHtml).toMatch(/lp-lvl--orange">8\u00a0%<\/span> des 26,1\u00a0GW installés/);
    expect(v.head.level ?? null).toBeNull();
    expect(v.head.status).toEqual(['vent faible', `terre 2,0${NBSP}GW · mer 0,1${NBSP}GW`, 'ODRÉ']);
    expect(v.head.lead).toBe(`Vent faible : 2,1${NBSP}GW, soit 8${NBSP}% de la puissance installée.`);
  });
  it('sections dans l’ordre, ouvertes et repliées comme la spec', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([['day', true], ['split', true], ['parks', false], ['sources', false]]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('production du jour : courbe éCO2mix, repère maintenant, min et max', () => {
    const s = view().sections.find((x) => x.id === 'day');
    expect(s?.summary).toBe(`min 1,6${NBSP}GW · max 2,1${NBSP}GW`);
    expect(s?.html).toMatch(/Minimum[^]*1,6\u00a0GW à 04:00[^]*Maximum[^]*2,1\u00a0GW à 08:30/);
    expect(s?.html).toContain('role="img"');
    expect(s?.html).toContain('stroke="var(--mix-wind)"');
    expect(s?.html).toContain('stroke="var(--v2-brand)"');
    expect(view({ grid: null }).sections.find((x) => x.id === 'day')?.html).toContain('Courbe du jour indisponible.');
  });
  it('terre et mer : jauges en couleurs de catégorie, mesurées par éCO2mix, sinon estimées', () => {
    const h = view().sections.find((x) => x.id === 'split')?.html ?? '';
    expect(h).toMatch(/Facteur de charge[^]*background:var\(--mix-wind\)/);
    expect(h).toMatch(/Terrestre[^]*background:var\(--cat-onshore\)/);
    expect(h).toMatch(/En mer[^]*background:var\(--cat-offshore\)/);
    expect(h).toContain('Répartition mesurée (éCO2mix).');
    expect(view({ grid: null }).sections.find((x) => x.id === 'split')?.html).toContain('Répartition estimée à partir du référentiel des parcs.');
    expect(view().sections.find((x) => x.id === 'split')?.summary).toBe('14 parcs');
  });
  it('parcs : douze plus grands, puce de catégorie, production estimée, ligne cliquable', () => {
    const h = view().sections.find((x) => x.id === 'parks')?.html ?? '';
    expect(h.match(/data-eolien-park=/g)).toHaveLength(12);
    expect(h).toMatch(new RegExp(`background:var\\(--cat-offshore\\)[^]*Parc off[^]*497${NBSP}MW[^]*Normandie · Fécamp · mer · ≈ 34${NBSP}MW estimés`));
    expect(h).toContain('class="lp-row is-link"');
    expect(h).not.toContain('Parc p12');
  });
  it('méthode : estimation proportionnelle dite', () => {
    expect(view().sections.find((x) => x.id === 'sources')?.html).toContain('au prorata de la puissance installée');
  });
  it('chargement, erreur de source, textes hostiles, R1, aucun tiret cadratin, aucune couleur brute', () => {
    expect(view({ live: null }).bodyHtml).toContain('Chargement des données…');
    const err = view({ live: null, error: 'fetch_failed' });
    expect(err.head.status).toEqual(['Source injoignable']);
    expect(err.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    const hostile = renderLayerView('windMonitor', view({ parks: [{ ...PARKS[0], name: '<img src=x onerror=1>' }] }));
    expect(hostile).not.toContain('<img');
    const h = renderLayerView('windMonitor', view());
    expect(breakableValue(visibleText(h))).toBeNull();
    expect(h).not.toMatch(/—|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
  });
  it('rien ne disparaît : parcs actifs, seuil d’alerte, statut des parcs, niveau du vent', () => {
    const split = view().sections.find((x) => x.id === 'split')?.html ?? '';
    expect(split).toContain('1487');
    expect(split).toContain(`alerte nationale sous 3${NBSP}GW`);
    expect(split).toContain('fmk-dot--orange');
    const h = view({ parks: [{ ...PARKS[0], status: 'construction' }] }).sections.find((x) => x.id === 'parks')?.html ?? '';
    expect(h).toContain('en construction');
  });
  it('donnée en retard : dite avec son heure, jamais une alerte fraîche', () => {
    const late = view({ now: NOW + 3 * 3_600_000 });
    expect(late.head.figure?.caption).toContain('(en retard)');
    expect(late.head.lead).toContain('Donnée en retard');
    expect(late.sections.find((x) => x.id === 'split')?.html).not.toContain('fmk-dot--orange');
    expect(late.sections.find((x) => x.id === 'sources')?.html).toContain('(en retard)');
  });
  it('parcs : l’indication « clic = recentrer la carte » de l’ancien panneau est gardée', () => {
    const h = renderLayerView('windMonitor', view({ open: () => true }));
    expect(h).toContain('Clic sur un parc : recentrer la carte.');
  });
});
