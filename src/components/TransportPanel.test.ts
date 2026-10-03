// src/components/TransportPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RailTrafficState } from '../services/traffic-rail.ts';
import type { RailTrain } from '../types/index.ts';
import { railStateFixture } from './layer-panel/traffic.fixture.ts';
import { TransportPanel } from './TransportPanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function mount(onSelect?: (train: RailTrain) => void): { c: HTMLElement; p: TransportPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new TransportPanel(c);
  if (onSelect) p.setOnSelectTrain(onSelect);
  p.mount();
  return { c, p };
}

function manyTrains(): RailTrafficState {
  const s = railStateFixture();
  const o = s.overview.data;
  if (o) {
    const base = o.trains[0];
    o.trains = Array.from({ length: 25 }, (_, i): RailTrain => ({ ...base, id: `t-${i}`, number: String(1000 + i) }));
  }
  return s;
}

describe('TransportPanel', () => {
  it('panneau .lp de classe transport-panel-modal, titre de la couche, plus de bouton « couverture complète »', () => {
    const { c, p } = mount();
    p.show(railStateFixture());
    expect(c.querySelector('.lp.transport-panel-modal .lp-title')?.textContent).toBe('Réseau ferroviaire');
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('37');
    expect(c.textContent).not.toMatch(/couverture complète/i);
  });
  it('filtre par axe ou région, pagination, gardés au rafraîchissement ; train choisi transmis à la carte', () => {
    const onSelect = vi.fn();
    const { c, p } = mount(onSelect);
    p.show(manyTrains());
    expect(c.querySelectorAll('[data-section="layer:trafficRail:trains"] [data-rail-train]')).toHaveLength(20);
    (c.querySelector('[data-rail-more]') as HTMLButtonElement).click();
    expect(c.querySelectorAll('[data-section="layer:trafficRail:trains"] [data-rail-train]')).toHaveLength(25);
    p.update(railStateFixture());
    const select = c.querySelector('[data-rail-filter]') as HTMLSelectElement;
    select.value = 'axis:sud-est';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(c.textContent).toContain('En cours (3)');
    p.update(railStateFixture());
    expect((c.querySelector('[data-rail-filter]') as HTMLSelectElement).value).toBe('axis:sud-est');
    (c.querySelector('[data-rail-train="SNCF:2026-10-03:9713"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ number: '9713' }));
  });
  it('survol d’un train : trajet prévisualisé sur la carte, effacé à la sortie de la ligne ou du panneau ; clic : train choisi (carte factice)', () => {
    const map = { previewTrainRoute: vi.fn(), highlightTrainRoute: vi.fn() };
    const { c, p } = mount((train) => map.highlightTrainRoute(train));
    p.setOnPreviewTrain((train) => map.previewTrainRoute(train));
    p.show(railStateFixture());
    const row = c.querySelector('[data-rail-train="SNCF:2026-10-03:9713"]') as HTMLElement;
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(map.previewTrainRoute).toHaveBeenLastCalledWith(expect.objectContaining({ number: '9713' }));
    // Survol d'un élément de la même ligne : pas de nouvel appel.
    (row.firstElementChild ?? row).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(map.previewTrainRoute).toHaveBeenCalledTimes(1);
    // Sortie de la ligne vers le reste du panneau : prévisualisation effacée.
    (c.querySelector('.lp-head') as HTMLElement).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(map.previewTrainRoute).toHaveBeenLastCalledWith(null);
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    (c.querySelector('.lp') as HTMLElement).dispatchEvent(new MouseEvent('mouseleave'));
    expect(map.previewTrainRoute).toHaveBeenLastCalledWith(null);
    expect(map.previewTrainRoute).toHaveBeenCalledTimes(4);
    row.click();
    expect(map.highlightTrainRoute).toHaveBeenCalledWith(expect.objectContaining({ number: '9713' }));
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    p.hide({ silent: true });
    expect(map.previewTrainRoute).toHaveBeenLastCalledWith(null);
  });
  it('fermer une seule fois ; silencieux sans rappel ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(railStateFixture());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
