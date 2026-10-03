// src/components/AccesSoinsPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { offerFixture } from './layer-panel/health.fixture.ts';
import { AccesSoinsPanel } from './AccesSoinsPanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: AccesSoinsPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new AccesSoinsPanel(c);
  p.mount();
  return { c, p };
}

describe('AccesSoinsPanel', () => {
  it('panneau .lp de classe acces-soins-panel-modal, titre de la couche, gros chiffre', () => {
    const { c, p } = mount();
    p.show(offerFixture());
    expect(c.querySelector('.lp.acces-soins-panel-modal .lp-title')?.textContent).toBe('Accès aux soins');
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('18,2 %');
  });
  it('sélecteur de profession : rappel vers la carte, bouton pressé, mémorisé, gardé au rafraîchissement', () => {
    const a = mount();
    const onProfession = vi.fn();
    a.p.setOnProfession(onProfession);
    a.p.show(offerFixture());
    expect(a.p.getProfession()).toBe('mg');
    (a.c.querySelector('[data-apl-profession="kine"]') as HTMLButtonElement).click();
    expect(onProfession).toHaveBeenCalledWith('kine');
    a.p.update(offerFixture());
    expect(a.c.querySelector('[data-apl-profession="kine"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(mount().p.getProfession()).toBe('kine');
  });
  it('fermer une seule fois ; silencieux sans rappel ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(offerFixture());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
