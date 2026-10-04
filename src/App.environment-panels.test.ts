// @vitest-environment happy-dom
// Panneaux Environnement d'App.ts (spec 2026-10-04 environnement § 2.1) : bascule d'échéance de la vigilance quand la carte ne se
// repeint pas, légendes datées reconstruites une seule fois par appel.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegendCategory } from './components/MapLegend.ts';
import { ENV_FIXTURE_NOW, FLOODS_FIXTURE, VIGILANCE_FIXTURE, seaLevelsStateFixture } from './components/layer-panel/environment.fixture.ts';
import type { MapLayers } from './types/index.ts';
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
      activeLayers: { environmental: true }, mapContainer: { updateVigilanceLayer, selectWeatherDepartment, canFocusMap: () => false }, mapLegend: null,
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
      currentDrought: null, currentAirQuality: null, currentEarthquakes: null, currentSeaLevels: null, fillOrder: [],
      activeLayers: {
        environmentGroup: true, environmental: false, floods: true, weatherRadar: false, fires: false, drought: false, airQuality: false, earthquakes: false,
      },
    });

    (app as unknown as { refreshEnvironmentLegend: () => void }).refreshEnvironmentLegend();

    expect(setCategories).toHaveBeenCalledTimes(1);
    expect(addCategory).not.toHaveBeenCalled();
    expect(setCategoryVisibility).not.toHaveBeenCalled();
    const categories = setCategories.mock.calls[0]?.[0] as LegendCategory[];
    expect(categories.map((c) => [c.id, c.visible])).toEqual([
      ['environmental', false], ['floods', true], ['weatherRadar', false], ['fires', false], ['drought', false], ['airQuality', false], ['earthquakes', false],
    ]);
  });
});

describe('App : marégraphes lus avec la couche Vigilance météo (phase B, contrats § 0.7)', () => {
  type SeaLevelsApp = { loadVigilanceAndSeaLevels: () => Promise<void> };
  function appWith(environmental: boolean, panelOpen: boolean | null, seaLevels: () => Promise<void> = () => Promise.resolve()) {
    const app = Object.create(App.prototype) as App & Record<string, unknown>;
    const loadVigilance = vi.fn(() => Promise.resolve());
    const loadSeaLevels = vi.fn(seaLevels);
    Object.assign(app, {
      activeLayers: { environmental }, vigilancePanel: panelOpen === null ? null : { isVisible: () => panelOpen }, loadVigilance, loadSeaLevels,
    });
    return { read: (): Promise<void> => (app as unknown as SeaLevelsApp).loadVigilanceAndSeaLevels(), loadVigilance, loadSeaLevels };
  }

  it('jamais lus seuls : couche éteinte et panneau fermé, seule la vigilance est lue', async () => {
    for (const app of [appWith(false, null), appWith(false, false)]) {
      await app.read();
      expect(app.loadVigilance).toHaveBeenCalledTimes(1);
      expect(app.loadSeaLevels).not.toHaveBeenCalled();
    }
  });

  it('couche active ou panneau ouvert : lus avec la vigilance ; leur échec ne fait pas échouer la lecture de la vigilance', async () => {
    for (const app of [appWith(true, null), appWith(false, true)]) {
      await app.read();
      expect(app.loadVigilance).toHaveBeenCalledTimes(1);
      expect(app.loadSeaLevels).toHaveBeenCalledTimes(1);
    }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing = appWith(true, null, () => Promise.reject(new Error('SHOM : réponse HTTP 503')));
    await expect(failing.read()).resolves.toBeUndefined();
    expect(failing.loadVigilance).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalled();
  });

  it('panneau créé après une lecture des marégraphes : la section Submersion marine les montre aussitôt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ENV_FIXTURE_NOW);
    const app = Object.create(App.prototype) as App & Record<string, unknown>;
    const container = document.createElement('div');
    document.body.appendChild(container);
    Object.assign(app, {
      floatContainerEl: container, vigilancePanel: null, vigilancePanelPromise: null, vigilanceEcheance: 'J', selectedVigilanceDept: null,
      currentVigilance: { vigilance: { data: VIGILANCE_FIXTURE(), error: null, fetchedAt: ENV_FIXTURE_NOW } }, currentSeaLevels: seaLevelsStateFixture(),
      activeLayers: { environmental: true }, mapContainer: { canFocusMap: () => true }, mapLegend: null,
    });

    await (app as unknown as { ensureVigilancePanel: () => Promise<void> }).ensureVigilancePanel();

    expect(container.textContent).toContain('Brest');
    expect(container.textContent).not.toContain('Chargement des marégraphes…');
    // Carte WebGL : lignes des marégraphes cliquables.
    expect(container.querySelector('[data-gauge="3"]')).not.toBeNull();
  });
});

describe('App : couches de la phase B transmises à la carte', () => {
  it('getEffectiveLayers donne drought, airQuality et earthquakes avec le maître dérivé : la carte les montre et les repeint au réaffichage', () => {
    const app = Object.create(App.prototype) as App & Record<string, unknown>;
    const effective = (active: Partial<MapLayers>): MapLayers => {
      Object.assign(app, { activeLayers: { environmentGroup: false, environmental: false, floods: false, weatherRadar: false, fires: false, ...active } });
      return (app as unknown as { getEffectiveLayers: () => MapLayers }).getEffectiveLayers();
    };
    for (const key of ['drought', 'airQuality', 'earthquakes'] as const) {
      const on = effective({ drought: false, airQuality: false, earthquakes: false, [key]: true });
      expect(on[key]).toBe(true);
      expect(on.environmentGroup).toBe(true);
      const off = effective({ drought: false, airQuality: false, earthquakes: false });
      expect(off[key]).toBe(false);
      expect(off.environmentGroup).toBe(false);
    }
  });
});
