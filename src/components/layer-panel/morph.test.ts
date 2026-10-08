// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { morphInto } from './morph.ts';

afterEach(() => { document.body.innerHTML = ''; });

const toolbar = '<div class="lp-toolbar"><input type="search" data-mar-search value=""><select data-mar-territory>'
  + '<option value="all" selected>Tous</option><option value="GP">Guadeloupe</option></select></div>';

function host(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe('morphInto : nœuds inchangés gardés (focus, menu déroulant, saisie)', () => {
  it('barre d’outils identique gardée, liste mise à jour, focus de la recherche et choix du territoire préservés', () => {
    const el = host(`<details data-section="a" open><summary>2 navires</summary>${toolbar}<div class="lp-row" data-mar-ship="1">A</div><div class="lp-row" data-mar-ship="2">B</div></details>`);
    const input = el.querySelector('input') as HTMLInputElement;
    const select = el.querySelector('select') as HTMLSelectElement;
    input.focus();
    select.value = 'GP';
    morphInto(el, `<details data-section="a" open><summary>3 navires</summary>${toolbar}<div class="lp-row" data-mar-ship="1">A</div><div class="lp-row" data-mar-ship="3">C</div><div class="lp-row" data-mar-ship="4">D</div></details>`);
    expect(el.querySelector('input')).toBe(input);
    expect(el.querySelector('select')).toBe(select);
    expect(document.activeElement).toBe(input);
    expect(select.value).toBe('GP');
    expect(el.querySelector('summary')?.textContent).toBe('3 navires');
    expect([...el.querySelectorAll('[data-mar-ship]')].map((r) => r.textContent)).toEqual(['A', 'C', 'D']);
  });
  it('ligne d’une autre identité remplacée, ligne de même identité gardée ; attributs mis à jour ; surplus retiré', () => {
    const el = host('<div class="lp-row" data-mar-ship="1" aria-pressed="false">A</div><div class="lp-row" data-mar-ship="2">B</div><p>fin</p>');
    const first = el.firstElementChild;
    const second = el.children[1];
    morphInto(el, '<div class="lp-row" data-mar-ship="1" aria-pressed="true">A</div><div class="lp-row" data-mar-ship="9">Z</div>');
    expect(el.firstElementChild).toBe(first);
    expect(first?.getAttribute('aria-pressed')).toBe('true');
    expect(el.children[1]).not.toBe(second);
    expect(el.children[1]?.textContent).toBe('Z');
    expect(el.children).toHaveLength(2);
  });
  it('sections d’une autre identité remplacées (changement d’onglet)', () => {
    const el = host('<details data-section="navy"><summary>Marine</summary></details>');
    const before = el.firstElementChild;
    morphInto(el, '<details data-section="alerts"><summary>Alertes</summary></details>');
    expect(el.firstElementChild).not.toBe(before);
    expect(el.textContent).toBe('Alertes');
  });
});
