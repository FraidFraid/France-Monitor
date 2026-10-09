// src/components/OutagesCloudPanel.ts : panneau de couche « Cloud et hébergement » (spec 2026-10-08 panneaux pannes § 2.4, § 4). Coquille DOM :
// contenu de buildCloudView (pur), cadre commun ; une zone à coordonnées cliquée (ou Entrée) recentre la carte.
import type { CloudState } from '../services/outages-cloud.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { buildCloudView } from './layer-panel/outages-cloud.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';

const PANEL_ID = 'outagesCloud';
/** « lat,lon » : deux nombres décimaux, rien d'autre. */
const COORDS = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

export class OutagesCloudPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusZone?: (lat: number, lon: number) => void;
  private state: CloudState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) { this.container = container; }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'outages-cloud-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => this.onClick(e));
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Zones cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusZone(handler: (lat: number, lon: number) => void): void { this.onFocusZone = handler; }

  show(state: CloudState): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvel état ; un panneau fermé ne se rouvre pas. */
  update(state: CloudState): void {
    this.state = state;
    if (this.isVisible()) this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    // Masquage « silencieux » (bascule entre panneaux) : ne désactive pas la couche.
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean { return this.shell ? isLayerPanelOpen(this.shell.root) : false; }

  destroy(): void {
    this.shell?.destroy();
    this.shell = null;
  }

  private onClick(e: Event): void {
    const raw = (e.target as HTMLElement).closest<HTMLElement>('[data-zone]')?.dataset['zone'];
    const m = raw === undefined ? null : COORDS.exec(raw);
    if (m) this.onFocusZone?.(Number(m[1]), Number(m[2]));
  }

  private render(): void {
    if (!this.shell || !this.state) return;
    const slot = this.state.cloud;
    this.shell.patch(buildCloudView({
      cloud: slot.data, error: slot.error, canFocus: this.onFocusZone !== undefined, now: Date.now(),
      open: sectionOpenOf(loadSectionState(this.storage), PANEL_ID),
    }));
  }
}
