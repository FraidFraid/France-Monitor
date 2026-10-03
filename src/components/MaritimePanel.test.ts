// src/components/MaritimePanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MilitaryShip } from '../services/military-ships.ts';
import { maritimeStateFixture } from './layer-panel/traffic.fixture.ts';
import { MaritimePanel, type MaritimeLiveSource } from './MaritimePanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

const ship = (over: Partial<MilitaryShip> & Pick<MilitaryShip, 'id' | 'name'>): MilitaryShip => ({
  type: 'Cargo', role: 'Civil/Inconnu', lat: 49.6, lon: -1.0, isLive: true, lastSeen: Date.now(), riskLevel: 'none', ...over,
});
const traffic: MilitaryShip[] = [
  ship({ id: 'a', name: 'OCEAN STAR', mmsi: '667001234', riskLevel: 'medium', country: 'SL|Sierra Leone', speed: 11 }),
  ship({ id: 'b', name: 'CALANDRA', mmsi: '232063461', country: 'GB|Royaume-Uni', speed: 4 }),
];
const navy: MilitaryShip[] = [ship({ id: 'd620', name: 'Chevalier Paul', mmsi: '227731000', type: 'Frégate DA', role: 'Défense aérienne', speed: 16 })];
const source: MaritimeLiveSource = {
  navy: () => navy, traffic: () => traffic, connection: () => ({ status: 'connected', lastMessageAt: Date.now() }),
};

function mount(): { c: HTMLElement; p: MaritimePanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new MaritimePanel(c, source);
  p.mount();
  return { c, p };
}

describe('MaritimePanel', () => {
  it('panneau .lp de classe maritime-panel-modal, onglet Veille par défaut, chargement puis données', () => {
    const { c, p } = mount();
    p.show(null);
    expect(c.querySelector('.lp.maritime-panel-modal .lp-title')?.textContent).toBe('Trafic maritime');
    expect(c.querySelector('[data-tab="veille"]')?.getAttribute('aria-selected')).toBe('true');
    expect(c.textContent).toContain('Chargement des données…');
    p.update(maritimeStateFixture());
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('1\u202F196');
  });
  it('onglet mémorisé : gardé au rafraîchissement et par une nouvelle instance', () => {
    const a = mount();
    a.p.show(maritimeStateFixture());
    (a.c.querySelector('[data-tab="alertes"]') as HTMLButtonElement).click();
    expect(a.c.textContent).toContain('OCEAN STAR');
    a.p.update(maritimeStateFixture());
    expect(a.c.querySelector('[data-tab="alertes"]')?.getAttribute('aria-selected')).toBe('true');
    const b = mount();
    b.p.show(maritimeStateFixture());
    expect(b.c.querySelector('[data-tab="alertes"]')?.getAttribute('aria-selected')).toBe('true');
  });
  it('filtre, recherche (focus gardé), territoire, fiche navire et retour, survol transmis à la carte', () => {
    const onSelect = vi.fn();
    const onHighlight = vi.fn();
    const { c, p } = mount();
    p.setOnSelectShip(onSelect);
    p.setOnHighlightShip(onHighlight);
    p.show(maritimeStateFixture());
    (c.querySelector('[data-tab="alertes"]') as HTMLButtonElement).click();
    (c.querySelector('[data-mar-filter="tous"]') as HTMLButtonElement).click();
    expect(c.textContent).toContain('CALANDRA');
    const input = c.querySelector('[data-mar-search]') as HTMLInputElement;
    input.focus();
    input.value = 'ocean';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(c.textContent).not.toContain('CALANDRA');
    expect((document.activeElement as HTMLInputElement | null)?.value).toBe('ocean');
    const select = c.querySelector('[data-mar-territory]') as HTMLSelectElement;
    select.value = 'GP';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(c.textContent).not.toContain('OCEAN STAR');
    // Le rendu remplace la liste : le sélecteur affiché est relu, comme le ferait l'utilisateur.
    const again = c.querySelector('[data-mar-territory]') as HTMLSelectElement;
    again.value = 'all';
    again.dispatchEvent(new Event('change', { bubbles: true }));
    (c.querySelector('[data-mar-ship="667001234"]') as HTMLElement).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(onHighlight).toHaveBeenCalledWith('667001234');
    (c.querySelector('[data-mar-ship="667001234"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ mmsi: '667001234' }));
    expect(c.querySelector('details[data-section="layer:trafficMaritime:ship-position"]')).not.toBeNull();
    (c.querySelector('[data-mar-back]') as HTMLButtonElement).click();
    expect(c.querySelector('details[data-section="layer:trafficMaritime:ship-position"]')).toBeNull();
  });
  it('clic sur un navire de la carte : fiche si le panneau est ouvert ; positions relues à chaque rafraîchissement', () => {
    const { c, p } = mount();
    p.openShipModal(navy[0]);
    expect(c.querySelector('[data-section="layer:trafficMaritime:ship-position"]')).toBeNull();
    p.show(maritimeStateFixture());
    p.openShipModal(navy[0]);
    expect(c.textContent).toContain('Chevalier Paul');
    (c.querySelector('[data-mar-back]') as HTMLButtonElement).click();
    (c.querySelector('[data-tab="alertes"]') as HTMLButtonElement).click();
    traffic.push(ship({ id: 'c', name: 'NOUVEAU RISQUE', mmsi: '667009999', riskLevel: 'high' }));
    p.refreshLive();
    expect(c.textContent).toContain('NOUVEAU RISQUE');
    traffic.pop();
  });
  it('fermer une seule fois ; silencieux sans rappel ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(maritimeStateFixture());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
