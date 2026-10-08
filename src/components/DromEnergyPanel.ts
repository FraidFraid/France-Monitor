// src/components/DromEnergyPanel.ts : panneau de couche « Énergie DROM » (spec 2026-10-02 lot 2 § 3.6).
// Coquille DOM : contenu de buildDromView (pur), cadre de createLayerPanelShell ; territoire mémorisé
// comme un onglet, filtre de type des infrastructures, survol des actifs relayé à la carte.
import type { DromLiveCode, DromLiveResponse } from '../types/index.ts';
import type { DromEnergyAsset, DromEnergyDashboard } from '../services/drom-energy/index.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import {
  createLayerPanelShell, isLayerPanelOpen, loadLayerTab, safeStorage, saveLayerTab, sectionOpenOf, type LayerPanelShell,
} from './layer-panel/frame.ts';
import { buildDromView, DROM_TABS } from './layer-panel/drom.ts';

const PANEL_ID = 'dromEnergy';

export class DromEnergyPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onHoverAsset?: (asset: DromEnergyAsset | null) => void;
  private dashboard: DromEnergyDashboard | null = null;
  private dashboardError: string | null = null;
  private live: DromLiveResponse | null = null;
  private liveError: string | null = null;
  private assetType = 'all';
  private hovered: string | null = null;
  private territory: DromLiveCode;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.territory = loadLayerTab(this.storage, PANEL_ID, DROM_TABS) as DromLiveCode;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'drom-energy-panel-modal', panelId: PANEL_ID, storage: this.storage,
      onClose: () => this.hide(),
      onTab: (id) => {
        if (!(DROM_TABS as readonly string[]).includes(id)) return;
        this.territory = id as DromLiveCode;
        this.assetType = 'all';
        saveLayerTab(this.storage, PANEL_ID, id);
        this.emitHover(null);
        this.render();
      },
    });
    shell.root.addEventListener('change', (e) => {
      const select = e.target;
      if (!(select instanceof HTMLSelectElement) || !select.matches('[data-drom-filter="type"]')) return;
      this.assetType = select.value;
      this.emitHover(null);
      this.render();
    });
    shell.root.addEventListener('mouseover', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-drom-asset]')?.dataset['dromAsset'] ?? null;
      this.emitHover(id);
    });
    shell.root.addEventListener('mouseleave', () => this.emitHover(null));
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  setOnHoverAsset(handler: (asset: DromEnergyAsset | null) => void): void { this.onHoverAsset = handler; }

  show(dashboard: DromEnergyDashboard | null): void {
    if (dashboard) {
      this.dashboard = dashboard;
      this.dashboardError = null;
    }
    this.open();
  }

  showLoadingState(): void {
    this.dashboardError = null;
    this.open();
  }

  showErrorState(message: string): void {
    this.dashboardError = message;
    this.open();
  }

  /** Production en temps réel ; en erreur, les dernières données restent affichées avec un encadré. */
  setLive(live: DromLiveResponse | null, error: string | null = null): void {
    if (live) this.live = live;
    this.liveError = error;
    if (this.isVisible()) this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    this.emitHover(null);
    // Masquage « silencieux » (bascule entre panneaux) : ne désactive pas la couche.
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    return this.shell ? isLayerPanelOpen(this.shell.root) : false;
  }

  private open(): void {
    this.shell?.root.classList.add('is-open');
    this.render();
  }

  private emitHover(assetId: string | null): void {
    if (this.hovered === assetId) return;
    this.hovered = assetId;
    const asset = assetId ? this.dashboard?.assets.find((a) => a.id === assetId) ?? null : null;
    this.onHoverAsset?.(asset);
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildDromView({
      live: this.live, liveError: this.liveError, dashboard: this.dashboard, dashboardError: this.dashboardError,
      territory: this.territory, assetType: this.assetType, now: Date.now(), open,
    }));
  }
}
