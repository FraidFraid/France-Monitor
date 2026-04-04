import type { MarketData } from '../types/index.ts';
import { buildMarketSparkline } from '../utils/market-sparkline.ts';

function escapeHtml(value: string): string {
  const el = document.createElement('div');
  el.textContent = value;
  return el.innerHTML;
}

function formatPrice(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 100) return value.toFixed(2);
  return value.toFixed(2);
}

function formatPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

type MarketCategory = 'indices' | 'defense' | 'services';

const MARKET_SECTIONS: { key: MarketCategory; label: string }[] = [
  { key: 'indices',  label: 'Indices' },
  { key: 'defense',  label: 'Défense & Énergie' },
  { key: 'services', label: 'Services' },
];

const CATEGORY_FALLBACK: MarketCategory = 'services';

export class MarketStrip {
  private container: HTMLElement;
  private bodyEl: HTMLElement | null = null;
  private stampEl: HTMLElement | null = null;
  private barometerDotEl: HTMLElement | null = null;
  private barometerTextEl: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const root = document.createElement('section');
    root.className = 'under-map-card under-map-card--markets';
    root.innerHTML = `
      <div class="under-map-card__header">
        <div style="display: flex; align-items: center;">
          <div class="under-map-card__title">Flux boursier</div>
          <div style="font-size: 10px; font-weight: bold; display: flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); margin-left: 12px; letter-spacing: 0.5px;">
            <span class="market-barometer-dot" style="width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); display: inline-block;"></span>
            <span class="market-barometer-text" style="color: var(--text-muted); text-transform: uppercase;">Évaluation en cours</span>
          </div>
        </div>
        <div class="under-map-card__meta" id="market-strip-stamp">Chargement...</div>
      </div>
      <div class="under-map-card__body" id="market-strip-body"></div>
    `;

    this.container.appendChild(root);
    this.bodyEl = root.querySelector('#market-strip-body');
    this.stampEl = root.querySelector('#market-strip-stamp');
    this.barometerDotEl = root.querySelector('.market-barometer-dot');
    this.barometerTextEl = root.querySelector('.market-barometer-text');
    this.renderLoading();
  }

  update(items: MarketData[]): void {
    if (!this.bodyEl || !this.stampEl) return;

    if (!items.length) {
      this.renderEmpty();
      return;
    }

    const avgChange = items.reduce((sum, item) => sum + item.changePercent, 0) / (items.length || 1);
    if (this.barometerDotEl && this.barometerTextEl) {
      let color = '#9ca3af'; // text-muted / flat
      let text = 'CLIMAT STABLE';
      if (avgChange > 0.1) {
        color = '#4ade80'; // theme green
        text = `TENDANCE HAUSSIÈRE (+${avgChange.toFixed(2)}%)`;
      } else if (avgChange < -0.1) {
        color = '#f87171'; // theme red
        text = `TENDANCE BAISSIÈRE (${avgChange.toFixed(2)}%)`;
      }

      this.barometerDotEl.style.background = color;
      this.barometerDotEl.style.boxShadow = `0 0 6px ${color}`;
      this.barometerTextEl.textContent = text;
      this.barometerTextEl.style.color = color;
    }

    this.bodyEl.innerHTML = '';

    for (const section of MARKET_SECTIONS) {
      const sectionItems = items.filter(
        item => (item.category ?? CATEGORY_FALLBACK) === section.key,
      );
      if (!sectionItems.length) continue;

      const sectionEl = document.createElement('div');
      sectionEl.className = `market-strip__section market-strip__section--${section.key}`;

      const label = document.createElement('div');
      label.className = 'market-strip__section-label';
      label.textContent = section.label;
      sectionEl.appendChild(label);

      const list = document.createElement('div');
      list.className = 'market-strip__list';

      for (const item of sectionItems) {
        const trendClass =
          item.trend === 'up' ? 'is-up' :
          item.trend === 'down' ? 'is-down' :
          'is-flat';

        const card = document.createElement('article');
        card.className = `market-strip__item ${trendClass}`;
        card.innerHTML = `
          <div class="market-strip__topline">
            <span class="market-strip__name">${escapeHtml(item.name)}</span>
            <span class="market-strip__symbol">${escapeHtml(item.symbol)}</span>
          </div>
          <div class="market-strip__price">${escapeHtml(formatPrice(item.price))}</div>
          <div class="market-strip__delta">${escapeHtml(formatPct(item.changePercent))}</div>
          ${buildMarketSparkline(item.history, item.trend)}
        `;
        list.appendChild(card);
      }

      sectionEl.appendChild(list);
      this.bodyEl.appendChild(sectionEl);
    }

    const latestTs = items.reduce((latest, item) => {
      const ts = item.lastUpdated instanceof Date ? item.lastUpdated.getTime() : new Date(item.lastUpdated).getTime();
      return Math.max(latest, ts);
    }, 0);

    this.stampEl.textContent = latestTs > 0
      ? `MàJ ${new Date(latestTs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
      : 'MàJ indisponible';
  }

  private renderLoading(): void {
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = `
      <div class="under-map-card__empty">
        <div class="under-map-card__empty-title">Chargement des marchés</div>
      </div>
    `;
  }

  private renderEmpty(): void {
    if (!this.bodyEl || !this.stampEl) return;
    this.stampEl.textContent = 'Source indisponible';
    this.bodyEl.innerHTML = `
      <div class="under-map-card__empty">
        <div class="under-map-card__empty-title">Flux boursier indisponible</div>
      </div>
    `;
  }
}
