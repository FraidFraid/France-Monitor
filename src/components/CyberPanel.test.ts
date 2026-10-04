// src/components/CyberPanel.test.ts
// @vitest-environment happy-dom
// Coquille du panneau Vigilance cyber (spec 2026-10-04 souveraineté § 2.3 ; contrats § 4.2 ; amendement 7, O1, O2, S11) : cadre commun ;
// plus d'anneau de score, de badges « TEMPS RÉEL » ou « CACHE FIGÉ », d'onglets ni de carte des incidents.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SovCyberState } from '../services/sovereignty-cyber.ts';
import { CYBER_FIXTURE, SOV_FIXTURE_NOW } from './layer-panel/sovereignty.fixture.ts';
import { CyberPanel } from './CyberPanel.ts';

const NOW = SOV_FIXTURE_NOW;
const state = (): SovCyberState => ({ cyber: { data: CYBER_FIXTURE(), error: null, fetchedAt: NOW } });

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: CyberPanel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new CyberPanel(c);
  p.mount();
  return { c, p };
}

describe('CyberPanel', () => {
  it('panneau .lp de classe cyber-panel-modal, titre « Vigilance cyber », chargement puis 3 alertes CERT-FR en cours, pastille orange (ALE-011)', () => {
    const { c, p } = mount();
    p.show(null);
    expect(c.querySelector('.lp.cyber-panel-modal .lp-title')?.textContent).toBe('Vigilance cyber');
    expect(c.textContent).toContain('Chargement des données…');
    p.update(state());
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('3');
    expect(c.querySelector('.lp-figure b')?.classList.contains('lp-lvl--orange')).toBe(true);
    expect(c.querySelector('.lp-figure span')?.textContent).toMatch(/^alertes CERT-FR en cours/);
    expect(c.textContent).toContain('CERTFR-2026-ALE-011 en cours, publiée le 28/09 : exploitation signalée par le CERT-FR');
  });
  it('liens externes seulement ; Ransomware.live nommée avec son lien ; ni anneau, ni onglets, ni badge, ni nom de source retirée', () => {
    const { c, p } = mount();
    p.show(state());
    expect(c.querySelector('a[href="https://www.ransomware.live/country/FR"]')).not.toBeNull();
    expect(c.querySelector('a[href="https://www.ransomware.live"]')?.textContent).toBe('Source : Ransomware.live');
    expect(c.querySelector('a[href="https://www.cert.ssi.gouv.fr/alerte/CERTFR-2026-ALE-011/"]')).not.toBeNull();
    for (const a of c.querySelectorAll<HTMLAnchorElement>('.lp-body a[href]')) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(c.querySelector('.lp-tabs, canvas, .cyber-ring-container, .cyber-bento-grid')).toBeNull();
    // La méthode nomme une fois ce qui a été retiré ; rien d'autre.
    expect((c.textContent ?? '').replace(/Retirés : exposition Shodan et Censys[^.]*\./, '')).not.toMatch(/TEMPS RÉEL|CACHE FIGÉ|temps réel|Shodan|Censys|NVD/);
  });
  it('mise à jour d’un panneau fermé sans le rouvrir ; null garde le dernier état ; fermer une seule fois ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(state());
    p.update(null);
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('3');
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    p.update(state());
    expect(p.isVisible()).toBe(false);
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
