// src/components/WebcamsPanel.ts : panneau de couche « Webcams ». Coquille DOM : contenu de buildWebcamsView (pur), cadre de
// createLayerPanelShell. La webcam cliquée sur la carte est affichée en fiche. Recensement statique : aucune relève.
import type { WebcamsDataset } from '../types/index.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildWebcamsView } from './layer-panel/webcams.ts';

const PANEL_ID = 'webcams';

export class WebcamsPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private data: WebcamsDataset | null = null;
  private error: string | null = null;
  private selectedId: string | null = null;
  private wallIds: readonly string[] | undefined;
  private onWallOpen?: () => void;
  private onWallToggle?: (id: string) => void;
  private clickCleanup: (() => void) | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'webcams-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    // Boutons du mur de webcams (le cadre commun ne gère que la fermeture et les onglets).
    const root = this.shell.root;
    const onClick = (e: Event): void => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-wall-open]')) { this.onWallOpen?.(); return; }
      const id = t.closest<HTMLElement>('[data-wall-toggle]')?.dataset['wallToggle'];
      if (id) this.onWallToggle?.(id);
    };
    root.addEventListener('click', onClick);
    this.clickCleanup = () => root.removeEventListener('click', onClick);
  }

  /** Mur de webcams : ouverture et épinglage depuis la fiche. */
  setWallHandlers(onOpen: () => void, onToggle: (id: string) => void): void {
    this.onWallOpen = onOpen;
    this.onWallToggle = onToggle;
  }

  /** Webcams du mur : boutons « Ajouter au mur » / « Retirer du mur » et compte du mur à jour. */
  setWallIds(ids: readonly string[]): void {
    this.wallIds = ids;
    if (this.isVisible()) this.render();
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }

  /** Point cliqué sur la carte : fiche de la webcam en tête du panneau. */
  select(id: string): void {
    this.selectedId = id;
    if (this.isVisible()) this.render();
    this.shell?.root.querySelector<HTMLElement>('.wc-name')?.scrollIntoView({ block: 'nearest' });
  }

  show(data: WebcamsDataset | null, error: string | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(data, error);
  }

  update(data: WebcamsDataset | null, error: string | null): void {
    if (data) this.data = data;
    this.error = error;
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
    this.clickCleanup?.();
    this.clickCleanup = null;
    this.shell?.destroy();
    this.shell = null;
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildWebcamsView({ data: this.data, error: this.error, selectedId: this.selectedId, open, wallIds: this.wallIds }));
  }
}
