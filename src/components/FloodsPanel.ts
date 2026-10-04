// src/components/FloodsPanel.ts : panneau de couche « Crues » (spec 2026-10-04 environnement § 2.2), séparé de la vigilance météo.
// Coquille DOM : contenu de buildCruesView (pur), cadre de createLayerPanelShell ; un tronçon ou une station cliqués (ou Entrée) sont
// recentrés sur la carte. Plus de « tracé recalé, confiance 100 % » : le tracé est celui publié par Vigicrues.
import type { FloodsState } from '../services/environment-floods.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { buildCruesView } from './layer-panel/crues.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';

const PANEL_ID = 'floods';

export class FloodsPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusSection?: (id: string) => void;
  private onFocusStation?: (code: string) => void;
  private state: FloodsState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'floods-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const station = target.closest<HTMLElement>('[data-station]')?.dataset['station'];
      if (station) { this.onFocusStation?.(station); return; }
      const section = target.closest<HTMLElement>('[data-section]')?.dataset['section'];
      // Les sections du cadre portent aussi data-section (« layer:floods:… », sur <details>) : seules les lignes de tronçon comptent.
      if (section && !section.startsWith('layer:')) this.onFocusSection?.(section);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes de tronçon cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusSection(handler: (id: string) => void): void { this.onFocusSection = handler; }
  setOnFocusStation(handler: (code: string) => void): void { this.onFocusStation = handler; }

  show(state: FloodsState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  update(state: FloodsState | null): void {
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
    const slot = this.state?.floods ?? null;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildCruesView({
      floods: slot?.data ?? null, floodsError: slot?.error ?? null, canFocus: this.onFocusSection !== undefined, now: Date.now(), open,
    }));
  }
}
