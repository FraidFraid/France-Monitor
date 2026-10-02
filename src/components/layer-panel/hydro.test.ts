// src/components/layer-panel/hydro.test.ts
import { describe, expect, it } from 'vitest';
import type { EcowattResponse, GridSnapshot, HydraulicBackboneAsset, HydraulicTrend } from '../../types/index.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, frNumber, visibleText } from './format.ts';
import { buildHydroView, hydroLead, trendLevel } from './hydro.ts';

const NOW = Date.parse('2026-10-02T07:00:00Z'); // 09:00 Paris
const open = (_: string, d: boolean): boolean => d;
type Signals = HydraulicBackboneAsset['signals'];
function asset(id: string, name: string, trend: HydraulicTrend, over: Partial<HydraulicBackboneAsset> = {}, sig: Partial<Signals> = {}): HydraulicBackboneAsset {
  return {
    id, name, type: 'hydro_production', subtype: 'reservoir', capacity_mw: 380, reservoir_volume: 1200, operator: 'EDF', river: 'Durance',
    location: { lat: 44.5, lon: 6.3, region: "Provence-Alpes-Côte d'Azur", country: 'FR' }, criticality_score: 70,
    verification_sources: ['RTE/ODRE 30/09/2025'], location_accuracy: 'site',
    signals: {
      hydro_trend: trend, last_update: new Date(NOW).toISOString(), signalSource: 'DERIVED_CONTEXT_ONLY', dataFreshness: 'unavailable',
      measuredSupportLevel: 'none', hydroTrend: 'unavailable', observationTimestamp: null, confidence: 0.25, measuredStationCount: 0,
      sourceDetail: null, cause: null, ...sig,
    },
    ...over,
  };
}
const measured: Partial<Signals> = { signalSource: 'DERIVED_REAL_MEASURE_SUPPORT', measuredSupportLevel: 'partial', dataFreshness: 'fresh' };
const ASSETS: HydraulicBackboneAsset[] = [
  asset('sp', 'Serre-Ponçon', 'stress', {}, { ...measured, cause: 'crue vigilance orange', observationTimestamp: '2026-10-02T06:20:00Z' }),
  asset('st', 'Sainte-Tulle', 'stress', { capacity_mw: 108 }, { ...measured, cause: 'débit en hausse', observationTimestamp: '2026-10-02T06:10:00Z' }),
  asset('gm', 'Grand’Maison', 'high', { type: 'step_storage', subtype: 'pumped_storage', capacity_mw: 1800, river: "Eau d'Olle",
    location: { lat: 45.2, lon: 6.1, region: 'Auvergne-Rhône-Alpes', country: 'FR' } }, { cause: 'vigilance pluie-inondation jaune' }),
  ...Array.from({ length: 9 }, (_, i) => asset(`n${i}`, `Ouvrage ${i}`, 'normal')),
  asset('co', 'Tolla', 'normal', { location: { lat: 41.9, lon: 8.9, region: 'Corse', country: 'FR' } }),
];
const GRID = {
  dataTime: Date.parse('2026-10-02T06:30:00Z'), consumptionMw: null, forecastMw: null, co2gPerKwh: null, netImportMw: null,
  mix: { nuclear: null, hydro: 7000, wind: null, solar: null, thermal: null, bio: null },
  hydroDetail: { runOfRiver: 2300, lakes: 2900, stepTurbine: 1900, pumping: 0 }, windDetail: { onshore: null, offshore: null }, day: [],
} satisfies GridSnapshot;
const ECOWATT = { official: null, mixes: {}, national: { timestamp: new Date(NOW), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 },
  interconnections: [], grid: GRID } satisfies EcowattResponse;
const view = (assets = ASSETS, ecowatt: EcowattResponse | null = ECOWATT) => buildHydroView({ assets, ecowatt, now: NOW, open });

