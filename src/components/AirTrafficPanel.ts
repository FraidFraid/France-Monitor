// src/components/AirTrafficPanel.ts : panneau de couche « Trafic aérien » (spec 2026-10-03 trafics § 3.2), nouveau panneau.
// Coquille DOM : contenu de buildAerienView (pur), cadre de createLayerPanelShell. La carte garde ses positions (12 s) ; le panneau
// lit l'aperçu du serveur (2 min).
import type { AirOverviewState } from '../services/traffic-air.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildAerienView } from './layer-panel/aerien.ts';

const PANEL_ID = 'trafficAir';

export class AirTrafficPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private state: AirOverviewState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'air-traffic-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }

  show(state: AirOverviewState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  update(state: AirOverviewState | null): void {
    if (state) this.state = state;
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
    this.shell.render(buildAerienView({
      overview: this.state?.overview.data ?? null, error: this.state?.overview.error ?? null, now: Date.now(), open,
    }));
  }
}
