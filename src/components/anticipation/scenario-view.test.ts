// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ALL_WORDS, WORD_LABEL } from '../../services/anticipation-words.ts';
import { scenarioHtml, stepSource } from './scenario-view.ts';
import { wordChip } from './agenda-view.ts';
import type { AnticipationScenario } from '../../types/index.ts';
import type { FeedbackState } from './scenario-view.ts';
import { FIXTURE, LYON } from './fixture.test-data.ts';

const render = (feedback: FeedbackState = 'idle', s = LYON): HTMLElement => {
  const el = document.createElement('div');
  el.innerHTML = scenarioHtml(s, FIXTURE.signals, { today: '2026-11-04', feedback });
  return el;
};
const sectionTitles = (el: HTMLElement): string[] => [...el.querySelectorAll('h4')].map((h) => h.textContent ?? '');
const section = (el: HTMLElement, title: string): Element | undefined =>
  [...el.querySelectorAll('.anr-sec')].find((s) => s.querySelector('h4')?.textContent === title);

describe('fiche d\u2019un scénario', () => {
  it('scenario card shows 7-word scale with active word and why', () => {
    const el = render();
    const cells = [...el.querySelectorAll('.anr-scale > span')];
    expect(cells.map((c) => c.textContent)).toEqual(ALL_WORDS.map((w) => WORD_LABEL[w]));
    const on = el.querySelectorAll('.anr-scale > span.is-on');
    expect(on).toHaveLength(1);
    expect(on[0].textContent).toBe('probable');
    expect(on[0].getAttribute('style')).toContain('--sev-orange');
    const note = el.querySelector('.anr-scalenote')?.textContent ?? '';
    expect(note).toContain('Probable');
    expect(note).toContain('55\u00a0à\u00a075\u00a0%');
    expect(note).toContain('3 sources indépendantes, précédent du 12/10');
    expect(note).toContain('d\'après la règle \u00ab\u00a0mobilisation × transports\u00a0\u00bb');
    expect(el.querySelector('h3')?.textContent).toBe(LYON.title);
    // Lieu, fenêtre et heures à Paris (UTC+1 en novembre).
    expect(el.querySelector('.anr-meta')?.textContent).toContain('Rhône');
    expect(el.querySelector('.anr-meta')?.textContent).toContain('ouvert à 09:40, revu à 13:10');
  });

  it('sections et intitulés de la maquette, dans l\u2019ordre', () => {
    expect(sectionTitles(render())).toEqual([
      'Pourquoi : le croisement',
      'Inconnu',
      'Indicateurs de bascule',
      'Ce qui l\'infirmerait',
      'À vérifier avant d\'agir',
      'Ce scénario vous a-t-il servi ?',
    ]);
    expect(render().querySelector('.anr-warn')?.textContent).toContain('Hypothèse à vérifier');
  });

  it('chaque étape cite source et heure de Paris', () => {
    const el = render();
    const steps = [...el.querySelectorAll('.anr-step')];
    expect(steps[0].querySelector('.anr-src')?.textContent).toBe('CGT, Démosphère · 08:55');
    expect(steps[1].querySelector('.anr-src')?.textContent).toBe('SNCF · 07:30');
    expect(steps[2].querySelector('.anr-src')).toBeNull();
    expect(stepSource({ text: 'x', signalIds: ['inconnu'] }, FIXTURE.signals)).toBe('');
  });

  it('bascule atteint shows time', () => {
    const el = render();
    const trig = [...el.querySelectorAll('.anr-trig')];
    expect(trig[0].classList.contains('is-hit')).toBe(true);
    expect(trig[0].textContent).toContain('Atteint 13:10');
    expect(trig[1].classList.contains('is-hit')).toBe(false);
    expect(trig[1].textContent).toContain('surveillé');
  });

  it('unknowns rendered in their section', () => {
    const items = [...(section(render(), 'Inconnu')?.querySelectorAll('li') ?? [])].map((li) => li.textContent);
    expect(items).toEqual(LYON.unknowns);
  });

  it('boutons de retour : actifs, puis Merci ou Déjà noté et désactivés', () => {
    const idle = render('idle');
    expect([...idle.querySelectorAll('button[data-vote]')].map((b) => b.textContent)).toEqual(['Utile', 'Déjà su', 'Faux']);
    expect([...idle.querySelectorAll<HTMLButtonElement>('button[data-vote]')].every((b) => !b.disabled)).toBe(true);
    // Seule zone annoncée : le message des retours, présent (vide) avant le vote.
    expect(idle.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(idle.querySelector('.anr-fb-state')?.getAttribute('aria-live')).toBe('polite');
    expect(idle.querySelector('.anr-fb-state')?.textContent).toBe('');
    const ok = render('ok');
    expect(ok.querySelector('.anr-fb-state')?.textContent).toBe('Merci');
    expect([...ok.querySelectorAll<HTMLButtonElement>('button[data-vote]')].every((b) => b.disabled)).toBe(true);
    expect(render('deja').querySelector('.anr-fb-state')?.textContent).toBe('Déjà noté');
    expect([...render('erreur').querySelectorAll<HTMLButtonElement>('button[data-vote]')].every((b) => !b.disabled)).toBe(true);
  });

  it('crise manquée : fiche sans mot actif', () => {
    const el = render('idle', { ...LYON, word: '', status: 'manque' });
    expect(el.querySelectorAll('.anr-scale > span.is-on')).toHaveLength(0);
  });

  it('aucun scénario : message, mention BÊTA', () => {
    const el = document.createElement('div');
    el.innerHTML = scenarioHtml(null, {}, { today: '2026-11-04', feedback: 'idle' });
    expect(el.textContent).toContain('Aucun scénario');
    expect(el.querySelector('.anr-warn')).not.toBeNull();
  });

  it('no em dash in rendered HTML', () => {
    for (const fb of ['idle', 'ok', 'deja', 'erreur'] as const) {
      const html = scenarioHtml(LYON, FIXTURE.signals, { today: '2026-11-04', feedback: fb });
      expect(html).not.toContain('\u2014');
      expect(html).not.toMatch(/&mdash;/);
    }
  });
  it('unknown word from a newer server: raw word escaped, neutral colour, no throw', () => {
    const odd = { ...LYON, word: 'quasi_<b>nouveau</b>' } as unknown as AnticipationScenario;
    let el: HTMLElement | null = null;
    expect(() => { el = render('idle', odd); }).not.toThrow();
    const note = (el as HTMLElement | null)?.querySelector('.anr-scalenote');
    expect(note?.textContent).toContain('Quasi_<b>nouveau</b>');
    expect(note?.querySelector('b b')).toBeNull();
    expect(note?.querySelector('b')?.getAttribute('style')).toContain('--text-muted');
    expect((el as HTMLElement | null)?.querySelectorAll('.anr-scale > span.is-on')).toHaveLength(0);
    const chip = document.createElement('div');
    chip.innerHTML = wordChip('autre_mot' as unknown as AnticipationScenario['word']);
    expect(chip.textContent).toBe('autre_mot');
    expect(chip.querySelector('.anr-lvl')?.getAttribute('style')).toContain('--text-muted');
  });
});
