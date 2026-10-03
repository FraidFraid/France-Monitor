// src/components/AirTrafficPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { airStateFixture } from './layer-panel/traffic.fixture.ts';
import { AirTrafficPanel } from './AirTrafficPanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: AirTrafficPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new AirTrafficPanel(c);
  p.mount();
  return { c, p };
}

describe('AirTrafficPanel (nouveau panneau)', () => {
  it('panneau .lp de classe air-traffic-panel-modal, titre de la couche, urgences en tête', () => {
    const { c, p } = mount();
    p.show(airStateFixture());
    expect(c.querySelector('.lp.air-traffic-panel-modal .lp-title')?.textContent).toBe('Trafic aérien');
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('0');
    expect(c.querySelector('details[data-section="layer:trafficAir:emergencies"]')).not.toBeNull();
  });
  it('fermer une seule fois ; silencieux sans rappel ; update fermé ne rouvre pas', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(airStateFixture());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    p.update(airStateFixture());
    expect(p.isVisible()).toBe(false);
    p.show(null);
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
