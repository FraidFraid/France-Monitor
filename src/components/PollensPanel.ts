// src/components/PollensPanel.ts : panneau de couche « Pollens » (Atmo France, 20/10/2026). Coquille DOM : contenu de buildPollensView
// (pur), cadre de createLayerPanelShell ; bascule Aujourd’hui / Demain / Après-demain (onglets, transmise à la carte) ; une ligne de
// département cliquée (ou Entrée) recentre la carte.
import type { PollenDay } from '../types/index.ts';
import type { PollenState } from '../services/environment-pollen.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { POLLENS_TABS, buildPollensView } from './layer-panel/pollens.ts';

const PANEL_ID = 'pollens';

export class PollensPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusDepartment?: (code: string) => void;
  private onDayChange?: (day: PollenDay) => void;
  private state: PollenState | null = null;
  private day: PollenDay = 'J';
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'pollens-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
      onTab: (id) => {
        if (!(POLLENS_TABS as readonly string[]).includes(id) || id === this.day) return;
        // Échéance du jour à chaque ouverture de l'application (jamais mémorisée) : « Demain » ne doit pas rester affiché le lendemain.
        this.day = id as PollenDay;
        this.render();
        this.onDayChange?.(this.day);
      },
    });
    // Entrée sur une ligne cliquable : le cadre la transforme en clic (createLayerPanelShell).
    shell.root.addEventListener('click', (e) => {
      const code = (e.target as HTMLElement).closest<HTMLElement>('[data-department]')?.dataset['department'];
      if (code) this.onFocusDepartment?.(code);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Ligne d'un département : recentrage de la carte. Rend les lignes cliquables. */
  setOnFocusDepartment(handler: (code: string) => void): void { this.onFocusDepartment = handler; }
  /** Bascule J / J+1 / J+2 : la carte suit l'échéance affichée. */
  setOnDayChange(handler: (day: PollenDay) => void): void { this.onDayChange = handler; }

  getDay(): PollenDay { return this.day; }

  /** Ouvre le panneau ; null garde les données déjà reçues (chargement au premier affichage). */
  show(state: PollenState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  /** Nouvelles données : un panneau fermé ne se rouvre pas ; onglet et sections ouvertes gardés. */
  update(state: PollenState | null): void {
    if (state) this.state = state;
    this.render();
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

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildPollensView({
      pollen: this.state?.pollen.data ?? null, error: this.state?.pollen.error ?? null, day: this.day,
      canFocus: this.onFocusDepartment !== undefined, now: Date.now(), open,
    }));
  }
}
