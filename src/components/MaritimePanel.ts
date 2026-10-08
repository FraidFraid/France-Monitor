// src/components/MaritimePanel.ts : panneau de couche « Trafic maritime » (spec 2026-10-03 trafics § 3.4) : onglets Veille,
// Marine nationale et Alertes, fiche d'un navire. Coquille DOM : contenu de buildMaritimeView (pur), cadre commun ; onglet mémorisé
// dans fm.layer.tabs ; positions AIS vivantes lues à chaque rendu (getters de military-ships.ts, injectables en test). Chaque rendu,
// relève AIS de 5 s comprise, met à jour le panneau sans reconstruire ce qui n'a pas changé (shell.patch) : barre d'outils, menu
// des territoires ouvert, focus et curseur de la recherche gardés ; recherche appliquée 150 ms après la dernière frappe.
import { FRENCH_MARITIME_TERRITORIES, type FrenchMaritimeTerritoryCode } from '../config/french-ports.ts';
import type { AisConnectionStatus } from '../services/ais-connection.ts';
import { getAisConnectionState, getAllLiveTraffic, getMilitaryShips, type MilitaryShip } from '../services/military-ships.ts';
import type { MaritimeState } from '../services/traffic-maritime.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import {
  createLayerPanelShell, isLayerPanelOpen, loadLayerTab, safeStorage, saveLayerTab, sectionOpenOf, type LayerPanelShell,
} from './layer-panel/frame.ts';
import { MARITIME_TABS, type MaritimeTab } from './layer-panel/maritime.ts';
import { MARITIME_ALERT_FILTERS, buildMaritimeView, type MaritimeAlertFilter } from './layer-panel/maritime-tabs.ts';

const PANEL_ID = 'trafficMaritime';
/** Délai entre la dernière frappe et le filtrage de la liste (ancien panneau : 150 ms). */
export const SEARCH_DEBOUNCE_MS = 150;

export interface MaritimeLiveSource {
  navy(): MilitaryShip[];
  traffic(): MilitaryShip[];
  connection(): { status: AisConnectionStatus; lastMessageAt: number | null };
}

/** Base de la Marine nationale, trafic vivant des eaux françaises (10 min), état du WebSocket du relais. */
const LIVE_AIS: MaritimeLiveSource = {
  navy: () => getMilitaryShips(),
  traffic: () => getAllLiveTraffic(10 * 60_000, true),
  connection: () => {
    const s = getAisConnectionState();
    return { status: s.status, lastMessageAt: s.lastMessageAt };
  },
};

export class MaritimePanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onHighlightShip?: (mmsi: string | null) => void;
  private onSelectShip?: (ship: MilitaryShip) => void;
  private state: MaritimeState | null = null;
  private tab: MaritimeTab;
  private search = '';
  private territory: FrenchMaritimeTerritoryCode | 'all' = 'all';
  private filter: MaritimeAlertFilter = 'alertes';
  private pages = 1;
  private selected: MilitaryShip | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;
  private readonly live: MaritimeLiveSource;

  constructor(container: HTMLElement, live: MaritimeLiveSource = LIVE_AIS) {
    this.container = container;
    this.live = live;
    this.tab = loadLayerTab(this.storage, PANEL_ID, MARITIME_TABS) as MaritimeTab;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'maritime-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
      onTab: (id) => {
        if (!(MARITIME_TABS as readonly string[]).includes(id)) return;
        this.tab = id as MaritimeTab;
        saveLayerTab(this.storage, PANEL_ID, id);
        this.selected = null;
        this.pages = 1;
        this.render();
      },
    });
    shell.root.addEventListener('click', (e) => this.onClick(e));
    shell.root.addEventListener('input', (e) => this.onInput(e));
    shell.root.addEventListener('change', (e) => this.onChange(e));
    shell.root.addEventListener('mouseover', (e) => this.onHover(e));
    shell.root.addEventListener('mouseleave', () => this.onHighlightShip?.(null));
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  setOnHighlightShip(handler: (mmsi: string | null) => void): void { this.onHighlightShip = handler; }
  setOnSelectShip(handler: (ship: MilitaryShip) => void): void { this.onSelectShip = handler; }

  show(state: MaritimeState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  update(state: MaritimeState | null): void {
    if (state) this.state = state;
    if (this.isVisible()) this.render();
  }

  /** Positions AIS rafraîchies (App.ts, à chaque tour de updateShips) : nouveau rendu si le panneau est ouvert. */
  refreshLive(): void {
    if (this.isVisible()) this.render();
  }

  /** Clic sur un navire de la carte : sa fiche dans le panneau, s'il est ouvert. */
  openShipModal(ship: MilitaryShip): void {
    if (!this.isVisible()) return;
    this.selected = ship;
    this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    this.onHighlightShip?.(null);
    // Masquage « silencieux » (bascule entre panneaux) : ne désactive pas la couche.
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    return this.shell ? isLayerPanelOpen(this.shell.root) : false;
  }

  destroy(): void {
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.shell?.destroy();
    this.shell = null;
  }

  private findShip(key: string): MilitaryShip | undefined {
    return [...this.live.traffic(), ...this.live.navy()].find((s) => (s.mmsi ?? s.id) === key);
  }

  private onClick(e: Event): void {
    const target = e.target as HTMLElement;
    if (target.closest('[data-mar-back]')) {
      this.selected = null;
      this.render();
      return;
    }
    if (target.closest('[data-mar-more]')) {
      this.pages += 1;
      this.render();
      return;
    }
    const filter = target.closest<HTMLElement>('[data-mar-filter]')?.dataset['marFilter'];
    if (filter && (MARITIME_ALERT_FILTERS as readonly string[]).includes(filter)) {
      this.filter = filter as MaritimeAlertFilter;
      this.pages = 1;
      this.render();
      return;
    }
    const key = target.closest<HTMLElement>('[data-mar-ship]')?.dataset['marShip'];
    const ship = key ? this.findShip(key) : undefined;
    if (ship) {
      this.selected = ship;
      this.onSelectShip?.(ship);
      this.render();
    }
  }

  private onInput(e: Event): void {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('[data-mar-search]')) return;
    this.search = input.value;
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.pages = 1;
      if (this.isVisible()) this.render();
    }, SEARCH_DEBOUNCE_MS);
  }

  private onChange(e: Event): void {
    const select = e.target;
    if (!(select instanceof HTMLSelectElement) || !select.matches('[data-mar-territory]')) return;
    const value = select.value;
    const known = FRENCH_MARITIME_TERRITORIES.find((t) => t.code === value)?.code;
    this.territory = known ?? 'all';
    this.pages = 1;
    this.render();
  }

  private onHover(e: Event): void {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-mar-ship]')?.dataset['marShip'] ?? null;
    this.onHighlightShip?.(key);
  }

  private render(): void {
    if (!this.shell) return;
    const connection = this.live.connection();
    // Fiche ouverte : la dernière position connue du navire, relue dans le flux vivant.
    const selected = this.selected ? this.findShip(this.selected.mmsi ?? this.selected.id) ?? this.selected : null;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    // Mise à jour sans reconstruire les nœuds inchangés : la barre d'outils (recherche, territoire, filtres) reste en place.
    this.shell.patch(buildMaritimeView({
      snapshot: this.state?.snapshot.data ?? null, error: this.state?.snapshot.error ?? null, tab: this.tab,
      live: {
        status: connection.status, lastMessageAt: connection.lastMessageAt, navy: this.live.navy(), traffic: this.live.traffic(),
        search: this.search, territory: this.territory, filter: this.filter, pages: this.pages, selected,
      },
      now: Date.now(), open,
    }));
  }
}
