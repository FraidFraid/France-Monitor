// src/components/ThemeBriefPanel.ts : panneau « En bref » des onglets autres qu'Environnement (20/10/2026). Coquille DOM : contenu de
// buildThemeBriefView (pur), cadre de createLayerPanelShell. Clic sur un élément : sa fiche s'ouvre (liste « À traiter » du poste) ;
// « Copier pour une note ».
import type { MapLayers } from '../types/index.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { THEME_BRIEF_TITLE, buildThemeBriefView, themeBriefNoteText, type ThemeBriefInput } from './layer-panel/theme-brief.ts';
import { createLayerPanelShell, isLayerPanelOpen, loadingBody, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';

const PANEL_ID = 'brief';

export type ThemeBriefData = Omit<ThemeBriefInput, 'open'>;

export class ThemeBriefPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onOpenPastille?: (key: keyof MapLayers) => void;
  private onSelectWork?: (key: string) => void;
  private data: ThemeBriefData | null = null;
  private clickCleanup: (() => void) | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'theme-brief-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    const root = this.shell.root;
    const onClick = (e: Event): void => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-copy-note]')) { void this.copyNote(); return; }
      const pastille = t.closest<HTMLElement>('.lp-row.is-link')?.dataset['pastille'];
      if (pastille) { this.onOpenPastille?.(pastille as keyof MapLayers); return; }
      const key = t.closest<HTMLElement>('.lp-row.is-link')?.dataset['work'];
      if (key) this.onSelectWork?.(key);
    };
    root.addEventListener('click', onClick);
    this.clickCleanup = () => root.removeEventListener('click', onClick);
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Ligne de la synthèse des pastilles : le panneau de la pastille s'ouvre. */
  setOnOpenPastille(handler: (key: keyof MapLayers) => void): void { this.onOpenPastille = handler; }
  setOnSelectWork(handler: (key: string) => void): void { this.onSelectWork = handler; }

  show(data: ThemeBriefData | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(data);
  }

  update(data: ThemeBriefData | null): void {
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
      await navigator.clipboard.writeText(themeBriefNoteText({ ...this.data, open: () => true }));
      if (done) done.textContent = 'Copié';
    } catch {
      if (done) done.textContent = 'Copie impossible';
    }
  }

  private render(): void {
    if (!this.shell) return;
    if (!this.data) {
      this.shell.render({ head: { theme: 'Synthèse', title: THEME_BRIEF_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() });
      return;
    }
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildThemeBriefView({ ...this.data, open }));
  }
}
