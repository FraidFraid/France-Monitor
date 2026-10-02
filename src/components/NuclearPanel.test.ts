// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NuclearPanel } from './NuclearPanel.ts';
import { NUCLEAR_UNITS } from '../config/infrastructure.ts';
import type { NuclearState } from '../types/index.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function state(): NuclearState {
  const r = NUCLEAR_UNITS[0];
  const now = Date.now();
  return {
    unavailabilities: [{ id: 'a', plantName: r.plantName, unitName: r.unitName, nominalPowerMW: r.nominalPowerMW, availablePowerMW: 0,
      status: 'OUTAGE_UNPLANNED', startDate: new Date(now - 86_400_000), endDate: new Date(now + 86_400_000), type: 'UNPLANNED', updatedAt: new Date(now) }],
    remitSignals: [], unconfirmedSignals: [], stress: null, rteAvailable: true, remitAvailable: true, remitStatus: 'ok', fetchedAt: new Date(now),
  };
}
function mount(): { c: HTMLElement; p: NuclearPanel } {
  const c = document.createElement('div'); document.body.appendChild(c);
  const p = new NuclearPanel(c); p.mount();
  return { c, p };
}

describe('NuclearPanel', () => {
  it('cadre commun, onglets, onglet mémorisé', () => {
    const { c, p } = mount();
    p.show(state());
    expect(c.querySelector('.lp.nuclear-panel-modal .lp-title')?.textContent).toBe('Parc nucléaire');
    (c.querySelector('[data-tab="calendar"]') as HTMLButtonElement).click();
    expect(c.querySelector('[data-tab="calendar"]')?.getAttribute('aria-selected')).toBe('true');
    const again = mount();
    again.p.show(state());
    expect(again.c.querySelector('[data-tab="calendar"]')?.getAttribute('aria-selected')).toBe('true');
  });
  it('fermer : rappel une seule fois (corrige le double appel) et survol effacé', () => {
    const { c, p } = mount();
    const onClose = vi.fn(); const onHover = vi.fn();
    p.setOnClose(onClose); p.setOnPlantHover(onHover);
    p.show(state());
    const site = c.querySelector('[data-nuclear-plant]') as HTMLElement;
    site.dispatchEvent(new Event('mouseover', { bubbles: true }));
    expect(onHover).toHaveBeenLastCalledWith(site.dataset['nuclearPlant']);
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
  it('masquage silencieux : le rappel de fermeture n\'est pas appelé', () => {
    const { p } = mount();
    const onClose = vi.fn(); p.setOnClose(onClose);
    p.show(state());
    p.hide({ silent: true });
    expect(p.isVisible()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
  it("update sur panneau ouvert garde l'onglet ; update sur panneau fermé ne l'ouvre pas", () => {
    const { c, p } = mount();
    p.show(state());
    (c.querySelector('[data-tab="remit"]') as HTMLButtonElement).click();
    p.update(state());
    expect(c.querySelector('[data-tab="remit"]')?.getAttribute('aria-selected')).toBe('true');
    p.hide({ silent: true });
    p.update(state());
    expect(p.isVisible()).toBe(false);
  });
  it('destroy retire le panneau', () => {
    const { c, p } = mount();
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
