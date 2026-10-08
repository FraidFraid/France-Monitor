// src/components/ConnectivityPanel.ts : panneau de couche « Connectivité » (spec 2026-10-04 souveraineté § 2.2 ; contrats § 4.2), clé de
// couche `subseaCables` gardée. Coquille DOM : contenu de buildConnectiviteView (pur), cadre commun ; un câble, un lieu d'atterrage ou un
// navire signalé cliqués (ou Entrée) sont recentrés sur la carte. Plus de couche « visuelle seulement » : les câbles ont leur panneau.
// Phase B (tâche B28) : visibilité des grands réseaux (RIPEstat) et points d'échange (PeeringDB) passés à la vue, gardés quand une mise à
// jour ne les donne pas.
import type { CablesState } from '../services/sovereignty-cables.ts';
import type { ConnectivityState } from '../services/sovereignty-connectivity.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import type { CableAlert, CableLanding } from '../types/index.ts';
import { buildConnectiviteView } from './layer-panel/connectivite.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';

const PANEL_ID = 'subseaCables';

/** État reçu d'App.ts : veille des câbles et fichier des câbles (Shom et OpenStreetMap), grands réseaux et points d'échange (phase B). */
export interface ConnectivityPanelState {
  cables: CablesState | null;
  /** Phase B (contrats § 4.2) : absent d'une mise à jour, derniers reçus gardés ; null : pas encore lus (« n.d. », chargement). */
  connectivity?: ConnectivityState | null;
}

export class ConnectivityPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusCable?: (id: string) => void;
  private onFocusVessel?: (alert: CableAlert) => void;
  private onFocusLanding?: (landing: CableLanding) => void;
  private state: ConnectivityPanelState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'connectivity-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => this.onClick(e));
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes de câbles, de lieux et de navires cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusCable(handler: (id: string) => void): void { this.onFocusCable = handler; }
  setOnFocusVessel(handler: (alert: CableAlert) => void): void { this.onFocusVessel = handler; }
  setOnFocusLanding(handler: (landing: CableLanding) => void): void { this.onFocusLanding = handler; }

  show(state: ConnectivityPanelState): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvel état ; un panneau fermé ne se rouvre pas. Grands réseaux absents de l'appel : derniers reçus gardés. */
  update(state: ConnectivityPanelState): void {
    this.state = { ...state, connectivity: state.connectivity !== undefined ? state.connectivity : this.state?.connectivity ?? null };
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

  private onClick(e: Event): void {
    const target = e.target as HTMLElement;
    const cables = this.state?.cables ?? null;
    const cable = target.closest<HTMLElement>('[data-cable]')?.dataset['cable'];
    if (cable) {
      this.onFocusCable?.(cable);
      return;
    }
    const vessel = target.closest<HTMLElement>('[data-vessel]')?.dataset['vessel'];
    if (vessel) {
      const alert = cables?.watch.data?.alerts.find((a) => a.id === vessel);
      if (alert) this.onFocusVessel?.(alert);
      return;
    }
    // « way/761201753:0 », « shom/FR…:1 » : identifiant du câble (qui contient lui-même « / »), puis rang de l'atterrage après le dernier
    // deux-points.
    const landing = target.closest<HTMLElement>('[data-landing]')?.dataset['landing'];
    if (landing) {
      const cut = landing.lastIndexOf(':');
      const id = landing.slice(0, cut);
      const rank = Number(landing.slice(cut + 1));
      const found = cut > 0 && Number.isInteger(rank) ? cables?.file?.cables.find((c) => c.id === id)?.landings[rank] : undefined;
      if (found) this.onFocusLanding?.(found);
    }
  }

  private render(): void {
    if (!this.shell || !this.state) return;
    const { cables, connectivity } = this.state;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildConnectiviteView({
      watch: cables?.watch.data ?? null, watchError: cables?.watch.error ?? null, file: cables?.file ?? null, fileError: cables?.fileError ?? null,
      connectivity: connectivity?.connectivity.data ?? null, connectivityError: connectivity?.connectivity.error ?? null,
      canFocus: this.onFocusCable !== undefined, now: Date.now(), open,
    }));
  }
}
