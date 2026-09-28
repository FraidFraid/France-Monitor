// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { LayerPanel } from './LayerPanel.ts';
import { layersForPreset } from '../config/layer-presets.ts';
import type { MapLayers } from '../types/index.ts';

function mountWith(layers: Partial<MapLayers>): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  new LayerPanel(host, layers as MapLayers).mount();
  return host;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('LayerPanel — « Personnaliser les couches »', () => {
  it('la liste des couches est dépliée à l’ouverture, même quand l’état correspond à une vue', () => {
    const host = mountWith(layersForPreset('energy'));
    const toggle = host.querySelector<HTMLElement>('#layer-panel-customize-toggle');
    const body = host.querySelector<HTMLElement>('.layer-panel-customize-body');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(body?.style.display).toBe('block');
    // Le groupe du thème courant est déplié, ses cases cochées visibles.
    expect(host.querySelector<HTMLInputElement>('[data-layer="metroLoad"] input')?.checked).toBe(true);
  });

  it('reste repliée si l’utilisateur l’a repliée', () => {
    const host = mountWith(layersForPreset('energy'));
    host.querySelector<HTMLElement>('#layer-panel-customize-toggle')?.click();
    expect(host.querySelector<HTMLElement>('.layer-panel-customize-body')?.style.display).toBe('none');
  });
});
