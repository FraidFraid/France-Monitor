import type { CommodityData } from '../types/index.ts';
import { marketTone, type MarketTone } from '../services/vigilance.ts';
import { buildMarketSparkline } from '../utils/market-sparkline.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import { NBSP, frNumber } from './layer-panel/format.ts';
import { finTableRowHTML } from './shared/fin-table.ts';

// ─── Utilitaires ───────────────────────────────────

/** Cours à la française : virgule décimale, milliers groupés sans décimale. */
export function formatCommodityPrice(value: number): string {
  return frNumber(value, Math.abs(value) >= 1000 ? 0 : 2);
}

/** Variation du jour : signe, virgule, pourcentage insécable. */
export function formatCommodityPct(value: number): string {
  return `${frNumber(value, 2, true)}${NBSP}%`;
}

/** Courbe de la séance : ligne pointillée de la clôture de la veille, infobulle à la française. */
export function commoditySparkline(item: CommodityData, tone: MarketTone = 'neutral'): string {
  const previousClose = item.changePercent > -100 ? item.price / (1 + item.changePercent / 100) : null;
  return buildMarketSparkline(item.history, tone, { reference: previousClose, label: 'séance du jour', format: formatCommodityPrice });
}

/** Ligne de tableau (même style que la stabilité financière) ; pétrole et gaz : seuil de ± 5 %, métaux et agro toujours neutres. */
export function commodityRowHTML(item: CommodityData): string {
  const tone = marketTone(item.changePercent, item.category === 'energy' ? 'energy' : 'other');
  const sense = item.changePercent > 0 ? 'up' : item.changePercent < 0 ? 'down' : 'flat';
  return finTableRowHTML({
    id: item.symbol, name: item.name, unit: item.unit, value: formatCommodityPrice(item.price),
    note: { text: formatCommodityPct(item.changePercent), tone: tone === 'alert' ? 'alert' : sense },
    curve: commoditySparkline(item, tone),
  });
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
      listEl.insertAdjacentHTML('beforeend', commodityRowHTML(item));

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
