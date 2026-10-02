// src/components/layer-panel/metro.test.ts
import { describe, expect, it } from 'vitest';
import type { MetropoleConsumption } from '../../services/metropoles.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { LATE_MS, buildMetroView, metroDeltaLevel, metroFigureLevel, type MetroViewInput } from './metro.ts';

const NOW = Date.parse('2026-10-02T07:00:00Z'); // 09:00 Paris
const open = (_: string, d: boolean): boolean => d;
const m = (code: string, name: string, mw: number, delta?: number, at = '2026-10-02T06:00:00+00:00', nationalMw: number | null = 46_000): MetropoleConsumption =>
  ({ code, name, lon: 2, lat: 48, consommation: mw, date_heure: at, deltaVsJ1Pct: delta, nationalMw: nationalMw ?? undefined });
const METROS = [m('gp', 'Grand Paris', 3100, 4.2), m('ly', 'Lyon', 1050, 1.1), m('li', 'Lille', 690, 9), m('ni', 'Nice', 400, -6), m('to', 'Tours', 135, 0.1)];
const input = (over: Partial<MetroViewInput> = {}): MetroViewInput => ({ metros: METROS, now: NOW, open, ...over });
const view = (over: Partial<MetroViewInput> = {}) => buildMetroView(input(over));

