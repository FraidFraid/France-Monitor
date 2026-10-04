// src/components/ConnectivityPanel.test.ts
// @vitest-environment happy-dom
// Coquille du panneau Connectivité (spec 2026-10-04 souveraineté § 2.2 ; contrats § 4.2 ; amendement 7, O18) : la couche des câbles a
// enfin son panneau ; câble, lieu d'atterrage et navire signalé cliqués vers la carte.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CablesWatchResponse } from '../types/index.ts';
import { CABLES_FILE_FIXTURE, CABLES_WATCH_ALERTS_FIXTURE, CABLES_WATCH_FIXTURE, SOV_FIXTURE_NOW } from './layer-panel/sovereignty.fixture.ts';
import { ConnectivityPanel, type ConnectivityPanelState } from './ConnectivityPanel.ts';

const NOW = SOV_FIXTURE_NOW;
const state = (watch: CablesWatchResponse = CABLES_WATCH_FIXTURE()): ConnectivityPanelState => ({
  cables: { watch: { data: watch, error: null, fetchedAt: NOW }, file: CABLES_FILE_FIXTURE(), fileError: null },
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: ConnectivityPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new ConnectivityPanel(c);
  p.mount();
  return { c, p };
}

describe('ConnectivityPanel', () => {
  it('panneau .lp de classe connectivity-panel-modal, titre « Connectivité » ; chargement puis veille du 04/10 verte', () => {
    const { c, p } = mount();
    p.show({ cables: null });
    expect(c.querySelector('.lp.connectivity-panel-modal .lp-title')?.textContent).toBe('Connectivité');
    expect(c.textContent).toContain('Chargement des données…');
    p.update(state());
    // Phase B (B26) : le gros chiffre est « N / 6 » grands réseaux ; sans relevé RIPEstat (branché par B28) il reste « n.d. » sans
    // couleur, et le compte des navires lents est passé en tête de la section des navires.
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('n.d.');
    expect(c.querySelector('.lp-figure b')?.className ?? '').not.toMatch(/lp-lvl--/);
    expect(c.textContent).toContain('Navires lents sur un tracé');
    // O18 : le Shom en référence, OpenStreetMap en complément ; une proximité n'est « jamais une menace ».
    expect(c.textContent).toContain('d’après le Shom et OpenStreetMap');
    expect((c.textContent ?? '').replace(/jamais une menace/g, '')).not.toMatch(/SubmarineCableMap|temps réel|menace/i);
  });
  it('câble, lieu d’atterrage et navire signalé cliqués : rappels avec l’identifiant, l’atterrage et l’alerte', () => {
    const { c, p } = mount();
    const onCable = vi.fn();
    const onLanding = vi.fn();
    const onVessel = vi.fn();
    p.setOnFocusCable(onCable);
    p.setOnFocusLanding(onLanding);
    p.setOnFocusVessel(onVessel);
    p.show(state(CABLES_WATCH_ALERTS_FIXTURE()));
    expect(c.querySelectorAll('[data-cable]')).toHaveLength(CABLES_FILE_FIXTURE().cables.length);
    const cable = c.querySelector<HTMLElement>('[data-cable]');
    cable?.click();
    expect(onCable).toHaveBeenCalledWith(cable?.dataset['cable']);
    // Un câble du Shom (identifiant « shom/… ») se recentre comme un câble OpenStreetMap.
    const shom = c.querySelector<HTMLElement>('[data-cable^="shom/"]');
    expect(shom).not.toBeNull();
    shom?.click();
    expect(onCable).toHaveBeenLastCalledWith(shom?.dataset['cable']);
    for (const place of c.querySelectorAll<HTMLElement>('[data-landing]')) {
      const key = place.dataset['landing'] ?? '';
      const cut = key.lastIndexOf(':');
      const expected = CABLES_FILE_FIXTURE().cables.find((x) => x.id === key.slice(0, cut))?.landings[Number(key.slice(cut + 1))];
      expect(expected).toBeDefined();
      place.click();
      expect(onLanding).toHaveBeenLastCalledWith(expected);
    }
    expect(onLanding).toHaveBeenCalled();
    (c.querySelector('[data-vessel="229000001:way/761201757"]') as HTMLElement).click();
    expect(onVessel).toHaveBeenCalledWith(expect.objectContaining({ mmsi: '229000001', distanceM: 304, confirmed: true }));
  });
  it('sans gestionnaire de carte : câbles, lieux et navires non cliquables ; titre d’une section repliable sans effet', () => {
    const { c, p } = mount();
    const onCable = vi.fn();
    p.show(state(CABLES_WATCH_ALERTS_FIXTURE()));
    expect(c.querySelector('[data-cable], [data-landing], [data-vessel]')).toBeNull();
    const withFocus = mount();
    withFocus.p.setOnFocusCable(onCable);
    withFocus.p.show(state());
    (withFocus.c.querySelector('details[data-section="layer:subseaCables:cables"] summary') as HTMLElement).click();
    expect(onCable).not.toHaveBeenCalled();
  });
  it('fermer une seule fois ; mise à jour d’un panneau fermé sans le rouvrir ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(state());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    p.update(state());
    expect(p.isVisible()).toBe(false);
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
