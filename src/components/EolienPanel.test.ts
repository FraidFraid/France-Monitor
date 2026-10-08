// src/components/EolienPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EolienLive, EolienParkSummary } from '../services/eolien/types.ts';
import { EolienPanel } from './EolienPanel.ts';
import { zoneMidnight } from './layer-panel/format.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

const LIVE: EolienLive = { production: 2.1, production_gw: 2.1, puissance_installee: 26.1, facteur_charge: 0.08, parcs_actifs: 1,
  timestamp: new Date(), alertLevel: 'low-production' };
const PARK: EolienParkSummary = { id: 'p1', groupId: 'p1', name: 'Parc 1', status: 'operating', kind: 'onshore', capacityMw: 50, turbineCount: 10,
  operator: null, commune: null, department: null, region: null, commissioningYear: null, estimatedProductionMw: 4, coordinates: [2, 49], sourceType: 'park' };

function mount(): { c: HTMLElement; p: EolienPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new EolienPanel(c);
  p.mount();
  return { c, p };
}

describe('EolienPanel', () => {
  it('cadre commun, titre de la pastille, sans badge « TEMPS RÉEL » ni anneau', () => {
    const { c, p } = mount();
    p.show(LIVE, [PARK]);
    expect(c.querySelector('.lp.eolien-panel-modal .lp-title')?.textContent).toBe('Éolien');
    expect(c.innerHTML).not.toMatch(/TEMPS RÉEL|Backbone|linear-gradient/);
  });
  it('clic sur un parc : recentrage demandé', () => {
    const { c, p } = mount();
    const onSelect = vi.fn();
    p.setOnSelectPark(onSelect);
    p.show(LIVE, [PARK]);
    (c.querySelector('details[data-section="layer:windMonitor:parks"]') as HTMLDetailsElement).open = true;
    (c.querySelector('[data-eolien-park="p1"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith(PARK);
  });
  it('erreur puis données : l’erreur s’efface ; update sur panneau fermé ne l’ouvre pas', () => {
    const { c, p } = mount();
    p.show(null, []);
    p.showErrorState('fetch_failed');
    expect(c.textContent).toContain('Source injoignable');
    p.update(LIVE, [PARK]);
    expect(c.textContent).not.toContain('Source injoignable');
    p.hide({ silent: true });
    p.update(LIVE, [PARK]);
    expect(p.isVisible()).toBe(false);
  });
  it('setGrid rafraîchit la courbe d’un panneau ouvert', () => {
    const { c, p } = mount();
    p.show(LIVE, [PARK]);
    expect(c.textContent).toContain('Courbe du jour indisponible.');
    const t = zoneMidnight(Date.now(), 'Europe/Paris') + 12 * 3_600_000; // midi du jour de Paris
    p.setGrid({ dataTime: t, consumptionMw: null, forecastMw: null, co2gPerKwh: null, netImportMw: null,
      mix: { nuclear: null, hydro: null, wind: 2000, solar: null, thermal: null, bio: null },
      hydroDetail: { runOfRiver: null, lakes: null, stepTurbine: null, pumping: null }, windDetail: { onshore: 1900, offshore: 100 },
      day: [{ at: t - 60_000, consumptionMw: null, forecastMw: null, windMw: 1900 }, { at: t, consumptionMw: null, forecastMw: null, windMw: 2000 }] });
    expect(c.querySelector('details[data-section="layer:windMonitor:day"] svg')).not.toBeNull();
  });
  it('fermer une seule fois', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(LIVE, []);
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
