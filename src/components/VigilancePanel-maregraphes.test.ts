// src/components/VigilancePanel-maregraphes.test.ts
// @vitest-environment happy-dom
// Marégraphes dans le panneau Vigilance météo (spec 2026-10-04 environnement § 3.4, arbitrage 11) : état facultatif `seaLevels`,
// gardé quand un appel ne le donne pas ; ligne d'un marégraphe : recentrage.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VigilanceState } from '../services/environment-vigilance.ts';
import { ENV_FIXTURE_NOW, VIGILANCE_FIXTURE, seaLevelsStateFixture } from './layer-panel/environment.fixture.ts';
import { VigilancePanel } from './VigilancePanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

const vigilance = (): VigilanceState => ({ vigilance: { data: VIGILANCE_FIXTURE(), error: null, fetchedAt: ENV_FIXTURE_NOW } });

describe('VigilancePanel : section Submersion marine', () => {
  it('marégraphes non lus : chargement ; lus : Brest et Marseille ; un appel sans marégraphes les garde ; clic : recentrage', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const p = new VigilancePanel(c);
    const onGauge = vi.fn();
    p.setOnSelectDepartment(() => undefined);
    p.setOnFocusGauge(onGauge);
    p.mount();
    p.show({ vigilance: vigilance() });
    expect(c.querySelector('details[data-section="layer:environmental:submersion"]')).not.toBeNull();
    expect(c.textContent).toContain('Chargement des marégraphes…');
    p.update({ vigilance: vigilance(), seaLevels: seaLevelsStateFixture() });
    expect(c.textContent).toContain('Brest');
    p.update({ vigilance: vigilance() });
    expect(c.textContent).toContain('Marseille');
    (c.querySelector('[data-gauge="3"]') as HTMLElement).click();
    expect(onGauge).toHaveBeenCalledWith(3);
  });
});
