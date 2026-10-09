// src/components/OutagesCloudPanel.test.ts
// @vitest-environment happy-dom
// Coquille du panneau Cloud (spec 2026-10-08 panneaux pannes § 2.4, § 4) : cadre commun, clic sur une zone, croix et masquage silencieux,
// mise à jour d'un panneau fermé.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudOutagesResponse } from '../types/index.ts';
import { CLOUD_FIXTURE_NOW, cloudFixtureResponse } from './layer-panel/outages.fixture.ts';
import { OutagesCloudPanel } from './OutagesCloudPanel.ts';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(CLOUD_FIXTURE_NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

const state = (data: CloudOutagesResponse = cloudFixtureResponse()) => ({ cloud: { data, error: null, fetchedAt: CLOUD_FIXTURE_NOW } });
function mount(): { c: HTMLElement; p: OutagesCloudPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new OutagesCloudPanel(c);
  p.mount();
  return { c, p };
}

describe('OutagesCloudPanel', () => {
  it('panneau .lp de classe outages-cloud-panel-modal, titre « Cloud et hébergement », fermé tant qu’on ne l’ouvre pas', () => {
    const { c, p } = mount();
    expect(p.isVisible()).toBe(false);
    p.show(state());
    expect(p.isVisible()).toBe(true);
    expect(c.querySelector('.lp.outages-cloud-panel-modal .lp-title')?.textContent).toBe('Cloud et hébergement');
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('2');
    expect(c.textContent).not.toMatch(/temps réel|TEMPS RÉEL|LIVE/);
  });
  it('clic sur une zone (Paris, CDG) : rappel avec ses coordonnées', () => {
    const { c, p } = mount();
    const focus = vi.fn();
    p.setOnFocusZone(focus);
    p.show(state());
    (c.querySelector('[data-zone="48.86,2.35"]') as HTMLElement).click();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith(48.86, 2.35);
  });
  it('data-zone illisible : aucun appel', () => {
    const { c, p } = mount();
    const focus = vi.fn();
    p.setOnFocusZone(focus);
    p.show(state());
    const row = c.querySelector('[data-zone]') as HTMLElement;
    for (const bad of ['', 'abc', '48.86', '48.86,x', 'NaN,2', '1,2,3']) {
      row.setAttribute('data-zone', bad);
      row.click();
    }
    expect(focus).not.toHaveBeenCalled();
  });
  it('sans gestionnaire : rien de cliquable', () => {
    const { c, p } = mount();
    p.show(state());
    expect(c.querySelector('[data-zone]')).toBeNull();
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
    p.update({ cloud: { data: null, error: 'Scaleway : HTTP 503', fetchedAt: null } });
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('n.d.');
    expect(c.textContent).toContain('Scaleway : HTTP 503');
    p.hide({ silent: true });
    p.update(state());
    expect(p.isVisible()).toBe(false);
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('n.d.');
  });
  it('destroy retire le panneau du DOM', () => {
    const { c, p } = mount();
    p.show(state());
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
