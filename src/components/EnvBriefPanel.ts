// src/components/EnvBriefPanel.ts : panneau « En bref » de l'onglet Environnement. Coquille DOM : contenu de buildEnvBriefView (pur),
// cadre de createLayerPanelShell. Clic sur un enjeu : la carte le cadre ; sur une webcam : sa fiche ; « Copier pour une note ».
import type { MapLayers } from '../types/index.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { ENV_BRIEF_TITLE, buildEnvBriefView, envBriefNoteText, type EnvBriefInput } from './layer-panel/env-brief.ts';
import { ENVIRONMENT_THEME } from './layer-panel/environment-format.ts';
import { createLayerPanelShell, isLayerPanelOpen, loadingBody, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';

const PANEL_ID = 'envBrief';

export type EnvBriefData = Omit<EnvBriefInput, 'open'>;

export class EnvBriefPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onOpenPastille?: (key: keyof MapLayers) => void;
  private onFocusPoint?: (lon: number, lat: number) => void;
  private onWebcam?: (id: string) => void;
  private data: EnvBriefData | null = null;
  private clickCleanup: (() => void) | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'env-brief-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    const root = this.shell.root;
    const onClick = (e: Event): void => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-copy-note]')) { void this.copyNote(); return; }
      const pastille = t.closest<HTMLElement>('.lp-row.is-link')?.dataset['pastille'];
      if (pastille) { this.onOpenPastille?.(pastille as keyof MapLayers); return; }
      const row = t.closest<HTMLElement>('.lp-row.is-link');
      if (!row) return;
      const webcam = row.dataset['webcam'];
      if (webcam) { this.onWebcam?.(webcam); return; }
      const lon = Number(row.dataset['lon']);
      const lat = Number(row.dataset['lat']);
      if (Number.isFinite(lon) && Number.isFinite(lat)) this.onFocusPoint?.(lon, lat);
    };
    root.addEventListener('click', onClick);
    this.clickCleanup = () => root.removeEventListener('click', onClick);
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Ligne de la synthèse des pastilles : le panneau de la pastille s'ouvre. */
  setOnOpenPastille(handler: (key: keyof MapLayers) => void): void { this.onOpenPastille = handler; }
  setOnFocusPoint(handler: (lon: number, lat: number) => void): void { this.onFocusPoint = handler; }
  setOnWebcam(handler: (id: string) => void): void { this.onWebcam = handler; }

  show(data: EnvBriefData | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(data);
  }

  update(data: EnvBriefData | null): void {
    if (data) this.data = data;
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

  private async copyNote(): Promise<void> {
    if (!this.data || !this.shell) return;
    const done = this.shell.root.querySelector<HTMLElement>('.eb-copied');
    try {
      await navigator.clipboard.writeText(envBriefNoteText({ ...this.data, open: () => true }));
      if (done) done.textContent = 'Copié';
    } catch {
      if (done) done.textContent = 'Copie impossible';
    }
  }

  private render(): void {
    if (!this.shell) return;
    if (!this.data) {
      this.shell.render({ head: { theme: ENVIRONMENT_THEME, title: ENV_BRIEF_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() });
      return;
    }
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildEnvBriefView({ ...this.data, open }));
  }
}
