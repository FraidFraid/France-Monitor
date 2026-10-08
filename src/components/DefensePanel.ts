// src/components/DefensePanel.ts : panneau de couche « Défense » (spec 2026-10-04 souveraineté § 2.1 ; contrats § 4.2), réécrit dans le
// cadre commun : plus de modale déplaçable, plus de câbles (panneau Connectivité) ni de brouillage déduit des vols. Coquille DOM : contenu
// de buildDefenseView (pur), positions de la Marine nationale lues à chaque rendu (getters de military-ships.ts, injectables en test,
// comme MaritimePanel) ; un aéronef, une urgence ou un bâtiment cliqués (ou Entrée) sont recentrés sur la carte ; bouton des ouvrages
// OpenStreetMap. Aucun masquage des aéronefs (décision du 08/10/2026, qui remplace O10). Posture Vigipirate vérifiée par la relecture
// quotidienne de la page du SGDSN (O14). Phase B (tâche B28) : grille GNSS et registre des gels gardés quand une mise à jour ne les donne
// pas (règle de VigilancePanel) ; une maille du jour UTC précédent cliquée est recentrée (O17 : jamais un lieu en direct) ; bouton des
// zones drones DGAC (option de la couche). Chaque rendu, relève AIS de 5 s comprise, met à jour sans reconstruire ce qui n'a pas changé
// (shell.patch).
import { VIGIPIRATE } from '../config/vigipirate.ts';
import type { AisConnectionStatus } from '../services/ais-connection.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { getAisConnectionState, getMilitaryShips, type MilitaryShip } from '../services/military-ships.ts';
import type { CablesState } from '../services/sovereignty-cables.ts';
import type { GnssState } from '../services/sovereignty-gnss.ts';
import type { MilitaryState } from '../services/sovereignty-military.ts';
import type { SanctionsState } from '../services/sovereignty-sanctions.ts';
import type { VigipirateCheckState } from '../services/sovereignty-vigipirate.ts';
import type { MilitaryAircraft, MilitaryEmergency } from '../types/index.ts';
import { buildDefenseView, type DefenseSitesSummary } from './layer-panel/defense.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { findShipByKey } from './layer-panel/navy.ts';
import { cablesAisDown } from './layer-panel/sovereignty-format.ts';

const PANEL_ID = 'military';

/**
 * État reçu d'App.ts : relevé adsb.lol, veille des câbles (état de l'AIS vu par le serveur), relecture de la page Vigipirate du SGDSN
 * (null avant la première lecture), sites de défense (zones drones de la phase B comprises).
 */
export interface DefensePanelState {
  military: MilitaryState | null;
  cables: CablesState | null;
  vigipirate: VigipirateCheckState | null;
  sites: DefenseSitesSummary;
  /**
   * Phase B (contrats § 4.2) : grille GNSS et météo spatiale, registre national des gels. Absents d'une mise à jour : derniers reçus
   * gardés ; null : pas encore lus (sections « chargement… »).
   */
  gnss?: GnssState | null;
  sanctions?: SanctionsState | null;
}

/** Marine nationale vue en AIS et état du WebSocket du relais (injectables en test). */
export interface DefenseLiveSource {
  navy(): MilitaryShip[];
  connection(): { status: AisConnectionStatus; lastMessageAt: number | null };
}

const LIVE_AIS: DefenseLiveSource = {
  navy: () => getMilitaryShips(),
  connection: () => {
    const s = getAisConnectionState();
    return { status: s.status, lastMessageAt: s.lastMessageAt };
  },
};

