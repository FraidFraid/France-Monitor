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
