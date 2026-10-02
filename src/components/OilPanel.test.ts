// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OilPanel } from './OilPanel.ts';
import { oilFixture, tensionFixture } from './layer-panel/oil.fixture.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function mount(opts: { isEnabled?: () => boolean } = {}): { c: HTMLElement; p: OilPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new OilPanel(c, opts);
  p.mount();
  return { c, p };
}

describe('OilPanel', () => {
  it('cadre commun, titre de la pastille, sans décor', () => {
    const { c, p } = mount();
    p.show(oilFixture(), tensionFixture());
    expect(c.querySelector('.lp.oil-panel-modal .lp-title')?.textContent).toBe('Pétrole');
    expect(c.innerHTML).not.toMatch(/linear-gradient|cursor: ?grab|lock-keyhole|VITE_ENABLE/);
  });
  it('onglet mémorisé d’un montage à l’autre', () => {
    const a = mount();
    a.p.show(oilFixture(), tensionFixture());
    (a.c.querySelector('[data-tab="supply"]') as HTMLButtonElement).click();
    expect(a.c.querySelector('[data-tab="supply"]')?.getAttribute('aria-selected')).toBe('true');
    const b = mount();
    b.p.show(oilFixture(), tensionFixture());
    expect(b.c.querySelector('[data-tab="supply"]')?.getAttribute('aria-selected')).toBe('true');
  });
  it('bascule 1 mois / 1 an', () => {
    const { c, p } = mount();
    p.show(oilFixture(), tensionFixture());
    (c.querySelector('[data-oil-range="1y"]') as HTMLButtonElement).click();
    expect(c.querySelector('[data-oil-range="1y"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(c.querySelector('[data-oil-range="1m"]')?.getAttribute('aria-pressed')).toBe('false');
  });
  it('« Afficher sur la carte » : rappel et état exposé', () => {
    const { c, p } = mount();
    const onMap = vi.fn();
    p.setOnFuelTensionMapVisibilityChange(onMap);
    p.show(oilFixture(), tensionFixture());
    (c.querySelector('[data-tab="departments"]') as HTMLButtonElement).click();
    (c.querySelector('[data-oil-map]') as HTMLButtonElement).click();
    expect(onMap).toHaveBeenLastCalledWith(true);
    expect(p.isFuelTensionMapVisible()).toBe(true);
    expect(c.querySelector('[data-oil-map]')?.textContent).toBe('Masquer de la carte');
    (c.querySelector('[data-oil-map]') as HTMLButtonElement).click();
    expect(onMap).toHaveBeenLastCalledWith(false);
  });
  it('recherche : filtre la liste et garde le focus dans le champ', () => {
    const { c, p } = mount();
    p.show(oilFixture(), tensionFixture());
    (c.querySelector('[data-tab="departments"]') as HTMLButtonElement).click();
    const input = c.querySelector('[data-oil-search]') as HTMLInputElement;
    input.focus();
    input.value = 'nord';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const again = c.querySelector('[data-oil-search]') as HTMLInputElement;
    expect(document.activeElement).toBe(again);
    expect(again.value).toBe('nord');
    expect(c.textContent).toContain('Nord (59)');
    expect(c.textContent).not.toContain('Bouches-du-Rhône (13)');
  });
  it('info-bulle au survol du graphe, masquée en sortie', () => {
    const { c, p } = mount();
    p.show(oilFixture(), tensionFixture());
    const svg = c.querySelector('.lp-fuel-chart svg') as SVGElement;
    svg.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 0 }));
    const tip = c.querySelector('.lp-tip') as HTMLElement;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('Gazole (B7)');
    c.querySelector('.lp')?.dispatchEvent(new MouseEvent('mouseleave'));
    expect((c.querySelector('.lp-tip') as HTMLElement).hidden).toBe(true);
  });
  it('module désactivé : phrase, sans onglets ni chiffre, même sans données', () => {
    const { c, p } = mount({ isEnabled: () => false });
    p.show(null, null);
    expect(c.textContent).toContain('Couche désactivée sur cette instance.');
    expect(c.querySelector('[data-tab]')).toBeNull();
    expect(c.querySelector('.lp-figure')).toBeNull();
  });
  it('fermer une seule fois ; silencieux sans rappel ; update sur panneau fermé ne l’ouvre pas', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(oilFixture(), tensionFixture());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    p.update(oilFixture(), tensionFixture());
    expect(p.isVisible()).toBe(false);
    p.show(oilFixture());
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('la carte départementale reste choisie après un rafraîchissement ; l’onglet et la période aussi', () => {
    const { c, p } = mount();
    p.show(oilFixture(), tensionFixture());
    (c.querySelector('[data-tab="departments"]') as HTMLButtonElement).click();
    (c.querySelector('[data-oil-map]') as HTMLButtonElement).click();
    p.update(oilFixture(), tensionFixture());
    expect(c.querySelector('[data-oil-map]')?.getAttribute('aria-pressed')).toBe('true');
    expect(c.querySelector('[data-tab="departments"]')?.getAttribute('aria-selected')).toBe('true');
  });
});
