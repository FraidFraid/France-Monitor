// src/components/AirQualityPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { airQualityStateFixture } from './layer-panel/environment.fixture.ts';
import { AirQualityPanel } from './AirQualityPanel.ts';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

describe('AirQualityPanel', () => {
  it('classe air-panel-modal, titre, chargement puis données ; fermeture une fois ; destroy', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const p = new AirQualityPanel(c);
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.mount();
    p.show(null);
    expect(c.querySelector('.lp.air-panel-modal .lp-title')?.textContent).toBe('Qualité de l’air');
    expect(c.textContent).toContain('Chargement des données…');
    p.update(airQualityStateFixture());
    expect(c.querySelector('.lp-figure b')?.textContent).toBe('0');
    expect(c.querySelector('details[data-section="layer:airQuality:indice"]')).not.toBeNull();
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