export class DefensePanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusAircraft?: (aircraft: MilitaryAircraft) => void;
  private onFocusEmergency?: (emergency: MilitaryEmergency) => void;
  private onFocusNavy?: (ship: MilitaryShip) => void;
  private onOsmWorks?: (on: boolean) => void;
  private onDroneZones?: (on: boolean) => void;
  private onFocusGnssCell?: (cell: { lat: number; lon: number }) => void;
  private state: DefensePanelState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;
  private readonly live: DefenseLiveSource;

  constructor(container: HTMLElement, live: DefenseLiveSource = LIVE_AIS) {
    this.container = container;
    this.live = live;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'defense-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => this.onClick(e));
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes d'aéronefs d'autres nations et d'urgences montrées cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusAircraft(handler: (aircraft: MilitaryAircraft) => void): void { this.onFocusAircraft = handler; }
  setOnFocusEmergency(handler: (emergency: MilitaryEmergency) => void): void { this.onFocusEmergency = handler; }
  setOnFocusNavy(handler: (ship: MilitaryShip) => void): void { this.onFocusNavy = handler; }
  /** Bouton « Afficher les ouvrages OpenStreetMap » : App.ts lit le fichier daté à la première demande. */
  setOnOsmWorks(handler: (on: boolean) => void): void { this.onOsmWorks = handler; }
  /** Bouton des zones drones (section Sites) : bascule de l'option de la couche Défense, d'après son aria-pressed (phase B). */
  setOnDroneZones(handler: (on: boolean) => void): void { this.onDroneZones = handler; }
  /** Ligne d'une maille GNSS du jour UTC précédent (section GNSS) : recentrage de la carte (phase B, O17). */
  setOnFocusGnssCell(handler: (cell: { lat: number; lon: number }) => void): void { this.onFocusGnssCell = handler; }

  show(state: DefensePanelState): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvel état ; un panneau fermé ne se rouvre pas. Grille GNSS et registre des gels absents de l'appel : derniers reçus gardés. */
  update(state: DefensePanelState): void {
    this.state = {
      ...state,
      gnss: state.gnss !== undefined ? state.gnss : this.state?.gnss ?? null,
      sanctions: state.sanctions !== undefined ? state.sanctions : this.state?.sanctions ?? null,
    };
    if (this.isVisible()) this.render();
  }

  /** Positions AIS rafraîchies (App.ts, relève de 5 s) : nouveau rendu si le panneau est ouvert. */
  refreshLive(): void {
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
    if (target.closest('[data-osm-works]')) {
      this.onOsmWorks?.(!(this.state?.sites.osm.shown ?? false));
      return;
    }
    const droneToggle = target.closest<HTMLElement>('[data-drone-zones]');
    if (droneToggle) {
      this.onDroneZones?.(droneToggle.getAttribute('aria-pressed') !== 'true');
      return;
    }
    // « 48:-3.5 » : coin sud-ouest d'une maille du jour UTC précédent (seules lignes portant l'attribut, O17).
    const gnssCell = target.closest<HTMLElement>('[data-gnss-cell]')?.dataset['gnssCell'];
    if (gnssCell) {
      const [lat, lon] = gnssCell.split(':').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon)) this.onFocusGnssCell?.({ lat, lon });
      return;
    }
    const m = this.state?.military?.military.data ?? null;
    const hex = target.closest<HTMLElement>('[data-aircraft]')?.dataset['aircraft'];
    if (hex) {
      const aircraft = m?.aircraft.find((a) => a.hex === hex);
      if (aircraft) this.onFocusAircraft?.(aircraft);
      return;
    }
    const key = target.closest<HTMLElement>('[data-emergency]')?.dataset['emergency'];
    if (key) {
      const emergency = m?.emergencies.find((x) => `${x.icao24}:${x.squawk}` === key);
      if (emergency) this.onFocusEmergency?.(emergency);
      return;
    }
    const navy = target.closest<HTMLElement>('[data-navy]')?.dataset['navy'];
    if (navy) {
      const ship = findShipByKey(navy, this.live.navy());
      if (ship) this.onFocusNavy?.(ship);
    }
  }

  private render(): void {
    if (!this.shell || !this.state) return;
    const { military, cables, vigipirate, sites, gnss, sanctions } = this.state;
    const connection = this.live.connection();
    const watch = cables?.watch.data ?? null;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.patch(buildDefenseView({
      military: military?.military.data ?? null, militaryError: military?.military.error ?? null, vigipirate: VIGIPIRATE,
      vigipirateCheck: vigipirate?.check ?? null,
      navy: { status: connection.status, lastMessageAt: connection.lastMessageAt, ships: this.live.navy() },
      // AIS indisponible pour le serveur (muet, relais injoignable) ; un fichier des câbles illisible ne fige pas la Marine nationale.
      aisRelay: watch !== null && watch.readAt !== null ? { evaluated: !cablesAisDown(watch), lastMessageAt: watch.aisLastMessageAt } : null,
      sites,
      gnss: gnss?.gnss.data ?? null, gnssError: gnss?.gnss.error ?? null,
      sanctions: sanctions?.sanctions.data ?? null, sanctionsError: sanctions?.sanctions.error ?? null,
      canFocus: this.onFocusAircraft !== undefined, now: Date.now(), open,
    }));
  }
}
