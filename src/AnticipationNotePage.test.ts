// @vitest-environment happy-dom
// src/AnticipationNotePage.test.ts : note d'anticipation de 7 h (page imprimable, 04/11/2026, maquette écran 2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnticipationNote } from './types/index.ts';
import { CARBURANT, LYON } from './components/anticipation/fixture.test-data.ts';

const fetchNote = vi.fn<(day?: string) => Promise<AnticipationNote | null>>();
vi.mock('./services/anticipation.ts', () => ({ fetchAnticipationNote: (day?: string) => fetchNote(day) }));

import { dayFromSearch, noteHtml, renderAnticipationNotePage } from './AnticipationNotePage.ts';

const NOTE: AnticipationNote = {
  day: '2026-11-04',
  generatedAt: '2026-11-04T06:00:00Z',
  bluf: 'Journée de mobilisation, risque probable de foule bloquée à Lyon en soirée.',
  degraded: [],
  today: [LYON],
  week: [{ day: '2026-11-07', scenario: { ...CARBURANT, word: 'peu_probable' } }],
  sinceYesterday: {
    opened: [LYON],
    closed: [{ ...CARBURANT, id: 'sc-old', status: 'arrive', word: 'probable', title: 'Crue de la Garonne' }],
  },
};
const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ');
const flush = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { fetchNote.mockReset(); window.history.replaceState({}, '', '/anticipation/note'); });
afterEach(() => { document.body.innerHTML = ''; });

describe('note de 7 h', () => {
  it('note renders bluf, today, week, since yesterday', () => {
    const host = document.createElement('div');
    host.innerHTML = noteHtml(NOTE);
    const t = text(host);
    expect(t).toContain('En une phrase');
    expect(t).toContain('risque probable de foule bloquée à Lyon');
    expect(t).toContain('Scénarios du jour');
    expect(t).toContain('Foule bloquée ou débordements en fin de cortège');
    expect(t).toContain('probable');
    expect(t).toContain('Arrêté préfectoral publié');
    expect(t).toContain('Les 7 prochains jours');
    expect(t).toContain('peu probable');
    expect(t).toContain('Depuis hier');
    expect(t).toContain('Crue de la Garonne');
    expect(t).toContain('arrivé');
    expect(t).toContain('BÊTA');
    expect(t).not.toContain('Sources non lues');
  });

  it('degraded inputs are listed discreetly at the bottom', () => {
    const host = document.createElement('div');
    host.innerHTML = noteHtml({ ...NOTE, degraded: ['Météo-France', 'carburants'] });
    expect(text(host.querySelector('.anp-degraded') as Element)).toBe('Sources non lues au moment de la note : Météo-France, carburants.');
  });

  it('escapes server text', () => {
    const host = document.createElement('div');
    host.innerHTML = noteHtml({ ...NOTE, bluf: '<img src=x onerror=alert(1)>' });
    expect(host.querySelector('img')).toBeNull();
  });

  it('no note: Aucune note pour ce jour', async () => {
    fetchNote.mockResolvedValue(null);
    const host = document.createElement('div');
    renderAnticipationNotePage(host);
    await flush();
    expect(text(host)).toContain('Aucune note pour ce jour');
  });

  it('?day= is passed to the service and validated', async () => {
    fetchNote.mockResolvedValue(NOTE);
    window.history.replaceState({}, '', '/anticipation/note?day=2026-11-03');
    const host = document.createElement('div');
    renderAnticipationNotePage(host);
    await flush();
    expect(fetchNote).toHaveBeenCalledWith('2026-11-03');
    expect(dayFromSearch('?day=n-importe-quoi')).toBeUndefined();
    expect(dayFromSearch('?day=2026-11-03')).toBe('2026-11-03');
    expect(dayFromSearch('')).toBeUndefined();
    expect(host.querySelector('.anp-paper')).not.toBeNull();
  });

  it('service failure: message, no throw', async () => {
    fetchNote.mockRejectedValue(new Error('réseau'));
    const host = document.createElement('div');
    renderAnticipationNotePage(host);
    await flush();
    expect(text(host)).toContain('Note indisponible');
  });
});
