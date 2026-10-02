// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnergyPanel } from './EnergyPanel.ts';
import { isLayerPanelOpen } from './layer-panel/frame.ts';
import type { EcowattResponse } from '../types/index.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function data(): EcowattResponse {
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  return {
    official: { source: 'rte', generatedAt: null, days: [{ date: day, level: 'green', message: 'Pas d\'alerte.', hours: Array(24).fill(1) }] },
    mixes: {}, national: { timestamp: new Date(), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 },
    interconnections: [], grid: null,
  };
}

describe('EnergyPanel', () => {
  it('monte un panneau .lp caché, l\'ouvre avec le cadre commun', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const p = new EnergyPanel(c); p.mount();
    const root = c.querySelector('.lp.energy-panel-modal') as HTMLElement;
    expect(root).toBeTruthy();
    expect(p.isVisible()).toBe(false);
    p.show(data());
    expect(p.isVisible()).toBe(true);
    expect(root.querySelector('.lp-title')?.textContent).toBe('Réseau électrique');
    expect(root.textContent).toContain('Énergie · Couche');
    expect(root.innerHTML).not.toMatch(/monospace|cursor: ?grab|linear-gradient/);
  });
  it('fermer : masque et appelle le rappel une seule fois ; masquage silencieux sans rappel', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const p = new EnergyPanel(c); p.mount();
    const onClose = vi.fn(); p.setOnClose(onClose);
    p.show(data());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(p.isVisible()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    p.show(data()); p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('rafraîchir garde l\'ouverture des sections choisie par l\'utilisateur', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const p = new EnergyPanel(c); p.mount(); p.show(data());
    const d = c.querySelector('details[data-section="layer:powerGrid:production"]') as HTMLDetailsElement;
    d.open = false; d.dispatchEvent(new Event('toggle'));
    p.show(data());
    expect((c.querySelector('details[data-section="layer:powerGrid:production"]') as HTMLDetailsElement).open).toBe(false);
  });
  it('météo spatiale avant ou après les données', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const p = new EnergyPanel(c); p.mount();
    p.updateSpaceWeather({ kpIndex: 1, level: 'quiet', levelLabel: 'Calme', riskFrance: 'Aucun risque', color: '#0f0', fetchedAt: new Date() });
    p.show(data());
    expect(c.querySelector('details[data-section="layer:powerGrid:space"]')?.textContent).toContain('Kp 1 · calme');
  });
  it('sans données : chargement, pas d\'erreur', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const p = new EnergyPanel(c); p.mount(); p.show(null);
    expect(c.textContent).toContain('Chargement des données…');
  });
  it('visibilité : détectée par isLayerPanelOpen (pour App.ts:layoutEnergyFloatingPanels)', () => {
    const c = document.createElement('div'); document.body.appendChild(c);
    const p = new EnergyPanel(c); p.mount();
    const root = c.querySelector('.lp.energy-panel-modal') as HTMLElement;
    expect(isLayerPanelOpen(root)).toBe(false);
    p.show(data());
    expect(isLayerPanelOpen(root)).toBe(true);
    p.hide();
    expect(isLayerPanelOpen(root)).toBe(false);
  });
});
