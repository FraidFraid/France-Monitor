// src/components/HopitauxPanel.ts : panneau de couche « Hôpitaux » (spec 2026-10-03 § 3.4).
// Coquille DOM : contenu de buildHopitauxView (pur) ; un site fréquenté cliqué (ou Entrée) est transmis à la carte.
import type { EmergencySite, HospitalsDataset } from '../types/index.ts';
import type { HealthOfferState } from '../services/health-offer.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildHopitauxView } from './layer-panel/hopitaux.ts';

const PANEL_ID = 'hospitals';

export class HopitauxPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onSelectSite?: (site: EmergencySite) => void;
  private data: HospitalsDataset | null = null;
  private error: string | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'hopitaux-panel-modal', panelId: PANEL_ID, storage: this.storage,
      onClose: () => this.hide(),
    });
    // Entrée sur une ligne cliquable : le cadre la transforme en clic (createLayerPanelShell).
    shell.root.addEventListener('click', (e) => {
      const finess = (e.target as HTMLElement).closest<HTMLElement>('[data-hosp-finess]')?.dataset['hospFiness'];
      const site = finess ? this.data?.sites.find((s) => s.finess === finess) : undefined;
      if (site) this.onSelectSite?.(site);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  setOnSelectSite(handler: (site: EmergencySite) => void): void { this.onSelectSite = handler; }

  show(offer: HealthOfferState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(offer);
  }

  update(offer: HealthOfferState | null): void {
    if (offer) {
      this.data = offer.hospitals.data;
      this.error = offer.hospitals.error;
    }
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
    this.shell.render(buildHopitauxView({ data: this.data, error: this.error, now: Date.now(), open }));
  }
}
