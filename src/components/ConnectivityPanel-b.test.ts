// src/components/ConnectivityPanel-b.test.ts
// @vitest-environment happy-dom
// Coquille Connectivité, phase B (contrats § 4.2 ; amendement 7, S8) : la coquille passe enfin la visibilité des grands réseaux à la vue
// (report de B26) : gros chiffre « N / 6 », sections Réseaux et Points d'échange, données gardées quand une mise à jour ne les donne pas.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CABLES_FILE_FIXTURE, CABLES_WATCH_FIXTURE, SOV_FIXTURE_NOW, connectivityStateFixture } from './layer-panel/sovereignty.fixture.ts';
import { ConnectivityPanel, type ConnectivityPanelState } from './ConnectivityPanel.ts';

const NOW = SOV_FIXTURE_NOW;
const NBSP = '\u00a0';
const cables = (): ConnectivityPanelState['cables'] => (
  { watch: { data: CABLES_WATCH_FIXTURE(), error: null, fetchedAt: NOW }, file: CABLES_FILE_FIXTURE(), fileError: null }
);
const state = (): ConnectivityPanelState => ({ cables: cables(), connectivity: connectivityStateFixture() });

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: ConnectivityPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new ConnectivityPanel(c);
  p.mount();
  return { c, p };
}

describe('ConnectivityPanel, phase B', () => {
  it('« 6 / 6 » grands réseaux vus par au moins 99 % des routeurs témoins, en vert ; sections Réseaux et Points d’échange (27)', () => {
    const { c, p } = mount();
    p.show(state());
    expect(c.querySelector('.lp-figure b')?.textContent).toBe(`6${NBSP}/${NBSP}6`);
    expect(c.querySelector('.lp-figure b')?.classList.contains('lp-lvl--vert')).toBe(true);
    expect(c.querySelector('[data-section="layer:subseaCables:reseaux"]')).not.toBeNull();
    expect(c.querySelectorAll('[data-section="layer:subseaCables:reseaux"] [data-network]')).toHaveLength(6);
    expect(c.querySelectorAll('[data-section="layer:subseaCables:echanges"] [data-exchange]')).toHaveLength(27);
  });
  it('une mise à jour sans grands réseaux garde les derniers reçus ; null les retire (« n.d. », chargement)', () => {
    const { c, p } = mount();
    p.show(state());
    p.update({ cables: cables() });
    expect(c.querySelector('.lp-figure b')?.textContent).toBe(`6${NBSP}/${NBSP}6`);
    p.update({ cables: cables(), connectivity: null });
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('n.d.');
    expect(c.querySelector('[data-network]')).toBeNull();
  });
  it('lecture RIPEstat en échec sans donnée : panne nommée, jamais une barre à 0', () => {
    const { c, p } = mount();
    p.show({ cables: cables(), connectivity: { connectivity: { data: null, error: 'HTTP 502', fetchedAt: NOW } } });
    expect(c.querySelector('[data-section="layer:subseaCables:reseaux"]')?.textContent).toContain('HTTP 502');
    expect(c.querySelector('[data-network]')).toBeNull();
  });
});
