// src/components/EolienPanel.ts : panneau de couche « Éolien » (spec 2026-10-02 lot 2 § 3.4).
// Coquille DOM : contenu de buildWindView (pur), cadre de createLayerPanelShell.
import type { GridSnapshot } from '../types/index.ts';
import type { EolienLive, EolienParkSummary } from '../services/eolien/types.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildWindView } from './layer-panel/wind.ts';

const PANEL_ID = 'windMonitor';

export class EolienPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onSelectPark?: (park: EolienParkSummary) => void;
  private live: EolienLive | null = null;
  private parks: EolienParkSummary[] = [];
  private grid: GridSnapshot | null = null;
  private error: string | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'eolien-panel-modal', panelId: PANEL_ID,
      onClose: () => this.hide(), storage: this.storage,
    });
    shell.root.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-eolien-park]')?.dataset['eolienPark'];
      const park = id ? this.parks.find((p) => p.id === id) : undefined;
      if (park) this.onSelectPark?.(park);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  setOnSelectPark(handler: (park: EolienParkSummary) => void): void { this.onSelectPark = handler; }

  setGrid(grid: GridSnapshot | null): void {
    this.grid = grid;
    if (this.isVisible()) this.render();
  }

  show(live: EolienLive | null, parks: EolienParkSummary[]): void {
    this.shell?.root.classList.add('is-open');
    this.update(live, parks);
  }

  update(live: EolienLive | null, parks: EolienParkSummary[]): void {
    this.live = live;
    this.parks = parks;
    if (live) this.error = null;
    if (this.isVisible()) this.render();
  }

  showErrorState(message: string): void {
    this.error = message;
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
    this.shell.render(buildWindView({ live: this.live, parks: this.parks, grid: this.grid, error: this.error, now: Date.now(), open }));
  }
}
