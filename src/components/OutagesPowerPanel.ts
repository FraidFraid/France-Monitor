// src/components/OutagesPowerPanel.ts : panneau de couche « Électricité : production et transport » (spec 2026-10-08 panneaux pannes § 2.2).
// Coquille DOM : contenu de buildPowerView (pur), cadre commun ; une tranche nucléaire ouvre le panneau Parc nucléaire, une autre unité
// recentre la carte. Le dernier signal Écowatt reçu est gardé quand une mise à jour n'en apporte pas.
import type { EcowattOfficial } from '../types/index.ts';
import type { PowerState } from '../services/outages-power.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { buildPowerView } from './layer-panel/outages-power.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';

const PANEL_ID = 'outagesElec';

export class OutagesPowerPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusUnit?: (name: string) => void;
  private onOpenNuclear?: () => void;
  private state: PowerState | null = null;
  private ecowatt: EcowattOfficial | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) { this.container = container; }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'outages-power-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => this.onClick(e));
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Unités cliquables (recentrage de la carte) seulement avec ce gestionnaire, posé par App.ts. */
  setOnFocusUnit(handler: (name: string) => void): void { this.onFocusUnit = handler; }
  /** Une tranche nucléaire ouvre le panneau Parc nucléaire. */
  setOnOpenNuclear(handler: () => void): void { this.onOpenNuclear = handler; }

  show(state: PowerState, ecowatt: EcowattOfficial | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state, ecowatt);
  }

  /** Nouvel état ; sans Écowatt, le dernier reçu est gardé ; un panneau fermé ne se rouvre pas. */
  update(state: PowerState, ecowatt: EcowattOfficial | null = this.ecowatt): void {
    this.state = state;
    this.ecowatt = ecowatt;
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
    const target = e.target as HTMLElement;
    if (target.closest('[data-open-nuclear]')) { this.onOpenNuclear?.(); return; }
    const unit = target.closest<HTMLElement>('[data-unit]')?.dataset['unit'];
    if (unit) this.onFocusUnit?.(unit);
  }

  private render(): void {
    if (!this.shell || !this.state) return;
    const slot = this.state.power;
    this.shell.patch(buildPowerView({
      power: slot.data, error: slot.error, ecowatt: this.ecowatt, canFocus: this.onFocusUnit !== undefined, now: Date.now(),
      open: sectionOpenOf(loadSectionState(this.storage), PANEL_ID),
    }));
  }
}
