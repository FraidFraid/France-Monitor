// src/components/OutagesInternetPanel.ts : panneau de couche « Internet » (spec 2026-10-08 panneaux pannes § 2.3, § 4). Coquille DOM :
// contenu de buildInternetView (pur), cadre commun ; une ligne de département cliquée (ou Entrée) recentre la carte ; le bouton de rappel
// RIPEstat ouvre le panneau Connectivité.
import type { InternetState } from '../services/outages-internet.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { buildInternetView } from './layer-panel/outages-internet.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';

const PANEL_ID = 'outagesInternet';

export class OutagesInternetPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusDept?: (dept: string) => void;
  private onOpenConnectivity?: () => void;
  private state: InternetState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) { this.container = container; }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'outages-internet-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => this.onClick(e));
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes de département cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusDept(handler: (dept: string) => void): void { this.onFocusDept = handler; }
  /** Bouton « Voir le panneau Connectivité » : affiché seulement avec ce gestionnaire. */
  setOnOpenConnectivity(handler: () => void): void { this.onOpenConnectivity = handler; }

  show(state: InternetState): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvel état ; un panneau fermé ne se rouvre pas. */
  update(state: InternetState): void {
    this.state = state;
    if (this.isVisible()) this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    // Masquage « silencieux » (bascule entre panneaux) : ne désactive pas la couche.
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean { return this.shell ? isLayerPanelOpen(this.shell.root) : false; }

  destroy(): void {
    this.shell?.destroy();
    this.shell = null;
  }

  private onClick(e: Event): void {
    const target = e.target as HTMLElement;
    const dept = target.closest<HTMLElement>('[data-dept]')?.dataset['dept'];
    if (dept) { this.onFocusDept?.(dept); return; }
    if (target.closest('[data-open-connectivity]')) this.onOpenConnectivity?.();
  }

  private render(): void {
    if (!this.shell || !this.state) return;
    const slot = this.state.internet;
    this.shell.patch(buildInternetView({
      internet: slot.data, error: slot.error, canFocus: this.onFocusDept !== undefined && this.onOpenConnectivity !== undefined, now: Date.now(),
      open: sectionOpenOf(loadSectionState(this.storage), PANEL_ID),
    }));
  }
}
