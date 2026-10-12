import type { CommodityData } from '../types/index.ts';
import { marketTone } from '../services/vigilance.ts';
import { buildMarketSparkline } from '../utils/market-sparkline.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import { NBSP, frNumber } from './layer-panel/format.ts';

// ─── Utilitaires ───────────────────────────────────

function escapeHtml(value: string): string {
  const el = document.createElement('div');
  el.textContent = value;
  return el.innerHTML;
}

/** Cours à la française : virgule décimale, milliers groupés sans décimale. */
export function formatCommodityPrice(value: number): string {
  return frNumber(value, Math.abs(value) >= 1000 ? 0 : 2);
}

/** Variation du jour : signe, virgule, pourcentage insécable. */
export function formatCommodityPct(value: number): string {
  return `${frNumber(value, 2, true)}${NBSP}%`;
}

export const SECTION_LABELS: Readonly<Record<'energy' | 'metals' | 'agro', string>> = { energy: 'Énergie', metals: 'Métaux', agro: 'Agro' };

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
          <div class="commodity-strip__section-label">${SECTION_LABELS.energy}</div>
          <div class="commodity-strip__list" id="commodity-list-energy"></div>
        </div>
        <div class="commodity-strip__section commodity-strip__section--metals">
          <div class="commodity-strip__section-label">${SECTION_LABELS.metals}</div>
          <div class="commodity-strip__list" id="commodity-list-metals"></div>
        </div>
        <div class="commodity-strip__section commodity-strip__section--agro">
          <div class="commodity-strip__section-label">${SECTION_LABELS.agro}</div>
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

      // Pétrole et gaz : seuil de ±5 % ; métaux et produits agricoles toujours neutres.
      const tone = marketTone(item.changePercent, item.category === 'energy' ? 'energy' : 'other');

      const card = document.createElement('article');
      card.className = `market-strip__item is-${tone}`;
      card.innerHTML = `
        <div class="market-strip__topline">
          <span class="market-strip__name">${escapeHtml(item.name)}</span>
          <span class="market-strip__symbol">${escapeHtml(item.unit)}</span>
        </div>
        <div class="market-strip__price">${escapeHtml(formatCommodityPrice(item.price))}</div>
        <div class="market-strip__delta">${escapeHtml(formatCommodityPct(item.changePercent))}</div>
        ${buildMarketSparkline(item.history, tone)}
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
      if (el) el.innerHTML = fmLoaderHTML({ text: 'Chargement des cours…', variant: 'inline' });
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
