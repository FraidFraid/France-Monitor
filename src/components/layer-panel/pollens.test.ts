// src/components/layer-panel/pollens.test.ts
import { describe, expect, it } from 'vitest';
import type { PollenResponse } from '../../types/index.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, visibleText } from './format.ts';
import { POLLENS_TABS, POLLENS_TITLE, buildPollensView, pollenDate, pollenWordFor, pollensHeadLevel, type PollensViewInput } from './pollens.ts';
import { POLLENS_LEGEND, POLLEN_HEX, POLLEN_WORD, pollensLegend } from './pollens-legend.ts';
import { POLLEN_FIXTURE_NOW as NOW, calmPollenFixture, pollenFixture } from './pollens.fixture.ts';

const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<PollensViewInput> = {}): PollensViewInput => ({ pollen: pollenFixture(), error: null, day: 'J', canFocus: true, now: NOW, open, ...over });
const view = (over: Partial<PollensViewInput> = {}) => buildPollensView(input(over));
const html = (over: Partial<PollensViewInput> = {}): string => renderLayerView('pollens', view(over));
const section = (id: string, over: Partial<PollensViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withPollen(edit: (p: PollenResponse) => void): PollenResponse {
  const p = pollenFixture();
  edit(p);
  return p;
}

describe('pastille : niveau mesuré du jour', () => {
  it('n.d. sans donnée', () => expect(pollensHeadLevel(null, NOW)).toBe('nd'));
  it('n.d. en retard (plus de 36 h)', () => expect(pollensHeadLevel(pollenFixture(), NOW + 37 * 3_600_000)).toBe('nd'));
  it('n.d. si le jour n’est pas publié', () => expect(pollensHeadLevel(withPollen((p) => { p.departments.forEach((d) => { d.days = d.days.slice(1); }); }), NOW)).toBe('nd'));
  it.each([[1, 'vert'], [3, 'vert'], [4, 'jaune'], [5, 'orange'], [6, 'rouge']] as const)('plus haut code %i : %s', (code, level) => {
    const p = withPollen((x) => { x.departments = [{ code: '69', name: 'Rhône', days: [{ date: '2026-10-20', maxCode: code, communes: 3, high: 1, alerte: false, taxa: [] }] }]; });
    expect(pollensHeadLevel(p, NOW)).toBe(level);
  });
  it('le fixture du 20/10 : orange (Rhône, très élevé)', () => expect(pollensHeadLevel(pollenFixture(), NOW)).toBe('orange'));
});

describe('en-tête', () => {
  it('chiffre : départements à élevé ou plus, ambroisie nommée dans la synthèse, mise à jour datée', () => {
    const v = view();
    expect(v.head).toMatchObject({ theme: 'Environnement', title: POLLENS_TITLE, level: 'orange' });
    expect(v.head.figure?.value).toBe('2');
    expect(v.head.figure?.level).toBe('orange');
    expect(v.head.figure?.caption).toContain('Atmo France');
    expect(v.head.lead).toContain('Ambroisie très élevée dans 1 département (Rhône)');
    expect(v.head.lead).toContain('graminées élevées dans 1 département (Rhône)');
    expect(v.head.lead).toContain('olivier élevé dans 1 département (Bouches-du-Rhône)');
  });
  it('J+1 : extrêmement élevé accordé ; J+2 : aucun département élevé, niveau le plus haut dit', () => {
    expect(view({ day: 'J1' }).head.lead).toContain('Ambroisie extrêmement élevée dans 1 département (Rhône) ; graminées élevées dans 1 département (Rhône) demain.');
    expect(view({ day: 'J1' }).head.figure?.level).toBe('rouge');
    // Aucun département élevé : pas de gros « 0 » lu comme un score (20/10/2026), la phrase de tête le dit.
    expect(view({ day: 'J2' }).head.figure).toBeNull();
    expect(view({ day: 'J2' }).head.lead).toContain('Aucun département à pollens élevés');
    expect(view({ day: 'J2' }).head.lead).toContain('niveau le plus haut : modéré');
  });
  it('période calme : jamais vide, phrase explicite', () => {
    const v = view({ pollen: calmPollenFixture() });
    expect(v.head.figure).toBeNull();
    expect(v.head.level).toBe('vert');
    expect(v.head.lead).toContain('Aucun département à pollens élevés aujourd’hui');
    expect(section('eleves', { pollen: calmPollenFixture() })?.html).toContain('Aucun département à pollens élevés aujourd’hui');
    expect(section('eleves', { pollen: calmPollenFixture() })?.summary).toBe('aucun');
  });
  it('en retard : niveau suspendu, synthèse retirée, lignes grises', () => {
    const late = NOW + 40 * 3_600_000;
    const v = view({ now: late });
    expect(v.head.level).toBe('nd');
    expect(v.head.lead).toBeNull();
    expect(v.head.status[0]).toBe('niveau suspendu : pollens Atmo France en retard');
    expect(v.head.status[1]).toContain('(en retard)');
  });
  it('jour non publié : n.d., dit, jamais zéro', () => {
    const p = withPollen((x) => { x.days = x.days.slice(0, 1); x.departments.forEach((d) => { d.days = d.days.slice(0, 1); }); });
    const v = view({ pollen: p, day: 'J2' });
    expect(v.head.figure?.value).toBe('n.d.');
    expect(v.head.lead).toContain('pas encore publié');
    expect(section('eleves', { pollen: p, day: 'J2' })?.html).toContain('non encore publiés');
    expect(section('taxons', { pollen: p, day: 'J2' })?.html).toContain('non encore publiés');
  });
});

describe('onglets J / J+1 / J+2', () => {
  it('trois onglets avec le nombre de départements élevés par jour ; actif = jour choisi', () => {
    expect(POLLENS_TABS).toEqual(['J', 'J1', 'J2']);
    const v = view({ day: 'J1' });
    expect(v.tabs).toEqual([
      { id: 'J', label: 'Aujourd’hui', count: 2 }, { id: 'J1', label: 'Demain', count: 1 }, { id: 'J2', label: 'Après-demain', count: 0 },
    ]);
    expect(v.activeTab).toBe('J1');
  });
  it('échéances par le calendrier de Paris', () => {
    expect([pollenDate('J', NOW), pollenDate('J1', NOW), pollenDate('J2', NOW)]).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    expect(pollenDate('J2', Date.parse('2026-10-30T12:00:00Z'))).toBe('2026-11-01');
  });
  it('les lignes suivent le jour choisi', () => {
    expect(visibleText(section('eleves', { day: 'J1' })?.html ?? '')).toContain('Rhône (69)');
    expect(visibleText(section('eleves', { day: 'J1' })?.html ?? '')).not.toContain('Bouches-du-Rhône (13)');
  });
});

describe('sections', () => {
  it('ordre et ouverture', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([['eleves', true], ['taxons', false], ['methode', false]]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('départements élevés : triés par niveau, cliquables avec data-department, taxons responsables dans la note', () => {
    const s = section('eleves');
    expect(s?.summary).toBe('2 départements');
    expect(s?.html.indexOf('Rhône (69)')).toBeLessThan(s?.html.indexOf('Bouches-du-Rhône (13)') ?? 0);
    expect(s?.html).toContain('data-department="69"');
    expect(s?.html).toContain('is-link');
    expect(s?.html).toContain(`background:${POLLEN_HEX[5]}`);
    const t = visibleText(s?.html ?? '');
    expect(t).toContain('12 communes sur 267 à élevé ou plus');
    expect(t).toContain('ambroisie très élevée, graminées élevées');
    expect(t).toContain('alerte publiée');
    expect(t).toContain('Clic sur une ligne');
  });
  it('sans carte : lignes non cliquables', () => {
    const s = section('eleves', { canFocus: false });
    expect(s?.html).not.toContain('data-department');
    expect(s?.html).not.toContain('is-link');
  });
  it('taxons : plus haut niveau national, répartition par niveau, accord au féminin et pluriel', () => {
    const t = visibleText(section('taxons')?.html ?? '');
    expect(t).toContain('Ambroisie');
    expect(t).toContain('très élevé');
    expect(t).toContain('Graminées');
    expect(t).toContain('plus haut niveau national · départements : très élevé 1 · très faible 1');
    expect(t).toContain('Graminéesélevées');
    expect(section('taxons')?.summary).toBe('ambroisie très élevée');
    expect(pollenWordFor(4, 'graminees')).toBe('élevées');
    expect(pollenWordFor(4, 'ambroisie')).toBe('élevée');
    expect(pollenWordFor(4, 'olivier')).toBe('élevé');
    expect(pollenWordFor(2, 'graminees')).toBe('faibles');
    expect(pollenWordFor(6, 'armoise')).toBe('extrêmement élevée');
  });
  it('taxon jamais publié : n.d., jamais 0', () => {
    const p = withPollen((x) => { x.departments.forEach((d) => d.days.forEach((dd) => { dd.taxa = dd.taxa.filter((t) => t.taxon !== 'bouleau'); })); });
    const t = visibleText(section('taxons', { pollen: p })?.html ?? '');
    expect(t).toContain('Bouleau');
    expect(t).toContain('n.d.');
    expect(t).toContain('niveau non publié ce jour');
  });
  it('méthode et sources : producteurs, licence, couverture (régions qui ne publient pas), lecture, retard, incidents', () => {
    const p = withPollen((x) => { x.errors = ['Atmo France, pollens 2026-10-22 : HTTP 500']; });
    const s = section('methode', { pollen: p });
    const t = visibleText(s?.html ?? '');
    expect(s?.summary).toBe('Atmo France');
    expect(t).toContain('Airparif, Atmo Auvergne-Rhône-Alpes, AtmoSud');
    expect(t).toContain('Licence Ouverte');
    expect(t).toContain('4 départements publiés');
    expect(t).toContain('sans pollens publiés');
    expect(t).toContain('Certaines régions peuvent ne pas publier');
    expect(t).toContain(`Retard : au-delà de 36${NBSP}h`);
    expect(t).toContain('Incidents de lecture : Atmo France, pollens 2026-10-22 : HTTP 500.');
    expect(view({ pollen: p }).head.status.at(-1)).toBe('1 incident de lecture (voir Méthode et sources)');
  });
});

describe('états sans donnée', () => {
  it('chargement', () => {
    const v = view({ pollen: null, error: null });
    expect(v.head.status).toEqual(['chargement…']);
    expect(v.sections).toEqual([]);
    expect(v.bodyHtml).toBeTruthy();
  });
  it('source injoignable : n.d. dit, jamais « aucun département »', () => {
    const v = view({ pollen: null, error: 'HTTP 502' });
    expect(v.head.level).toBe('nd');
    expect(v.head.figure?.value).toBe('n.d.');
    expect(v.sections.map((s) => s.id)).toEqual(['eleves', 'taxons', 'methode']);
    expect(v.sections[0].html).toContain('Source indisponible');
    expect(v.tabs).toHaveLength(3);
  });
});

describe('typographie', () => {
  it.each(['J', 'J1', 'J2'] as const)('aucun tiret cadratin ni espace insécable littéral dans le rendu (%s)', (day) => {
    const out = html({ day }) + JSON.stringify(view({ day }).head);
    expect(out).not.toContain('—');
    expect(JSON.stringify(POLLENS_LEGEND)).not.toContain('—');
  });
  it('échelle de légende : 6 niveaux, palette officielle Atmo', () => {
    expect(POLLEN_HEX.slice(1)).toEqual(['#50f0e6', '#50ccaa', '#f0e641', '#ff5050', '#960032', '#872181']);
    expect(Object.values(POLLEN_WORD)).toEqual(['très faible', 'faible', 'modéré', 'élevé', 'très élevé', 'extrêmement élevé']);
    expect(POLLENS_LEGEND.id).toBe('pollens');
    expect(POLLENS_LEGEND.items.filter((i) => !i.isHeader).map((i) => i.color)).toEqual(POLLEN_HEX.slice(1));
  });
  it('légende datée, en retard dite, indisponible dite', () => {
    expect(pollensLegend(pollenFixture(), NOW).notes?.[0]).toMatch(/^Données : pollens du 20\/10, mis à jour le .+\.$/);
    const late = pollensLegend(pollenFixture(), NOW + 40 * 3_600_000);
    expect(late.notes?.[0]).toContain('(en retard)');
    expect(late.notes?.[1]).toBe('En retard : couleurs de niveau retirées de la carte.');
    expect(pollensLegend(null, NOW).notes?.[0]).toBe('Données : Atmo France indisponible.');
    expect(pollensLegend(withPollen((p) => { p.days = []; }), NOW).notes?.[0]).toBe('Données : pollens non encore publiés.');
  });
});