describe('vue Charge métropolitaine', () => {
  it('écart à la veille : hausse orange, baisse verte, moins de 0,2 % neutre', () => {
    expect([0.2, 4.2, 0.1, -0.1, -0.2, undefined].map(metroDeltaLevel)).toEqual(['orange', 'orange', null, null, 'vert', null]);
  });
  it('en-tête : somme des charges en gros chiffre, part nationale, heure de la donnée, pas de pastille', () => {
    const v = view();
    expect(v.head).toMatchObject({ theme: 'Énergie', title: 'Charge métropolitaine' });
    expect(v.head.level ?? null).toBeNull();
    expect(v.head.figure).toEqual({ value: `5,4${NBSP}GW`, level: null, caption: `5 métropoles · 11,7${NBSP}% de la consommation nationale` });
    expect(v.head.status).toEqual(['données de 08:00', 'ODRÉ éCO2mix métropoles']);
    expect(v.head.lead).toBe(`Grand Paris 3,1${NBSP}GW (+4${NBSP}% sur la veille à la même heure). Plus forte hausse : Lille (+9${NBSP}%).`);
  });
  it('sections et ordre', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([['metros', true], ['delta', true], ['sources', false]]);
  });
  it('métropoles classées par charge, puce et barre dans la couleur de la classe de la carte', () => {
    const h = view().sections.find((s) => s.id === 'metros')?.html ?? '';
    expect(h).toMatch(new RegExp(`fmk-dot--rouge[^]*Grand Paris[^]*width:100%;background:var\\(--sev-red\\)[^]*3${String.fromCharCode(0x202f)}100${NBSP}MW`));
    expect(h).toMatch(/fmk-dot--orange[^]*Lyon[^]*background:var\(--sev-orange\)/);
    expect(h).toMatch(/fmk-dot--vert[^]*Tours[^]*background:var\(--sev-green\)/);
    expect(h).toContain(`6,7${NBSP}% de la consommation nationale`);
    expect(h.indexOf('Grand Paris')).toBeLessThan(h.indexOf('Lyon'));
  });
  it('écart à la veille : trois plus fortes hausses en orange, baisses en vert', () => {
    const h = view().sections.find((s) => s.id === 'delta')?.html ?? '';
    expect(h).toMatch(new RegExp(`Lille[^]*lp-lvl--orange">\\+9,0${NBSP}%[^]*Grand Paris[^]*\\+4,2${NBSP}%[^]*Lyon[^]*\\+1,1${NBSP}%`));
    expect(h).toMatch(new RegExp(`Nice[^]*lp-lvl--vert">−6,0${NBSP}%`));
    expect(h).not.toContain('Tours');
    const flat = view({ metros: [m('to', 'Tours', 135, 0.1)] }).sections.find((s) => s.id === 'delta')?.html ?? '';
    expect(flat).toContain(`<span class="lp-val fmk-num">+0,1${NBSP}%</span>`);
  });
  it('données de la veille absentes : écart dit indisponible, synthèse sans écart, jamais 0 %', () => {
    const v = view({ metros: METROS.map((x) => ({ ...x, deltaVsJ1Pct: undefined })) });
    expect(v.head.lead).toBe(`Grand Paris 3,1${NBSP}GW.`);
    const h = v.sections.find((s) => s.id === 'delta')?.html ?? '';
    expect(h).toContain('Écart à la veille indisponible : données de la veille non publiées.');
    expect(h).not.toContain(`0${NBSP}%`);
  });
  it('consommation nationale absente : part non inventée', () => {
    const sans = METROS.map((x) => ({ ...x, nationalMw: undefined }));
    expect(view({ metros: sans }).head.figure?.caption).toBe('5 métropoles');
    expect(view({ metros: sans }).sections.find((s) => s.id === 'metros')?.html).not.toContain('de la consommation nationale');
  });
  it('part de chaque métropole sur la consommation nationale de SON instant, total = somme des parts', () => {
    const night = '2026-10-01T22:00:00+00:00';
    const metros = [m('gp', 'Grand Paris', 3000, 1, night, 30_000), m('ly', 'Lyon', 1000, 1, '2026-10-02T00:00:00+00:00', 40_000)];
    const v = view({ metros });
    const h = v.sections.find((s) => s.id === 'metros')?.html ?? '';
    expect(h).toContain(`10,0${NBSP}% de la consommation nationale`);
    expect(h).toContain(`2,5${NBSP}% de la consommation nationale`);
    expect(v.head.figure?.caption).toBe(`2 métropoles · 12,5${NBSP}% de la consommation nationale`);
  });
  it('un instant national manquant : cette métropole sans part, pas de total trompeur', () => {
    const metros = [m('gp', 'Grand Paris', 3000, 1, undefined, 30_000), m('ly', 'Lyon', 1000, 1, undefined, null)];
    const v = view({ metros });
    const h = v.sections.find((s) => s.id === 'metros')?.html ?? '';
    expect(h.match(/de la consommation nationale/g)).toHaveLength(1);
    expect(v.head.figure?.caption).toBe('2 métropoles');
  });
  it('synthèse : plus forte hausse seulement si la valeur arrondie est positive', () => {
    expect(view({ metros: [m('gp', 'Grand Paris', 3100, -4.2), m('ly', 'Lyon', 1050, 0.1)] }).head.lead).not.toContain('Plus forte hausse');
    expect(view({ metros: [m('gp', 'Grand Paris', 3100, -4.2), m('ly', 'Lyon', 1050, 1.6)] }).head.lead).toContain(`Plus forte hausse : Lyon (+2${NBSP}%)`);
  });
  it('source par lot quotidien : en retard seulement au-delà de 30 h, des deux côtés du seuil', () => {
    const at = (ms: number) => METROS.map((x) => ({ ...x, date_heure: new Date(NOW - ms).toISOString() }));
    expect(LATE_MS).toBe(30 * 3_600_000);
    expect(view({ metros: at(10 * 3_600_000) }).head.status[0]).not.toContain('en retard');
    expect(view({ metros: at(29 * 3_600_000) }).head.status[0]).not.toContain('en retard');
    expect(view({ metros: at(31 * 3_600_000) }).head.status[0]).toMatch(/\(en retard\)$/);
  });
  it('couleur du chiffre : orange dès +5 %, vert dès −5 %, sinon texte ; null sans J-1 ou en retard', () => {
    const r = (loadMW: number, d?: number) => ({ loadMW, deltaVsJ1Pct: d });
    expect(metroFigureLevel([r(1050, 5), r(1000, 5)], false)).toBe('orange');
    expect(metroFigureLevel([r(1000, 4.9)], false)).toBeNull();
    expect(metroFigureLevel([r(950, -5), r(950, -5)], false)).toBe('vert');
    expect(metroFigureLevel([r(960, -4)], false)).toBeNull();
    expect(metroFigureLevel([r(1000)], false)).toBeNull();
    expect(metroFigureLevel([], false)).toBeNull();
    expect(metroFigureLevel([r(1100, 10)], true)).toBeNull();
    const up = METROS.map((x) => ({ ...x, deltaVsJ1Pct: 8 }));
    const html = renderLayerView('metroLoad', view({ metros: up }));
    expect(html).toMatch(/<b class="fmk-num lp-lvl lp-lvl--orange">5,4/);
    expect(html).toContain('Couleur du chiffre : écart de la charge totale à la veille, même heure : orange dès +5');
    expect(renderLayerView('metroLoad', view({ metros: METROS.map((x) => ({ ...x, deltaVsJ1Pct: undefined })) }))).not.toMatch(/<b class="fmk-num lp-lvl/);
    const late = up.map((x) => ({ ...x, date_heure: new Date(NOW - 31 * 3_600_000).toISOString() }));
    expect(renderLayerView('metroLoad', view({ metros: late }))).not.toMatch(/<b class="fmk-num lp-lvl/);
  });
  it('chargement, aucune donnée, textes hostiles, R1, aucun tiret cadratin, aucune couleur brute', () => {
    expect(view({ metros: null }).bodyHtml).toContain('Chargement des données…');
    expect(view({ metros: [] }).bodyHtml).toContain('Aucune donnée métropolitaine reçue.');
    const hostile = renderLayerView('metroLoad', view({ metros: [m('x', '<img src=x onerror=1>', 100, 1)] }));
    expect(hostile).not.toContain('<img');
    const h = renderLayerView('metroLoad', view());
    expect(breakableValue(visibleText(h))).toBeNull();
    expect(h).not.toMatch(/—|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
  });
});
