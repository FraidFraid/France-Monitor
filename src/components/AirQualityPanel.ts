// src/components/AirQualityPanel.ts : panneau de couche « Qualité de l'air » (spec 2026-10-04 environnement § 3.2). Coquille DOM :
// contenu de buildQualiteAirView (pur), cadre de createLayerPanelShell.
import type { AirQualityState } from '../services/environment-air.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildQualiteAirView } from './layer-panel/qualite-air.ts';

const PANEL_ID = 'airQuality';

export class AirQualityPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private state: AirQualityState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'air-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }

  show(state: AirQualityState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  update(state: AirQualityState | null): void {
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
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildQualiteAirView({ air: this.state?.air.data ?? null, airError: this.state?.air.error ?? null, now: Date.now(), open }));
  }
}
