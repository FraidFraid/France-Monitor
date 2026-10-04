// src/components/FloodsPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV_FIXTURE_NOW, FLOODS_FIXTURE } from './layer-panel/environment.fixture.ts';
import type { FloodsState } from '../services/environment-floods.ts';
import { FloodsPanel } from './FloodsPanel.ts';

const state = (): FloodsState => ({ floods: { data: FLOODS_FIXTURE(), error: null, fetchedAt: ENV_FIXTURE_NOW } });

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(ENV_FIXTURE_NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: FloodsPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new FloodsPanel(c);
  p.mount();
  return { c, p };
}

describe('FloodsPanel', () => {
  it('panneau .lp de classe floods-panel-modal, titre « Crues », 4 tronçons jaunes du 04/10, aucun « tracé recalé »', () => {
    const { c, p } = mount();
    p.show(null);
    expect(c.querySelector('.lp.floods-panel-modal .lp-title')?.textContent).toBe('Crues');
    p.update(state());
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('4');
    expect(c.textContent).not.toMatch(/recalé|confiance 100/i);
  });
  it('tronçon et station cliqués : recentrage ; le titre d’une section repliable ne déclenche rien', () => {
    const { c, p } = mount();
    const onSection = vi.fn();
    const onStation = vi.fn();
    p.setOnFocusSection(onSection);
    p.setOnFocusStation(onStation);
    p.show(state());
    (c.querySelector('[data-section="MO12"]') as HTMLElement).click();
    expect(onSection).toHaveBeenCalledWith('MO12');
    (c.querySelector('[data-station="Y046401001"]') as HTMLElement).click();
    expect(onStation).toHaveBeenCalledWith('Y046401001');
    (c.querySelector('details[data-section="layer:floods:troncons"] summary') as HTMLElement).click();
    expect(onSection).toHaveBeenCalledTimes(1);
    const other = mount();
    other.p.show(state());
    expect(other.c.querySelector('.lp-row[data-section]')).toBeNull();
  });
  it('fermer une seule fois ; silencieux sans rappel ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(state());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
