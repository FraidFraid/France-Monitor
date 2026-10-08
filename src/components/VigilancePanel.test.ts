// src/components/VigilancePanel.test.ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV_FIXTURE_NOW, VIGILANCE_FIXTURE } from './layer-panel/environment.fixture.ts';
import type { VigilanceState } from '../services/environment-vigilance.ts';
import { VigilancePanel } from './VigilancePanel.ts';

const state = (): { vigilance: VigilanceState } => ({ vigilance: { vigilance: { data: VIGILANCE_FIXTURE(), error: null, fetchedAt: ENV_FIXTURE_NOW } } });

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(ENV_FIXTURE_NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: VigilancePanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new VigilancePanel(c);
  p.mount();
  return { c, p };
}

describe('VigilancePanel', () => {
  it('panneau .lp de classe vigilance-panel-modal, titre, chargement puis carte du 04/10 ; aucun badge LIVE ni « temps réel »', () => {
    const { c, p } = mount();
    expect(p.isVisible()).toBe(false);
    p.show(null);
    expect(c.querySelector('.lp.vigilance-panel-modal .lp-title')?.textContent).toBe('Vigilance météo');
    expect(c.textContent).toContain('Chargement des données…');
    p.update(state());
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('2');
    expect(c.querySelector('.lp-figure b')?.classList.contains('lp-lvl--orange')).toBe(true);
    expect(c.textContent).not.toMatch(/\bLIVE\b|temps réel/i);
  });
  it('bascule Aujourd’hui / Demain : vue et rappel de la carte, jamais mémorisée', () => {
    const { c, p } = mount();
    const onEcheance = vi.fn();
    p.setOnEcheance(onEcheance);
    p.show(state());
    (c.querySelector('[data-tab="J1"]') as HTMLElement).click();
    expect(onEcheance).toHaveBeenCalledWith('J1');
    expect(p.getEcheance()).toBe('J1');
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('6');
    (c.querySelector('[data-tab="J1"]') as HTMLElement).click();
    expect(onEcheance).toHaveBeenCalledTimes(1);
    const again = mount();
    expect(again.p.getEcheance()).toBe('J');
  });
  it('département cliqué (ou Entrée) : choisi puis retiré ; sans gestionnaire, lignes non cliquables', () => {
    const { c, p } = mount();
    const onSelect = vi.fn();
    p.setOnSelectDepartment(onSelect);
    p.show(state());
    (c.querySelector('[data-dept="66"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenLastCalledWith('66');
    (c.querySelector('[data-dept="66"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    const other = mount();
    other.p.show(state());
    expect(other.c.querySelector('[data-dept]')).toBeNull();
  });
  it('fermer une seule fois ; silencieux sans rappel ; update fermé ne rouvre pas ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(state());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    p.update(state());
    expect(p.isVisible()).toBe(false);
    p.show(null);
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
