// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FiresPanel } from './FiresPanel.ts';
import type { FireObservationRuntimeState } from '../types/index.ts';

const runtime: FireObservationRuntimeState = {
  mtgFrp: {
    status: 'ok',
    observedAt: Date.parse('2026-07-16T12:50:00Z'),
    fetchedAt: Date.parse('2026-07-16T13:00:00Z'),
    source: 'EUMETSAT LSA SAF',
  },
  radar2d: {
    status: 'not-configured',
    observedAt: null,
    fetchedAt: null,
    source: 'Météo-France DPRadar',
  },
};

function renderPanel(): FiresPanel {
  const panel = new FiresPanel(document.body);
  panel.mount();
  panel.setObservationRuntimeState(runtime);
  panel.show([]);
  return panel;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('FiresPanel observation multi-capteurs', () => {
  it('rend exactement cinq lignes et conserve l’ouverture lors des mises à jour runtime', () => {
    const panel = renderPanel();
    const details = document.querySelector<HTMLDetailsElement>('.fires-multisensor');

    expect(details).not.toBeNull();
    expect(details?.querySelectorAll('.fires-multisensor__row')).toHaveLength(5);
    details!.open = true;
    details!.dispatchEvent(new Event('toggle'));

    panel.setObservationRuntimeState({
      ...runtime,
      radar2d: { ...runtime.radar2d, status: 'error', fetchedAt: Date.now() },
    });

    const rerendered = document.querySelector<HTMLDetailsElement>('.fires-multisensor');
    expect(rerendered?.open).toBe(true);
    expect(rerendered?.querySelectorAll('.fires-multisensor__row')).toHaveLength(5);
  });

  it('expose les deux overlays désactivés et notifie les activations', () => {
    const panel = renderPanel();
    const mtgToggle = document.querySelector<HTMLButtonElement>('button[aria-label="Afficher MTG-FRP"]');
    const radarToggle = document.querySelector<HTMLButtonElement>('button[aria-label="Afficher Réflectivité radar 2D Météo-France"]');
    const onMtg = vi.fn();
    const onRadar = vi.fn();
    panel.setOnMtgFrpToggle(onMtg);
    panel.setOnRadar2dToggle(onRadar);

    expect(mtgToggle?.getAttribute('aria-pressed')).toBe('false');
    expect(radarToggle?.getAttribute('aria-pressed')).toBe('false');

    mtgToggle?.click();
    radarToggle?.click();

    expect(onMtg).toHaveBeenCalledWith(true);
    expect(onRadar).toHaveBeenCalledWith(true);
    expect(mtgToggle?.getAttribute('aria-pressed')).toBe('true');
    expect(radarToggle?.getAttribute('aria-pressed')).toBe('true');
  });

  it('permet à App de resynchroniser le bouton radar après un échec', () => {
    const panel = renderPanel();
    const radarToggle = document.querySelector<HTMLButtonElement>('button[aria-label="Afficher Réflectivité radar 2D Météo-France"]');
    radarToggle?.click();
    expect(radarToggle?.getAttribute('aria-pressed')).toBe('true');

    panel.setRadar2dEnabled(false);

    const resetToggle = document.querySelector<HTMLButtonElement>('button[aria-label="Afficher Réflectivité radar 2D Météo-France"]');
    expect(resetToggle?.getAttribute('aria-pressed')).toBe('false');
    expect(resetToggle?.textContent).toBe('Afficher');
  });

  it('ne présente plus les passages groupés comme une revisite horaire continue', () => {
    const panel = renderPanel();
    panel.setSourcesInfo(['SNPP', 'NOAA-20', 'NOAA-21'], true);
    panel.show([]);

    const text = document.querySelector('.fires-panel-modal')?.textContent ?? '';
    expect(text).toContain('2 grappes/jour');
    expect(text).not.toContain('~1 h de revisite');
    expect(text).not.toContain('Revisite France ~1 h');
  });
});
