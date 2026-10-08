// src/components/layer-panel/gas.test.ts
import { describe, expect, it } from 'vitest';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { GAS_NOW, biogasFixture, gasFixture } from './gas.fixture.ts';
import { biogasSignal, buildGasView, ecogazLevel, ecogazWord, fillLevel, gasLead, type GasViewInput } from './gas.ts';

const open = (_id: string, d: boolean): boolean => d;
const input = (over: Partial<GasViewInput> = {}): GasViewInput =>
  ({ data: gasFixture(), biogas: biogasFixture(), enabled: true, now: GAS_NOW, open, ...over });
const html = (over: Partial<GasViewInput> = {}): string => renderLayerView('gasNetwork', buildGasView(input(over)));
const section = (id: string, over: Partial<GasViewInput> = {}) => buildGasView(input(over)).sections.find((s) => s.id === id);

describe('vue Réseau gaz', () => {
  it('seuils de remplissage repris du panneau actuel', () => {
    expect([29.9, 30, 49.9, 50, 69.9, 70, 100].map(fillLevel)).toEqual(['rouge', 'orange', 'orange', 'jaune', 'jaune', 'vert', 'vert']);
  });
  it('Ecogaz : niveau et mot par valeur du service, inconnu en gris', () => {
    expect((['green', 'yellow', 'orange', 'red', 'unknown'] as const).map(ecogazLevel)).toEqual(['vert', 'jaune', 'orange', 'rouge', 'nd']);
    expect((['green', 'yellow', 'orange', 'red', 'unknown'] as const).map(ecogazWord))
      .toEqual(['pas de tension', 'vigilance', 'système tendu', 'système très tendu', 'signal indisponible']);
  });
  it('en-tête : remplissage coloré par seuil, pastille Ecogaz, journée gazière, sources', () => {
    const v = buildGasView(input());
    expect(v.head).toMatchObject({ theme: 'Énergie', title: 'Réseau gaz', level: 'vert' });
    expect(v.head.figure).toMatchObject({ value: `93,4${NBSP}%`, caption: `stockages remplis · 123,1 sur 131,8${NBSP}TWh`, level: 'vert' });
    expect(v.head.status).toEqual(['Ecogaz : pas de tension', 'journée gazière du 02/10', 'GRTgaz, Teréga']);
  });
  it('synthèse : mouvement des stockages, imports nets dont GNL', () => {
    expect(gasLead(gasFixture())).toBe(`Stockages en injection (+412${NBSP}GWh/j). Imports nets de 720${NBSP}GWh/j, dont 310${NBSP}GWh/j par les terminaux GNL.`);
    const out = gasFixture({ nationalStats: { ...gasFixture().nationalStats, storageNetFlowGWhDay: -250 } });
    expect(gasLead(out)).toContain(`Stockages en soutirage (−250${NBSP}GWh/j).`);
  });
  it('pays exportateur net : « Exports nets de X », jamais « Imports nets de −X »', () => {
    const out = gasFixture({ nationalStats: { ...gasFixture().nationalStats, totalImportGWhDay: 100, totalExportGWhDay: 400 }, terminals: [] });
    const lead = gasLead(out);
    expect(lead).toContain(`Exports nets de 300${NBSP}GWh/j.`);
    expect(lead).not.toMatch(/Imports nets|−\d/);
  });
  it('ENTSOG partiel : le point manquant dit n.d., jamais « équilibre » ni 0', () => {
    const data = gasFixture();
    const partial = gasFixture({ interconnections: [...data.interconnections, { id: 'i3', name: 'Larrau', country: 'Espagne', direction: 'bidirectional', coordinates: [-1, 43], flowGWhDay: 0, maxCapacityGWhDay: 100, flowMissing: true }] });
    const h = section('interconnections', { data: partial })?.html ?? '';
    expect(h).toMatch(/Larrau \(Espagne\)[^]*<span class="lp-val fmk-num">n\.d\.<\/span>/);
    const larrau = h.slice(h.indexOf('Larrau'), h.indexOf('Solde'));
    expect(larrau).not.toContain('équilibre');
    expect(h).toContain('Taisnières');
  });
  it('gros chiffre non coloré quand ODRÉ a échoué (valeurs de référence), coloré sinon', () => {
    const ok = buildGasView(input());
    expect(ok.head.figure?.level).not.toBeNull();
    const ref = buildGasView(input({ data: gasFixture({ sourceStatus: { ...gasFixture().sourceStatus, odre: 'error' } }) }));
    expect(ref.head.figure?.level).toBeNull();
    expect(ref.head.figure?.caption).toContain('valeurs de référence');
    expect(renderLayerView('gasNetwork', ref)).not.toMatch(/<b class="fmk-num lp-lvl/);
  });
  it('flux ENTSOG en repli : n.d., jamais « équilibre » ni imports inventés', () => {
    const stale = { data: gasFixture({ sourceStatus: { ...gasFixture().sourceStatus, grtgaz: 'stale', terega: 'stale' } }) };
    expect(section('interconnections', stale)?.summary).toBe('n.d.');
    expect(section('interconnections', stale)?.html).not.toMatch(/lp-imp|lp-exp|équilibre/);
    expect(section('interconnections', stale)?.html).toContain('Flux aux frontières indisponibles (ENTSOG) : valeurs de repli non affichées.');
    const lead = buildGasView(input(stale)).head.lead ?? '';
    expect(lead).not.toContain('Imports nets');
    expect(lead).toContain(`Terminaux GNL : 310${NBSP}GWh/j ; flux aux frontières indisponibles.`);
  });
  it('sections dans l’ordre, ouvertes et repliées comme la spec', () => {
    const v = buildGasView(input());
    expect(v.sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['ecogaz', true], ['storage', true], ['interconnections', false], ['terminals', false], ['biomethane', true], ['sources', false],
    ]);
    expect(v.sections.at(-1)?.tone).toBe('reference');
  });
  it('Ecogaz : J+1 à J+3 en pastilles, premier jour tendu nommé', () => {
    const s = section('ecogaz');
    expect(s?.summary).toBe('système tendu lundi');
    expect(s?.html).toMatch(/Sam\. 03\/10[^]*fm-vig--vert[^]*Dim\. 04\/10[^]*Lun\. 05\/10[^]*fm-vig--orange/);
    const calm = gasFixture({ ecogaz: { ...gasFixture().ecogaz, forecast: [{ date: '2026-10-03', signal: 'green' }] } });
    expect(section('ecogaz', { data: calm })?.summary).toBe('aucune tension prévue d’ici samedi');
  });
  it('stockages : jauge nationale, mouvement net, sites triés par remplissage, trois puis « n autres »', () => {
    const s = section('storage');
    expect(s?.summary).toContain(`93,4${NBSP}% · `);
    expect(s?.summary).toContain(`lp-lvl--vert">Remplissage +412${NBSP}GWh/j`);
    const h = s?.html ?? '';
    expect(h).toMatch(/Remplissage[^]*width:93\.4%;background:var\(--sev-green\)/);
    expect(h.indexOf('Chémery')).toBeLessThan(h.indexOf('Lussagnet'));
    expect(h).toMatch(/<details class="lp-more"><summary>2 autres sites<\/summary>[^]*Céré-la-Ronde[^]*var\(--sev-orange\)[^]*Trois-Fontaines[^]*var\(--sev-red\)/);
    expect(h).toContain(`1,8${NBSP}TWh`); // stock calculé : 4 TWh × 45 %
  });
  it('ODRÉ injoignable : valeurs de référence dites', () => {
    const stale = { data: gasFixture({ sourceStatus: { ...gasFixture().sourceStatus, odre: 'stale' } }) };
    expect(buildGasView(input(stale)).head.figure?.caption).toContain('valeurs de référence');
    expect(section('storage', stale)?.html).toContain('Remplissage ODRÉ injoignable : valeurs de référence affichées.');
  });
  it('interconnexions : import en rouge, export en vert, totaux et solde colorés', () => {
    const s = section('interconnections');
    expect(s?.summary).toBe(`<span class="lp-imp">import net 410${NBSP}GWh/j</span>`);
    const h = s?.html ?? '';
    expect(h).toContain(`<span class="lp-imp">import 520${NBSP}GWh/j</span>`); // total Import
    expect(h).toContain(`<span class="lp-exp">export 110${NBSP}GWh/j</span>`); // total Export
    expect(h).toMatch(new RegExp(`Taisnières \\(Belgique\\)[^]*lp-imp">import 520${NBSP}GWh/j[^]*Oltingue \\(Suisse\\)[^]*lp-exp">export 110${NBSP}GWh/j[^]*Solde[^]*lp-imp">import 410${NBSP}GWh/j`));
    expect(h).not.toMatch(/fmk-dot--|lp-lvl/);
    const surplus = gasFixture({ nationalStats: { ...gasFixture().nationalStats, totalImportGWhDay: 100, totalExportGWhDay: 300 } });
    expect(section('interconnections', { data: surplus })?.summary).toBe(`<span class="lp-exp">export net 200${NBSP}GWh/j</span>`);
  });
  it('stockages : mouvement net coloré (remplissage vert, soutirage orange, stable et n.d. neutres)', () => {
    const net = (v: number | undefined) => gasFixture({ nationalStats: { ...gasFixture().nationalStats, storageNetFlowGWhDay: v } });
    const h = (v: number | undefined): string => section('storage', { data: net(v) })?.html ?? '';
    expect(h(412)).toContain(`lp-lvl--vert">Remplissage +412${NBSP}GWh/j`);
    expect(h(-380)).toContain(`lp-lvl--orange">Soutirage −380${NBSP}GWh/j`);
    expect(section('storage', { data: net(-380) })?.summary).toContain('lp-lvl--orange">Soutirage');
    expect(h(0)).toContain('<span class="lp-val fmk-num">Stable</span>');
    expect(section('storage', { data: net(undefined) })?.summary).toContain('<span class="lp-val fmk-num">n.d.</span>');
  });
  it('terminaux GNL : en service puce verte, maintenance puce grise, opérateur, stock, jauge de catégorie', () => {
    const s = section('terminals');
    expect(s?.summary).toBe(`310${NBSP}GWh/j · 1 terminal en service`);
    const h = s?.html ?? '';
    expect(h).toMatch(new RegExp(`fmk-dot--vert[^]*Dunkerque LNG · en service[^]*310${NBSP}GWh/j[^]*stock GNL 71${NBSP}%`));
    expect(h).toMatch(/<span class="fmk-dot" aria-hidden="true"><\/span><span>Fos Tonkin · maintenance<\/span>[^]*n\.d\.[^]*Elengy/);
    expect(h).toMatch(/Utilisation[^]*width:54%;background:var\(--cat-lng\)/);
  });
  it('biométhane : état, écart à la veille coloré, courbe 30 jours colorée par l’état, statut', () => {
    expect(biogasSignal(biogasFixture())).toEqual({ word: 'Normal', level: 'vert' });
    expect(biogasSignal(biogasFixture({ latestMWh: 20_000 }))).toEqual({ word: 'Baisse', level: 'jaune' });
    expect(biogasSignal(biogasFixture({ latestMWh: 16_000 }))).toEqual({ word: 'Alerte', level: 'orange' });
    const s = section('biomethane');
    expect(s?.summary).toBe(`25,3${NBSP}GWh/j · Normal`);
    const h = s?.html ?? '';
    expect(h).toContain(`<span class="lp-val fmk-num lp-lvl lp-lvl--orange">−1,2${NBSP}%</span>`);
    expect(h).toMatch(/<polyline [^>]*stroke="var\(--sev-green\)"/);
    expect(h).toContain('Moyenne 7 jours');
    expect(h).toContain('provisoire, journée du 01/10');
    expect(h).not.toContain('fmk-callout');
    const up = section('biomethane', { biogas: biogasFixture({ deltaJ1Pct: 2.4 }) })?.html ?? '';
    expect(up).toContain(`lp-lvl--vert">+2,4${NBSP}%`);
  });
  it('biométhane : chute de plus de 30 % encadrée ; absent : phrase', () => {
    const drop = biogasFixture({ latestMWh: 16_000, alert: { type: 'production_drop', severityPct: 34.2 } });
    expect(section('biomethane', { biogas: drop })?.html).toContain(`Chute de 34,2${NBSP}% de la production par rapport à la moyenne sur 7 jours.`);
    expect(section('biomethane', { biogas: null })?.html).toContain('Production de biométhane indisponible.');
  });
  it('sources : une ligne par source, puce vert, jaune ou rouge, heure de lecture', () => {
    const data = gasFixture({ sourceStatus: { ...gasFixture().sourceStatus, agsi: 'stale', alsi: 'error' } });
    const h = section('sources', { data })?.html ?? '';
    expect(h).toMatch(/fmk-dot--vert[^]*Ecogaz \(ODRÉ\)/);
    expect(h).toMatch(/fmk-dot--jaune[^]*GIE AGSI/);
    expect(h).toMatch(/fmk-dot--rouge[^]*GIE ALSI/);
    expect(h).toContain('lu à 08:55');
  });
  it('module désactivé, chargement', () => {
    const off = buildGasView(input({ enabled: false }));
    expect(off.bodyHtml).toContain('Couche désactivée sur cette instance.');
    expect(off.sections).toEqual([]);
    const loading = buildGasView(input({ data: null }));
    expect(loading.head.status).toEqual(['chargement…']);
    expect(loading.bodyHtml).toContain('Chargement des données…');
  });
  it('textes tiers échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute', () => {
    const data = gasFixture({ terminals: [{ ...gasFixture().terminals[0], name: '<img src=x onerror=1>' }] });
    const h = html({ data });
    expect(h).not.toContain('<img');
    expect(breakableValue(visibleText(html()))).toBeNull();
    expect(h).not.toMatch(/—|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
  });
});
