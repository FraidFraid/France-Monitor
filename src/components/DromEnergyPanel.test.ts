// src/components/DromEnergyPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DromEnergyDashboard } from '../services/drom-energy/index.ts';
import { DromEnergyPanel } from './DromEnergyPanel.ts';
import { dromLiveFixture } from './layer-panel/drom.fixture.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

const DASH: DromEnergyDashboard = {
  territories: [], communeMetrics: [], productionLimitations: [], datasets: [], updatedAt: '2026-10-02T06:00:00Z',
  assets: [
    { id: 'a1', territoryCode: 'RE', type: 'source_substation', name: 'Poste A', sourceDatasetId: 'x', voltageKv: 63 },
    { id: 'a2', territoryCode: 'RE', type: 'htb_pylon', name: 'Pylône B', sourceDatasetId: 'x' },
  ],
};

function mount(): { c: HTMLElement; p: DromEnergyPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new DromEnergyPanel(c);
  p.mount();
  return { c, p };
}
const openInfra = (c: HTMLElement): void => {
  (c.querySelector('details[data-section="layer:dromEnergy:infra"]') as HTMLDetailsElement).open = true;
};

describe('DromEnergyPanel', () => {
  it('cadre commun, sans décor ni compteurs techniques', () => {
    const { c, p } = mount();
    p.setLive(dromLiveFixture());
    p.show(DASH);
    expect(c.querySelector('.lp.drom-energy-panel-modal .lp-title')?.textContent).toBe('Énergie DROM');
    expect(c.innerHTML).not.toMatch(/linear-gradient|Datasets présents|Filtrés/);
  });
  it('territoire mémorisé comme un onglet, rafraîchissement qui le garde', () => {
    const a = mount();
    a.p.setLive(dromLiveFixture());
    a.p.show(DASH);
    (a.c.querySelector('[data-tab="GP"]') as HTMLButtonElement).click();
    expect(a.c.querySelector('.lp-figure')?.textContent).toContain('Guadeloupe');
    a.p.setLive(dromLiveFixture());
    expect(a.c.querySelector('[data-tab="GP"]')?.getAttribute('aria-selected')).toBe('true');
    const b = mount();
    b.p.setLive(dromLiveFixture());
    b.p.show(DASH);
    expect(b.c.querySelector('[data-tab="GP"]')?.getAttribute('aria-selected')).toBe('true');
  });
  it('filtre de type des infrastructures', () => {
    const { c, p } = mount();
    p.setLive(dromLiveFixture());
    p.show(DASH);
    openInfra(c);
    const select = c.querySelector('[data-drom-filter="type"]') as HTMLSelectElement;
    select.value = 'htb_pylon';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(c.querySelector('[data-drom-asset="a2"]')).not.toBeNull();
    expect(c.querySelector('[data-drom-asset="a1"]')).toBeNull();
  });
  it('survol d’un actif : mise en évidence sur la carte, effacée en sortie et à la fermeture', () => {
    const { c, p } = mount();
    const onHover = vi.fn();
    p.setOnHoverAsset(onHover);
    p.setLive(dromLiveFixture());
    p.show(DASH);
    openInfra(c);
    c.querySelector('[data-drom-asset="a1"]')?.dispatchEvent(new Event('mouseover', { bubbles: true }));
    expect(onHover).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a1' }));
    c.querySelector('.lp')?.dispatchEvent(new Event('mouseleave'));
    expect(onHover).toHaveBeenLastCalledWith(null);
    p.hide({ silent: true });
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
  it('EDF injoignable après une première lecture : données gardées, encadré daté', () => {
    const { c, p } = mount();
    p.setLive(dromLiveFixture());
    p.show(DASH);
    p.setLive(null, 'HTTP 502');
    expect(c.textContent).toContain('Source injoignable. Dernières données');
    expect(c.querySelector('.lp-figure')?.textContent).toContain('MW');
  });
  it('inventaire en chargement puis en erreur ; fermeture une seule fois', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.setLive(dromLiveFixture());
    p.showLoadingState();
    openInfra(c);
    expect(c.textContent).toContain('Inventaire en cours de chargement…');
    p.showErrorState('HTTP 500');
    expect(c.textContent).toContain('Inventaire des infrastructures injoignable.');
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
