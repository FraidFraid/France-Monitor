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

export class MarketStrip {
  private container: HTMLElement;
  private listEl: HTMLElement | null = null;
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
      <div class="under-map-card__body">
        <div class="market-strip__list" id="market-strip-list"></div>
      </div>
    `;

    this.container.appendChild(root);
    this.listEl = root.querySelector('#market-strip-list');
    this.stampEl = root.querySelector('#market-strip-stamp');
    this.renderLoading();
  }

  update(items: MarketData[]): void {
    if (!this.listEl || !this.stampEl) return;

    if (!items.length) {
      this.renderEmpty();
      return;
    }

    const sorted = [...items].sort((a, b) => {
      const diff = Math.abs(b.changePercent) - Math.abs(a.changePercent);
      if (Math.abs(diff) > 0.001) return diff;
      return a.name.localeCompare(b.name, 'fr');
    });

    this.listEl.innerHTML = '';

    for (const item of sorted) {
      const card = document.createElement('article');
      const trendClass =
        item.trend === 'up' ? 'is-up' :
        item.trend === 'down' ? 'is-down' :
        'is-flat';

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
      this.listEl.appendChild(card);
    }

    const latestTs = sorted.reduce((latest, item) => {
      const ts = item.lastUpdated instanceof Date ? item.lastUpdated.getTime() : new Date(item.lastUpdated).getTime();
      return Math.max(latest, ts);
    }, 0);

    this.stampEl.textContent = latestTs > 0
      ? `MàJ ${new Date(latestTs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
      : 'MàJ indisponible';
  }

  private renderLoading(): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = `
      <div class="under-map-card__empty">
        <div class="under-map-card__empty-title">Chargement des marchés</div>
        <div class="under-map-card__empty-text">Le premier bloc sous la carte est prêt et attend les cours.</div>
      </div>
    `;
  }

  private renderEmpty(): void {
    if (!this.listEl || !this.stampEl) return;
    this.stampEl.textContent = 'Source indisponible';
    this.listEl.innerHTML = `
      <div class="under-map-card__empty">
        <div class="under-map-card__empty-title">Flux boursier indisponible</div>
        <div class="under-map-card__empty-text">L’espace sous la carte est en place. Les prochains modules pourront s’y ajouter sans refonte du shell.</div>
      </div>
    `;
  }
}
