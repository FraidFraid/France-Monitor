// src/components/HydraulicPanel.ts : panneau de couche « Stress hydro » (spec 2026-10-02 lot 2 § 3.2).
// Coquille DOM : contenu de buildHydroView (pur), cadre de createLayerPanelShell.
import type { EcowattResponse, HydraulicBackboneAsset } from '../types/index.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildHydroView } from './layer-panel/hydro.ts';

const PANEL_ID = 'hydroBackbone';

export class HydraulicPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onSelectAsset?: (asset: HydraulicBackboneAsset) => void;
  private assets: HydraulicBackboneAsset[] = [];
  private ecowatt: EcowattResponse | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'hydraulic-panel-modal', panelId: PANEL_ID,
      onClose: () => this.hide(), storage: this.storage,
    });
    shell.root.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-hydraulic-asset]')?.dataset['hydraulicAsset'];
      const asset = id ? this.assets.find((a) => a.id === id) : undefined;
      if (asset) this.onSelectAsset?.(asset);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  setOnSelectAsset(handler: (asset: HydraulicBackboneAsset) => void): void { this.onSelectAsset = handler; }

  show(assets: HydraulicBackboneAsset[], ecowatt: EcowattResponse | null = null): void {
    this.assets = assets;
    this.ecowatt = ecowatt;
    this.shell?.root.classList.add('is-open');
    this.render();
  }

  update(assets: HydraulicBackboneAsset[], ecowatt: EcowattResponse | null = this.ecowatt): void {
    this.assets = assets;
    this.ecowatt = ecowatt;
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
    this.shell.render(buildHydroView({ assets: this.assets, ecowatt: this.ecowatt, now: Date.now(), open }));
  }
}
