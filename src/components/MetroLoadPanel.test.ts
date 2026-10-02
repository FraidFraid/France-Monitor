// src/components/MetroLoadPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetroLoadPanel } from './MetroLoadPanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

const METROS = [{ code: 'gp', name: 'Grand Paris', lon: 2.35, lat: 48.85, consommation: 3100, date_heure: new Date().toISOString(), deltaVsJ1Pct: 4 }];

function mount(): { c: HTMLElement; p: MetroLoadPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new MetroLoadPanel(c);
  p.mount();
  return { c, p };
}

describe('MetroLoadPanel', () => {
  it('panneau .lp de classe metro-load-panel-modal, caché puis ouvert', () => {
    const { c, p } = mount();
    expect(p.isVisible()).toBe(false);
    p.show(METROS);
    expect(c.querySelector('.lp.metro-load-panel-modal .lp-title')?.textContent).toBe('Charge métropolitaine');
    expect(p.isVisible()).toBe(true);
  });
  it('fermer une seule fois ; silencieux sans rappel ; update fermé ne rouvre pas ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(METROS);
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    p.update(METROS);
    expect(p.isVisible()).toBe(false);
    p.show(null);
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
