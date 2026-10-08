// src/components/EarthquakesPanel.test.ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV_FIXTURE_NOW, quakesStateFixture } from './layer-panel/environment.fixture.ts';
import { EarthquakesPanel } from './EarthquakesPanel.ts';

// Horloge figée à la date du jeu d'essai : la vue ne liste que les séismes des 7 derniers jours.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(ENV_FIXTURE_NOW); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

describe('EarthquakesPanel', () => {
  it('classe quakes-panel-modal ; clic ou Entrée sur un séisme : recentrage sur son épicentre ; sans gestionnaire : lignes non cliquables', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const p = new EarthquakesPanel(c);
    const onFocus = vi.fn();
    p.setOnFocusQuake((q) => onFocus(q.lon));
    p.mount();
    p.show(quakesStateFixture());
    expect(c.querySelector('.lp.quakes-panel-modal .lp-title')?.textContent).toBe('Séismes');
    (c.querySelector('[data-quake="fr2026usugeu"]') as HTMLElement).click();
    expect(onFocus).toHaveBeenCalledWith(6.3004);
    (c.querySelector('[data-quake="fr2026utlsew"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onFocus).toHaveBeenLastCalledWith(6.6427);
    const d = document.createElement('div');
    document.body.appendChild(d);
    const bare = new EarthquakesPanel(d);
    bare.mount();
    bare.show(quakesStateFixture());
    expect(d.querySelector('[data-quake]')).toBeNull();
  });
});
