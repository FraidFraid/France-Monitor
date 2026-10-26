// src/components/ProtestsPanel.ts : panneau de couche « Manifestations » (spec 2026-10-17 manifestations). Coquille DOM : contenu de
// buildManifestationsView (pur), cadre de createLayerPanelShell ; une ligne placée cliquée (ou Entrée) recentre la carte ; un point de
// la carte cliqué met en avant les lignes de sa commune (focusPlace).
import { readGiletsJaunesPref, writeGiletsJaunesPref, type ProtestsState } from '../services/protests.ts';
import type { FluxEvent } from '../types/index.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildManifestationsView } from './layer-panel/manifestations.ts';

const PANEL_ID = 'protests';

export class ProtestsPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onFocusPlace?: (lat: number, lon: number) => void;
  private onFluxEvent?: (id: string) => void;
  private forecasts: ReadonlyMap<string, FluxEvent> = new Map();
  private state: ProtestsState | null = null;
  private pendingFocus: string | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;
  /** Annonces de la carte des gilets jaunes affichées (case du panneau) ; décoché par défaut. */
  private showGiletsJaunes = readGiletsJaunesPref(safeStorage());
  private onGiletsJaunes?: (show: boolean) => void;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'protests-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('a')) return;
      // « Foule estimée » : la prévision Flux piétons du rendez-vous (rues et rejeu), pas le recentrage sur la commune.
      const flux = target.closest<HTMLElement>('[data-flux-event]')?.dataset['fluxEvent'];
      if (flux) { e.stopPropagation(); this.onFluxEvent?.(flux); return; }
      const key = target.closest<HTMLElement>('[data-protest]')?.dataset['protest'];
      const [lat, lon] = (key ?? '').split(',').map(Number);
      if (key && Number.isFinite(lat) && Number.isFinite(lon)) this.onFocusPlace?.(lat, lon);
    });
    shell.root.addEventListener('change', (e) => {
      const box = (e.target as HTMLElement).closest<HTMLInputElement>('input[data-gj-toggle]');
      if (!box) return;
      this.showGiletsJaunes = box.checked;
      writeGiletsJaunesPref(safeStorage(), box.checked);
      this.onGiletsJaunes?.(box.checked);
      // Carte Sécurité autonome (public/maquette-securite.js) : elle relit le choix et redessine ses manifestations.
      window.dispatchEvent(new CustomEvent('fm:giletsjaunes', { detail: { show: box.checked } }));
      this.render();
    });
    this.shell = shell;
  }

  /** Case « carte des gilets jaunes » changée (posé par App.ts : la carte suit). */
  setOnGiletsJaunes(handler: (show: boolean) => void): void { this.onGiletsJaunes = handler; }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Lignes cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusPlace(handler: (lat: number, lon: number) => void): void { this.onFocusPlace = handler; }

  /** Clic sur « Foule estimée » d'une annonce (posé par App.ts). */
  setOnFluxEvent(handler: (id: string) => void): void { this.onFluxEvent = handler; }

  /** Prévisions Flux piétons par rendez-vous ; le panneau se redessine s'il est ouvert. */
  setForecasts(forecasts: ReadonlyMap<string, FluxEvent>): void {
    this.forecasts = forecasts;
    this.render();
  }

  show(state: ProtestsState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  update(state: ProtestsState | null): void {
    if (state) this.state = state;
    this.render();
  }

  /** Point de la carte cliqué : les lignes de sa commune sont dépliées et amenées à l'écran. */
  focusPlace(key: string): void {
    this.pendingFocus = key;
    if (this.isVisible()) this.applyFocus();
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
    const s = this.state;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildManifestationsView({
      data: s?.data ?? null, error: s?.error ?? null, canFocus: this.onFocusPlace !== undefined, now: Date.now(), open, forecasts: this.forecasts,
      showGiletsJaunes: this.showGiletsJaunes,
    }));
    if (this.pendingFocus !== null) this.applyFocus();
  }

  private applyFocus(): void {
    const key = this.pendingFocus;
    this.pendingFocus = null;
    if (key === null || !this.shell) return;
    const rows = [...this.shell.root.querySelectorAll<HTMLElement>('[data-protest]')].filter((el) => el.dataset['protest'] === key);
    for (const row of rows) {
      const details = row.closest('details');
      if (details) details.open = true;
    }
    rows[0]?.scrollIntoView({ block: 'nearest' });
    rows[0]?.focus({ preventScroll: true });
  }
}
