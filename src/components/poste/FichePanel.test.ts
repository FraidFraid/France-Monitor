// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { FichePanel } from './FichePanel.ts';
import type { FicheModel } from '../fiche/parts.ts';

function model(over: Partial<FicheModel> = {}): FicheModel {
  return {
    key: 'france', kind: 'Pays', name: 'France', level: 'rouge', driver: 'tirée par l’énergie', freshness: '',
    essentiel: ['BLUF.'], changesMeta: '', changes: [], sections: [], figures: [], watch: [],
    sourcesTitle: 'Preuves et sources', sources: [{ label: 'E42 · Explosion', href: null, select: 'event:42' }],
    why: '<p>Indice</p>', whyOpen: false, actions: [{ id: 'report', label: 'Note de situation' }], ...over,
  };
}

function mount(): { root: HTMLElement; panel: FichePanel } {
  const root = document.createElement('aside');
  document.body.appendChild(root);
  return { root, panel: new FichePanel(root) };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('FichePanel', () => {
  it('remonte sélection, action, volet et fermeture', () => {
    const { root, panel } = mount();
    const onSelect = vi.fn();
    const onAction = vi.fn();
    const onWhy = vi.fn();
    const onClose = vi.fn();
    panel.setOnSelect(onSelect);
    panel.setOnAction(onAction);
    panel.setOnWhyToggle(onWhy);
    panel.setOnClose(onClose);
    panel.render(model(), 'fr', true);
    root.querySelector<HTMLElement>('[data-select="event:42"]')?.click();
    root.querySelector<HTMLElement>('[data-action="report"]')?.click();
    // Attribut plutôt que propriété `open` : le test ne dépend pas de l'implémentation de <details>.
    const details = root.querySelector('details');
    details?.setAttribute('open', '');
    details?.dispatchEvent(new Event('toggle'));
    root.querySelector<HTMLButtonElement>('.fiche-close')?.click();
    expect(onSelect).toHaveBeenCalledWith('event:42');
    expect(onAction).toHaveBeenCalledWith('report', 'france');
    expect(onWhy).toHaveBeenCalledWith('france', true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('bouton de fermeture seulement pour une sélection ; aucune réécriture si rien ne change', () => {
    const { root, panel } = mount();
    panel.render(model(), 'fr', false);
    expect(root.querySelector<HTMLButtonElement>('.fiche-close')?.hidden).toBe(true);
    const name = root.querySelector('.fiche-name');
    panel.render(model(), 'fr', false);
    expect(root.querySelector('.fiche-name')).toBe(name);
  });

  it('le focus sur une preuve survit à une reconstruction de la même fiche', () => {
    const { root, panel } = mount();
    panel.render(model(), 'fr', false);
    root.querySelector<HTMLElement>('[data-select="event:42"]')?.focus();
    panel.render(model({ essentiel: ['Autre phrase.'] }), 'fr', false);
    expect(document.activeElement instanceof HTMLElement ? document.activeElement.dataset.select : undefined).toBe('event:42');
  });
});
