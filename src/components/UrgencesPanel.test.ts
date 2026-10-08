// src/components/UrgencesPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { surveillanceFixture } from './layer-panel/health.fixture.ts';
import { UrgencesPanel } from './UrgencesPanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: UrgencesPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new UrgencesPanel(c);
  p.mount();
  return { c, p };
}

describe('UrgencesPanel', () => {
  it('panneau .lp de classe urgences-panel-modal, titre de la couche', () => {
    const { c, p } = mount();
    p.show(surveillanceFixture());
    expect(c.querySelector('.lp.urgences-panel-modal .lp-title')?.textContent).toBe('Urgences et SOS Médecins');
    expect(c.querySelector('.lp-figure')?.textContent).toContain('des passages aux urgences pour IRA');
  });
  it('sélecteur de syndrome : rappel vers la carte, bouton pressé, départements suivis, mémorisé', () => {
    const a = mount();
    const onSyndrome = vi.fn();
    a.p.setOnSyndrome(onSyndrome);
    a.p.show(surveillanceFixture());
    expect(a.p.getSyndrome()).toBe('ira');
    (a.c.querySelector('[data-urg-syndrome="gastro"]') as HTMLButtonElement).click();
    expect(onSyndrome).toHaveBeenCalledWith('gastro');
    expect(a.c.querySelector('[data-urg-syndrome="gastro"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(a.c.textContent).toContain('Gastro-entérite · Mayotte');
    (a.c.querySelector('[data-urg-syndrome="gastro"]') as HTMLButtonElement).click();
    expect(onSyndrome).toHaveBeenCalledTimes(1);
    a.p.update(surveillanceFixture());
    expect(a.c.querySelector('[data-urg-syndrome="gastro"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(mount().p.getSyndrome()).toBe('gastro');
  });
  it('fermer une seule fois ; silencieux sans rappel ; update fermé ne rouvre pas', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(surveillanceFixture());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    p.update(surveillanceFixture());
    expect(p.isVisible()).toBe(false);
    p.show(null);
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
