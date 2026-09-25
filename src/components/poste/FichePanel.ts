// src/components/poste/FichePanel.ts — colonne de droite de la disposition A1 (spec §6) : affiche le
// modèle rendu par components/fiche/*. Délégation d'événements (le contenu est reconstruit à chaque
// donnée) ; le focus clavier et la position de lecture survivent aux reconstructions ; l'état des
// volets est remonté au contrôleur, qui le garde hors du DOM.

import { renderFiche, type FicheModel, type Lang } from '../fiche/parts.ts';
import { isDisplayed } from './WorkList.ts';

function findByData(root: ParentNode, attr: 'select' | 'action', value: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(`[data-${attr}]`)) {
    if (el.dataset[attr] === value) return el;
  }
  return null;
}

export class FichePanel {
  private readonly body: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private lastHtml = '';
  private currentKey: string | null = null;
  private onSelect: ((key: string) => void) | null = null;
  private onAction: ((action: string, ficheKey: string) => void) | null = null;
  private onWhyToggle: ((ficheKey: string, open: boolean) => void) | null = null;
  private onClose: (() => void) | null = null;

  constructor(root: HTMLElement) {
    root.id = 'fm-v2-fiche';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Fiche');
    this.closeButton = document.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.className = 'fiche-close';
    this.closeButton.hidden = true;
    this.closeButton.textContent = '×';
    this.body = document.createElement('div');
    this.body.className = 'fiche-body';
    const chrome = document.createElement('div');
    chrome.className = 'fiche-chrome';
    chrome.appendChild(this.closeButton);
    root.replaceChildren(chrome, this.body);

    this.closeButton.addEventListener('click', () => this.onClose?.());
    this.body.addEventListener('click', (e) => this.handleClick(e));
    // `toggle` ne remonte pas : écoute en capture sur le conteneur. L'attribut `open` fait foi.
    this.body.addEventListener('toggle', (e) => {
      const target = e.target;
      if (target instanceof HTMLElement && target.matches('details.fiche-why')) {
        this.onWhyToggle?.(target.dataset.why ?? '', target.hasAttribute('open'));
      }
    }, true);
  }

  setOnSelect(handler: (key: string) => void): void {
    this.onSelect = handler;
  }

  setOnAction(handler: (action: string, ficheKey: string) => void): void {
    this.onAction = handler;
  }

  setOnWhyToggle(handler: (ficheKey: string, open: boolean) => void): void {
    this.onWhyToggle = handler;
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  getBody(): HTMLElement {
    return this.body;
  }

  render(model: FicheModel, lang: Lang, closable: boolean): void {
    this.closeButton.hidden = !closable;
    this.closeButton.setAttribute('aria-label', lang === 'fr' ? 'Fermer la fiche' : 'Close the sheet');
    const html = renderFiche(model, lang);
    if (html === this.lastHtml) return;
    const sameFiche = this.currentKey === model.key;
    const restore = this.focusTarget(sameFiche);
    const scrollTop = this.body.scrollTop;
    this.body.innerHTML = html;
    this.lastHtml = html;
    this.currentKey = model.key;
    // Même fiche mise à jour : garder la position de lecture ; autre fiche : repartir du haut.
    this.body.scrollTop = sameFiche ? scrollTop : 0;
    restore?.()?.focus({ preventScroll: true });
  }

  /** Focus sur le titre de la fiche ; false si la fiche n'est pas affichée (volet fermé, onglet masqué). */
  focusHeading(): boolean {
    const heading = this.body.querySelector<HTMLElement>('.fiche-name');
    if (!heading || !isDisplayed(heading)) return false;
    heading.focus({ preventScroll: true });
    return true;
  }

  focusClose(): void {
    if (!this.closeButton.hidden) this.closeButton.focus({ preventScroll: true });
  }

  private focusTarget(sameFiche: boolean): (() => HTMLElement | null) | null {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !this.body.contains(el)) return null;
    // Fiche différente (ex. citation d'un jugement qui ouvre une autre fiche) : la cible focalisée
    // (même data-select/data-action) n'a aucune raison d'exister dans la nouvelle fiche ; se
    // replier directement sur son titre plutôt que de laisser le focus tomber sur <body>.
    if (!sameFiche) return () => this.body.querySelector<HTMLElement>('.fiche-name');
    if (el.matches('.fiche-why > summary')) return () => this.body.querySelector<HTMLElement>('.fiche-why > summary');
    const select = el.dataset.select;
    if (select !== undefined) return () => findByData(this.body, 'select', select);
    const action = el.dataset.action;
    if (action !== undefined) return () => findByData(this.body, 'action', action);
    return () => this.body.querySelector<HTMLElement>('.fiche-name');
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const select = target.closest<HTMLElement>('[data-select]')?.dataset.select;
    if (select !== undefined) {
      e.preventDefault();
      this.onSelect?.(select);
      return;
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action !== undefined && this.currentKey !== null) this.onAction?.(action, this.currentKey);
  }
}
