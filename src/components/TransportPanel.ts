// src/components/TransportPanel.ts : panneau de couche « Réseau ferroviaire » (spec 2026-10-03 trafics § 3.3).
// Coquille DOM : contenu de buildRailView (pur), cadre de createLayerPanelShell ; filtre « axe ou région » et pages de « Trains un
// par un » gardés pour la session ; un train survolé est prévisualisé sur la carte (son trajet, effacé quand la souris quitte la
// ligne), un train cliqué (ou Entrée) y est transmis (trajet surligné et carte centrée).
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
  private onPreviewTrain?: (train: RailTrain | null) => void;
  private previewedId: string | null = null;
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
      const train = id ? this.findTrain(id) : undefined;
      if (train) this.onSelectTrain?.(train);
    });
    // Survol d'une ligne de train : son trajet prévisualisé sur la carte ; hors d'une ligne ou hors du panneau : prévisualisation effacée.
    shell.root.addEventListener('mouseover', (e) => {
      this.preview((e.target as HTMLElement).closest<HTMLElement>('[data-rail-train]')?.dataset['railTrain'] ?? null);
    });
    shell.root.addEventListener('mouseleave', () => this.preview(null));
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
  /** Survol d'un train : trajet prévisualisé sur la carte, null à la sortie (carte WebGL, posé par App.ts). */
  setOnPreviewTrain(handler: (train: RailTrain | null) => void): void { this.onPreviewTrain = handler; }

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
    this.preview(null);
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

  private findTrain(id: string): RailTrain | undefined {
    const o = this.state?.overview.data;
    return o ? [...o.trains, ...o.topDelays].find((t) => t.id === id) : undefined;
  }

  /** Prévisualisation sur la carte : appelée seulement quand le train survolé change (null : aucun). */
  private preview(id: string | null): void {
    if (id === this.previewedId) return;
    this.previewedId = id;
    this.onPreviewTrain?.(id !== null ? this.findTrain(id) ?? null : null);
  }

  private render(): void {
    if (!this.shell) return;
    const s = this.state;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    // Mise à jour sans reconstruire les nœuds inchangés (comme le panneau maritime) : le menu « axe ou région » ouvert, le focus et
    // le défilement restent à la relève de 5 min.
    this.shell.patch(buildRailView({
      overview: s?.overview.data ?? null, overviewError: s?.overview.error ?? null,
      situations: s?.situations.data ?? null, situationsError: s?.situations.error ?? null,
      filter: this.filter, pages: this.pages, canFocus: this.onSelectTrain !== undefined, now: Date.now(), open,
    }));
  }
}
