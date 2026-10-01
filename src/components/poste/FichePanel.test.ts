// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { FichePanel } from './FichePanel.ts';
import { renderSourceChips, type FicheModel } from '../fiche/parts.ts';

function model(over: Partial<FicheModel> = {}): FicheModel {
  return {
    key: 'france', kind: 'Pays', name: 'France', level: 'rouge', driver: 'tirée par l’énergie', freshness: '',
    lead: 'BLUF.',
    sections: [{ id: 'sources', title: 'Preuves et sources', html: renderSourceChips([{ label: 'E42 · Explosion', href: null, select: 'event:42' }]) }],
    actions: [{ id: 'report', label: 'Note de situation' }], ...over,
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
  it('remonte sélection, action et fermeture', () => {
    const { root, panel } = mount();
    const onSelect = vi.fn();
    const onAction = vi.fn();
    const onClose = vi.fn();
    panel.setOnSelect(onSelect);
    panel.setOnAction(onAction);
    panel.setOnClose(onClose);
    panel.render(model(), 'fr', true);
    root.querySelector<HTMLElement>('[data-select="event:42"]')?.click();
    root.querySelector<HTMLElement>('[data-action="report"]')?.click();
    root.querySelector<HTMLButtonElement>('.fiche-close')?.click();
    expect(onSelect).toHaveBeenCalledWith('event:42');
    expect(onAction).toHaveBeenCalledWith('report', 'france');
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
    panel.render(model({ lead: 'Autre phrase.' }), 'fr', false);
    expect(document.activeElement instanceof HTMLElement ? document.activeElement.dataset.select : undefined).toBe('event:42');
  });

  it('remonte l’ouverture et la fermeture d’une section du kit', async () => {
    const { root, panel } = mount();
    const onSection = vi.fn();
    panel.setOnSectionToggle(onSection);
    panel.render(model({ sections: [{ id: 'infra', title: 'Infrastructures', html: '<p>x</p>', collapsible: true }] }), 'fr', false);
    const details = root.querySelector<HTMLDetailsElement>('details[data-section="france:infra"]');
    if (!details) throw new Error('section absente');
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(onSection).toHaveBeenLastCalledWith('france:infra', true);
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    expect(onSection).toHaveBeenLastCalledWith('france:infra', false);
  });

  it('le focus sur un titre de section survit à une reconstruction', () => {
    const { root, panel } = mount();
    const sections = [{ id: 'infra', title: 'Infrastructures', summary: '96/100', html: '<p>x</p>', collapsible: true }];
    panel.render(model({ sections }), 'fr', false);
    root.querySelector<HTMLElement>('details[data-section="france:infra"] > summary')?.focus();
    panel.render(model({ sections: [{ ...sections[0], summary: '95/100' }] }), 'fr', false);
    expect(document.activeElement?.closest('details')?.getAttribute('data-section')).toBe('france:infra');
  });

  it('un toggle émis au rendu (ouverture inchangée) n’est pas une action de l’utilisateur', () => {
    const { root, panel } = mount();
    const onSection = vi.fn();
    panel.setOnSectionToggle(onSection);
    panel.render(model({ sections: [{ id: 'note', title: 'Note', html: '<p>x</p>', collapsible: true, open: true }] }), 'fr', false);
    const details = root.querySelector<HTMLDetailsElement>('details[data-section="france:note"]');
    if (!details) throw new Error('section absente');
    details.dispatchEvent(new Event('toggle'));
    expect(onSection).not.toHaveBeenCalled();
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    expect(onSection).toHaveBeenCalledWith('france:note', false);
  });

  it('annonce brève hors du corps de fiche, effacée après 2,5 s', () => {
    vi.useFakeTimers();
    const { root, panel } = mount();
    panel.render(model(), 'fr', false);
    panel.announce('Référence copiée');
    expect(root.querySelector('.fiche-toast')?.textContent).toBe('Référence copiée');
    expect(root.querySelector('.fiche-toast')?.getAttribute('role')).toBe('status');
    expect(root.querySelector('.fiche-body .fiche-toast')).toBeNull();
    panel.render(model({ name: 'Autre' }), 'fr', false);
    expect(root.querySelector('.fiche-toast')?.textContent).toBe('Référence copiée');
    vi.advanceTimersByTime(2500);
    expect(root.querySelector('.fiche-toast')?.textContent).toBe('');
    vi.useRealTimers();
  });
});
