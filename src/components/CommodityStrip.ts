import type { CommodityData } from '../types/index.ts';
import { buildMarketSparkline } from '../utils/market-sparkline.ts';

// ─── Utilitaires (identiques à MarketStrip) ───────────────────────────────────

function escapeHtml(value: string): string {
  const el = document.createElement('div');
  el.textContent = value;
  return el.innerHTML;
}

function formatPrice(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 100)  return value.toFixed(2);
  return value.toFixed(2);
}

function formatPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export class CommodityStrip {
  private container: HTMLElement;
  private listEls: Record<'energy' | 'metals' | 'agro', HTMLElement | null> = {
    energy: null,
    metals: null,
    agro: null,
  };
  private stampEl: HTMLElement | null = null;
  /** Re-render guard: serialized snapshot of the last rendered dataset. */
  private lastRenderKey: string | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const root = document.createElement('section');
    root.className = 'under-map-card under-map-card--commodities';
    root.innerHTML = `
      <div class="under-map-card__header">
        <div class="under-map-card__title">Matières premières</div>
        <div class="under-map-card__meta" id="commodity-strip-stamp">Chargement...</div>
      </div>
      <div class="under-map-card__body">
        <div class="commodity-strip__section commodity-strip__section--energy">
          <div class="commodity-strip__section-label">ENERGIE</div>
          <div class="commodity-strip__list" id="commodity-list-energy"></div>
        </div>
        <div class="commodity-strip__section commodity-strip__section--metals">
          <div class="commodity-strip__section-label">METAUX</div>
          <div class="commodity-strip__list" id="commodity-list-metals"></div>
        </div>
        <div class="commodity-strip__section commodity-strip__section--agro">
          <div class="commodity-strip__section-label">AGRO</div>
          <div class="commodity-strip__list" id="commodity-list-agro"></div>
        </div>
      </div>
    `;

    this.container.appendChild(root);
    this.listEls.energy = root.querySelector('#commodity-list-energy');
    this.listEls.metals = root.querySelector('#commodity-list-metals');
    this.listEls.agro   = root.querySelector('#commodity-list-agro');
    this.stampEl = root.querySelector('#commodity-strip-stamp');
    this.renderLoading();
  }

  update(items: CommodityData[]): void {
    // Skip the full DOM rebuild when the dataset is byte-identical
    // (cards and stamp are all derived from `items`).
    const renderKey = JSON.stringify(items);
    if (renderKey === this.lastRenderKey) return;
    this.lastRenderKey = renderKey;

    if (!items.length) {
      this.renderEmpty();
      return;
    }

    // Vider les listes
    for (const cat of ['energy', 'metals', 'agro'] as const) {
      const el = this.listEls[cat];
      if (el) el.innerHTML = '';
    }

    let latestTs = 0;

    for (const item of items) {
      const listEl = this.listEls[item.category];
      if (!listEl) continue;

      const trendClass =
        item.trend === 'up'   ? 'is-up' :
        item.trend === 'down' ? 'is-down' :
        'is-flat';

      const card = document.createElement('article');
      card.className = `market-strip__item ${trendClass}`;
      card.innerHTML = `
        <div class="market-strip__topline">
          <span class="market-strip__name">${escapeHtml(item.name)}</span>
          <span class="market-strip__symbol">${escapeHtml(item.unit)}</span>
        </div>
        <div class="market-strip__price">${escapeHtml(formatPrice(item.price))}</div>
        <div class="market-strip__delta">${escapeHtml(formatPct(item.changePercent))}</div>
        ${buildMarketSparkline(item.history, item.trend)}
      `;
      listEl.appendChild(card);

      const ts = item.lastUpdated instanceof Date
        ? item.lastUpdated.getTime()
        : new Date(item.lastUpdated).getTime();
      latestTs = Math.max(latestTs, ts);
    }

    if (this.stampEl) {
      this.stampEl.textContent = latestTs > 0
        ? `MàJ ${new Date(latestTs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
        : 'MàJ indisponible';
    }
  }

  private renderLoading(): void {
    for (const cat of ['energy', 'metals', 'agro'] as const) {
      const el = this.listEls[cat];
      if (el) el.innerHTML = `<div class="under-map-card__empty"><div class="under-map-card__empty-title">Chargement...</div></div>`;
    }
  }

  private renderEmpty(): void {
    if (this.stampEl) this.stampEl.textContent = 'Source indisponible';
    for (const cat of ['energy', 'metals', 'agro'] as const) {
      const el = this.listEls[cat];
      if (el) el.innerHTML = `<div class="under-map-card__empty"><div class="under-map-card__empty-title">Indisponible</div></div>`;
    }
  }
}
