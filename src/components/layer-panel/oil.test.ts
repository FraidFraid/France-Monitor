// src/components/layer-panel/oil.test.ts
import { describe, expect, it } from 'vitest';
import { filterFuelPriceSeries } from '../../utils/fuelPriceChart.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { OIL_NOW, oilFixture, tensionFixture } from './oil.fixture.ts';
import { formatEuro } from './format.ts';
import {
  buildOilView, fuelCatVar, fuelTooltipHtml, nearestTimestamp, priceDeltaLevel, stockLevel, tensionLevel, type OilViewInput,
} from './oil.ts';

const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<OilViewInput> = {}): OilViewInput => ({
  data: oilFixture(), tension: tensionFixture(), enabled: true, tab: 'overview', range: '1m', search: '', mapVisible: false,
  now: OIL_NOW, open, ...over,
});
const view = (over: Partial<OilViewInput> = {}) => buildOilView(input(over));
const html = (over: Partial<OilViewInput> = {}): string => renderLayerView('oilNetwork', view(over));
const section = (id: string, over: Partial<OilViewInput> = {}) => view(over).sections.find((s) => s.id === id);

describe('vue Pétrole', () => {
  it('seuils : tension, stocks, écart de prix', () => {
    expect((['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map(tensionLevel)).toEqual(['vert', 'jaune', 'orange', 'rouge']);
    expect([29.9, 30, 40, 40.1].map(stockLevel)).toEqual(['rouge', 'jaune', 'jaune', 'vert']);
    expect([0.6, 0.5, 0.4, -0.4, -0.5, null].map(priceDeltaLevel)).toEqual(['orange', 'orange', null, null, 'vert', null]);
    expect(fuelCatVar('gazole')).toBe('var(--cat-gazole)');
  });
  it('en-tête : prix du gazole non coloré, écart 7 j coloré, tension, relevé médian, source', () => {
    const v = view();
    expect(v.head).toMatchObject({ title: 'Pétrole', level: 'vert' });
    expect(v.head.figure?.value).toBe(`1,689${NBSP}€`);
    expect(v.head.figure?.level ?? null).toBeNull();
    expect(v.head.figure?.captionHtml).toBe(`gazole, moyenne nationale · <span class="lp-val fmk-num lp-lvl lp-lvl--vert">−1,2${NBSP}c en 7${NBSP}j</span>`);
    // relevé médian des stations : 08:10 − 38 min
    expect(v.head.status).toEqual([`2,1${NBSP}% de stations en anomalie`, 'données de 07:32', 'prix-carburants']);
    expect(v.head.lead).toBe('Pas de tension d’approvisionnement. Stocks stratégiques : 46 jours. 1 raffinerie sur 2 en activité.');
  });
  it('tension modérée : phrase avec la part d’anomalies', () => {
    const t = tensionFixture({ national: { ...tensionFixture().national, tensionLevel: 'MEDIUM' } });
    expect(view({ tension: t }).head.lead).toMatch(new RegExp(`^Tension modérée sur les carburants : 2,1${NBSP}% de stations en anomalie\\.`));
  });
  it('onglets : Vue d’ensemble, Départements avec compteur, Approvisionnement', () => {
    expect(view().tabs?.map((t) => [t.id, t.label, t.count ?? null])).toEqual([
      ['overview', 'Vue d’ensemble', null], ['departments', 'Départements', 3], ['supply', 'Approvisionnement', null],
    ]);
  });
  it('vue d’ensemble : sections, ouvertes et repliées comme la spec', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['prices', true], ['tension', true], ['stocks', true], ['refineries', false], ['method', false],
    ]);
    expect(section('method')?.tone).toBe('reference');
  });
  it('prix à la pompe : graphe repris, une couleur par carburant, bascule 1 mois / 1 an, écart 7 j coloré', () => {
    const h = section('prices')?.html ?? '';
    expect(h).toContain('stroke="var(--cat-gazole)"');
    expect(h).toContain('data-oil-range="1m" aria-pressed="true"');
    expect(h).toContain('data-oil-range="1y" aria-pressed="false"');
    expect(h).toMatch(new RegExp(`background:var\\(--cat-e10\\)[^]*E10[^]*1,752${NBSP}€[^]*lp-lvl--orange">\\+0,6${NBSP}c en 7${NBSP}j`));
    expect(h).toContain('<div class="lp-tip" hidden></div>');
    const none = section('prices', { data: oilFixture({ fuelPriceHistory: null }) })?.html ?? '';
    expect(none).toContain('Historique des prix indisponible sur ce cycle.');
    expect(none).toContain(`1,689${NBSP}€`);
  });
  it('info-bulle : date la plus proche, prix par carburant, échappés', () => {
    const s = filterFuelPriceSeries(oilFixture().fuelPriceHistory, '1y');
    expect(nearestTimestamp(s, 1)).toBe(Date.parse('2026-10-02T00:00:00Z'));
    expect(nearestTimestamp(s, 0)).toBe(Date.parse('2025-10-02T00:00:00Z'));
    expect(nearestTimestamp([], 0.5)).toBeNull();
    const tip = fuelTooltipHtml([{ ...s[0], label: '<img src=x>' }], Date.parse('2026-10-02T00:00:00Z'));
    expect(tip).toContain('02/10/2026');
    expect(tip).toContain(`1,689${NBSP}€`);
    expect(tip).not.toContain('<img');
  });
  it('tension carburants : départements les plus tendus, puce, part d’anomalies, écart 7 j', () => {
    const s = section('tension');
    expect(s?.summary).toBe('9\u202F812 stations · 96 départements');
    expect(s?.html).toMatch(new RegExp(`fmk-dot--orange[^]*Bouches-du-Rhône \\(13\\)[^]*6,8${NBSP}%[^]*écart 7${NBSP}j : <span class="lp-val fmk-num lp-lvl lp-lvl--orange">\\+2,1${NBSP}c</span>`));
    expect(s?.html).toMatch(/fmk-dot--jaune[^]*Nord \(59\)[^]*écart 7\u00A0j : <span class="lp-val fmk-num">n\.d\.<\/span>/);
  });
  it('stocks stratégiques : une jauge par produit sur 120 jours, couleurs de seuil, total', () => {
    const s = section('stocks');
    expect(s?.summary).toBe(`46${NBSP}j · seuil 30${NBSP}j`);
    const h = s?.html ?? '';
    expect(h).toMatch(/Gazole[^]*background:var\(--sev-green\)/);
    expect(h).toMatch(/Carburéacteur[^]*background:var\(--sev-yellow\)/);
    expect(h).toMatch(/Fioul lourd[^]*background:var\(--sev-red\)/);
    expect(h).toContain(`46${NBSP}j · 17,2${NBSP}Mt`);
  });
  it('raffineries : puce verte en activité, grise à l’arrêt, capacité', () => {
    const s = section('refineries');
    expect(s?.summary).toBe(`1 sur 2 en activité · 12,5${NBSP}Mt/an`);
    expect(s?.html).toMatch(/fmk-dot--vert[^]*Gonfreville[^]*12,5\u00A0Mt\/an[^]*en activité/);
    expect(s?.html).toMatch(/<span class="fmk-dot" aria-hidden="true"><\/span><span>Grandpuits<\/span>[^]*à l’arrêt/);
  });
  it('méthode et sources : textes méthodologiques, fraîcheurs en mots, mises en garde ; aucun code anglais', () => {
    const h = section('method')?.html ?? '';
    expect(h).toContain('Deux lectures complémentaires');
    expect(h).toMatch(/Stocks, flux et origines[^]*structurel[^]*SDES, bilan 2024/);
    expect(h).toContain('Signal de prix, pas de volumes livrés.');
    expect(h).toContain('Données &lt;b&gt;provisoires&lt;/b&gt;.');
    expect(html()).not.toMatch(/STRUCTURAL|HYBRID|MONTHLY|DAILY|PROVISIONAL|QUASI-LIVE|FALLBACK|LOW|HIGH|CRITICAL/);
  });
  it('départements : recherche, liste triée par tension, bouton de carte', () => {
    const v = view({ tab: 'departments' });
    const h = renderLayerView('oilNetwork', v);
    expect(h).toContain('data-oil-search');
    expect(h).toContain('data-oil-map aria-pressed="false">Afficher sur la carte</button>');
    expect(h.indexOf('Bouches-du-Rhône')).toBeLessThan(h.indexOf('Nord'));
    expect(h.indexOf('Nord')).toBeLessThan(h.indexOf('Paris'));
    expect(h).toMatch(new RegExp(`120 stations · écart 7${NBSP}j <span class="lp-val fmk-num lp-lvl lp-lvl--orange">\\+2,1${NBSP}c</span> · relevés d’il y a 42${NBSP}min · gazole 1,701${NBSP}€`));
    const searched = renderLayerView('oilNetwork', view({ tab: 'departments', search: 'bouches' }));
    expect(searched).toContain('Bouches-du-Rhône');
    expect(searched).not.toContain('Nord (59)');
    expect(renderLayerView('oilNetwork', view({ tab: 'departments', search: 'zzz' }))).toContain('Aucun département ne correspond à la recherche.');
    expect(renderLayerView('oilNetwork', view({ tab: 'departments', mapVisible: true }))).toContain('aria-pressed="true">Masquer de la carte</button>');
  });
  it('approvisionnement : flux estimés, origines en jauge de catégorie, livraisons UFIP, vue harmonisée', () => {
    const v = view({ tab: 'supply' });
    expect(v.sections.map((s) => s.id)).toEqual(['flows', 'origins', 'deliveries', 'harmonized']);
    const h = renderLayerView('oilNetwork', v);
    expect(h).toMatch(new RegExp(`Import[^]*210${NBSP}kt/j[^]*Export[^]*56${NBSP}kt/j[^]*import net 154${NBSP}kt/j`));
    expect(h).toContain('estimé');
    expect(h).toMatch(/Amérique du Nord[^]*width:23\.4%;background:var\(--cat-crude\)/);
    expect(h).not.toContain('Autres</span>');
    expect(h).toMatch(new RegExp(`Produits énergétiques[^]*6,42${NBSP}Mt · <span class="lp-val fmk-num lp-lvl lp-lvl--orange">\\+0,6${NBSP}% sur un an</span>`));
    expect(h).toContain('provisoire');
    expect(renderLayerView('oilNetwork', view({ tab: 'supply', data: oilFixture({ harmonized: null }) }))).toContain('Vue harmonisée indisponible sur ce cycle.');
  });
  it('états : module désactivé, chargement, données partielles, tension dégradée, tension en attente', () => {
    const off = view({ enabled: false });
    expect(off.bodyHtml).toContain('Couche désactivée sur cette instance.');
    expect(off.tabs ?? []).toEqual([]);
    expect(off.head.figure ?? null).toBeNull();
    expect(view({ data: null }).bodyHtml).toContain('Chargement des données…');
    expect(view({ data: oilFixture({ meta: { ...oilFixture().meta, partialData: true } }) }).bodyHtml).toContain('valeurs de repli consolidées');
    const degraded = view({ tension: tensionFixture({ degraded: true, errorMessage: 'API <b>KO</b>' }) });
    expect(degraded.head.level).toBe('nd');
    expect(degraded.bodyHtml).toContain('Tension carburants en mode dégradé : API &lt;b&gt;KO&lt;/b&gt;.');
    const pending = view({ tension: null });
    expect(pending.head.level ?? null).toBeNull();
    expect(pending.sections.find((s) => s.id === 'tension')?.html).toContain('Signal carburants en cours de lecture…');
  });
  it('rien ne disparaît : écart 30 j, tendances, vigilance, fraîcheur en mots, part des gazoducs, maintenance', () => {
    const o = oilFixture();
    const prices = section('prices')?.html ?? '';
    expect(prices).toContain(`en 30${NBSP}j`);
    expect(prices).toContain('Fraîcheur : quotidien · Prix quotidiens');
    const stocks = section('stocks')?.html ?? '';
    expect(stocks).toMatch(/lp-lvl--vert">en hausse/);
    expect(stocks).toMatch(/lp-lvl--orange">en baisse/);
    expect(stocks).toContain('20 sur 100 · normale');
    const tension = section('tension')?.html ?? '';
    expect(tension).toContain(`moyenne 50${NBSP}min · médiane 38${NBSP}min`);
    expect(tension).toContain('Anomalies nationales');
    const refs = section('refineries', { data: { ...o, refineries: [{ ...o.refineries[0], status: 'maintenance' }] } })?.html ?? '';
    expect(refs).toMatch(/fmk-dot--jaune[^]*en maintenance/);
    const supply = renderLayerView('oilNetwork', view({ tab: 'supply' }));
    expect(supply).toContain(`Part des gazoducs`);
    expect(supply).toContain('lp-imp');
    expect(supply).toContain('lp-exp');
    const falling = tensionFixture();
    falling.national.topDepartments = [{ ...falling.summaries[0], deltaPrice7d: -0.9 }];
    expect(section('tension', { tension: falling })?.html).toContain(`lp-lvl--vert">−0,9${NBSP}c`);
    const calm = oilFixture({ deliveries: [{ ...oilFixture().deliveries[0], totalProductsYoYPct: -1.2, roadFuelYoYPct: 0.2 }] });
    const ufip = renderLayerView('oilNetwork', view({ tab: 'supply', data: calm }));
    expect(ufip).toContain(`lp-lvl--vert">−1,2${NBSP}% sur un an`);
    expect(ufip).toMatch(/lp-val fmk-num">\+0,2\u00A0% sur un an/);
    expect(renderLayerView('oilNetwork', view({ tab: 'departments' }))).toContain('lp-lvl--orange">+2,1');
    const dep = renderLayerView('oilNetwork', view({ tab: 'departments' }));
    expect(dep).toContain('signal quasi direct');
    expect(dep).toContain('tension forte');
  });
  it('R1, aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute', () => {
    for (const tab of ['overview', 'departments', 'supply'] as const) {
      const h = html({ tab });
      expect(breakableValue(visibleText(h))).toBeNull();
      expect(h).not.toMatch(/—|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
    }
  });
  it('vue harmonisée nettoyée : produits en français, mois dits une fois, une seule note, résumé court, pas de « au en »', () => {
    const o = oilFixture();
    const data = {
      ...o,
      harmonized: o.harmonized ? {
        ...o.harmonized, provisional: true, oilDataMonth: '2025-12', gasDataMonth: '2026-01', latestUfipPeriodLabel: 'en août 2026',
        oilProducts: [{ product: 'Gasoline', demandKbd: 306.9, importsKbd: 46.3 }, { product: 'Jet fuel', demandKbd: 164.2, importsKbd: 122 }, { product: 'LPG', demandKbd: 96.5, importsKbd: 90.9 }],
      } : null,
      meta: { ...o.meta, freshness: { ...o.meta.freshness, harmonized: { ...o.meta.freshness.harmonized, asOf: '2025-12 · 2026-01 · en août 2026', detail: 'pas de télémesure live' } } },
    };
    const v = view({ tab: 'supply', data });
    const h = v.sections.find((s) => s.id === 'harmonized');
    expect(h?.summary).toBe('JODI et UFIP · provisoire');
    const html = h?.html ?? '';
    expect(html).toContain('Essence');
    expect(html).toContain('Kérosène');
    expect(html).toContain('GPL');
    expect(html).not.toMatch(/Gasoline|Jet fuel|LPG/);
    expect(html.match(/décembre 2025/g)).toHaveLength(1);
    expect(html).toContain('UFIP août 2026');
    expect(html.match(/fmk-note/g)).toHaveLength(1);
    expect(html).not.toContain('Mois couverts');
    expect(html).toMatch(/Part des gazoducs[^]*color-mix\(in srgb, var\(--cat-lng\) 45%/);
    const all = renderLayerView('oilNetwork', view({ data })) + renderLayerView('oilNetwork', v);
    expect(all).not.toMatch(/au en |\b2025-12\b|\blive\b/);
  });
  it('relevés de stations de plus de 24 h : tension non évaluée, pastille grise, « en retard », pas de « Rouge »', () => {
    const stale = tensionFixture({ generatedAt: new Date(OIL_NOW - 5 * 86_400_000).toISOString() });
    const crit = { ...stale, national: { ...stale.national, tensionLevel: 'CRITICAL' as const, anomalyShare: 87 } };
    const v = view({ tension: crit });
    expect(v.head.level).toBe('nd');
    expect(v.head.status[0]).toBe('tension non évaluée : relevés anciens');
    expect(v.head.status[1]).toMatch(/^données de \d\d\/\d\d \d\d:\d\d \(en retard\)$/);
    expect(v.head.lead).toContain('la tension n’est pas évaluée');
    expect(v.head.lead).not.toContain('Tension critique');
    // Le prix vient alors de l'historique (plus récent que les relevés figés), daté dans la légende si ce n'est pas aujourd'hui.
    const gazole = oilFixture().fuelPriceHistory?.series.find((s) => s.fuelType === 'gazole');
    expect(v.head.figure?.value).toBe(formatEuro(gazole?.latestPrice ?? null));
    // Relevés récents : la tension reste évaluée.
    expect(view({ tension: { ...tensionFixture(), national: { ...tensionFixture().national, tensionLevel: 'CRITICAL' as const } } }).head.level).toBe('rouge');
  });
});
