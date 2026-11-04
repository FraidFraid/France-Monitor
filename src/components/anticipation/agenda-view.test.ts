// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { AnticipationNowResponse } from '../../types/index.ts';
import { agendaHtml, dayLabel, scenarioPlace, visitMarks } from './agenda-view.ts';
import { CARBURANT, FIXTURE, LYON } from './fixture.test-data.ts';

const render = (data: AnticipationNowResponse | null, selectedId: string | null = null): HTMLElement => {
  const el = document.createElement('div');
  el.innerHTML = agendaHtml(data, { selectedId, marks: new Map() });
  return el;
};

describe('agenda des risques croisés', () => {
  it('agenda renders today halves and empty days with deadlines', () => {
    const el = render(FIXTURE, 'sc-lyon');
    expect(el.textContent).toContain('Agenda des risques croisés');
    const today = el.querySelector('[data-agenda-day="2026-11-04"]');
    expect(today?.textContent).toContain('Aujourd\'hui');
    const halves = [...(today?.querySelectorAll('[data-half]') ?? [])].map((h) => h.getAttribute('data-half'));
    expect(halves).toEqual(['matin', 'apres-midi', 'soir']);
    expect(today?.querySelector('[data-half="apres-midi"] [data-scenario="sc-lyon"]')).not.toBeNull();
    expect(today?.querySelector('[data-half="matin"]')?.textContent).toContain('Aucun croisement');
    expect(el.querySelector('[data-scenario="sc-lyon"]')?.classList.contains('is-sel')).toBe(true);
    // Jeudi : le scénario national, sans couleur de carte mais dans l'agenda.
    const jeudi = el.querySelector('[data-agenda-day="2026-11-05"]');
    expect(jeudi?.textContent).toContain('National');
    expect(jeudi?.textContent).toContain('peu probable');
    // Vendredi à mardi : jours vides regroupés, échéances connues listées.
    const empty = el.querySelector('[data-agenda-empty="2026-11-06"]');
    expect(empty?.textContent).toContain('Aucun croisement détecté.');
    expect(empty?.textContent).toContain('Écowatt vert');
    expect(empty?.textContent).toContain('RTE');
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

  it('sans réponse : chargement ; réponse vide : aucun croisement', () => {
    expect(render(null).textContent).toContain('Chargement');
    const empty = render({ ...FIXTURE, scenarios: [], agenda: FIXTURE.agenda.map((d) => ({ ...d, scenarioIds: [], halves: d.halves?.map((h) => ({ ...h, scenarioIds: [] })) })) });
    expect(empty.textContent).toContain('Aucun croisement détecté.');
  });

  it('libellé des jours à l\u2019heure de Paris', () => {
    expect(dayLabel('2026-11-04', '2026-11-04')).toBe('Aujourd\'hui · mer. 4/11');
    expect(dayLabel('2026-11-05', '2026-11-04')).toBe('Jeu. 5/11');
  });
});

describe('depuis ta dernière visite', () => {
  it('nouveau, mot monté, bascule atteinte depuis la visite', () => {
    const since = Date.parse('2026-11-04T08:00:00Z');
    const marks = visitMarks(FIXTURE.scenarios, { since, words: { 'sc-carburant': 'chance_infime' } });
    expect(marks.get('sc-lyon')).toEqual({ isNew: true, raised: false, basculeAt: '2026-11-04T12:10:00Z' });
    expect(marks.get('sc-carburant')).toEqual({ isNew: false, raised: true, basculeAt: null });
    const el = document.createElement('div');
    el.innerHTML = agendaHtml(FIXTURE, { selectedId: null, marks });
    expect(el.querySelector('[data-scenario="sc-lyon"]')?.textContent).toContain('nouveau');
    expect(el.querySelector('[data-scenario="sc-lyon"]')?.textContent).toContain('bascule atteinte');
    expect(el.querySelector('[data-scenario="sc-carburant"]')?.textContent).toContain('monté');
  });
  it('visite inconnue : aucune marque', () => {
    expect([...visitMarks(FIXTURE.scenarios, null).values()].every((m) => !m.isNew && !m.raised && m.basculeAt === null)).toBe(true);
  });
});
