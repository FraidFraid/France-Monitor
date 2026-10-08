// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GasPanel } from './GasPanel.ts';
import { biogasFixture, gasFixture } from './layer-panel/gas.fixture.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function mount(opts: { isEnabled?: () => boolean } = {}): { c: HTMLElement; p: GasPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new GasPanel(c, opts);
  p.mount();
  return { c, p };
}

describe('GasPanel', () => {
  it('monte un panneau .lp caché, l’ouvre dans le cadre commun, sans interrupteur pipeline ni décor', () => {
    const { c, p } = mount();
    expect(p.isVisible()).toBe(false);
    p.show(gasFixture(), biogasFixture());
    const root = c.querySelector('.lp.gas-panel-modal') as HTMLElement;
    expect(p.isVisible()).toBe(true);
    expect(root.querySelector('.lp-title')?.textContent).toBe('Réseau gaz');
    expect(root.textContent).toContain('Énergie · Couche');
    expect(root.innerHTML).not.toMatch(/pipeline|monospace|cursor: ?grab|linear-gradient/);
    expect(root.querySelector('[data-tab]')).toBeNull();
  });
  it('fermer : rappel une seule fois ; masquage silencieux sans rappel', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(gasFixture());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(p.isVisible()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    p.show(gasFixture());
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('update : rafraîchit un panneau ouvert en gardant les sections choisies, n’ouvre pas un panneau fermé', () => {
    const { c, p } = mount();
    p.show(gasFixture(), biogasFixture());
    const d = c.querySelector('details[data-section="layer:gasNetwork:storage"]') as HTMLDetailsElement;
    d.open = false;
    d.dispatchEvent(new Event('toggle'));
    p.update(gasFixture());
    expect((c.querySelector('details[data-section="layer:gasNetwork:storage"]') as HTMLDetailsElement).open).toBe(false);
    expect(c.textContent).toContain('Biométhane');
    p.hide({ silent: true });
    p.update(gasFixture());
    expect(p.isVisible()).toBe(false);
  });
  it('biométhane gardé si update ne le fournit pas', () => {
    const { c, p } = mount();
    p.show(gasFixture(), biogasFixture());
    p.update(gasFixture());
    expect(c.querySelector('details[data-section="layer:gasNetwork:biomethane"]')?.textContent).toContain('Normal');
  });
  it('module désactivé et chargement', () => {
    const off = mount({ isEnabled: () => false });
    off.p.show(gasFixture());
    expect(off.c.textContent).toContain('Couche désactivée sur cette instance.');
    const { c, p } = mount();
    p.show(null);
    expect(c.textContent).toContain('Chargement des données…');
  });
});
