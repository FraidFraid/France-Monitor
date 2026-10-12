// src/components/DisastersPanel.ts : panneau de couche « Catastrophes (GDACS) » (spec 2026-10-12 GDACS). Coquille DOM : contenu de
// buildCatastrophesView (pur), cadre de createLayerPanelShell ; une alerte cliquée (ou Entrée) est recentrée.
import type { DisasterAlert } from '../types/index.ts';
import type { DisastersState } from '../services/environment-disasters.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildCatastrophesView } from './layer-panel/catastrophes.ts';

const PANEL_ID = 'disasters';

export class DisastersPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusAlert?: (alert: DisasterAlert) => void;
  private state: DisastersState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'disasters-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-disaster]')?.dataset['disaster'];
      const alert = id ? this.state?.disasters.data?.alerts.find((a) => a.id === id) : undefined;
      if (alert) this.onFocusAlert?.(alert);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusAlert(handler: (alert: DisasterAlert) => void): void { this.onFocusAlert = handler; }

  show(state: DisastersState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  update(state: DisastersState | null): void {
    if (state) this.state = state;
    if (this.isVisible()) this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    return this.shell ? isLayerPanelOpen(this.shell.root) : false;
  }

  destroy(): void {
    this.shell?.destroy();
    this.shell = null;
  }

  private render(): void {
    if (!this.shell) return;
    const s = this.state;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildCatastrophesView({
      disasters: s?.disasters.data ?? null, disastersError: s?.disasters.error ?? null,
      ems: s ? s.ems.data : null, emsError: s?.ems.error ?? null,
      canFocus: this.onFocusAlert !== undefined, now: Date.now(), open,
    }));
  }
}
