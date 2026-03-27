import type { MarketData } from '../types/index.ts';

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

function buildSparkline(history: number[] | undefined, trend: MarketData['trend']): string {
  if (!history || history.length < 2) return '';

  const width = 112;
  const height = 28;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const points = history.map((value, index) => {
    const x = (index / (history.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const stroke =
    trend === 'up' ? 'var(--threat-low)' :
    trend === 'down' ? 'var(--threat-high)' :
    'var(--text-muted)';

  return `
    <svg class="market-strip__sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
    </svg>
  `;
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

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const root = document.createElement('section');
    root.className = 'under-map-card under-map-card--markets';
    root.innerHTML = `
      <div class="under-map-card__header">
        <div>
          <div class="under-map-card__title">Flux boursier</div>
        </div>
        <div class="under-map-card__meta" id="market-strip-stamp">Chargement...</div>
      </div>
      <div class="under-map-card__body" id="market-strip-body"></div>
    `;

    this.container.appendChild(root);
    this.bodyEl = root.querySelector('#market-strip-body');
    this.stampEl = root.querySelector('#market-strip-stamp');
    this.renderLoading();
  }

  update(items: MarketData[]): void {
    if (!this.bodyEl || !this.stampEl) return;

    if (!items.length) {
      this.renderEmpty();
      return;
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
          ${buildSparkline(item.history, item.trend)}
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
