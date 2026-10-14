// @vitest-environment happy-dom
// Légende de la carte : plusieurs catégories remplacées d'un coup (légendes Environnement datées) avec une seule reconstruction.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapLegend, type LegendCategory } from './MapLegend.ts';

const category = (id: string, title: string, visible: boolean): LegendCategory => ({
  id, title, items: [{ id: `${id}-item`, label: `Élément ${title}`, color: '#ffcc00' }], visible,
});

afterEach(() => {
  document.body.innerHTML = '';
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('MapLegend.setCategories', () => {
  it('ajoute ou remplace par identifiant, applique la visibilité donnée et ne reconstruit la légende qu’une fois', () => {
    sessionStorage.setItem('fm-legend-open', '1');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const legend = new MapLegend(host);
    legend.init();
    legend.addCategory(category('floods', 'Crues', true));
    const update = vi.spyOn(legend, 'update');

    legend.setCategories([
      category('environmental', 'Vigilance météo', false),
      category('floods', 'Crues du 04/10', true),
      category('fires', 'Feux de forêt', true),
    ]);

    expect(update).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Crues du 04/10');
    expect(host.textContent).toContain('Feux de forêt');
    expect(host.textContent).not.toContain('Vigilance météo');
    expect(host.textContent?.match(/Crues/g)).toHaveLength(2);
  });
});

describe('MapLegend · à la demande', () => {
  it('fermée : un bouton « Légende » ; ouverte : « Lire la carte », bloc événements puis couches ; Échap ferme', () => {
    sessionStorage.clear();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const legend = new MapLegend(host);
    legend.init();
    legend.addCategory({ id: 'vigilance', title: 'Vigilance météo', items: [{ id: 'v', label: 'Rouge', color: '#ff3b30' }], visible: true });
    legend.setEventsKey('<section class="mk">Événements en cours</section>');
    const btn = host.querySelector<HTMLButtonElement>('.map-key-btn');
    expect(btn?.textContent).toContain('Légende');
    expect(btn?.getAttribute('aria-expanded')).toBe('false');
    btn?.click();
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Lire la carte');
    expect(dialog?.textContent?.indexOf('Événements en cours')).toBeLessThan(dialog?.textContent?.indexOf('Vigilance météo') ?? 0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    legend.destroy();
  });

  it('un clic sur un niveau remonte l’action', () => {
    sessionStorage.setItem('fm-legend-open', '1');
    const host = document.createElement('div');
    const legend = new MapLegend(host);
    legend.init();
    const onAction = vi.fn();
    legend.setOnKeyAction(onAction);
    legend.setEventsKey('<button type="button" data-key-action="level:rouge">Rouge</button>');
    host.querySelector<HTMLButtonElement>('[data-key-action="level:rouge"]')?.click();
    expect(onAction).toHaveBeenCalledWith('level:rouge');
    legend.destroy();
  });
});

describe('MapLegend · bascule d’un niveau', () => {
  it('garde le focus sur le bouton et la position de défilement', () => {
    sessionStorage.setItem('fm-legend-open', '1');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const legend = new MapLegend(host);
    legend.init();
    legend.setEventsKey('<button type="button" data-key-action="level:rouge" aria-pressed="true">Rouge</button>');
    const panel = host.querySelector<HTMLElement>('.map-key');
    if (panel) panel.scrollTop = 40;
    host.querySelector<HTMLButtonElement>('[data-key-action="level:rouge"]')?.focus();
    legend.setEventsKey('<button type="button" data-key-action="level:rouge" aria-pressed="false">Rouge</button>');
    expect((document.activeElement as HTMLElement | null)?.dataset.keyAction).toBe('level:rouge');
    expect(host.querySelector<HTMLElement>('.map-key')?.scrollTop).toBe(40);
    legend.destroy();
    host.remove();
  });
});
