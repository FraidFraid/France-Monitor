// src/components/CriminalitePanel.ts : panneau de couche « Criminalité » (spec 2026-10-17 criminalité). Coquille DOM : contenu de
// buildCriminaliteView (pur), cadre de createLayerPanelShell. L'indicateur choisi (liste déroulante) est mémorisé (fm.layer.tabs) et
// transmis à la carte ; une ville cliquée (ou Entrée) recentre la carte. Données statiques annuelles : aucune relève.
import type { CrimeDataset, CrimeIndicatorKey } from '../types/index.ts';
import { CRIME_INDICATOR_KEYS, DEFAULT_CRIME_INDICATOR, isCrimeIndicatorKey } from '../services/crime.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, loadLayerTab, safeStorage, saveLayerTab, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildCriminaliteView } from './layer-panel/criminalite.ts';

const PANEL_ID = 'crime';
const INDICATOR_KEY = 'crime.indicator';

export class CriminalitePanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onIndicator?: (key: CrimeIndicatorKey) => void;
  private onFocusPlace?: (lat: number, lon: number) => void;
  private data: CrimeDataset | null = null;
  private error: string | null = null;
  private indicator: CrimeIndicatorKey;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    const saved = loadLayerTab(this.storage, INDICATOR_KEY, CRIME_INDICATOR_KEYS);
    this.indicator = isCrimeIndicatorKey(saved) ? saved : DEFAULT_CRIME_INDICATOR;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'crime-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
    });
    shell.root.addEventListener('change', (e) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLSelectElement && target.hasAttribute('data-crime-indicator') && isCrimeIndicatorKey(target.value)) this.setIndicator(target.value);
    });
    shell.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('a')) return;
      const key = target.closest<HTMLElement>('[data-crime]')?.dataset['crime'];
      const [lat, lon] = (key ?? '').split(',').map(Number);
      if (key && Number.isFinite(lat) && Number.isFinite(lon)) this.onFocusPlace?.(lat, lon);
    });
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  setOnIndicator(handler: (key: CrimeIndicatorKey) => void): void { this.onIndicator = handler; }
  /** Lignes de ville cliquables seulement avec ce gestionnaire (carte WebGL, posé par App.ts). */
  setOnFocusPlace(handler: (lat: number, lon: number) => void): void { this.onFocusPlace = handler; }
  getIndicator(): CrimeIndicatorKey { return this.indicator; }

  /** Rond de ville cliqué sur la carte : la ligne de la ville est amenée à l'écran (si elle est dans le classement affiché). */
  focusCity(code: string): void {
    if (!this.shell) return;
    const row = [...this.shell.root.querySelectorAll<HTMLElement>('[data-crime-city]')].find((el) => el.dataset['crimeCity'] === code);
    if (!row) return;
    const details = row.closest('details');
    if (details) details.open = true;
    row.scrollIntoView({ block: 'nearest' });
    row.focus({ preventScroll: true });
  }

  show(data: CrimeDataset | null, error: string | null): void {
    this.shell?.root.classList.add('is-open');
    this.update(data, error);
  }

  update(data: CrimeDataset | null, error: string | null): void {
    if (data) this.data = data;
    this.error = error;
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

  private setIndicator(key: CrimeIndicatorKey): void {
    if (key === this.indicator) return;
    this.indicator = key;
    saveLayerTab(this.storage, INDICATOR_KEY, key);
    this.onIndicator?.(key);
    this.render();
    this.shell?.root.querySelector<HTMLElement>('[data-crime-indicator]')?.focus({ preventScroll: true });
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildCriminaliteView({
      data: this.data, error: this.error, indicator: this.indicator, canFocus: this.onFocusPlace !== undefined, now: Date.now(), open,
    }));
  }
}
