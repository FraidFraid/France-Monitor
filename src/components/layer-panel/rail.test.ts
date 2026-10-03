// src/components/layer-panel/rail.test.ts
import { describe, expect, it } from 'vitest';
import type { RailOverviewResponse, RailTrain } from '../../types/index.ts';
import { railLevel } from '../../services/traffic-levels.ts';
import { TRAFFIC_NOW, paris, railOverviewFixture, railSituationsFixture } from './traffic.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { glueUnits, trafficBreakable } from './traffic-format.ts';
import { RAIL_PAGE_SIZE, buildRailView, railFilterOptions, type RailViewInput } from './rail.ts';

const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<RailViewInput> = {}): RailViewInput => ({
  overview: railOverviewFixture(), overviewError: null, situations: railSituationsFixture(), situationsError: null, filter: 'all', pages: 1,
  canFocus: true, now: TRAFFIC_NOW, open, ...over,
});
const view = (over: Partial<RailViewInput> = {}) => buildRailView(input(over));
const html = (over: Partial<RailViewInput> = {}): string => renderLayerView('trafficRail', view(over));
const sectionOf = (id: string, over: Partial<RailViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withOverview(edit: (o: RailOverviewResponse) => void): RailOverviewResponse {
  const o = railOverviewFixture();
  edit(o);
  return o;
}
const LATE_NOW = Date.parse('2026-10-03T13:31:00Z');

describe('vue Réseau ferroviaire (spec 2026-10-03 trafics § 3.3)', () => {
  it('en-tête du 03/10 : 37 trains en orange, pastille Orange (Sud-Est +56,7 min sur 6 trains), sources datées, synthèse', () => {
    const v = view();
    expect(railLevel(railOverviewFixture()).level).toBe('orange');
    expect(v.head).toMatchObject({ theme: 'Trafics', title: 'Réseau ferroviaire', level: 'orange' });
    expect(v.head.figure).toEqual({ value: '37', caption: `trains grandes lignes perturbés en cours · 20 à 15${NBSP}min ou plus · SNCF, 15:10`, level: undefined });
    expect(v.head.status).toEqual([glueUnits(railLevel(railOverviewFixture()).reason), 'SNCF 15:10 · SIRI SX 15:10']);
    expect(v.head.lead).toBe(`Axe Sud-Est le plus touché (6 trains, +57${NBSP}min en moyenne). TER Occitanie : +58${NBSP}min en moyenne sur 5 trains. `
      + 'Situation : Panne d’installation près de Châteauroux.');
    expect(html()).toContain('<b class="fmk-num lp-lvl lp-lvl--orange">37</b>');
  });
  it('sections, ordre, ouverture', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['axes', true], ['regions', true], ['situations', true], ['top', false], ['trains', false], ['method', false],
    ]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('grandes lignes par axe : trains, retard moyen coloré dès l’orange, maximum, supprimés ; puce selon la règle', () => {
    const s = sectionOf('axes');
    expect(s?.summary).toBe(`Sud-Est +57${NBSP}min`);
    const h = s?.html ?? '';
    expect(h).toContain(`<tr><th scope="row"><span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span>Sud-Est</th><td><span class="lp-val fmk-num">6</span></td>`
      + `<td><span class="lp-val fmk-num lp-lvl lp-lvl--orange">+57${NBSP}min</span></td><td><span class="lp-val fmk-num">140${NBSP}min</span></td>`
      + '<td><span class="lp-val fmk-num">0</span></td></tr>');
    expect(h).toContain(`<span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span>Province, transversales</th><td><span class="lp-val fmk-num">21</span></td>`
      + `<td><span class="lp-val fmk-num">+24${NBSP}min</span></td>`);
    expect(h).toContain(`<span class="fmk-dot fmk-dot--vert" aria-hidden="true"></span>Atlantique</th>`);
    const order = ['>Sud-Est<', '>Province, transversales<', '>Atlantique<', '>Est<', '>Nord<', '>Intercités Bercy<'].map((n) => h.indexOf(n));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(visibleText(h)).toContain('Gare de Lyon : Sud-Est');
  });
  it('TER par région : les 5 régions qui ont le plus de trains, rangées par niveau, le reste résumé', () => {
    const s = sectionOf('regions');
    expect(s?.summary).toBe(`Occitanie +58${NBSP}min`);
    const h = s?.html ?? '';
    expect(h.match(/<tr><th scope="row">/g)).toHaveLength(5);
    const order = ['Occitanie', 'Provence-Alpes-Côte d’Azur', 'Hauts-de-France', 'Auvergne-Rhône-Alpes', 'Grand Est'].map((n) => h.indexOf(n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(h).toContain(`<span class="lp-val fmk-num lp-lvl lp-lvl--orange">+53${NBSP}min</span></td><td><span class="lp-val fmk-num">200${NBSP}min</span>`);
    expect(visibleText(h)).toContain('5 autres régions : 14 trains.');
    expect(visibleText(h)).toContain('région du premier arrêt');
  });
  it('situations en cours : titre, cause, rattachement, nombre de trains, les plus étendues d’abord', () => {
    const s = sectionOf('situations');
    expect(s?.summary).toBe('4 situations');
    const h = s?.html ?? '';
    expect(h).toContain('<span>Panne d’installation près de Châteauroux</span><span class="lp-val fmk-num">11:05</span>'
      + '<small>Cause : panne d’installation en gare · Intercités · 78 trains concernés</small>');
    expect(h.indexOf('Châteauroux')).toBeLessThan(h.indexOf('Narbonne'));
    expect(h.indexOf('Narbonne')).toBeLessThan(h.indexOf('Hazebrouck'));
    expect(visibleText(h)).toContain('messages d’information voyageur sans effet sur la circulation');
  });
  it('plus gros retards : cinq trains, retard coloré, clic vers la carte', () => {
    const s = sectionOf('top');
    expect(s?.summary).toBe(`Paris Gare de Lyon – Barcelone Sants n° 9713 +140${NBSP}min`);
    const h = s?.html ?? '';
    expect(h.match(/class="lp-row/g)).toHaveLength(5);
    expect(h).toContain('<div class="lp-row is-link" tabindex="0" role="button" data-rail-train="SNCF:2026-10-03:9713"><span class="fmk-dot fmk-dot--rouge" aria-hidden="true"></span>'
      + `<span>n° 9713 · Paris Gare de Lyon – Barcelone Sants</span><span class="lp-val fmk-num lp-lvl lp-lvl--rouge">+140${NBSP}min</span>`
      + '<small>retard · axe Sud-Est · mis à jour 15:08</small></div>');
    expect(h).toContain(`<span class="lp-val fmk-num lp-lvl lp-lvl--orange">+60${NBSP}min</span>`);
    expect(sectionOf('top', { canFocus: false })?.html).not.toContain('data-rail-train');
  });
  it('trains un par un : en cours et à venir séparés, supprimés d’abord, filtre par axe et région, pagination', () => {
    const s = sectionOf('trains');
    expect(s?.summary).toBe('7 en cours · 1 à venir');
    const h = s?.html ?? '';
    expect(h).toContain('<select class="lp-select" data-rail-filter aria-label="Axe ou région"><option value="all" selected>Tous les axes et régions</option>');
    expect(h).toContain('<option value="axis:sud-est">Axe Sud-Est</option>');
    expect(h).toContain('<option value="region:occitanie">TER Occitanie</option>');
    const t = visibleText(h);
    expect(t.indexOf('En cours (7)')).toBeLessThan(t.indexOf('n° 4400'));
    expect(t.indexOf('n° 4400')).toBeLessThan(t.indexOf('n° 871234'));
    expect(t.indexOf('n° 871234')).toBeLessThan(t.indexOf('n° 9713'));
    expect(t.indexOf('n° 7885')).toBeLessThan(t.indexOf('À venir (1)'));
    expect(t.indexOf('À venir (1)')).toBeLessThan(t.indexOf('n° 8521'));
    expect(h).toMatch(/<span>n° 4400 · Lyon Part-Dieu – Tours<\/span><span class="lp-val fmk-num lp-lvl lp-lvl--rouge">supprimé<\/span><small>supprimé · axe Province, transversales/);
    expect(h).toMatch(/n° 871234 · Narbonne – Toulouse Matabiau[^]*<small>retard · TER Occitanie · mis à jour 15:08<\/small>/);
    expect(h).toMatch(/n° 8521[^]*<small>retard · axe Atlantique · à venir · mis à jour 15:08<\/small>/);
    expect(h).not.toContain('data-rail-more');
    const sudEst = visibleText(sectionOf('trains', { filter: 'axis:sud-est' })?.html ?? '');
    expect(sudEst).toContain('En cours (3)');
    expect(sudEst).not.toContain('n° 4400');
    expect(sectionOf('trains', { filter: 'axis:sud-est' })?.html).toContain('<option value="axis:sud-est" selected>Axe Sud-Est</option>');
    expect(visibleText(sectionOf('trains', { filter: 'region:occitanie' })?.html ?? '')).toContain('n° 871234');
    const many = withOverview((o) => {
      const base = o.trains[0];
      o.trains = Array.from({ length: 25 }, (_, i): RailTrain => ({ ...base, id: `t-${i}`, number: String(1000 + i), delayMin: 30 + i }));
    });
    const paged = sectionOf('trains', { overview: many })?.html ?? '';
    expect(paged.match(/data-rail-train=/g)).toHaveLength(RAIL_PAGE_SIZE);
    expect(paged).toContain('<button type="button" class="lp-toggle" data-rail-more>Afficher 5 de plus (5 restants)</button>');
    expect(sectionOf('trains', { overview: many, pages: 2 })?.html).not.toContain('data-rail-more');
  });
  it('options du filtre : tous, axes, régions', () => {
    const opts = railFilterOptions(railOverviewFixture());
    expect(opts[0]).toEqual({ value: 'all', label: 'Tous les axes et régions' });
    expect(opts).toHaveLength(1 + 6 + 10);
  });
  it('méthode et sources : périmètre (T1), règle de la pastille, axes, effets exacts, retards', () => {
    const t = visibleText(sectionOf('method')?.html ?? '');
    for (const part of ['mise à jour de 15:10', 'réponse de 15:10', 'trains signalés par la SNCF (pas le plan de transport complet)',
      `à partir de 5${NBSP}min`, 'au moins 3 trains', `90${NBSP}min de retard moyen ou plus`, 'au moins 10 trains supprimés',
      'au moins 15 trains grandes lignes', 'service réduit (REDUCED_SERVICE)', 'train ajouté (ADDITIONAL_SERVICE)', `au-delà de 20${NBSP}min`]) {
      expect(t).toContain(part);
    }
    expect(sectionOf('method')?.summary).toBe('SNCF · SIRI SX');
  });
  it('en retard (SNCF plus de 20 min) : pastille n.d., « (en retard) », aucune couleur de niveau', () => {
    const v = view({ now: LATE_NOW });
    expect(v.head.level).toBe('nd');
    expect(v.head.figure?.level).toBeNull();
    expect(v.head.figure?.caption).toMatch(/SNCF, 15:10 \(en retard\)$/);
    expect(v.head.status).toEqual(['niveau suspendu : données SNCF en retard', 'SNCF 15:10 (en retard) · SIRI SX 15:10 (en retard)']);
    expect(v.head.lead).toBeNull();
    const h = renderLayerView('trafficRail', v);
    expect(h).not.toMatch(/lp-lvl--|fmk-dot--(?:rouge|orange|jaune|vert)|fm-vig--(?:rouge|orange|jaune|vert)/);
    expect(v.sections.find((s) => s.id === 'situations')?.summary).toBe('4 situations (en retard)');
  });
  it('panne partielle : SIRI SX en panne, perturbations sans agrégat ; jamais « aucune » quand la source manque', () => {
    const down = view({ situations: null, situationsError: 'HTTP 503' });
    expect(down.sections.find((s) => s.id === 'situations')?.html).toContain('Source indisponible : SIRI SX (situations SNCF).');
    expect(down.head.status[1]).toBe('SNCF 15:10 · SIRI SX injoignable');
    expect(down.head.lead).not.toContain('Situation :');
    const partial = withOverview((o) => { o.axes = []; o.regions = []; o.errors = ['SNCF : HTTP 429']; });
    const v = view({ overview: partial });
    expect(v.sections.find((s) => s.id === 'axes')?.html).toContain('Source indisponible : perturbations SNCF.');
    expect(visibleText(renderLayerView('trafficRail', v))).not.toMatch(/Aucun train grandes lignes/);
    expect(visibleText(v.sections.find((s) => s.id === 'method')?.html ?? '')).toContain('Incidents de lecture : SNCF : HTTP 429.');
    expect(view({ situations: null }).sections.find((s) => s.id === 'situations')?.html).toContain('Chargement des situations…');
  });
  it('erreur sans donnée, erreur avec données, vide, chargement', () => {
    const failed = view({ overview: null, overviewError: 'HTTP 500' });
    expect(failed.head).toMatchObject({ level: 'nd', figure: { value: 'n.d.' } });
    expect(failed.head.status[0]).toBe('SNCF injoignable');
    expect(failed.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(failed.sections.find((s) => s.id === 'axes')?.html).toContain('Source indisponible : perturbations SNCF.');
    expect(view({ overviewError: 'HTTP 500' }).bodyHtml).toContain('Source injoignable. Dernières données : 15:10.');
    const calm = withOverview((o) => { o.axes = []; o.regions = []; o.trains = []; o.topDelays = []; o.longDistance = { active: 0, delayed15: 0 }; });
    expect(view({ overview: calm }).sections.find((s) => s.id === 'axes')?.html).toContain('Aucun train grandes lignes perturbé en cours.');
    expect(view({ overview: null }).bodyHtml).toContain('Chargement des données…');
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute', () => {
    const overview = withOverview((o) => {
      o.trains[0].origin = '<img src=x>';
      o.topDelays[0].destination = '<script>y</script>';
      o.regions[0].label = '"><svg onload=1>';
    });
    const situations = railSituationsFixture();
    situations.situations[0].title = '<b>titre</b>';
    const h = html({ overview, situations });
    expect(h).not.toMatch(/<img|<script|<svg onload|<b>titre/);
    for (const over of [{}, { overview, situations }, { now: LATE_NOW }, { situations: null, situationsError: 'HTTP 503' }]) {
      const all = html(over);
      const text = visibleText(all);
      expect(breakableValue(text)).toBeNull();
      expect(trafficBreakable(text)).toBeNull();
      expect(all).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(text.toLowerCase()).not.toContain('temps réel');
    }
    expect(paris('15:10')).toBe('2026-10-03T15:10:00+02:00');
  });
});

describe('vue Réseau ferroviaire : arbitrages du serveur', () => {
  const AXIS_KEYS = ['sud-est', 'atlantique', 'nord', 'est', 'intercites-bercy', 'normandie', 'province'] as const;
  const withUnattached = (): RailOverviewResponse => withOverview((o) => {
    o.axes.push({ key: 'non-rattache', label: 'Non rattaché', trains: 2, avgDelayMin: 12, maxDelayMin: 20, cancelled: 0, reduced: 0, detour: 0 });
    const base = o.trains[0];
    o.trains.push({ ...base, id: 'gl-1', number: '5001', axis: null, kind: 'grandes-lignes', region: null, origin: 'Metz', destination: 'Nice' });
  });
  it('8e groupe « Non rattaché » : rendu générique, option nommée, sélection des grandes lignes sans axe, pas des TER', () => {
    const o = withUnattached();
    expect(railFilterOptions(o)).toContainEqual({ value: 'axis:non-rattache', label: 'Grandes lignes non rattachées' });
    expect(railFilterOptions(o).map((x) => x.label)).not.toContain('Axe Non rattaché');
    expect(railFilterOptions(o).map((x) => x.value)).toContain('region:non-rattache');
    const h = sectionOf('axes', { overview: o })?.html ?? '';
    expect(h.match(/<tr><th scope="row">/g)).toHaveLength(7);
    expect(h).toContain('Non rattaché</th>');
    const sel = sectionOf('trains', { overview: o, filter: 'axis:non-rattache' })?.html ?? '';
    expect(visibleText(sel)).toContain('n° 5001');
    expect(visibleText(sel)).toContain('En cours (1)');
    expect(visibleText(sel)).not.toContain('n° 871234');
    expect(sel).toContain('<option value="axis:non-rattache" selected>Grandes lignes non rattachées</option>');
    const ter = sectionOf('trains', { overview: o, filter: 'region:non-rattache' })?.html ?? '';
    expect(visibleText(ter)).not.toContain('n° 5001');
    expect(visibleText(sel)).toContain('grandes lignes non rattachées');
  });
  it('jour calme : 7 axes à zéro train, errors vide, même message que sans axe', () => {
    const calm = withOverview((o) => {
      o.axes = AXIS_KEYS.map((k) => ({ key: k, label: k, trains: 0, avgDelayMin: null, maxDelayMin: null, cancelled: 0, reduced: 0, detour: 0 }));
      o.regions = []; o.trains = []; o.topDelays = []; o.longDistance = { active: 0, delayed15: 0 }; o.errors = [];
    });
    const h = sectionOf('axes', { overview: calm })?.html ?? '';
    expect(h).toContain('Aucun train grandes lignes perturbé en cours.');
    expect(h).not.toContain('<table');
  });
});
