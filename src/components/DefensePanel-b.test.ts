// src/components/DefensePanel-b.test.ts
// @vitest-environment happy-dom
// Coquille Défense, phase B (contrats § 4.2 ; amendement 7, O17) : grille GNSS et registre des gels rendus depuis l'état et gardés quand
// une mise à jour ne les donne pas ; clic d'une maille du jour UTC précédent : recentrage ; bouton des zones drones : bascule de l'option
// d'après aria-pressed ; pastille avec le compte de mailles des 24 h.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DefenseSitesSummary } from './layer-panel/defense.ts';
import {
  CABLES_FILE_FIXTURE, CABLES_WATCH_FIXTURE, DRONE_ZONES_META_FIXTURE, MILITARY_FIXTURE, SOV_FIXTURE_NOW, gnssStateFixture, sanctionsStateFixture,
} from './layer-panel/sovereignty.fixture.ts';
import { DefensePanel, type DefensePanelState } from './DefensePanel.ts';

const NOW = SOV_FIXTURE_NOW;
const sites = (shown: boolean): DefenseSitesSummary => ({
  curated: { total: 112, byType: { air: 30, navy: 12, army: 40, joint: 10, fortification: 5, other: 15 }, overseas: 9, abroad: 4 },
  osm: { meta: null, error: null, shown: false },
  drones: { meta: DRONE_ZONES_META_FIXTURE(), error: null, shown },
});
const state = (shown = false): DefensePanelState => ({
  military: { military: { data: MILITARY_FIXTURE(), error: null, fetchedAt: NOW } },
  cables: { watch: { data: CABLES_WATCH_FIXTURE(), error: null, fetchedAt: NOW }, file: CABLES_FILE_FIXTURE(), fileError: null },
  vigipirate: null,
  sites: sites(shown), gnss: gnssStateFixture(), sanctions: sanctionsStateFixture(),
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: DefensePanel; cells: Array<{ lat: number; lon: number }>; drones: boolean[] } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new DefensePanel(c, { navy: () => [], connection: () => ({ status: 'connected', lastMessageAt: NOW }) });
  p.mount();
  const cells: Array<{ lat: number; lon: number }> = [];
  const drones: boolean[] = [];
  p.setOnFocusGnssCell((cell) => cells.push(cell));
  p.setOnDroneZones((on) => drones.push(on));
  return { c, p, cells, drones };
}

describe('DefensePanel, phase B', () => {
  it('sections GNSS et Sanctions rendues depuis l’état ; mailles du 03/10 par part décroissante ; pastille jaune (2 mailles sur 24 h)', () => {
    const { c, p } = mount();
    p.show(state());
    expect(c.querySelector('[data-section="layer:military:gnss"]')).not.toBeNull();
    expect(c.querySelector('[data-section="layer:military:gels"]')).not.toBeNull();
    expect([...c.querySelectorAll<HTMLElement>('[data-gnss-cell]')].map((el) => el.dataset['gnssCell'])).toEqual(['48:-3.5', '48:-4', '48:-3']);
    const gnss = c.querySelector('[data-section="layer:military:gnss"]')?.textContent ?? '';
    expect(gnss).toContain('Mailles du 03/10 (jour UTC complet)');
    expect(gnss).not.toContain('chargement…');
    expect(c.querySelector('.lp-head .fmk-level .fm-vig')?.className).toBe('fm-vig fm-vig--jaune');
  });
  it('clic sur une maille : recentrage sur la maille', () => {
    const { c, p, cells } = mount();
    p.show(state());
    c.querySelector<HTMLElement>('[data-gnss-cell="48:-3.5"]')?.click();
    expect(cells).toEqual([{ lat: 48, lon: -3.5 }]);
  });
  it('bouton des zones drones : bascule d’après son état', () => {
    const { c, p, drones } = mount();
    p.show(state(false));
    c.querySelector<HTMLElement>('[data-drone-zones]')?.click();
    p.update(state(true));
    expect(c.querySelector('[data-drone-zones]')?.getAttribute('aria-pressed')).toBe('true');
    c.querySelector<HTMLElement>('[data-drone-zones]')?.click();
    expect(drones).toEqual([true, false]);
  });
  it('une mise à jour sans grille ni registre garde les derniers reçus ; null les retire (sections « chargement… »)', () => {
    const { c, p } = mount();
    p.show(state());
    const { military, cables, vigipirate, sites: s } = state();
    p.update({ military, cables, vigipirate, sites: s });
    expect(c.querySelector('[data-section="layer:military:gnss"] [data-gnss-cell="48:-3.5"]')).not.toBeNull();
    expect(c.querySelector('[data-section="layer:military:gels"]')?.textContent).toContain('publication du');
    p.update({ military, cables, vigipirate, sites: s, gnss: null, sanctions: null });
    expect(c.querySelector('[data-gnss-cell]')).toBeNull();
    expect(c.querySelector('[data-section="layer:military:gnss"]')?.textContent).toContain('chargement…');
  });
  it('sans état de la phase B (première lecture de la phase A) : sections GNSS et Sanctions en chargement, jamais un compte « 0 »', () => {
    const { c, p } = mount();
    const { military, cables, vigipirate, sites: s } = state();
    p.show({ military, cables, vigipirate, sites: s });
    expect(c.querySelector('[data-section="layer:military:gnss"]')?.textContent).toContain('chargement…');
    expect(c.querySelector('[data-gnss-cell]')).toBeNull();
  });
});
