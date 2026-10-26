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
  private onFocusPoint?: (lon: number, lat: number) => void;
  private onHoverPoint?: (n: number | null) => void;
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
      // Point de vigilance Transports : la carte se centre dessus.
      const point = t.closest<HTMLElement>('.tb-point[data-lon]');
      if (point) {
        const lon = Number(point.dataset['lon']);
        const lat = Number(point.dataset['lat']);
        if (Number.isFinite(lon) && Number.isFinite(lat)) this.onFocusPoint?.(lon, lat);
        return;
      }
      const pastille = t.closest<HTMLElement>('.lp-row.is-link')?.dataset['pastille'];
      if (pastille) { this.onOpenPastille?.(pastille as keyof MapLayers); return; }
      const key = t.closest<HTMLElement>('.lp-row.is-link')?.dataset['work'];
      if (key) this.onSelectWork?.(key);
    };
    // Survol d'un point de vigilance : son étiquette et ses trajets s'allument sur la carte.
    const onOver = (e: Event): void => {
      const n = Number((e.target as HTMLElement).closest<HTMLElement>('.tb-point[data-point]')?.dataset['point']);
      this.onHoverPoint?.(Number.isFinite(n) && n > 0 ? n : null);
    };
    const onLeave = (): void => this.onHoverPoint?.(null);
    root.addEventListener('click', onClick);
    root.addEventListener('mouseover', onOver);
    root.addEventListener('mouseleave', onLeave);
    this.clickCleanup = () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('mouseover', onOver);
      root.removeEventListener('mouseleave', onLeave);
    };
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  /** Ligne de la synthèse des pastilles : le panneau de la pastille s'ouvre. */
  setOnOpenPastille(handler: (key: keyof MapLayers) => void): void { this.onOpenPastille = handler; }
  setOnSelectWork(handler: (key: string) => void): void { this.onSelectWork = handler; }
  /** Point de vigilance (onglet Transports) : centrer la carte. */
  setOnFocusPoint(handler: (lon: number, lat: number) => void): void { this.onFocusPoint = handler; }
  setOnHoverPoint(handler: (n: number | null) => void): void { this.onHoverPoint = handler; }

  /**
   * Survol d'une étiquette de la carte : le point de vigilance est mis en avant ici et amené en vue (la carte reste dégagée, sans
   * bulle). false : panneau fermé ou point absent, la carte montre alors sa propre infobulle.
   */
  highlightPoint(n: number | null): boolean {
    const root = this.shell?.root;
    if (!root || !this.isVisible()) return false;
    for (const el of root.querySelectorAll('.tb-point.is-hot')) el.classList.remove('is-hot');
    if (n === null) return true;
    const el = root.querySelector<HTMLElement>(`.tb-point[data-point="${n}"]`);
    // Section repliée : le point n'est pas visible, la carte montre son infobulle.
    if (!el || el.offsetParent === null) return false;
    el.classList.add('is-hot');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return true;
  }

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
