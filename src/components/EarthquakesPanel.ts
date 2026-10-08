// src/components/EarthquakesPanel.ts : panneau de couche « Séismes » (spec 2026-10-04 environnement § 3.3). Coquille DOM : contenu de
// buildSeismesView (pur), cadre de createLayerPanelShell ; un séisme cliqué (ou Entrée) est recentré sur son épicentre.
import type { Quake } from '../types/index.ts';
import type { EarthquakesState } from '../services/environment-earthquakes.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildSeismesView } from './layer-panel/seismes.ts';

const PANEL_ID = 'earthquakes';

export class EarthquakesPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusQuake?: (quake: Quake) => void;
  private state: EarthquakesState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'quakes-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-quake]')?.dataset['quake'];
      const quake = id ? this.state?.quakes.data?.quakes.find((q) => q.id === id) : undefined;
      if (quake) this.onFocusQuake?.(quake);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusQuake(handler: (quake: Quake) => void): void { this.onFocusQuake = handler; }

  show(state: EarthquakesState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  update(state: EarthquakesState | null): void {
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
    const s = this.state;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildSeismesView({
      quakes: s?.quakes.data ?? null, quakesError: s?.quakes.error ?? null, canFocus: this.onFocusQuake !== undefined, now: Date.now(), open,
    }));
  }
}
