// src/components/FluxPietonsPanel.ts : panneau de couche « Flux piétons ». Coquille DOM : contenu de buildFluxView (pur), cadre de
// createLayerPanelShell. Onglets = phase (arrivée, dispersion) ; clic sur un événement = la carte passe à cet événement.
import type { FluxIndex, FluxPhase } from '../types/index.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildFluxView, type FluxViewInput } from './layer-panel/flux-pietons.ts';

const PANEL_ID = 'pedestrianFlows';

export class FluxPietonsPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onSelect?: (id: string) => void;
  private onPhase?: (phase: FluxPhase) => void;
  private index: FluxIndex | null = null;
  private error: string | null = null;
  private selectedId: string | null = null;
  private phase: FluxPhase = 'arrivee';
  private geo: FluxViewInput['geo'] = 'idle';
  private clickCleanup: (() => void) | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'flux-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
      onTab: (tab) => { if (tab === 'arrivee' || tab === 'depart') this.onPhase?.(tab); },
    });
    const root = this.shell.root;
    const onClick = (e: Event): void => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-flux-event]')?.dataset['fluxEvent'];
      if (id) this.onSelect?.(id);
    };
    root.addEventListener('click', onClick);
    this.clickCleanup = () => root.removeEventListener('click', onClick);
  }

  setHandlers(h: { onClose: () => void; onSelect: (id: string) => void; onPhase: (phase: FluxPhase) => void }): void {
    this.onClose = h.onClose;
    this.onSelect = h.onSelect;
    this.onPhase = h.onPhase;
  }

  show(): void {
    this.shell?.root.classList.add('is-open');
    this.render();
  }

  /** État complet venu d'App.ts (index, événement choisi, phase, lecture de la carte). */
  update(s: { index: FluxIndex | null; error: string | null; selectedId: string | null; phase: FluxPhase; geo: FluxViewInput['geo'] }): void {
    this.index = s.index;
    this.error = s.error;
    this.selectedId = s.selectedId;
    this.phase = s.phase;
    this.geo = s.geo;
    if (this.isVisible()) this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    return this.shell ? isLayerPanelOpen(this.shell.root) : false;
  }

  destroy(): void {
    this.clickCleanup?.();
    this.clickCleanup = null;
    this.shell?.destroy();
    this.shell = null;
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.patch(buildFluxView({
      index: this.index, error: this.error, selectedId: this.selectedId, phase: this.phase, geo: this.geo, open, nowMs: Date.now(),
    }));
  }
}
