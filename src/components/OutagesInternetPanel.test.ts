// src/components/OutagesInternetPanel.test.ts
// @vitest-environment happy-dom
// Coquille du panneau Internet (spec 2026-10-08 panneaux pannes § 2.3, § 4) : cadre commun, clic sur un département, bouton du panneau
// Connectivité, croix et masquage silencieux, mise à jour d'un panneau fermé.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternetOutagesResponse } from '../types/index.ts';
import { INTERNET_FIXTURE_NOW, internetFixtureResponse } from './layer-panel/outages.fixture.ts';
import { OutagesInternetPanel } from './OutagesInternetPanel.ts';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(INTERNET_FIXTURE_NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

const state = (data: InternetOutagesResponse = internetFixtureResponse()) => ({ internet: { data, error: null, fetchedAt: INTERNET_FIXTURE_NOW } });
function mount(): { c: HTMLElement; p: OutagesInternetPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new OutagesInternetPanel(c);
  p.mount();
  return { c, p };
}

describe('OutagesInternetPanel', () => {
  it('panneau .lp de classe outages-internet-panel-modal, titre « Internet », fermé tant qu’on ne l’ouvre pas', () => {
    const { c, p } = mount();
    expect(p.isVisible()).toBe(false);
    p.show(state());
    expect(p.isVisible()).toBe(true);
    expect(c.querySelector('.lp.outages-internet-panel-modal .lp-title')?.textContent).toBe('Internet');
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('1');
    expect(c.textContent).not.toMatch(/temps réel|TEMPS RÉEL|LIVE/);
  });
  it('clic sur un département : rappel avec le code ; clic sur le bouton Connectivité : rappel une fois', () => {
    const { c, p } = mount();
    const dept = vi.fn();
    const connectivity = vi.fn();
    p.setOnFocusDept(dept);
    p.setOnOpenConnectivity(connectivity);
    p.show(state());
    (c.querySelector('[data-dept="23"]') as HTMLElement).click();
    expect(dept).toHaveBeenCalledTimes(1);
    expect(dept).toHaveBeenCalledWith('23');
    expect(connectivity).not.toHaveBeenCalled();
    (c.querySelector('[data-open-connectivity]') as HTMLElement).click();
    expect(connectivity).toHaveBeenCalledTimes(1);
    expect(dept).toHaveBeenCalledTimes(1);
  });
  it('sans gestionnaire (ou avec un seul), rien de cliquable', () => {
    const bare = mount();
    bare.p.show(state());
    expect(bare.c.querySelector('[data-dept], [data-open-connectivity]')).toBeNull();
    const half = mount();
    half.p.setOnFocusDept(() => {});
    half.p.show(state());
    expect(half.c.querySelector('[data-dept], [data-open-connectivity]')).toBeNull();
  });
  it('croix : onClose ; masquage silencieux : pas d’onClose', () => {
    const { c, p } = mount();
    const close = vi.fn();
    p.setOnClose(close);
    p.show(state());
    p.hide({ silent: true });
    expect(p.isVisible()).toBe(false);
    expect(close).not.toHaveBeenCalled();
    p.show(state());
    (c.querySelector('.lp-close') as HTMLElement).click();
    expect(close).toHaveBeenCalledTimes(1);
    expect(p.isVisible()).toBe(false);
  });
  it('mise à jour : un panneau ouvert se redessine, un panneau fermé ne se rouvre pas', () => {
    const { c, p } = mount();
    p.show(state());
    p.update({ internet: { data: null, error: 'IODA : HTTP 503', fetchedAt: null } });
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('n.d.');
    expect(c.textContent).toContain('IODA : HTTP 503');
    p.hide({ silent: true });
    p.update(state());
    expect(p.isVisible()).toBe(false);
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('n.d.');
  });
});
