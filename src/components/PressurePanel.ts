// src/components/PressurePanel.ts : panneau de couche « Pression par département » (v2, 12/10/2026), à la place de l'ISNRPanel.
// Coquille DOM : contenu de buildPressureView (pur), cadre de createLayerPanelShell. Un clic sur un département le choisit (ses
// éléments s'affichent, la carte le met en évidence) ; un clic sur un élément ouvre sa fiche.
import type { DepartmentPressure } from '../services/department-pressure.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildPressureView } from './layer-panel/pression.ts';

const PANEL_ID = 'pressure';

export class PressurePanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onSelectDepartment?: (code: string | null) => void;
  private onOpenElement?: (key: string) => void;
  private depts: readonly DepartmentPressure[] | null = null;
  private selected: string | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'pressure-panel-modal', panelId: PANEL_ID,
      onClose: () => this.hide(), storage: this.storage,
    });
    this.shell.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const key = target.closest<HTMLElement>('.lp-row.is-link[data-key]')?.dataset['key'];
      if (key) {
        this.onOpenElement?.(key);
        return;
      }
      const code = target.closest<HTMLElement>('.lp-row.is-link[data-dept]')?.dataset['dept'];
      if (!code) return;
      // Second clic sur le même département : le choix est levé.
      this.selected = this.selected === code ? null : code;
      this.onSelectDepartment?.(this.selected);
      this.render();
    });
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  setOnSelectDepartment(handler: (code: string | null) => void): void { this.onSelectDepartment = handler; }
  setOnOpenElement(handler: (key: string) => void): void { this.onOpenElement = handler; }

  show(depts: readonly DepartmentPressure[] | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(depts);
  }

  update(depts: readonly DepartmentPressure[] | null): void {
    this.depts = depts;
    // Département sorti de la liste (redevenu vert) : le choix est levé.
    if (this.selected !== null && depts !== null && !depts.some((d) => d.code === this.selected)) {
      this.selected = null;
      this.onSelectDepartment?.(null);
    }
    this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.shell?.root.classList.remove('is-open');
    if (this.selected !== null) {
      this.selected = null;
      this.onSelectDepartment?.(null);
    }
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
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.patch(buildPressureView({ depts: this.depts, selected: this.selected, open }));
  }
}
