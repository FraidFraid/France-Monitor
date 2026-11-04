// @vitest-environment happy-dom
// src/AnticipationBilanPage.test.ts : bilan public de l'anticipation (04/11/2026, maquette écran 3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnticipationBilan, AnticipationNowResponse } from './types/index.ts';
import { FIXTURE } from './components/anticipation/fixture.test-data.ts';

const fetchBilan = vi.fn<(month?: string) => Promise<AnticipationBilan>>();
const fetchNow = vi.fn<() => Promise<AnticipationNowResponse>>();
vi.mock('./services/anticipation.ts', () => ({
  fetchAnticipationBilan: (m?: string) => fetchBilan(m),
  fetchAnticipationNow: () => fetchNow(),
}));

import { ATOM_FEED_URL, bilanHtml, deptSectionHtml, renderAnticipationBilanPage } from './AnticipationBilanPage.ts';

const BILAN: AnticipationBilan = {
  month: '2026-10',
  emitted: 41,
  arrived: 19,
  notArrived: 17,
  undecided: 2,
  missed: 3,
  byWord: [
    { word: 'tres_probable', closed: 6, arrived: 5, percent: null },
    { word: 'probable', closed: 14, arrived: 9, percent: null },
    { word: 'possibilite_reelle', closed: 40, arrived: 18, percent: 45 },
    { word: 'peu_probable', closed: 0, arrived: 0, percent: null },
  ],
  byRule: [
    { ruleId: 'mobilisation-transports', title: 'Foule bloquée ou débordements en fin de cortège', emitted: 11, arrived: 7, useful: 8, inReview: false, arrivalTest: 'Un événement de presse est relevé dans le département.' },
    { ruleId: 'greve-carburant', title: 'Grève dans le raffinage et tension sur les carburants', emitted: 4, arrived: 0, useful: 1, inReview: true, arrivalTest: 'La part nationale des stations en rupture dépasse 15 %.' },
  ],
};
const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ');
const flush = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { fetchBilan.mockReset(); fetchNow.mockReset(); window.history.replaceState({}, '', '/anticipation/bilan'); });
afterEach(() => { document.body.innerHTML = ''; });

describe('bilan public', () => {
  it('bilan shows counts not percent under 30', () => {
    const host = document.createElement('div');
    host.innerHTML = bilanHtml(BILAN);
    const t = text(host);
    expect(t).toContain('9 sur 14');
    expect(t).toContain('5 sur 6');
    expect(t).not.toContain('64 %');
    expect(t).not.toContain('64\u00a0%');
    // 40 clos : le pourcentage du serveur est affiché
    expect(t).toContain('18 sur 40');
    expect(t).toMatch(/45\s%/);
    expect(t).toContain('41');
    expect(t).toContain('crises manquées');
  });

  it('rule in review flagged, with its public arrival test', () => {
    const host = document.createElement('div');
    host.innerHTML = bilanHtml(BILAN);
    const rows = [...host.querySelectorAll('.anb-rules tbody tr')];
    expect(rows).toHaveLength(2);
    expect(text(rows[0])).not.toContain('en revue');
    expect(text(rows[1])).toContain('en revue');
    expect(text(host)).toContain('La part nationale des stations en rupture dépasse 15 %.');
  });

  it('rule that emitted nothing shows n.d.', () => {
    const host = document.createElement('div');
    host.innerHTML = bilanHtml({ ...BILAN, byRule: [{ ...BILAN.byRule[0], emitted: 0, arrived: 0, useful: 0 }] });
    expect(text(host.querySelector('.anb-rules tbody tr') as Element)).toContain('n.d.');
  });

  it('department filter', async () => {
    fetchBilan.mockResolvedValue(BILAN);
    fetchNow.mockResolvedValue(FIXTURE);
    const host = document.createElement('div');
    renderAnticipationBilanPage(host);
    await flush();
    const select = host.querySelector<HTMLSelectElement>('.anb-dept select');
    expect(select).not.toBeNull();
    expect(host.querySelector('.anb-dept-result')?.textContent ?? '').toBe('');
    select!.value = '69';
    select!.dispatchEvent(new Event('change'));
    await flush();
    const result = host.querySelector('.anb-dept-result') as Element;
    expect(text(result)).toContain('Rhône');
    expect(text(result)).toContain('Foule bloquée ou débordements en fin de cortège');
    const link = result.querySelector('a[href]');
    expect(link?.getAttribute('href')).toBe(ATOM_FEED_URL);
    expect(window.location.search).toContain('dept=69');
  });

  it('department section: at most 3 scenarios, none: message', () => {
    const empty = deptSectionHtml('29', FIXTURE.scenarios.filter((s) => s.zone.dept.includes('69')).slice(0, 0));
    expect(empty).toContain('Aucun scénario ouvert');
    expect(empty).toContain(ATOM_FEED_URL);
    const lyon = FIXTURE.scenarios.find((s) => s.zone.dept.includes('69'));
    const many = Array.from({ length: 5 }, (_, i) => ({ ...(lyon as NonNullable<typeof lyon>), id: `x${i}` }));
    expect((deptSectionHtml('69', many).match(/class="anb-sc"/g) ?? []).length).toBe(3);
  });

  it('bilan failure: message', async () => {
    fetchBilan.mockRejectedValue(new Error('réseau'));
    const host = document.createElement('div');
    renderAnticipationBilanPage(host);
    await flush();
    expect(text(host)).toContain('Bilan indisponible');
  });
});
