// src/components/OutagesTelecomPanel.ts : panneau de couche « Télécoms mobiles » (spec 2026-10-08 panneaux pannes § 2.1, § 4). Coquille DOM :
// contenu de buildTelecomView (pur), cadre commun ; une ligne de site ou de département cliquée (ou Entrée) recentre la carte ;
// « Afficher 20 de plus » étend la liste ; l'option des maintenances bascule leur couche sur la carte.
import type { TelecomState } from '../services/outages-telecom.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { buildTelecomView, TELECOM_PAGE } from './layer-panel/outages-telecom.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';

const PANEL_ID = 'outagesTelecom';

export class OutagesTelecomPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusSite?: (lat: number, lon: number) => void;
  private onFocusDept?: (dept: string) => void;
  private onToggleMaintenance?: (on: boolean) => void;
  private maintenanceOn = false;
  private shown = TELECOM_PAGE;
  private state: TelecomState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) { this.container = container; }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'outages-telecom-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => this.onClick(e));
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes cliquables seulement avec ces gestionnaires (carte WebGL, posés par App.ts). */
  setOnFocusSite(handler: (lat: number, lon: number) => void): void { this.onFocusSite = handler; }
  setOnFocusDept(handler: (dept: string) => void): void { this.onFocusDept = handler; }
  /** Option « maintenances sur la carte » : bascule de la couche des maintenances, d'après l'état mémorisé du panneau. */
  setOnToggleMaintenance(handler: (on: boolean) => void): void { this.onToggleMaintenance = handler; }

  show(state: TelecomState): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvel état ; un panneau fermé ne se rouvre pas. */
  update(state: TelecomState): void {
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
    const site = target.closest<HTMLElement>('[data-site]')?.dataset['site'];
    if (site) {
      const s = this.state?.telecom.data?.sites.find((x) => x.id === site);
      if (s) this.onFocusSite?.(s.lat, s.lon);
      return;
    }
    const dept = target.closest<HTMLElement>('[data-dept]')?.dataset['dept'];
    if (dept) { this.onFocusDept?.(dept); return; }
    if (target.closest('[data-more="recentes"]')) { this.shown += TELECOM_PAGE; this.render(); return; }
    if (target.closest('[data-option="maintenances"]')) {
      this.maintenanceOn = !this.maintenanceOn;
      this.onToggleMaintenance?.(this.maintenanceOn);
    }
  }

  private render(): void {
    if (!this.shell || !this.state) return;
    const slot = this.state.telecom;
    this.shell.patch(buildTelecomView({
      telecom: slot.data, error: slot.error, canFocus: this.onFocusSite !== undefined, now: Date.now(),
      open: sectionOpenOf(loadSectionState(this.storage), PANEL_ID), shown: this.shown,
    }));
  }
}
