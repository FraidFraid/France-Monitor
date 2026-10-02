// src/components/MetroLoadPanel.ts : panneau de couche « Charge métropolitaine » (spec 2026-10-02 lot 2 § 3.5).
// Coquille DOM : contenu de buildMetroView (pur), cadre de createLayerPanelShell.
import type { MetropoleConsumption } from '../services/metropoles.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildMetroView } from './layer-panel/metro.ts';

const PANEL_ID = 'metroLoad';

export class MetroLoadPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private metros: MetropoleConsumption[] | null = null;
  private nationalMw: number | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'metro-load-panel-modal', panelId: PANEL_ID,
      onClose: () => this.hide(), storage: this.storage,
    });
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }

  show(metros: MetropoleConsumption[] | null, nationalMw: number | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(metros, nationalMw);
  }

  update(metros: MetropoleConsumption[] | null, nationalMw: number | null): void {
    this.metros = metros;
    this.nationalMw = nationalMw;
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

  destroy(): void {
    this.shell?.destroy();
    this.shell = null;
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildMetroView({ metros: this.metros, nationalMw: this.nationalMw, now: Date.now(), open }));
  }
}
