// src/components/WeatherRadarPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV_FIXTURE_NOW, RADAR_COLUMN_FIXTURE, RADAR_MANIFEST_FIXTURE } from './layer-panel/environment.fixture.ts';
import { WeatherRadarPanel, type RadarPanelState } from './WeatherRadarPanel.ts';

const state = (over: Partial<RadarPanelState> = {}): RadarPanelState => ({
  manifest: RADAR_MANIFEST_FIXTURE(), configured: true, error: null, echoTops: false, echoTopsAvailable: true, profile: null, ...over,
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(ENV_FIXTURE_NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: WeatherRadarPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new WeatherRadarPanel(c);
  p.mount();
  return { c, p };
}

describe('WeatherRadarPanel', () => {
  it('panneau .lp de classe radar-panel-modal : heure de la dernière image Météo-France, aucune trace de RainViewer', () => {
    const { c, p } = mount();
    p.show(null);
    expect(c.querySelector('.lp.radar-panel-modal .lp-title')?.textContent).toBe('Radar météo');
    p.update(state());
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('10:05');
    expect(c.textContent).not.toMatch(/RainViewer/i);
  });
  it('bouton « Sommets d’écho » : bascule de l’option partagée (état d’App.ts)', () => {
    const { c, p } = mount();
    const onEcho = vi.fn();
    p.setOnEchoTops(onEcho);
    p.show(state());
    (c.querySelector('[data-echo-tops]') as HTMLElement).click();
    expect(onEcho).toHaveBeenLastCalledWith(true);
    p.update(state({ echoTops: true }));
    (c.querySelector('[data-echo-tops]') as HTMLElement).click();
    expect(onEcho).toHaveBeenLastCalledWith(false);
  });
  it('profil vertical du point cliqué (démonstration, daté) ; la croix éteint la couche une seule fois', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(state({ profile: { lat: 43.6, lon: 3.9, result: RADAR_COLUMN_FIXTURE() } }));
    expect(c.textContent).toContain('DÉMONSTRATION');
    expect(c.textContent).toContain('NIMES');
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