describe('vue Stress hydro', () => {
  it('niveau dérivé : orange si un ouvrage en stress, jaune s’il n’y a que de la pression, vert sinon', () => {
    expect([trendLevel('stress'), trendLevel('high'), trendLevel('normal'), trendLevel('low')]).toEqual(['orange', 'jaune', 'vert', 'vert']);
    expect(view().head.level).toBe('orange');
    expect(view(ASSETS.filter((a) => a.signals.hydro_trend !== 'stress')).head.level).toBe('jaune');
    expect(view(ASSETS.filter((a) => a.signals.hydro_trend === 'normal')).head.level).toBe('vert');
  });
  it('en-tête : production hydraulique non colorée, comptes, dernière mesure Hub’Eau', () => {
    const v = view();
    expect(v.head.figure).toEqual({ value: `7,0${NBSP}GW`, caption: 'production hydraulique · éCO2mix 08:30' });
    expect(v.head.status).toEqual(['2 ouvrages en stress', '1 sous pression', 'Hub’Eau 08:20']);
  });
  it('synthèse : cause principale, production et turbinage STEP', () => {
    expect(hydroLead(ASSETS, GRID)).toBe(`2 ouvrages en stress (crue vigilance orange) ; production hydraulique 7,0${NBSP}GW, dont 1,9${NBSP}GW de turbinage STEP.`);
    expect(hydroLead(ASSETS.filter((a) => a.signals.hydro_trend === 'normal'), GRID)).toBe(`Aucun ouvrage sous contrainte ; production hydraulique 7,0${NBSP}GW, dont 1,9${NBSP}GW de turbinage STEP.`);
    expect(hydroLead(ASSETS, null)).toBe('2 ouvrages en stress (crue vigilance orange) ; production hydraulique nationale indisponible.');
  });
  it('sections dans l’ordre, ouvertes et repliées comme la spec', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([['constrained', true], ['production', true], ['step', false], ['watch', false], ['method', false]]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('ouvrages sous contrainte : stress puis pression, puce, puissance, rivière, cause, mesure', () => {
    const h = renderLayerView('hydroBackbone', view());
    expect(h).toMatch(new RegExp(`fmk-dot--orange[^]*Serre-Ponçon · stress[^]*380${NBSP}MW[^]*Durance · crue vigilance orange · mesure Hub’Eau 08:20`));
    expect(h.indexOf('Sainte-Tulle')).toBeLessThan(h.indexOf('Grand’Maison'));
    expect(h).toMatch(/fmk-dot--jaune[^]*Grand’Maison · sous pression[^]*Eau d&#39;Olle · vigilance pluie-inondation jaune · sans mesure directe/);
    expect(h).toContain('data-hydraulic-asset="sp"');
    expect(h).toContain('class="lp-row is-link"');
    expect(renderLayerView('hydroBackbone', view(ASSETS.filter((a) => a.signals.hydro_trend === 'normal')))).toContain('Aucun ouvrage sous contrainte.');
  });
  it('production hydraulique : quatre jauges en couleur de filière', () => {
    const s = view().sections.find((x) => x.id === 'production');
    expect(s?.summary).toBe(`7,0${NBSP}GW · pompage 0,0${NBSP}GW`);
    expect(s?.html).toMatch(new RegExp(`Lacs[^]*2,9${NBSP}GW[^]*Fil de l’eau[^]*2,3${NBSP}GW[^]*Turbinage STEP[^]*1,9${NBSP}GW[^]*Pompage STEP[^]*0,0${NBSP}GW`));
    expect(s?.html).not.toMatch(/var\(--sev-|--text-secondary/);
    expect(s?.html).toContain('width:41.4%;background:var(--mix-hydro)');
    expect(s?.html).toContain('background:color-mix(in srgb, var(--mix-hydro) 45%, transparent)');
    expect(view(ASSETS, null).sections.find((x) => x.id === 'production')?.html).toContain('Production hydraulique nationale indisponible.');
  });
  it('STEP et méthode', () => {
    expect(view().sections.find((x) => x.id === 'step')?.summary).toBe('1 station · 1 sous contrainte');
    const m = view().sections.find((x) => x.id === 'method');
    expect(m?.summary).toBe('13 ouvrages · 2 avec mesure');
    expect(m?.html).toContain('orange si au moins un ouvrage est en stress, jaune s’il n’y a que des ouvrages sous pression, vert sinon');
    expect(m?.html).toMatch(/DROM et Corse[^]*>1</);
    expect(m?.html).toContain('dérivé, appuyé sur des mesures réelles');
  });
  it('rien ne disparaît : fraîcheur, criticité, infobulle, ouvrages suivis, couverture', () => {
    const rich = ASSETS.map((a) => (a.id === 'sp' ? { ...a, signals: { ...a.signals, sourceDetail: 'Dérivé appuyé <sur> mesures réelles', dataFreshness: 'aging' as const } } : a));
    const v = view(rich);
    const h = renderLayerView('hydroBackbone', v);
    expect(h).toContain('crue vigilance orange · mesure Hub’Eau 08:20 · mesure à confirmer · criticité 70');
    expect(h).toContain('title="Dérivé appuyé &lt;sur&gt; mesures réelles"');
    expect(v.sections.map((s) => s.id)).toEqual(['constrained', 'production', 'step', 'watch', 'method']);
    const w = v.sections.find((x) => x.id === 'watch');
    expect(w?.open ?? false).toBe(false);
    expect(w?.summary).toBe('13 sur 13');
    expect(w?.html).toMatch(/Serre-Ponçon[^]*Sainte-Tulle[^]*Grand’Maison[^]*Ouvrage 0/);
    expect(w?.html).toContain('data-hydraulic-asset="sp"');
    expect(w?.html).toContain('Auvergne-Rhône-Alpes · criticité 70 · mesure sans mesure');
    const m = v.sections.find((x) => x.id === 'method')?.html ?? '';
    expect(m).toContain(`Puissance installée suivie</span><span class="fmk-kv-v fmk-num">${frNumber(380 + 108 + 1800 + 10 * 380, 0)}${NBSP}MW`);
    expect(m).toMatch(/Appui fort[^]*>0</);
    expect(m).toMatch(/Ouvrages de régulation[^]*>0</);
    expect(m).toMatch(/Référentiel manuel[^]*>0</);
    expect(m).toContain('Puissance moyenne par ouvrage');
  });
  it('Hub’Eau vide : aucune heure inventée, « sans mesure directe », 0 appuyé', () => {
    const none = ASSETS.map((a) => ({ ...a, signals: { ...a.signals, observationTimestamp: null, signalSource: 'DERIVED_CONTEXT_ONLY' as const } }));
    const v = view(none);
    expect(v.head.status.at(-1)).toBe('Hub’Eau : aucune mesure');
    const h = renderLayerView('hydroBackbone', v);
    expect(h).toContain('Durance · crue vigilance orange · sans mesure directe');
    expect(v.sections.find((x) => x.id === 'method')?.summary).toBe('13 ouvrages · 0 avec mesure');
  });
  it('chargement, textes hostiles, R1, aucun tiret cadratin, aucune couleur brute', () => {
    expect(view([]).bodyHtml).toContain('Chargement des données…');
    const hostile = [asset('x', '<img src=x onerror=1>', 'stress', { river: '<b>r</b>' }, { cause: '<i>c</i>' })];
    const h = renderLayerView('hydroBackbone', view(hostile));
    expect(h).not.toMatch(/<img|<b>r|<i>c/);
    const all = renderLayerView('hydroBackbone', view());
    expect(breakableValue(visibleText(all))).toBeNull();
    expect(all).not.toMatch(/—|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
  });
});
