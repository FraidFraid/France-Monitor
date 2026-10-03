// src/components/TrafficPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { roadStateFixture } from './layer-panel/traffic.fixture.ts';
import { TrafficPanel } from './TrafficPanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function mount(onFocus?: (lon: number | null) => void): { c: HTMLElement; p: TrafficPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new TrafficPanel(c);
  if (onFocus) p.setOnFocusEvent((event) => onFocus(event.lon));
  p.mount();
  return { c, p };
}

describe('TrafficPanel', () => {
  it('panneau .lp de classe traffic-panel-modal, caché puis ouvert, titre de la couche ; chargement puis données ; aucun badge « temps réel »', () => {
    const { c, p } = mount();
    expect(p.isVisible()).toBe(false);
    p.show(null);
    expect(c.querySelector('.lp.traffic-panel-modal .lp-title')?.textContent).toBe('Trafic routier');
    expect(c.textContent).toContain('Chargement des données…');
    p.update(roadStateFixture());
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('64');
    expect(c.textContent?.toLowerCase()).not.toContain('temps réel');
  });
  it('clic ou Entrée sur un événement : recentrage de la carte ; sans gestionnaire, lignes non cliquables', () => {
    const onFocus = vi.fn();
    const { c, p } = mount(onFocus);
    p.show(roadStateFixture());
    (c.querySelector('[data-road-event="acc-a55"]') as HTMLElement).click();
    expect(onFocus).toHaveBeenCalledWith(5.321);
    (c.querySelector('[data-road-event="queue-a7"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onFocus).toHaveBeenLastCalledWith(4.844);
    const other = mount();
    other.p.show(roadStateFixture());
    expect(other.c.querySelector('[data-road-event]')).toBeNull();
  });
  it('fermer une seule fois ; silencieux sans rappel ; update fermé ne rouvre pas ; section ouverte gardée ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(roadStateFixture());
    const details = c.querySelector('details[data-section="layer:trafficRoad:speeds"]') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    p.update(roadStateFixture());
    expect((c.querySelector('details[data-section="layer:trafficRoad:speeds"]') as HTMLDetailsElement).open).toBe(true);
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    p.update(roadStateFixture());
    expect(p.isVisible()).toBe(false);
    p.show(null);
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('64');
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
