// src/components/OutagesPowerPanel.test.ts
// @vitest-environment happy-dom
// Coquille du panneau Électricité (spec 2026-10-08 panneaux pannes § 2.2, § 4) : cadre commun, clic sur une tranche nucléaire, clic sur une
// unité, croix et masquage silencieux, Écowatt gardé d'une mise à jour à l'autre, mise à jour d'un panneau fermé.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EcowattOfficial, EcowattSignal, PowerOutagesResponse } from '../types/index.ts';
import { OUTAGES_FIXTURE_NOW, powerFixtureResponse } from './layer-panel/outages.fixture.ts';
import { OutagesPowerPanel } from './OutagesPowerPanel.ts';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(OUTAGES_FIXTURE_NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

const state = (data: PowerOutagesResponse | null = powerFixtureResponse(), error: string | null = null) => ({ power: { data, error, fetchedAt: data ? OUTAGES_FIXTURE_NOW : null } });
const official = (today: EcowattSignal): EcowattOfficial => ({
  source: 'rte', generatedAt: '2026-10-08T15:00:00Z',
  days: [['2026-10-08', today], ['2026-10-09', 'green']].map(([date, level]) => ({ date, level: level as EcowattSignal, message: '', hours: [] })),
});
function mount(): { c: HTMLElement; p: OutagesPowerPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new OutagesPowerPanel(c);
  p.mount();
  return { c, p };
}

describe('OutagesPowerPanel', () => {
  it('panneau .lp de classe outages-power-panel-modal, titre « Électricité : production et transport », fermé tant qu’on ne l’ouvre pas', () => {
    const { c, p } = mount();
    expect(p.isVisible()).toBe(false);
    p.show(state(), official('green'));
    expect(p.isVisible()).toBe(true);
    expect(c.querySelector('.lp.outages-power-panel-modal .lp-title')?.textContent).toBe('Électricité : production et transport');
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('2,8\u00A0GW');
    expect(c.textContent).not.toMatch(/temps réel|TEMPS RÉEL|LIVE/);
  });
  it('clic sur une tranche nucléaire ou sur le bouton : onOpenNuclear ; sans recentrage de carte', () => {
    const { c, p } = mount();
    const nuclear = vi.fn();
    const focus = vi.fn();
    p.setOnOpenNuclear(nuclear);
    p.setOnFocusUnit(focus);
    p.show(state(), official('green'));
    (c.querySelector('[data-open-nuclear="panneau"]') as HTMLElement).click();
    expect(nuclear).toHaveBeenCalledTimes(1);
    (c.querySelector('[data-open-nuclear="PALUEL 1"]') as HTMLElement).click();
    expect(nuclear).toHaveBeenCalledTimes(2);
    expect(focus).not.toHaveBeenCalled();
  });
  it('clic sur une unité non nucléaire : onFocusUnit avec son nom ; sans gestionnaire, rien de cliquable', () => {
    const { c, p } = mount();
    const focus = vi.fn();
    p.setOnFocusUnit(focus);
    p.show(state(), null);
    (c.querySelector('[data-unit="BLENOD 5"]') as HTMLElement).click();
    expect(focus).toHaveBeenCalledWith('BLENOD 5');
    const bare = mount();
    bare.p.show(state(), null);
    expect(bare.c.querySelector('[data-unit]')).toBeNull();
  });
  it('croix : onClose ; masquage silencieux : pas d’onClose', () => {
    const { c, p } = mount();
    const close = vi.fn();
    p.setOnClose(close);
    p.show(state(), null);
    p.hide({ silent: true });
    expect(p.isVisible()).toBe(false);
    expect(close).not.toHaveBeenCalled();
    p.show(state(), null);
    (c.querySelector('.lp-close') as HTMLElement).click();
    expect(close).toHaveBeenCalledTimes(1);
    expect(p.isVisible()).toBe(false);
  });
  it('update(state) sans Écowatt garde le dernier reçu : avec un signal du jour rouge passé à show, la pastille reste rouge', () => {
    const { c, p } = mount();
    p.show(state(), official('red'));
    expect(c.querySelector('.fmk-level .fm-vig')?.className).toContain('rouge');
    p.update(state());
    expect(c.querySelector('.fmk-level .fm-vig')?.className).toContain('rouge');
    p.update(state(), official('green'));
    expect(c.querySelector('.fmk-level .fm-vig')?.className).not.toContain('rouge');
  });
  it('mise à jour : un panneau ouvert se redessine (source muette : n.d.), un panneau fermé ne se rouvre pas', () => {
    const { c, p } = mount();
    p.show(state(), null);
    p.update(state(null, 'Électricité : HTTP 502'));
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('n.d.');
    expect(c.textContent).toContain('Électricité : HTTP 502');
    p.hide({ silent: true });
    p.update(state());
    expect(p.isVisible()).toBe(false);
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('n.d.');
  });
});
