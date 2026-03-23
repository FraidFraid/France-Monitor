/**
 * Panel.ts — Base class pour tous les panneaux sidebar.
 * Pattern WorldMonitor : chaque panneau a un header cliquable (collapse),
 * un badge de compteur, et un body collapsable.
 */

export interface PanelOptions {
  title: string;
  icon?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export abstract class Panel {
  protected container: HTMLElement;
  protected bodyEl: HTMLElement | null = null;
  protected badgeEl: HTMLElement | null = null;
  protected collapsed: boolean;
  protected options: PanelOptions;

  constructor(container: HTMLElement, options: PanelOptions) {
    this.container = container;
    this.options = options;
    this.collapsed = options.defaultCollapsed ?? false;
  }

  /** Build the panel DOM and mount it into container */
  mount(): void {
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('data-panel', this.options.title);

    // Header
    const header = document.createElement('div');
    header.className = 'panel-header';
    if (this.options.collapsible !== false) {
      header.addEventListener('click', () => this.toggleCollapse());
    }

    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

    if (this.options.icon) {
      const icon = document.createElement('span');
      icon.textContent = this.options.icon;
      icon.style.fontSize = '14px';
      titleRow.appendChild(icon);
    }

    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = this.options.title;
    titleRow.appendChild(title);

    this.badgeEl = document.createElement('span');
    this.badgeEl.className = 'panel-badge';
    this.badgeEl.textContent = '0';

    const chevron = document.createElement('span');
    chevron.className = 'panel-chevron';
    chevron.textContent = '›';
    chevron.style.cssText =
      'color:var(--text-muted);font-size:16px;transition:transform 200ms ease;margin-left:auto;';

    header.appendChild(titleRow);
    header.appendChild(this.badgeEl);
    if (this.options.collapsible !== false) {
      header.appendChild(chevron);
    }
    panel.appendChild(header);

    // Body
    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'panel-body';
    this.bodyEl.style.padding = '0';

    if (this.collapsed) {
      this.bodyEl.style.display = 'none';
      chevron.style.transform = 'rotate(90deg)';
    } else {
      chevron.style.transform = 'rotate(-90deg)';
    }

    panel.appendChild(this.bodyEl);
    this.container.appendChild(panel);

    // Store ref to chevron for toggle
    header.dataset.chevronEl = '';
    this._chevronEl = chevron;

    // Let subclass render its content
    this.render();
  }

  private _chevronEl: HTMLElement | null = null;

  protected toggleCollapse(): void {
    if (!this.bodyEl) return;
    this.collapsed = !this.collapsed;
    this.bodyEl.style.display = this.collapsed ? 'none' : 'block';
    if (this._chevronEl) {
      this._chevronEl.style.transform = this.collapsed
        ? 'rotate(90deg)'
        : 'rotate(-90deg)';
    }
  }

  /** Update badge count — optionally apply alert styling */
  protected setBadge(count: number, alert?: boolean): void {
    if (!this.badgeEl) return;
    this.badgeEl.textContent = String(count);
    if (alert) {
      this.badgeEl.style.background = 'rgba(255,45,85,0.2)';
      this.badgeEl.style.color = 'var(--threat-critical)';
    } else {
      this.badgeEl.style.background = '';
      this.badgeEl.style.color = '';
    }
  }

  /** Subclasses implement this to render content into this.bodyEl */
  protected abstract render(): void;

  /** Subclasses call this to re-render content */
  protected clearBody(): void {
    if (this.bodyEl) this.bodyEl.innerHTML = '';
  }
}
