// src/components/HydraulicPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HydraulicBackboneAsset } from '../types/index.ts';
import { HydraulicPanel } from './HydraulicPanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

const asset = (id: string, trend: 'stress' | 'normal'): HydraulicBackboneAsset => ({
  id, name: `Ouvrage ${id}`, type: 'hydro_production', subtype: 'reservoir', capacity_mw: 100, reservoir_volume: null, operator: null, river: 'Isère',
  location: { lat: 45, lon: 6, region: 'Auvergne-Rhône-Alpes', country: 'FR' }, criticality_score: 50,
  signals: { hydro_trend: trend, last_update: new Date().toISOString(), signalSource: 'DERIVED_CONTEXT_ONLY', dataFreshness: 'unavailable',
    measuredSupportLevel: 'none', hydroTrend: 'unavailable', observationTimestamp: null, confidence: 0.25, measuredStationCount: 0, sourceDetail: null, cause: null },
});

function mount(): { c: HTMLElement; p: HydraulicPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new HydraulicPanel(c);
  p.mount();
  return { c, p };
}

describe('HydraulicPanel', () => {
  it('cadre commun, titre de la pastille', () => {
    const { c, p } = mount();
    p.show([asset('a', 'stress'), asset('b', 'normal')], null);
    expect(c.querySelector('.lp.hydraulic-panel-modal .lp-title')?.textContent).toBe('Stress hydro');
    expect(c.innerHTML).not.toMatch(/linear-gradient|cursor: ?grab|DÉRIVÉ/);
  });
  it('clic et Entrée sur un ouvrage : recentrage demandé', () => {
    const { c, p } = mount();
    const onSelect = vi.fn();
    p.setOnSelectAsset(onSelect);
    p.show([asset('a', 'stress')], null);
    const row = c.querySelector('[data-hydraulic-asset="a"]') as HTMLElement;
    row.click();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: 'a' });
  });
  it('fermer une seule fois ; silencieux sans rappel ; update fermé ne rouvre pas', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show([asset('a', 'stress')]);
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    p.update([asset('a', 'normal')]);
    expect(p.isVisible()).toBe(false);
    p.show([asset('a', 'stress')]);
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('sans actifs : chargement', () => {
    const { c, p } = mount();
    p.show([]);
    expect(c.textContent).toContain('Chargement des données…');
  });
});
