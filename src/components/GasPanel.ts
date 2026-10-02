// src/components/GasPanel.ts : panneau de couche « Réseau gaz » (spec 2026-10-02 lot 2 § 3.1).
// Coquille DOM : contenu de buildGasView (pur), cadre de createLayerPanelShell.
import type { BiogasState, GasNetworkState } from '../types/index.ts';
import { isGasPanelEnabled } from '../services/gas.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildGasView } from './layer-panel/gas.ts';

const PANEL_ID = 'gasNetwork';

export class GasPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private data: GasNetworkState | null = null;
  private biogas: BiogasState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;
  private readonly isEnabled: () => boolean;

  constructor(container: HTMLElement, opts: { isEnabled?: () => boolean } = {}) {
    this.container = container;
    this.isEnabled = opts.isEnabled ?? isGasPanelEnabled;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'gas-panel-modal', panelId: PANEL_ID,
      onClose: () => this.hide(), storage: this.storage,
    });
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }

  show(data: GasNetworkState | null, biogasState?: BiogasState | null): void {
    this.data = data;
    if (biogasState !== undefined) this.biogas = biogasState;
    this.shell?.root.classList.add('is-open');
    this.render();
  }

  update(data: GasNetworkState, biogasState?: BiogasState | null): void {
    this.data = data;
    if (biogasState !== undefined) this.biogas = biogasState;
    if (this.isVisible()) this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    // Masquage « silencieux » (bascule entre panneaux) : ne désactive pas la couche.
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    return this.shell ? isLayerPanelOpen(this.shell.root) : false;
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildGasView({ data: this.data, biogas: this.biogas, enabled: this.isEnabled(), now: Date.now(), open }));
  }
}
