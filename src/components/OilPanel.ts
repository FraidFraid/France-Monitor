// src/components/OilPanel.ts : panneau de couche « Pétrole » (spec 2026-10-02 lot 2 § 3.3).
// Coquille DOM : contenu de buildOilView (pur), cadre de createLayerPanelShell ; état d'interface local
// (onglet mémorisé, période du graphe, recherche, couche départementale sur la carte).
import type { FuelTensionDashboard, OilDashboard } from '../types/index.ts';
import { isOilPanelEnabled } from '../services/oil.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { filterFuelPriceSeries, type FuelPriceChartRange } from '../utils/fuelPriceChart.ts';
import {
  createLayerPanelShell, isLayerPanelOpen, loadLayerTab, safeStorage, saveLayerTab, sectionOpenOf, type LayerPanelShell,
} from './layer-panel/frame.ts';
import { buildOilView, fuelTooltipHtml, nearestTimestamp, OIL_TABS, type OilTab } from './layer-panel/oil.ts';

const PANEL_ID = 'oilNetwork';

export class OilPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onMapVisibility?: (visible: boolean) => void;
  private data: OilDashboard | null = null;
  private tension: FuelTensionDashboard | null = null;
  private range: FuelPriceChartRange = '1m';
  private search = '';
  private mapVisible = false;
  private tab: OilTab;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;
  private readonly isEnabled: () => boolean;

  constructor(container: HTMLElement, opts: { isEnabled?: () => boolean } = {}) {
    this.container = container;
    this.isEnabled = opts.isEnabled ?? isOilPanelEnabled;
    this.tab = loadLayerTab(this.storage, PANEL_ID, OIL_TABS) as OilTab;
  }

  mount(): void {
    const shell = createLayerPanelShell({
      container: this.container, className: 'oil-panel-modal', panelId: PANEL_ID, storage: this.storage,
      onClose: () => this.hide(),
      onTab: (id) => {
        if (!(OIL_TABS as readonly string[]).includes(id)) return;
        this.tab = id as OilTab;
        saveLayerTab(this.storage, PANEL_ID, id);
        this.render();
      },
    });
    shell.root.addEventListener('click', (e) => this.onClick(e));
    shell.root.addEventListener('input', (e) => this.onInput(e));
    shell.root.addEventListener('mousemove', (e) => this.onPointer(e));
    shell.root.addEventListener('mouseleave', () => this.hideTip());
    this.shell = shell;
  }

  setOnClose(handler: () => void): void { this.onClose = handler; }
  setOnFuelTensionMapVisibilityChange(handler: (visible: boolean) => void): void { this.onMapVisibility = handler; }
  isFuelTensionMapVisible(): boolean { return this.mapVisible; }

  show(data: OilDashboard | null, fuelTension: FuelTensionDashboard | null = null): void {
    this.data = data;
    this.tension = fuelTension;
    this.shell?.root.classList.add('is-open');
    this.render();
  }

  update(data: OilDashboard, fuelTension: FuelTensionDashboard | null = null): void {
    this.data = data;
    this.tension = fuelTension;
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

  private onClick(e: Event): void {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const range = target.closest<HTMLElement>('[data-oil-range]')?.dataset['oilRange'];
    if (range === '1m' || range === '1y') {
      this.range = range;
      this.render();
      return;
    }
    if (target.closest('[data-oil-map]')) {
      this.mapVisible = !this.mapVisible;
      this.onMapVisibility?.(this.mapVisible);
      this.render();
    }
  }

  private onInput(e: Event): void {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('[data-oil-search]')) return;
    this.search = input.value;
    this.render();
    // Le rendu remplace le champ : on rend le focus et le curseur à la nouvelle saisie.
    const next = this.shell?.root.querySelector<HTMLInputElement>('[data-oil-search]');
    if (next) {
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    }
  }

  private onPointer(e: MouseEvent): void {
    const el = e.target instanceof Element ? e.target : null;
    const svg = el?.closest('.lp-fuel-chart svg') ?? null;
    const tip = this.shell?.root.querySelector<HTMLElement>('.lp-tip') ?? null;
    const history = this.data?.fuelPriceHistory ?? null;
    if (!svg || !tip || !history) {
      this.hideTip();
      return;
    }
    const box = svg.getBoundingClientRect();
    const series = filterFuelPriceSeries(history, this.range);
    const at = nearestTimestamp(series, box.width > 0 ? (e.clientX - box.left) / box.width : 1);
    if (at === null) {
      this.hideTip();
      return;
    }
    tip.innerHTML = fuelTooltipHtml(series, at);
    tip.hidden = false;
    const wrap = svg.parentElement?.getBoundingClientRect();
    const left = e.clientX - (wrap?.left ?? 0) + 12;
    tip.style.left = `${Math.max(4, Math.min((wrap?.width ?? 0) - 190, left))}px`;
    tip.style.top = `${Math.max(4, e.clientY - (wrap?.top ?? 0) - 8)}px`;
  }

  private hideTip(): void {
    const tip = this.shell?.root.querySelector<HTMLElement>('.lp-tip');
    if (tip) tip.hidden = true;
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.render(buildOilView({
      data: this.data, tension: this.tension, enabled: this.isEnabled(), tab: this.tab, range: this.range,
      search: this.search, mapVisible: this.mapVisible, now: Date.now(), open,
    }));
  }
}
