// src/components/DroughtPanel.ts : panneau de couche « Sécheresse » (spec 2026-10-04 environnement § 3.1). Coquille DOM : contenu de
// buildSecheresseView (pur), cadre de createLayerPanelShell ; un département cliqué (ou Entrée) est recentré sur la carte.
import type { DroughtState } from '../services/environment-drought.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildSecheresseView } from './layer-panel/secheresse.ts';

const PANEL_ID = 'drought';

export class DroughtPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusDepartment?: (code: string) => void;
  private state: DroughtState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'drought-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    // Entrée sur une ligne cliquable : le cadre la transforme en clic (createLayerPanelShell).
    shell.root.addEventListener('click', (e) => {
      const code = (e.target as HTMLElement).closest<HTMLElement>('[data-dept]')?.dataset['dept'];
      if (code) this.onFocusDepartment?.(code);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusDepartment(handler: (code: string) => void): void { this.onFocusDepartment = handler; }

  show(state: DroughtState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvelles données : un panneau fermé ne se rouvre pas ; sections ouvertes gardées. */
  update(state: DroughtState | null): void {
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
    this.shell.render(buildSecheresseView({
      drought: s?.drought.data ?? null, droughtError: s?.drought.error ?? null, canFocus: this.onFocusDepartment !== undefined, now: Date.now(), open,
    }));
  }
}
