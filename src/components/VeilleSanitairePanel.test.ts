// src/components/VeilleSanitairePanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { surveillanceFixture } from './layer-panel/health.fixture.ts';
import { VeilleSanitairePanel } from './VeilleSanitairePanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: VeilleSanitairePanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new VeilleSanitairePanel(c);
  p.mount();
  return { c, p };
}

describe('VeilleSanitairePanel', () => {
  it('panneau .lp de classe veille-panel-modal, caché puis ouvert, titre de la couche ; chargement puis données', () => {
    const { c, p } = mount();
    expect(p.isVisible()).toBe(false);
    p.show(null);
    expect(c.querySelector('.lp.veille-panel-modal .lp-title')?.textContent).toBe('Veille sanitaire');
    expect(c.textContent).toContain('Chargement des données…');
    p.update(surveillanceFixture());
    expect(c.textContent).toContain('Niveau national');
    expect(p.isVisible()).toBe(true);
  });
  it('onglet mémorisé : gardé au rafraîchissement et par une nouvelle instance', () => {
    const a = mount();
    a.p.show(surveillanceFixture());
    (a.c.querySelector('[data-tab="international"]') as HTMLButtonElement).click();
    expect(a.c.querySelector('[data-tab="international"]')?.getAttribute('aria-selected')).toBe('true');
    expect(a.c.textContent).toContain('Alertes OMS');
    a.p.update(surveillanceFixture());
    expect(a.c.querySelector('[data-tab="international"]')?.getAttribute('aria-selected')).toBe('true');
    const b = mount();
    b.p.show(surveillanceFixture());
    expect(b.c.querySelector('[data-tab="international"]')?.getAttribute('aria-selected')).toBe('true');
  });
  it('section ouverte par l’utilisateur : gardée au rafraîchissement', () => {
    const { c, p } = mount();
    p.show(surveillanceFixture());
    const details = c.querySelector('details[data-section="layer:health:alerts"]') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    p.update(surveillanceFixture());
    expect((c.querySelector('details[data-section="layer:health:alerts"]') as HTMLDetailsElement).open).toBe(true);
  });
  it('fermer une seule fois ; silencieux sans rappel ; update fermé ne rouvre pas ; update(null) garde les données ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(surveillanceFixture());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    p.update(surveillanceFixture());
    expect(p.isVisible()).toBe(false);
    p.show(null);
    expect(c.textContent).toContain('Niveau national');
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
