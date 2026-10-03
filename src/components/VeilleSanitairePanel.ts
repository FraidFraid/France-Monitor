// src/components/VeilleSanitairePanel.ts : panneau de couche « Veille sanitaire » (spec 2026-10-03 § 3.1).
// Coquille DOM : contenu de buildVeilleView (pur), cadre de createLayerPanelShell ; onglet mémorisé dans fm.layer.tabs.
import type { HealthSurveillanceState } from '../services/health-surveillance.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import {
  createLayerPanelShell, isLayerPanelOpen, loadLayerTab, safeStorage, saveLayerTab, sectionOpenOf, type LayerPanelShell,
} from './layer-panel/frame.ts';
import { VEILLE_TABS, type VeilleTab } from './layer-panel/veille.ts';
import { buildVeilleView } from './layer-panel/veille-tabs.ts';

const PANEL_ID = 'health';

export class VeilleSanitairePanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private state: HealthSurveillanceState | null = null;
  private tab: VeilleTab;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.tab = loadLayerTab(this.storage, PANEL_ID, VEILLE_TABS) as VeilleTab;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'veille-panel-modal', panelId: PANEL_ID, storage: this.storage,
      onClose: () => this.hide(),
      onTab: (id) => {
        if (!(VEILLE_TABS as readonly string[]).includes(id)) return;
        this.tab = id as VeilleTab;
        saveLayerTab(this.storage, PANEL_ID, id);
        this.render();
      },
    });
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }

  /** Ouvre le panneau ; null garde les données déjà reçues (chargement au premier affichage). */
  show(state: HealthSurveillanceState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvelles données : un panneau fermé ne se rouvre pas ; onglet et sections ouvertes sont gardés. */
  update(state: HealthSurveillanceState | null): void {
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
    this.shell.render(buildVeilleView({ state: this.state, tab: this.tab, now: Date.now(), open }));
  }
}
