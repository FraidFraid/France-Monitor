// src/components/OutagesTelecomPanel.test.ts
// @vitest-environment happy-dom
// Coquille du panneau Télécoms (spec 2026-10-08 panneaux pannes § 2.1, § 4) : cadre commun, clics vers la carte (site, département),
// « Afficher 20 de plus », option des maintenances, croix et masquage silencieux, mise à jour d'un panneau fermé.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelecomOutagesResponse } from '../types/index.ts';
import { OUTAGES_FIXTURE_NOW, telecomFixtureResponse } from './layer-panel/outages.fixture.ts';
import { OutagesTelecomPanel } from './OutagesTelecomPanel.ts';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(OUTAGES_FIXTURE_NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

const state = (data: TelecomOutagesResponse = telecomFixtureResponse()) => ({ telecom: { data, error: null, fetchedAt: OUTAGES_FIXTURE_NOW } });
/** 45 pannes récentes (les 18 du jeu d'essai, puis des copies à identifiants distincts). */
function many(): TelecomOutagesResponse {
  const t = telecomFixtureResponse();
  const recent = t.sites.filter((s) => s.cls === 'recente');
  const extra = Array.from({ length: 27 }, (_, i) => ({ ...recent[i % recent.length], id: `copie-${i}` }));
  return { ...t, sites: [...t.sites, ...extra] };
}
function mount(): { c: HTMLElement; p: OutagesTelecomPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new OutagesTelecomPanel(c);
  p.mount();
  return { c, p };
}
const recentRows = (c: HTMLElement): number => c.querySelectorAll('[data-section="layer:outagesTelecom:recentes"] [data-site]').length;

describe('OutagesTelecomPanel', () => {
  it('panneau .lp de classe outages-telecom-panel-modal, titre « Télécoms mobiles », fermé tant qu’on ne l’ouvre pas', () => {
    const { c, p } = mount();
    expect(p.isVisible()).toBe(false);
    p.show(state());
    expect(p.isVisible()).toBe(true);
    expect(c.querySelector('.lp.outages-telecom-panel-modal .lp-title')?.textContent).toBe('Télécoms mobiles');
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('18');
    expect(c.textContent).not.toMatch(/temps réel|TEMPS RÉEL|LIVE/);
  });
  it('clic sur un département et sur un site : rappels avec le code et la position ; sans gestionnaire, rien de cliquable', () => {
    const { c, p } = mount();
    const dept = vi.fn();
    const site = vi.fn();
    p.setOnFocusDept(dept);
    p.setOnFocusSite(site);
    p.show(state());
    (c.querySelector('[data-dept="02"]') as HTMLElement).click();
    expect(dept).toHaveBeenCalledWith('02');
    const row = c.querySelector('[data-site]') as HTMLElement;
    const expected = telecomFixtureResponse().sites.find((s) => s.id === row.dataset['site']);
    row.click();
    expect(site).toHaveBeenCalledTimes(1);
    expect(site).toHaveBeenCalledWith(expected?.lat, expected?.lon);
    const bare = mount();
    bare.p.show(state());
    expect(bare.c.querySelector('[data-dept], [data-site], [data-option]')).toBeNull();
  });
  it('« Afficher 20 de plus » : 20 lignes, puis 40, puis 45 sans bouton', () => {
    const { c, p } = mount();
    p.setOnFocusSite(() => {});
    p.show(state(many()));
    expect(recentRows(c)).toBe(20);
    expect(c.querySelector('[data-more="recentes"]')?.textContent).toContain('Afficher 20 de plus (25');
    (c.querySelector('[data-more="recentes"]') as HTMLElement).click();
    expect(recentRows(c)).toBe(40);
    expect(c.querySelector('[data-more="recentes"]')?.textContent).toContain('Afficher 5 de plus (5');
    (c.querySelector('[data-more="recentes"]') as HTMLElement).click();
    expect(recentRows(c)).toBe(45);
    expect(c.querySelector('[data-more="recentes"]')).toBeNull();
  });
  it('option des maintenances : bascule mémorisée par le panneau (vrai, puis faux)', () => {
    const { c, p } = mount();
    const toggle = vi.fn();
    p.setOnToggleMaintenance(toggle);
    p.setOnFocusSite(() => {});
    p.show(state());
    (c.querySelector('[data-option="maintenances"]') as HTMLElement).click();
    expect(toggle).toHaveBeenLastCalledWith(true);
    (c.querySelector('[data-option="maintenances"]') as HTMLElement).click();
    expect(toggle).toHaveBeenLastCalledWith(false);
    expect(toggle).toHaveBeenCalledTimes(2);
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
    p.update({ telecom: { data: null, error: 'ARCEP : HTTP 503', fetchedAt: null } });
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('n.d.');
    expect(c.textContent).toContain('ARCEP : HTTP 503');
    p.hide({ silent: true });
    p.update(state());
    expect(p.isVisible()).toBe(false);
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('n.d.');
  });
});
