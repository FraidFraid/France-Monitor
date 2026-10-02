// src/components/NuclearPanel.ts : panneau de couche « Parc nucléaire » (spec 2026-10-02 § 6).
// Coquille DOM : contenu de buildNuclearView (pur), cadre de createLayerPanelShell.
import type { EcowattResponse, NuclearState } from '../types/index.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import {
  createLayerPanelShell, isLayerPanelOpen, loadLayerTab, safeStorage, saveLayerTab, sectionOpenOf, type LayerPanelShell,
} from './layer-panel/frame.ts';
import { buildNuclearView, NUCLEAR_TABS, type NuclearTab } from './layer-panel/nuclear.ts';

const PANEL_ID = 'nuclearFleet';

export class NuclearPanel {
  private shell: LayerPanelShell | null = null;
  private state: NuclearState | null = null;
  private ecowatt: EcowattResponse | null = null;
  private onCloseCallback?: () => void;
  private onPlantHoverCallback?: (plantName: string | null) => void;
  private hoveredPlant: string | null = null;
  private readonly storage = safeStorage();
  private tab: NuclearTab;
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.tab = loadLayerTab(this.storage, PANEL_ID, NUCLEAR_TABS) as NuclearTab;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'nuclear-panel-modal', panelId: PANEL_ID, storage: this.storage,
      onClose: () => this.hide(),
      onTab: (id) => {
        if (!(NUCLEAR_TABS as readonly string[]).includes(id)) return;
        this.tab = id as NuclearTab;
        saveLayerTab(this.storage, PANEL_ID, id);
        this.emitHover(null);
        this.render();
      },
    });
    this.shell.root.addEventListener('mouseover', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-nuclear-plant]');
      this.emitHover(el?.dataset['nuclearPlant'] ?? null);
    });
    this.shell.root.addEventListener('mouseleave', () => this.emitHover(null));
  }

  setOnClose(cb: () => void): void { this.onCloseCallback = cb; }
  setOnPlantHover(cb: (plantName: string | null) => void): void { this.onPlantHoverCallback = cb; }

  show(state: NuclearState | null = null, ecowatt: EcowattResponse | null = null): void {
    if (state) this.state = state;
    if (ecowatt !== null) this.ecowatt = ecowatt;
    this.shell?.root.classList.add('is-open');
    this.render();
  }

  update(state: NuclearState, ecowatt: EcowattResponse | null = this.ecowatt): void {
    this.state = state;
    this.ecowatt = ecowatt;
    if (this.isVisible()) this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    this.emitHover(null);
    // Masquage « silencieux » (bascule entre panneaux) : ne désactive pas la couche.
    if (!opts.silent) this.onCloseCallback?.();
  }

  isVisible(): boolean {
    return this.shell ? isLayerPanelOpen(this.shell.root) : false;
  }

  destroy(): void {
    this.emitHover(null);
    this.shell?.destroy();
    this.shell = null;
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildNuclearView({ state: this.state, ecowatt: this.ecowatt, tab: this.tab, now: Date.now(), open }));
  }

  private emitHover(plantName: string | null): void {
    if (this.hoveredPlant === plantName) return;
    this.hoveredPlant = plantName;
    this.onPlantHoverCallback?.(plantName);
  }
}
