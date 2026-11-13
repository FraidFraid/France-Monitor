// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { AnticipationNowResponse } from '../../types/index.ts';
import { agendaHtml, dayLabel, groupScenarios, scenarioPlace, summaryHtml, visitMarks } from './agenda-view.ts';
import { CARBURANT, FIXTURE, LYON } from './fixture.test-data.ts';

const render = (data: AnticipationNowResponse | null, selectedId: string | null = null): HTMLElement => {
  const el = document.createElement('div');
  el.innerHTML = agendaHtml(data, { selectedId, marks: new Map() });
  return el;
};

describe('agenda des risques croisés', () => {
  it('agenda renders today halves and empty days with deadlines', () => {
    const el = render(FIXTURE, 'sc-lyon');
    expect(el.textContent).toContain('Ce qui pourrait arriver · 7 jours');
    const today = el.querySelector('[data-agenda-day="2026-11-04"]');
    expect(today?.textContent).toContain('Aujourd\'hui');
    const halves = [...(today?.querySelectorAll('[data-half]') ?? [])].map((h) => h.getAttribute('data-half'));
    expect(halves).toEqual(['matin', 'apres-midi', 'soir']);
    expect(today?.querySelector('[data-half="apres-midi"] [data-scenario="sc-lyon"]')).not.toBeNull();
    expect(today?.querySelector('[data-half="matin"]')?.textContent).toContain('Rien à signaler.');
    expect(el.querySelector('[data-scenario="sc-lyon"]')?.classList.contains('is-sel')).toBe(true);
    // Jeudi : le scénario national, sans couleur de carte mais dans l'agenda.
    const jeudi = el.querySelector('[data-agenda-day="2026-11-05"]');
    expect(jeudi?.textContent).toContain('National');
    expect(jeudi?.textContent).toContain('peu probable');
    // Vendredi à mardi : jours vides regroupés, échéances connues listées.
    const empty = el.querySelector('[data-agenda-empty="2026-11-06"]');
    expect(empty?.textContent).toContain('Rien à signaler.');
    expect(empty?.textContent).toContain('Écowatt vert');
    expect(empty?.textContent).toContain('RTE');
    expect([...(empty?.querySelectorAll('.anr-dl li') ?? [])].length).toBeGreaterThan(0);
    expect(empty?.textContent).toMatch(/Ven\. 6\/11 → mar\. 10\/11/);
  });

  it('domaines des signaux cités en puces, lieu « département · commune »', () => {
    const el = render(FIXTURE);
    const item = el.querySelector('[data-scenario="sc-lyon"]');
    expect(item?.textContent).toContain('Rhône · Lyon');
    expect(item?.textContent).toContain('Manifestations');
    expect(item?.textContent).toContain('Transports');
    expect(item?.querySelector('.anr-lvl')?.getAttribute('style')).toContain('--sev-orange');
    expect(scenarioPlace(CARBURANT)).toBe('National');
  });

  it('crise manquée (mot vide) : affichée sans mot', () => {
    const missed = { ...LYON, id: 'sc-m', word: '' as const, status: 'manque' as const };
    const data: AnticipationNowResponse = { ...FIXTURE, scenarios: [missed], agenda: [{ ...FIXTURE.agenda[0], halves: [{ half: 'matin', scenarioIds: ['sc-m'] }], scenarioIds: ['sc-m'] }] };
    const item = render(data).querySelector('[data-scenario="sc-m"]');
    expect(item).not.toBeNull();
    expect(item?.querySelector('.anr-lvl')).toBeNull();
  });

  it('sans réponse : chargement ; réponse vide : rien à signaler', () => {
    expect(render(null).textContent).toContain('Chargement');
    const empty = render({ ...FIXTURE, scenarios: [], agenda: FIXTURE.agenda.map((d) => ({ ...d, scenarioIds: [], halves: d.halves?.map((h) => ({ ...h, scenarioIds: [] })) })) });
    expect(empty.textContent).toContain('Rien à signaler aujourd\u2019hui.');
    // Aujourd'hui entièrement calme : une seule ligne, pas trois demi-journées vides.
    const today = empty.querySelector('[data-agenda-day="2026-11-04"]');
    expect(today?.querySelectorAll('[data-half]')).toHaveLength(0);
    expect(today?.textContent).toContain('Rien à signaler.');
  });

  it('demi-journée inconnue : ignorée, jamais recopiée dans le HTML', () => {
    const bad = { ...FIXTURE, agenda: [{ ...FIXTURE.agenda[0], halves: [{ half: '"><img src=x>' as unknown as 'matin', scenarioIds: ['sc-lyon'] }] }] };
    const html = agendaHtml(bad, { selectedId: null, marks: new Map() });
    expect(html).not.toContain('<img');
  });

  it('libellé des jours à l\u2019heure de Paris', () => {
    expect(dayLabel('2026-11-04', '2026-11-04')).toBe('Aujourd\'hui · mer. 4/11');
    expect(dayLabel('2026-11-05', '2026-11-04')).toBe('Jeu. 5/11');
  });
});

