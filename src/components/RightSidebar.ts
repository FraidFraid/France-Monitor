/**
 * RightSidebar.ts — Orchestrateur de la colonne droite.
 * Monte et gère les panels OSINT (Élus, Ministres, Maritime).
 * Montage dans App.ts sur l'élément .right-sidebar.
 */
export class RightSidebar {
  private contentEl!: HTMLElement;
  private readonly rootEl: HTMLElement;

  constructor(rootEl: HTMLElement) {
    this.rootEl = rootEl;
  }

  mount(): void {
    this.rootEl.classList.add('right-sidebar');
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'right-sidebar-content';
    this.rootEl.appendChild(this.contentEl);
    this.showPlaceholder();
  }

  getContentEl(): HTMLElement {
    return this.contentEl;
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
    this.contentEl.innerHTML = '';
  }
}
