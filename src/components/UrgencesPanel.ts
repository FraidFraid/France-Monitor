// src/components/UrgencesPanel.ts : panneau de couche « Urgences et SOS Médecins » (spec 2026-10-03 § 3.2).
// Coquille DOM : contenu de buildUrgencesView (pur) ; syndrome de la carte mémorisé (fm.layer.tabs) et transmis à la carte.
import type { AlertLevelsResponse, SyndromicResponse } from '../types/index.ts';
import type { HealthSurveillanceState } from '../services/health-surveillance.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import {
  createLayerPanelShell, isLayerPanelOpen, loadLayerTab, safeStorage, saveLayerTab, sectionOpenOf, type LayerPanelShell,
} from './layer-panel/frame.ts';
import { URGENCES_SYNDROMES, type UrgencesSyndrome } from './layer-panel/health-format.ts';
import { buildUrgencesView } from './layer-panel/urgences.ts';

const PANEL_ID = 'healthOscour';
/** Clé du sélecteur dans fm.layer.tabs (même mémoire que les onglets des panneaux). */
const SYNDROME_KEY = 'healthOscour.syndrome';

export class UrgencesPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onSyndrome?: (syndrome: UrgencesSyndrome) => void;
  private data: SyndromicResponse | null = null;
  private error: string | null = null;
  private alerts: AlertLevelsResponse | null = null;
  private syndrome: UrgencesSyndrome;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.syndrome = loadLayerTab(this.storage, SYNDROME_KEY, URGENCES_SYNDROMES) as UrgencesSyndrome;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'urgences-panel-modal', panelId: PANEL_ID, storage: this.storage,
      onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => {
      const value = (e.target as HTMLElement).closest<HTMLElement>('[data-urg-syndrome]')?.dataset['urgSyndrome'];
      if (value && (URGENCES_SYNDROMES as readonly string[]).includes(value)) this.setSyndrome(value as UrgencesSyndrome);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  setOnSyndrome(handler: (syndrome: UrgencesSyndrome) => void): void { this.onSyndrome = handler; }
  getSyndrome(): UrgencesSyndrome { return this.syndrome; }

  show(state: HealthSurveillanceState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  update(state: HealthSurveillanceState | null): void {
    if (state && (state.syndromic.data !== null || state.syndromic.error !== null)) {
      this.data = state.syndromic.data;
      this.error = state.syndromic.error;
      this.alerts = state.alerts.data;
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

  private setSyndrome(syndrome: UrgencesSyndrome): void {
    if (syndrome === this.syndrome) return;
    this.syndrome = syndrome;
    saveLayerTab(this.storage, SYNDROME_KEY, syndrome);
    this.onSyndrome?.(syndrome);
    this.render();
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildUrgencesView({
      data: this.data, error: this.error, alerts: this.alerts, syndrome: this.syndrome, now: Date.now(), open,
    }));
  }
}
