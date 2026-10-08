// src/components/HopitauxPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { offerFixture } from './layer-panel/health.fixture.ts';
import { HopitauxPanel } from './HopitauxPanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: HopitauxPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new HopitauxPanel(c);
  p.mount();
  return { c, p };
}

describe('HopitauxPanel', () => {
  it('panneau .lp de classe hopitaux-panel-modal, titre de la couche, 617 sites', () => {
    const { c, p } = mount();
    p.show(offerFixture());
    expect(c.querySelector('.lp.hopitaux-panel-modal .lp-title')?.textContent).toBe('Hôpitaux');
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('617');
  });
  it('clic (ou Entrée) sur un site fréquenté : le site est transmis à la carte', () => {
    const { c, p } = mount();
    const onSelect = vi.fn();
    p.setOnSelectSite(onSelect);
    p.show(offerFixture());
    (c.querySelector('[data-hosp-finess="750100125"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ finess: '750100125', name: 'Pitié-Salpêtrière' }));
    (c.querySelector('[data-hosp-finess="840000046"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ finess: '840000046' }));
  });
  it('sans recentrage possible (aucun gestionnaire de site, carte mobile) : lignes non cliquables', () => {
    const { c, p } = mount();
    p.show(offerFixture());
    expect(c.querySelector('.lp-row.is-link')).toBeNull();
    expect(c.querySelector('[data-hosp-finess]')).toBeNull();
  });
  it('fermer une seule fois ; update fermé ne rouvre pas ; rafraîchissement qui garde les sections ouvertes', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(offerFixture());
    const details = c.querySelector('details[data-section="layer:hospitals:departments"]') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    p.update(offerFixture());
    expect((c.querySelector('details[data-section="layer:hospitals:departments"]') as HTMLDetailsElement).open).toBe(true);
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    p.update(offerFixture());
    expect(p.isVisible()).toBe(false);
  });
});
