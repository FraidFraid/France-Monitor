// src/components/WeatherRadarPanel.ts : panneau de couche « Radar météo » (spec 2026-10-04 environnement § 2.3), réécrit : la
// mosaïque de réflectivité Météo-France du worker radar remplace RainViewer. Coquille DOM : contenu de buildRadarView (pur), cadre de
// createLayerPanelShell ; le bouton « Sommets d'écho » bascule l'option partagée avec le panneau Feux (App.echoTopsEnabled) ; le
// profil vertical vient d'un clic sur la carte (App.loadRadarProfile). La croix éteint la couche, comme les autres panneaux.
import type { Radar2dManifest } from '../services/radar-2d.ts';
import type { RadarProfileState } from '../services/environment-radar.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildRadarView } from './layer-panel/radar.ts';

const PANEL_ID = 'weatherRadar';

/** État reçu d'App.ts : manifeste (null avant la première lecture ou en panne), option et profil du point cliqué. */
export interface RadarPanelState {
  manifest: Radar2dManifest | null;
  configured: boolean;
  error: string | null;
  echoTops: boolean;
  echoTopsAvailable: boolean;
  profile: RadarProfileState | null;
}

export class WeatherRadarPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onEchoTops?: (on: boolean) => void;
  private state: RadarPanelState | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'radar-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-echo-tops]');
      if (button) this.onEchoTops?.(button.dataset['echoTops'] !== 'on');
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Option « Sommets d'écho » (état unique d'App.ts, partagé avec le panneau Feux). */
  setOnEchoTops(handler: (on: boolean) => void): void { this.onEchoTops = handler; }

  show(state: RadarPanelState | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(state);
  }

  update(state: RadarPanelState | null): void {
    if (state) this.state = state;
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
    this.shell?.destroy();
    this.shell = null;
  }

  private render(): void {
    if (!this.shell) return;
    const s = this.state;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    // Première ouverture sans lecture : état de chargement de la vue (manifeste null, configuré, aucune erreur).
    this.shell.render(buildRadarView({
      manifest: s?.manifest ?? null, configured: s?.configured ?? true, manifestError: s?.error ?? null,
      echoTops: s?.echoTops ?? false, echoTopsAvailable: s?.echoTopsAvailable ?? false, profile: s?.profile ?? null, now: Date.now(), open,
    }));
  }
}
