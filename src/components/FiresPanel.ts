// src/components/FiresPanel.ts : panneau de couche « Feux de forêt » (spec 2026-10-04 environnement § 2.4), réécrit dans le cadre
// commun : onglets Veille et Dossier d'un feu (onglet mémorisé dans fm.layer.tabs). Coquille DOM : contenu de buildFeuxView (pur),
// cadre de createLayerPanelShell. Elle lit elle-même le profil radar d'un foyer à l'ouverture de sa « Hauteur du panache »
// (fetchRadarColumn, démonstration) et, pour le dossier d'un grand feu, les communes autour de son centre (fetchFireImpacts) puis la
// relecture Ollama locale (enrichWithLlm, jamais de repli cloud). Plus de badge « TEMPS RÉEL » ni de « latence ~1h » : chaque partie
// porte la date de sa donnée (S1, E3). L'interrupteur « Réflectivité radar 2D » disparaît : la couche Radar météo le remplace.
import type { FireFoyer, FireObservationFeedState, LocatedFireIncident, RadarColumnResult } from '../types/index.ts';
import type { FiresState } from '../services/environment-fires.ts';
import { fetchFireImpacts } from '../services/environment-fires.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { fetchRadarColumn } from '../services/radar-column.ts';
import { buildDossier, selectMajorIncidents } from '../services/wildfire-dossier.ts';
import { enrichWithLlm } from '../services/wildfire-enrich.ts';
import { FEUX_TABS, buildFeuxView, type FeuxDossierInput, type FeuxTab } from './layer-panel/feux.ts';
import {
  createLayerPanelShell, isLayerPanelOpen, loadLayerTab, safeStorage, saveLayerTab, sectionOpenOf, type LayerPanelShell,
} from './layer-panel/frame.ts';

const PANEL_ID = 'fires';

/** Options de la carte, toutes tenues par App.ts (les sommets d'écho sont partagés avec le panneau Radar). */
export interface FiresPanelOptions { gibs: boolean; mtgFrp: boolean; echoTops: boolean; echoTopsAvailable: boolean; forestDangerFill: boolean }

/** État reçu d'App.ts : collecte du serveur, incidents DBSCAN sur les détections nettoyées (dossier), MTG-FRP dérivé, options. */
export interface FiresPanelState {
  fires: FiresState | null;
  incidents: LocatedFireIncident[];
  mtgFrp: FireObservationFeedState | null;
  options: FiresPanelOptions;
}

const NO_OPTIONS: FiresPanelOptions = { gibs: false, mtgFrp: false, echoTops: false, echoTopsAvailable: false, forestDangerFill: false };

