// @vitest-environment happy-dom
// Panneaux Environnement d'App.ts (spec 2026-10-04 environnement § 2.1) : bascule d'échéance de la vigilance quand la carte ne se
// repeint pas, légendes datées reconstruites une seule fois par appel.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegendCategory } from './components/MapLegend.ts';
import { ENV_FIXTURE_NOW, FLOODS_FIXTURE, VIGILANCE_FIXTURE } from './components/layer-panel/environment.fixture.ts';
import { App } from './App.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('App : bascule Aujourd’hui / Demain de la vigilance', () => {
  it('carte non repeinte (rejet) : échec tracé, aucun rejet non géré, panneau et échéance sur Demain', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ENV_FIXTURE_NOW);
    const app = Object.create(App.prototype) as App & Record<string, unknown>;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const updateVigilanceLayer = vi.fn(() => Promise.reject(new Error('style de carte absent')));
    const selectWeatherDepartment = vi.fn();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    Object.assign(app, {
      floatContainerEl: container, vigilancePanel: null, vigilancePanelPromise: null, vigilanceEcheance: 'J', selectedVigilanceDept: null,
      currentVigilance: { vigilance: { data: VIGILANCE_FIXTURE(), error: null, fetchedAt: ENV_FIXTURE_NOW } },
      activeLayers: { environmental: true }, mapContainer: { updateVigilanceLayer, selectWeatherDepartment }, mapLegend: null,
    });

    await (app as unknown as { ensureVigilancePanel: () => Promise<void> }).ensureVigilancePanel();
    (container.querySelector('[data-tab="J1"]') as HTMLElement).click();

    expect(updateVigilanceLayer).toHaveBeenCalledWith(expect.anything(), 'J1', ENV_FIXTURE_NOW);
    await vi.waitFor(() => expect(logged).toHaveBeenCalled());
    expect(selectWeatherDepartment).not.toHaveBeenCalled();
    expect((app as unknown as { vigilanceEcheance: string }).vigilanceEcheance).toBe('J1');
    expect(container.querySelector('.vigilance-panel-modal.is-open [data-tab="J1"]')?.getAttribute('aria-selected')).toBe('true');
  });
});

describe('App : légendes Environnement', () => {
  it('une seule reconstruction de la légende par appel ; chaque catégorie montrée selon sa couche et le maître', () => {
    const app = Object.create(App.prototype) as App & Record<string, unknown>;
    const setCategories = vi.fn();
    const addCategory = vi.fn();
    const setCategoryVisibility = vi.fn();
    Object.assign(app, {
      mapLegend: { setCategories, addCategory, setCategoryVisibility },
      currentVigilance: null, currentFloods: { floods: { data: FLOODS_FIXTURE(), error: null, fetchedAt: ENV_FIXTURE_NOW } },
      currentFires: null, radarManifest: null, radarError: null, vigilanceEcheance: 'J', echoTopsEnabled: false, forestDangerFill: false,
      activeLayers: { environmentGroup: true, environmental: false, floods: true, weatherRadar: false, fires: false },
    });

    (app as unknown as { refreshEnvironmentLegend: () => void }).refreshEnvironmentLegend();

    expect(setCategories).toHaveBeenCalledTimes(1);
    expect(addCategory).not.toHaveBeenCalled();
    expect(setCategoryVisibility).not.toHaveBeenCalled();
    const categories = setCategories.mock.calls[0]?.[0] as LegendCategory[];
    expect(categories.map((c) => [c.id, c.visible])).toEqual([
      ['environmental', false], ['floods', true], ['weatherRadar', false], ['fires', false],
    ]);
  });
});
