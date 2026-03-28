/**
 * RightSidebar.ts — Orchestrateur de la colonne droite.
 * Monte et gère les panels contextuels de la colonne droite.
 * Montage dans App.ts sur l'élément .right-sidebar.
 */
import { type EventCategory } from '../types/index.ts';
import { MinistresPanel } from './MinistresPanel.ts';

export class RightSidebar {
  private contentEl!: HTMLElement;
  private ministresPanel: MinistresPanel | null = null;
  private onToggleCb: ((isOpen: boolean) => void) | null = null;
  private open = false;
  private readonly rootEl: HTMLElement;

  constructor(rootEl: HTMLElement) {
    this.rootEl = rootEl;
  }

  mount(): void {
    this.rootEl.classList.add('right-sidebar');
    this.rootEl.setAttribute('aria-hidden', 'true');

    const toolbarEl = document.createElement('div');
    toolbarEl.className = 'right-sidebar-toolbar';

    const titleEl = document.createElement('div');
    titleEl.className = 'right-sidebar-toolbar__title';
    titleEl.textContent = 'Gouvernement';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'right-sidebar-toolbar__close';
    closeBtn.setAttribute('aria-label', 'Fermer le panneau gouvernement');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());

    toolbarEl.appendChild(titleEl);
    toolbarEl.appendChild(closeBtn);

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'right-sidebar-content';
    this.rootEl.appendChild(toolbarEl);
    this.rootEl.appendChild(this.contentEl);

    this.ministresPanel = new MinistresPanel(this.contentEl);
    this.ministresPanel.mount();
  }

  getContentEl(): HTMLElement {
    return this.contentEl;
  }

  setGovernmentContext(categories: EventCategory[]): void {
    this.ministresPanel?.setContext(categories);
  }

  setOnToggle(handler: (isOpen: boolean) => void): void {
    this.onToggleCb = handler;
  }

  isOpen(): boolean {
    return this.open;
  }

  openPanel(): void {
    if (this.open) return;
    this.open = true;
    this.rootEl.classList.add('open');
    this.rootEl.setAttribute('aria-hidden', 'false');
    this.ministresPanel?.activateLiveData();
    this.onToggleCb?.(true);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.rootEl.classList.remove('open');
    this.rootEl.setAttribute('aria-hidden', 'true');
    this.onToggleCb?.(false);
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openPanel();
  }

  showPlaceholder(): void {
    if (this.contentEl.children.length > 0) return;
    const ph = document.createElement('div');
    ph.className = 'right-sidebar-placeholder';
    ph.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 16px;gap:16px;text-align:center;color:var(--text-muted);';
    ph.innerHTML = `
      <div style="font-size:40px;opacity:0.3;">🔍</div>
      <div style="font-size:12px;line-height:1.7;">
        Cliquez sur la carte<br>ou activez un layer<br>pour afficher les données OSINT
      </div>`;
    this.contentEl.appendChild(ph);
  }

  clearPlaceholder(): void {
    const ph = this.contentEl.querySelector('.right-sidebar-placeholder');
    if (ph) ph.remove();
  }

  destroy(): void {
    this.onToggleCb = null;
    this.open = false;
    this.ministresPanel = null;
    this.contentEl.innerHTML = '';
  }
}
