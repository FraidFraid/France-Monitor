// src/components/TrafficPanel.ts : panneau de couche « Trafic routier » (spec 2026-10-03 trafics § 3.1).
// Coquille DOM : contenu de buildRouteView (pur), cadre de createLayerPanelShell ; un événement cliqué (ou Entrée) est recentré sur
// la carte. Plus de badge « temps réel » à l'heure du navigateur : chaque partie porte la date de sa donnée (S1).
import type { RoadEvent } from '../types/index.ts';
import type { RoadTrafficState } from '../services/traffic-road.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildRouteView } from './layer-panel/route.ts';

const PANEL_ID = 'trafficRoad';

export class TrafficPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusEvent?: (event: RoadEvent) => void;
  private state: RoadTrafficState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'traffic-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    // Entrée sur une ligne cliquable : le cadre la transforme en clic (createLayerPanelShell).
    shell.root.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-road-event]')?.dataset['roadEvent'];
      const event = id ? this.state?.national.data?.events.find((x) => x.id === id) : undefined;
      if (event) this.onFocusEvent?.(event);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusEvent(handler: (event: RoadEvent) => void): void { this.onFocusEvent = handler; }

  /** Ouvre le panneau ; null garde les données déjà reçues (chargement au premier affichage). */
  show(state: RoadTrafficState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvelles données : un panneau fermé ne se rouvre pas ; sections ouvertes gardées. */
  update(state: RoadTrafficState | null): void {
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
    const s = this.state;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildRouteView({
      national: s?.national.data ?? null, nationalError: s?.national.error ?? null,
      urban: s?.urban.data ?? null, urbanError: s?.urban.error ?? null,
      canFocus: this.onFocusEvent !== undefined, now: Date.now(), open,
    }));
  }
}
