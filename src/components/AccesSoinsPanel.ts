// src/components/AccesSoinsPanel.ts : panneau de couche « Accès aux soins » (spec 2026-10-03 § 3.3).
// Coquille DOM : contenu de buildAccesSoinsView (pur) ; profession de la carte mémorisée (fm.layer.tabs) et transmise à la carte.
import type { AplDataset, AplProfession } from '../types/index.ts';
import type { HealthOfferState } from '../services/health-offer.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import {
  createLayerPanelShell, isLayerPanelOpen, loadLayerTab, safeStorage, saveLayerTab, sectionOpenOf, type LayerPanelShell,
} from './layer-panel/frame.ts';
import { APL_PROFESSIONS } from './layer-panel/health-format.ts';
import { buildAccesSoinsView } from './layer-panel/acces-soins.ts';

const PANEL_ID = 'healthApl';
const PROFESSION_KEY = 'healthApl.profession';

export class AccesSoinsPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onProfession?: (profession: AplProfession) => void;
  private data: AplDataset | null = null;
  private error: string | null = null;
  private profession: AplProfession;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.profession = loadLayerTab(this.storage, PROFESSION_KEY, APL_PROFESSIONS) as AplProfession;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'acces-soins-panel-modal', panelId: PANEL_ID, storage: this.storage,
      onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => {
      const value = (e.target as HTMLElement).closest<HTMLElement>('[data-apl-profession]')?.dataset['aplProfession'];
      if (value && (APL_PROFESSIONS as readonly string[]).includes(value)) this.setProfession(value as AplProfession);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  setOnProfession(handler: (profession: AplProfession) => void): void { this.onProfession = handler; }
  getProfession(): AplProfession { return this.profession; }

  show(offer: HealthOfferState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(offer);
  }

  update(offer: HealthOfferState | null): void {
    if (offer) {
      this.data = offer.apl.data;
      this.error = offer.apl.error;
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

  private setProfession(profession: AplProfession): void {
    if (profession === this.profession) return;
    this.profession = profession;
    saveLayerTab(this.storage, PROFESSION_KEY, profession);
    this.onProfession?.(profession);
    this.render();
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildAccesSoinsView({ data: this.data, error: this.error, profession: this.profession, now: Date.now(), open }));
  }
}