export class FiresPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusFoyer?: (foyer: FireFoyer) => void;
  private onEchoTops?: (on: boolean) => void;
  private onMtgFrp?: (on: boolean) => void;
  private onGibs?: (on: boolean) => void;
  private onForestDangerFill?: (on: boolean) => void;
  private state: FiresPanelState | null = null;
  private tab: FeuxTab;
  /** Profils « Hauteur du panache » demandés, par foyer (gardés jusqu'à la disparition du foyer). */
  private readonly plume = new Map<string, RadarColumnResult | 'loading' | 'error'>();
  private dossier: FeuxDossierInput | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.tab = loadLayerTab(this.storage, PANEL_ID, FEUX_TABS) as FeuxTab;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'fires-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
      onTab: (id) => {
        if (!(FEUX_TABS as readonly string[]).includes(id)) return;
        this.tab = id as FeuxTab;
        saveLayerTab(this.storage, PANEL_ID, id);
        this.render();
      },
    });
    shell.root.addEventListener('click', (e) => this.onClick(e.target as HTMLElement));
    // « Hauteur du panache » : le profil est lu à la première ouverture du repli d'un foyer.
    shell.root.addEventListener('toggle', (e) => {
      const details = e.target;
      if (!(details instanceof HTMLDetailsElement) || !details.open) return;
      const id = details.dataset['plumeFoyer'];
      if (id && !this.plume.has(id)) void this.loadPlume(id);
    }, true);
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes de foyer cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusFoyer(handler: (foyer: FireFoyer) => void): void { this.onFocusFoyer = handler; }
  setOnEchoTops(handler: (on: boolean) => void): void { this.onEchoTops = handler; }
  setOnMtgFrp(handler: (on: boolean) => void): void { this.onMtgFrp = handler; }
  setOnGibs(handler: (on: boolean) => void): void { this.onGibs = handler; }
  setOnForestDangerFill(handler: (on: boolean) => void): void { this.onForestDangerFill = handler; }

  show(state: FiresPanelState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvelles données : un panneau fermé ne se rouvre pas ; onglet, panaches lus, dossier ouvert et sections gardés. */
  update(state: FiresPanelState | null): void {
    if (state) {
      this.state = state;
      const ids = new Set(state.fires?.fires.data?.foyers.map((f) => f.id) ?? []);
      for (const id of [...this.plume.keys()]) if (!ids.has(id)) this.plume.delete(id);
    }
    if (this.isVisible()) this.render();
  }

  /**
   * Ouvre le panneau sur l'onglet « Dossier d'un feu » pour un incident (alerte ou situation WILDFIRE_ESCALATION, ligne cliquée) ;
   * faux si l'incident n'est pas (ou plus) connu. Le dossier s'affiche aussitôt avec la seule observation, puis les communes à moins
   * de 10 km et la relecture locale le complètent ; jamais de chiffre supposé (impacts non renseignés).
   */
  openDossier(incidentId: string): boolean {
    const incident = this.state?.incidents.find((i) => i.id === incidentId);
    if (!incident) return false;
    this.tab = 'dossier';
    saveLayerTab(this.storage, PANEL_ID, 'dossier');
    const input: FeuxDossierInput = { incident, dossier: buildDossier(incident, [], incident.deptCodes), impacts: null, impactsError: null };
    this.dossier = input;
    this.show(null);
    // Le service ne rejette pas (contrat) ; un rejet inattendu reste une panne dite dans le dossier (S3), jamais un rejet non géré.
    void fetchFireImpacts(incident.centroidLat, incident.centroidLon)
      .catch((err: unknown) => ({ data: null, error: err instanceof Error ? err.message : 'lecture des communes en échec' }))
      .then(({ data, error }) => {
        if (this.dossier?.incident.id !== incidentId) return;
        this.dossier = { ...this.dossier, impacts: data, impactsError: error };
        this.update(null);
      });
    // Ollama tourne en local et n'est sollicité qu'ici : à l'ouverture d'un dossier, pour un seul incident. En échec, le dossier reste
    // celui de l'observation, sans enrichissement.
    void enrichWithLlm(input.dossier)
      .then((enriched) => {
        if (this.dossier?.incident.id !== incidentId) return;
        this.dossier = { ...this.dossier, dossier: enriched };
        this.update(null);
      })
      .catch(() => undefined);
    return true;
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    return this.shell ? isLayerPanelOpen(this.shell.root) : false;
  }

  destroy(): void {
    this.shell?.destroy();
    this.shell = null;
  }

  private onClick(target: HTMLElement): void {
    const options = this.state?.options ?? NO_OPTIONS;
    if (target.closest('[data-echo-tops]')) { this.onEchoTops?.(!options.echoTops); return; }
    if (target.closest('[data-gibs]')) { this.onGibs?.(!options.gibs); return; }
    if (target.closest('[data-mtg]')) { this.onMtgFrp?.(!options.mtgFrp); return; }
    if (target.closest('[data-forest-fill]')) { this.onForestDangerFill?.(!options.forestDangerFill); return; }
    const incident = target.closest<HTMLElement>('[data-incident]')?.dataset['incident'];
    if (incident) { this.openDossier(incident); return; }
    const foyerId = target.closest<HTMLElement>('[data-foyer]')?.dataset['foyer'];
    const foyer = foyerId ? this.state?.fires?.fires.data?.foyers.find((f) => f.id === foyerId) : undefined;
    if (foyer) this.onFocusFoyer?.(foyer);
  }

  /** Profil vertical à la station radar la plus proche du centroïde du foyer (démonstration) ; null de la lecture : panne dite. */
  private async loadPlume(foyerId: string): Promise<void> {
    const foyer = this.state?.fires?.fires.data?.foyers.find((f) => f.id === foyerId);
    if (!foyer) return;
    this.plume.set(foyerId, 'loading');
    this.render();
    let result: RadarColumnResult | null = null;
    try {
      result = await fetchRadarColumn(foyer.lat, foyer.lon);
    } catch {
      result = null;
    }
    this.plume.set(foyerId, result ?? 'error');
    this.render();
  }

  private render(): void {
    if (!this.shell || !this.isVisible()) return;
    const s = this.state;
    const slot = s?.fires?.fires ?? null;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildFeuxView({
      fires: slot?.data ?? null, firesError: slot?.error ?? null, mtgFrp: s?.mtgFrp ?? null, options: s?.options ?? NO_OPTIONS,
      plume: this.plume, tab: this.tab, majorIncidents: selectMajorIncidents(s?.incidents ?? []), dossier: this.dossier,
      canFocus: this.onFocusFoyer !== undefined, now: Date.now(), open,
    }));
  }
}
