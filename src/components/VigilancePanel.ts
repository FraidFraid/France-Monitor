// src/components/VigilancePanel.ts : panneau de couche « Vigilance météo » (spec 2026-10-04 environnement § 2.1). Remplace
// l'ancien panneau unique « Météo / crues » avec FloodsPanel. Coquille DOM : contenu de buildVigilanceView (pur), cadre de
// createLayerPanelShell ; bascule Aujourd’hui / Demain (onglets, transmise à la carte) ; un département cliqué (ou Entrée) est choisi :
// bulletin départemental et surbrillance de la carte ; un second clic le désélectionne ; un marégraphe cliqué (section Submersion
// marine) est recentré sur son port. Aucun badge « LIVE » : la date est celle de la carte Météo-France (S1).
import type { VigilanceEcheance } from '../types/index.ts';
import type { VigilanceState } from '../services/environment-vigilance.ts';
import type { SeaLevelsState } from '../services/environment-sea-levels.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { VIGILANCE_TABS, buildVigilanceView } from './layer-panel/vigilance.ts';

const PANEL_ID = 'environmental';

/** État du panneau (contrats § 4.2) : marégraphes facultatifs, gardés quand un appel ne les donne pas (arbitrage 11). */
export interface VigilancePanelState { vigilance: VigilanceState | null; seaLevels?: SeaLevelsState | null }

export class VigilancePanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onSelectDepartment?: (code: string | null) => void;
  private onEcheance?: (echeance: VigilanceEcheance) => void;
  private onFocusGauge?: (id: number) => void;
  private state: VigilancePanelState | null = null;
  private echeance: VigilanceEcheance = 'J';
  private selectedDept: string | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'vigilance-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
      onTab: (id) => {
        if (!(VIGILANCE_TABS as readonly string[]).includes(id) || id === this.echeance) return;
        // Échéance du jour à chaque ouverture de l'application (jamais mémorisée) : « Demain » ne doit pas rester affiché le lendemain.
        this.echeance = id as VigilanceEcheance;
        this.render();
        this.onEcheance?.(this.echeance);
      },
    });
    // Entrée sur une ligne cliquable : le cadre la transforme en clic (createLayerPanelShell).
    shell.root.addEventListener('click', (e) => {
      const gauge = (e.target as HTMLElement).closest<HTMLElement>('[data-gauge]')?.dataset['gauge'];
      if (gauge) {
        this.onFocusGauge?.(Number(gauge));
        return;
      }
      const code = (e.target as HTMLElement).closest<HTMLElement>('[data-dept]')?.dataset['dept'];
      if (!code) return;
      this.selectedDept = this.selectedDept === code ? null : code;
      this.render();
      this.onSelectDepartment?.(this.selectedDept);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Département choisi (bulletin départemental, surbrillance de la carte) ; null : choix retiré. Rend les lignes cliquables. */
  setOnSelectDepartment(handler: (code: string | null) => void): void { this.onSelectDepartment = handler; }
  /** Bascule Aujourd’hui / Demain : la carte suit l'échéance affichée. */
  setOnEcheance(handler: (echeance: VigilanceEcheance) => void): void { this.onEcheance = handler; }
  /** Ligne d'un marégraphe (section Submersion marine) : recentrage sur le port. */
  setOnFocusGauge(handler: (id: number) => void): void { this.onFocusGauge = handler; }

  getEcheance(): VigilanceEcheance { return this.echeance; }

  /** Ouvre le panneau ; null garde les données déjà reçues (chargement au premier affichage). */
  show(state: VigilancePanelState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvelles données : un panneau fermé ne se rouvre pas ; onglet, département choisi et sections ouvertes gardés. */
  update(state: VigilancePanelState | null): void {
    if (state) {
      this.state = {
        vigilance: state.vigilance ?? this.state?.vigilance ?? null,
        seaLevels: state.seaLevels !== undefined ? state.seaLevels : this.state?.seaLevels ?? null,
      };
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
    const slot = this.state?.vigilance?.vigilance ?? null;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildVigilanceView({
      vigilance: slot?.data ?? null, vigilanceError: slot?.error ?? null,
      seaLevels: this.state?.seaLevels?.seaLevels.data ?? null, seaLevelsError: this.state?.seaLevels?.seaLevels.error ?? null,
      canFocusGauge: this.onFocusGauge !== undefined,
      echeance: this.echeance, selectedDept: this.selectedDept,
      canFocus: this.onSelectDepartment !== undefined, now: Date.now(), open,
    }));
  }
}