describe('depuis ta dernière visite', () => {
  it('nouveau, en hausse, signe constaté depuis la visite', () => {
    const since = Date.parse('2026-11-04T08:00:00Z');
    const marks = visitMarks(FIXTURE.scenarios, { since, words: { 'sc-carburant': 'chance_infime' } });
    expect(marks.get('sc-lyon')).toEqual({ isNew: true, raised: false, basculeAt: '2026-11-04T12:10:00Z' });
    expect(marks.get('sc-carburant')).toEqual({ isNew: false, raised: true, basculeAt: null });
    const el = document.createElement('div');
    el.innerHTML = agendaHtml(FIXTURE, { selectedId: null, marks });
    expect(el.querySelector('[data-scenario="sc-lyon"]')?.textContent).toContain('nouveau');
    expect(el.querySelector('[data-scenario="sc-lyon"]')?.textContent).toContain('signe constaté');
    expect(el.querySelector('[data-scenario="sc-carburant"]')?.textContent).toContain('en hausse');
  });
  it('visite inconnue : aucune marque', () => {
    expect([...visitMarks(FIXTURE.scenarios, null).values()].every((m) => !m.isNew && !m.raised && m.basculeAt === null)).toBe(true);
  });
});

describe('lecture simplifiée : regroupement et résumé', () => {
  // Trois hypothèses de même règle et de même titre le même après-midi (Rhône, Hérault, Savoie), comme les lycées du 13/11/2026.
  const twin = (id: string, dept: string, word: AnticipationNowResponse['scenarios'][number]['word']): AnticipationNowResponse['scenarios'][number] =>
    ({ ...LYON, id, word, zone: { dept: [dept], communes: [] } });
  const many: AnticipationNowResponse = {
    ...FIXTURE,
    scenarios: [twin('sc-a', '69', 'peu_probable'), twin('sc-b', '34', 'probable'), twin('sc-c', '73', 'possibilite_reelle'), CARBURANT],
    agenda: FIXTURE.agenda.map((d, i) => (i === 0
      ? { ...d, scenarioIds: ['sc-a', 'sc-b', 'sc-c'], halves: [{ half: 'matin' as const, scenarioIds: [] }, { half: 'apres-midi' as const, scenarioIds: ['sc-a', 'sc-b', 'sc-c'] }, { half: 'soir' as const, scenarioIds: [] }] }
      : d)),
  };

  it('hypothèses identiques : un seul titre, un bouton par lieu du plus au moins probable, niveau le plus haut', () => {
    expect(groupScenarios(many.scenarios).map((g) => g.map((s) => s.id))).toEqual([['sc-a', 'sc-b', 'sc-c'], ['sc-carburant']]);
    const el = render(many, 'sc-c');
    const group = el.querySelector('[data-half="apres-midi"] .anr-group');
    expect(group?.textContent?.split(LYON.title)).toHaveLength(2);
    expect(group?.textContent).toContain('3\u00a0départements');
    expect(group?.querySelector('.anr-row .anr-lvl')?.textContent).toBe('probable');
    const places = [...(group?.querySelectorAll('button.anr-place') ?? [])];
    expect(places.map((b) => b.getAttribute('data-scenario'))).toEqual(['sc-b', 'sc-c', 'sc-a']);
    expect(places.map((b) => b.textContent)).toEqual(['Hérault', 'Savoie', 'Rhône']);
    expect(places[0].getAttribute('aria-label')).toBe('Hérault, probable');
    expect(places[0].querySelector('.anr-pip')?.getAttribute('style')).toContain('--sev-orange');
    expect(places.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    // Une hypothèse seule garde sa ligne entière.
    expect(el.querySelector('button.anr-item[data-scenario="sc-carburant"]')).not.toBeNull();
  });

  it('résumé du jour : une ligne par groupe ; jour calme : prochain jour concerné', () => {
    const sum = document.createElement('div');
    sum.innerHTML = summaryHtml(many);
    expect(sum.querySelector('h3')?.textContent).toBe('À retenir aujourd\u2019hui');
    const lines = [...sum.querySelectorAll('li')].map((li) => li.textContent);
    expect(lines).toEqual([`${LYON.title} · 3\u00a0départementsprobable`]);
    const calm = document.createElement('div');
    calm.innerHTML = summaryHtml({ ...FIXTURE, agenda: FIXTURE.agenda.map((d, i) => (i === 0 ? { ...d, scenarioIds: [] } : d)) });
    expect(calm.textContent).toContain('Rien à signaler aujourd\u2019hui. Prochain jour concerné : jeu. 5/11 (1\u00a0hypothèse).');
  });

  it('aide repliée présente, fermée au départ', () => {
    const help = render(FIXTURE).querySelector<HTMLDetailsElement>('details.anr-help');
    expect(help?.querySelector('summary')?.textContent).toBe('Comment lire cette page');
    expect(help?.open).toBe(false);
  });
});
