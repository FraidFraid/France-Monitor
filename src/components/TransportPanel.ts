// src/components/TransportPanel.ts : panneau de couche « Réseau ferroviaire » (spec 2026-10-03 trafics § 3.3).
// Coquille DOM : contenu de buildRailView (pur), cadre de createLayerPanelShell ; filtre « axe ou région » et pages de « Trains un
// par un » gardés pour la session ; un train cliqué (ou Entrée) est transmis à la carte (trajet surligné).
import type { RailTrain } from '../types/index.ts';
import type { RailTrafficState } from '../services/traffic-rail.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildRailView } from './layer-panel/rail.ts';

const PANEL_ID = 'trafficRail';

export class TransportPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onSelectTrain?: (train: RailTrain) => void;
  private state: RailTrafficState | null = null;
  private filter = 'all';
  private pages = 1;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'transport-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-rail-more]')) {
        this.pages += 1;
        this.render();
        return;
      }
      const id = target.closest<HTMLElement>('[data-rail-train]')?.dataset['railTrain'];
      const o = this.state?.overview.data;
      const train = id && o ? [...o.trains, ...o.topDelays].find((t) => t.id === id) : undefined;
      if (train) this.onSelectTrain?.(train);
    });
    shell.root.addEventListener('change', (e) => {
      const select = e.target;
      if (!(select instanceof HTMLSelectElement) || !select.matches('[data-rail-filter]')) return;
      this.filter = select.value;
      this.pages = 1;
      this.render();
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes de trains cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnSelectTrain(handler: (train: RailTrain) => void): void { this.onSelectTrain = handler; }

  show(state: RailTrafficState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  update(state: RailTrafficState | null): void {
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
    const s = this.state;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildRailView({
      overview: s?.overview.data ?? null, overviewError: s?.overview.error ?? null,
      situations: s?.situations.data ?? null, situationsError: s?.situations.error ?? null,
      filter: this.filter, pages: this.pages, canFocus: this.onSelectTrain !== undefined, now: Date.now(), open,
    }));
  }
}
