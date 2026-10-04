// src/components/DroughtPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { droughtStateFixture } from './layer-panel/environment.fixture.ts';
import { DroughtPanel } from './DroughtPanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function mount(onFocus?: (code: string) => void): { c: HTMLElement; p: DroughtPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new DroughtPanel(c);
  if (onFocus) p.setOnFocusDepartment(onFocus);
  p.mount();
  return { c, p };
}

describe('DroughtPanel', () => {
  it('panneau .lp de classe drought-panel-modal, chargement puis données, gros chiffre 79 ; aucun badge « temps réel »', () => {
    const { c, p } = mount();
    expect(p.isVisible()).toBe(false);
    p.show(null);
    expect(c.querySelector('.lp.drought-panel-modal .lp-title')?.textContent).toBe('Sécheresse');
    expect(c.textContent).toContain('Chargement des données…');
    p.update(droughtStateFixture());
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('79');
    expect(c.textContent?.toLowerCase()).not.toContain('temps réel');
  });
  it('clic ou Entrée sur un département : recentrage ; sans gestionnaire, lignes non cliquables', () => {
    const onFocus = vi.fn();
    const { c, p } = mount(onFocus);
    p.show(droughtStateFixture());
    (c.querySelector('[data-dept="01"]') as HTMLElement).click();
    expect(onFocus).toHaveBeenCalledWith('01');
    (c.querySelector('[data-dept="13"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onFocus).toHaveBeenLastCalledWith('13');
    const other = mount();
    other.p.show(droughtStateFixture());
    expect(other.c.querySelector('[data-dept]')).toBeNull();
  });
  it('fermer une seule fois ; silencieux sans rappel ; update fermé ne rouvre pas ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(droughtStateFixture());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    p.update(droughtStateFixture());
    expect(p.isVisible()).toBe(false);
    p.show(null);
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('79');
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
