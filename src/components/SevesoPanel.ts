// src/components/SevesoPanel.ts : panneau « Sites Seveso » de l'onglet Environnement (20/10/2026). Coquille DOM : contenu de
// buildSevesoView (pur), cadre de createLayerPanelShell. Clic sur un site exposé : la carte le cadre.
import type { Exposure } from '../services/environment-exposure.ts';
import type { SevesoDataset } from '../services/exposure-assets.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildSevesoView } from './layer-panel/seveso.ts';

const PANEL_ID = 'seveso';

export class SevesoPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusPoint?: (lon: number, lat: number) => void;
  private data: SevesoDataset | null = null;
  private error: string | null = null;
  private exposed: readonly Exposure[] | null = null;
  private clickCleanup: (() => void) | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'seveso-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    const root = this.shell.root;
    const onClick = (e: Event): void => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.lp-row.is-link');
      const lon = Number(row?.dataset['lon']);
      const lat = Number(row?.dataset['lat']);
      if (row && Number.isFinite(lon) && Number.isFinite(lat)) this.onFocusPoint?.(lon, lat);
    };
    root.addEventListener('click', onClick);
    this.clickCleanup = () => root.removeEventListener('click', onClick);
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  setOnFocusPoint(handler: (lon: number, lat: number) => void): void { this.onFocusPoint = handler; }

  show(): void {
    this.shell?.root.classList.add('is-open');
    this.render();
  }

  update(data: SevesoDataset | null, error: string | null, exposed: readonly Exposure[] | null): void {
    if (data) this.data = data;
    this.error = error;
    this.exposed = exposed;
    this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    return this.shell ? isLayerPanelOpen(this.shell.root) : false;
  }

  destroy(): void {
    this.clickCleanup?.();
    this.clickCleanup = null;
    this.shell?.destroy();
    this.shell = null;
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildSevesoView({
      data: this.data, error: this.error, exposed: this.exposed, canFocus: this.onFocusPoint !== undefined, now: Date.now(), open,
    }));
  }
}
