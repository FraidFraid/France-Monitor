// src/components/EnergyPanel.ts : panneau de couche « Réseau électrique » (spec 2026-10-02 § 5).
// Coquille DOM : le contenu vient de buildGridView (pur), le cadre de createLayerPanelShell.
import type { EcowattResponse } from '../types/index.ts';
import type { SpaceWeatherData } from '../services/space-weather.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildGridView } from './layer-panel/grid.ts';

const PANEL_ID = 'powerGrid';

export class EnergyPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private data: EcowattResponse | null = null;
  private space: SpaceWeatherData | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'energy-panel-modal', panelId: PANEL_ID,
      onClose: () => this.hide(), storage: this.storage,
    });
  }

  setOnClose(h: () => void): void { this.onClose = h; }

  show(data: EcowattResponse | null): void {
    this.data = data;
    this.shell?.root.classList.add('is-open');
    this.render();
  }

  updateSpaceWeather(data: SpaceWeatherData): void {
    this.space = data;
    if (this.isVisible()) this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    // Masquage « silencieux » (bascule entre panneaux) : ne désactive pas la couche.
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    if (!this.shell) return false;
    return this.shell.root.classList.contains('is-open');
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildGridView({ data: this.data, space: this.space, now: Date.now(), open }));
  }
}
