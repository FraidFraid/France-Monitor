import type { NewsItem, FilterState, EventCategory, ThreatLevel, TimeRange, MapLayers } from '../types/index.ts';

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "à l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days}j`;
}

const CATEGORY_ICONS: Record<string, string> = {
  social: '✊',
  security: '🚨',
  energy: '⚡',
  weather: '🌩️',
  transport: '🚆',
  infrastructure: '🏗️',
  health: '🏥',
  general: '📰',
};

export type NewsItemClickHandler = (item: NewsItem) => void;
export type NewsFilterChangeHandler = (filter: FilterState) => void;

const DEFAULT_LAYERS: MapLayers = {
  newsGroup: false,
  news: false,
  alerts: false,
  energyGroup: false,
  energy: false,
  hydraulic: false,
  eolien: false,
  health: false,
  healthOscour: false,
  healthApl: false,
  hospitals: false,
  environmentGroup: false,
  environmental: false,
  fires: false,
  infrastructure: false,
  traffic: true,
  trafficRoad: false,
  trafficMaritime: true,
  trafficAir: false,
  trafficRail: false,
  metropoles: false,
  sovereignty: false,
  military: false,
  subseaCables: false,
  outages: false,
  outagesElec: false,
  outagesTelecom: false,
  outagesInternet: false,
  outagesCloud: false,
  stability: false,
  cyber: false,
  gas: false,
  oil: false,
  nuclear: false,
  dayNight: false,
  elus: false,
};

const DEFAULT_FILTER: FilterState = {
  timeRange: '24h',
  categories: [],
  threatLevels: [],
  layers: { ...DEFAULT_LAYERS },
  searchQuery: '',
};

const TIME_OPTIONS: Array<{ label: string; value: TimeRange }> = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '48h', value: '48h' },
  { label: '7j', value: '7d' },
  { label: 'Tout', value: 'all' },
];

const CATEGORY_OPTIONS: Array<{ label: string; icon: string; value: EventCategory }> = [
  { label: 'Social', icon: '✊', value: 'social' },
  { label: 'Securite', icon: '🚨', value: 'security' },
  { label: 'Energie', icon: '⚡', value: 'energy' },
  { label: 'Meteo', icon: '🌩️', value: 'weather' },
  { label: 'Transport', icon: '🚆', value: 'transport' },
  { label: 'Infra', icon: '🏗️', value: 'infrastructure' },
  { label: 'Sante', icon: '🏥', value: 'health' },
];

const LEVEL_OPTIONS: Array<{ label: string; value: ThreatLevel; color: string }> = [
  { label: 'CRITICAL', value: 'critical', color: 'var(--threat-critical)' },
  { label: 'HIGH', value: 'high', color: 'var(--threat-high)' },
  { label: 'MEDIUM', value: 'medium', color: 'var(--threat-medium)' },
  { label: 'LOW', value: 'low', color: 'var(--threat-low)' },
  { label: 'INFO', value: 'info', color: 'var(--threat-info)' },
];

export class UnderMapNewsFeed {
  private container: HTMLElement;
  private rootEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private items: NewsItem[] = [];
  private filteredItems: NewsItem[] = [];
  private filter: FilterState = { ...DEFAULT_FILTER, categories: [], threatLevels: [], layers: { ...DEFAULT_LAYERS } };
  private onItemClick: NewsItemClickHandler | null = null;
  private onFilterChange: NewsFilterChangeHandler | null = null;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const root = document.createElement('section');
    root.className = 'under-map-card under-map-card--news';
    root.innerHTML = `
      <div class="under-map-card__header">
        <div class="under-map-card__header-copy">
          <div class="under-map-card__title">Flux actualités</div>
        </div>
        <div class="under-map-card__meta" id="under-map-news-count">Chargement...</div>
      </div>
      <div class="under-map-news__controls">
        <div class="under-map-news__timebar">
          ${TIME_OPTIONS.map((option) => `
            <button
              type="button"
              class="under-map-news__time-btn ${this.filter.timeRange === option.value ? 'active' : ''}"
              data-time-range="${option.value}"
            >${option.label}</button>
          `).join('')}
        </div>
        <div class="under-map-news__search">
          <input
            type="text"
            class="under-map-news__search-input"
            placeholder="Rechercher une actu, une source, un lieu..."
          />
        </div>
        <div class="under-map-news__filter-group">
          <div class="under-map-news__filter-label">Categories</div>
          <div class="under-map-news__filter-row">
            ${CATEGORY_OPTIONS.map((option) => `
              <button
                type="button"
                class="filter-chip ${this.filter.categories.includes(option.value) ? 'filter-chip--active' : ''}"
                data-category-value="${option.value}"
              >${option.icon} ${option.label}</button>
            `).join('')}
          </div>
        </div>
        <div class="under-map-news__filter-group">
          <div class="under-map-news__filter-label">Niveaux</div>
          <div class="under-map-news__filter-row">
            ${LEVEL_OPTIONS.map((option) => `
              <button
                type="button"
                class="filter-chip ${this.filter.threatLevels.includes(option.value) ? 'filter-chip--active' : ''}"
                data-level-value="${option.value}"
                style="border-left:3px solid ${option.color};"
              >${option.label}</button>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="under-map-card__body under-map-news__body">
        <div class="under-map-news__list" id="under-map-news-list"></div>
      </div>
    `;

    this.container.appendChild(root);
    this.rootEl = root;
    this.countEl = root.querySelector('#under-map-news-count');
    this.listEl = root.querySelector('#under-map-news-list');
    this.bindControls(root);
    this.syncControls();
    this.renderLoading();
  }

  setOnItemClick(handler: NewsItemClickHandler): void {
    this.onItemClick = handler;
  }

  setOnFilterChange(handler: NewsFilterChangeHandler): void {
    this.onFilterChange = handler;
  }

  setFilter(filter: Partial<FilterState>): void {
    this.filter = {
      ...this.filter,
      ...filter,
      categories: filter.categories ? [...filter.categories] : [...this.filter.categories],
      threatLevels: filter.threatLevels ? [...filter.threatLevels] : [...this.filter.threatLevels],
      layers: filter.layers ? { ...filter.layers } : { ...this.filter.layers },
      searchQuery: filter.searchQuery ?? this.filter.searchQuery,
    };
    this.syncControls();
    this.applyFilter();
    if (this.items.length > 0) {
      this.renderList();
    }
  }

  updateItems(items: NewsItem[], filter?: FilterState): void {
    this.items = [...items].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    if (filter) {
      this.filter = {
        ...filter,
        categories: [...filter.categories],
        threatLevels: [...filter.threatLevels],
        layers: { ...filter.layers },
      };
      this.syncControls();
    }
    this.applyFilter();
    this.renderList();
  }

  highlightItem(itemId?: string): void {
    if (!this.listEl) return;
    const allItems = this.listEl.querySelectorAll('.news-item');
    for (const el of allItems) {
      const htmlEl = el as HTMLElement;
      if (itemId && htmlEl.dataset.itemId === itemId) {
        htmlEl.classList.add('news-item--selected');
      } else {
        htmlEl.classList.remove('news-item--selected');
      }
    }
  }

  selectItem(itemId: string): void {
    if (!this.listEl) return;

    const allItems = this.listEl.querySelectorAll('.news-item');
    for (const el of allItems) {
      (el as HTMLElement).classList.remove('news-item--selected');
    }

    const target = this.listEl.querySelector(`[data-item-id="${itemId}"]`) as HTMLElement | null;
    if (target) {
      target.classList.add('news-item--selected');
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  private renderLoading(): void {
    if (!this.listEl || !this.countEl) return;
    this.countEl.textContent = 'Chargement...';
    this.listEl.innerHTML = `
      <div class="under-map-card__empty">
        <div class="under-map-card__empty-title">Chargement du flux</div>
        <div class="under-map-card__empty-text">Le flux des actualités sera affiché ici, à côté du marché.</div>
      </div>
    `;
  }

  private applyFilter(): void {
    const now = Date.now();
    const rangeMs: Record<string, number> = {
      '1h': 3600 * 1000,
      '6h': 6 * 3600 * 1000,
      '24h': 24 * 3600 * 1000,
      '48h': 48 * 3600 * 1000,
      '7d': 7 * 24 * 3600 * 1000,
    };
    const maxAge = rangeMs[this.filter.timeRange] ?? Infinity;
    const cats = new Set<EventCategory>(this.filter.categories);
    const levels = new Set<ThreatLevel>(this.filter.threatLevels);

    this.filteredItems = this.items.filter((item) => {
      if (now - item.pubDate.getTime() > maxAge) return false;
      if (cats.size > 0 && item.threat && !cats.has(item.threat.category)) return false;
      if (levels.size > 0 && item.threat && !levels.has(item.threat.level)) return false;
      if (this.filter.searchQuery) {
        const q = this.filter.searchQuery.toLowerCase();
        if (
          !item.title.toLowerCase().includes(q) &&
          !item.source.toLowerCase().includes(q) &&
          !(item.locationName ?? '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }

  private renderList(): void {
    if (!this.listEl || !this.countEl) return;

    const alertCount = this.filteredItems.filter((i) => i.isAlert).length;
    this.countEl.textContent = `${this.filteredItems.length} actus${alertCount > 0 ? ` · ${alertCount} alertes` : ''}`;
    this.listEl.innerHTML = '';

    if (this.filteredItems.length === 0) {
      this.listEl.innerHTML = `
        <div class="under-map-card__empty">
          <div class="under-map-card__empty-title">Aucune actualité</div>
          <div class="under-map-card__empty-text">Aucun article ne correspond aux filtres actifs.</div>
        </div>
      `;
      return;
    }

    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;

    for (const item of this.filteredItems) {
      const el = document.createElement('article');
      el.className = 'news-item under-map-news__item';
      if (item.isAlert) el.classList.add('news-item--alert');

      const level = item.threat?.level ?? 'info';
      const category = item.threat?.category ?? 'general';
      const icon = CATEGORY_ICONS[category] ?? '📰';
      const isNew = now - item.pubDate.getTime() < ONE_HOUR_MS;
      const newBadge = isNew ? '<span class="badge-new">NEW</span>' : '';

      el.dataset.itemId = item.id;
      el.innerHTML = `
        <div class="news-item-title">${escapeHtml(item.title)}${newBadge}</div>
        ${item.aiSummary ? `<div class="news-item-summary under-map-news__summary">${escapeHtml(item.aiSummary)}</div>` : ''}
        <div class="news-item-meta under-map-news__meta">
          <span class="threat-badge threat-badge--${escapeHtml(level)}">${escapeHtml(level)}</span>
          <span class="category-badge">${icon} ${escapeHtml(category)}</span>
          <span class="news-item-source">${escapeHtml(item.source)}</span>
          <span class="news-item-time">${escapeHtml(timeAgo(item.pubDate))}</span>
          ${item.threat?.source === 'ml' ? '<span title="IA" style="font-size:10px;margin-left:auto;">🤖</span>' : ''}
        </div>
      `;

      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.read-article-btn')) return;
        this.selectItem(item.id);
        if (item.lat != null && item.lon != null && this.onItemClick) {
          this.onItemClick(item);
        }
      });

      if (item.link && item.link !== '#') {
        const btnRow = document.createElement('div');
        btnRow.className = 'under-map-news__actions';

        const btn = document.createElement('button');
        btn.className = 'read-article-btn';
        btn.textContent = 'Lire ↗';
        btn.style.cssText = 'font-size:11px;padding:3px 8px;background:rgba(108,140,255,0.15);border:1px solid rgba(108,140,255,0.32);border-radius:4px;color:#8cacff;cursor:pointer;font-family:inherit;';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.open(item.link, '_blank', 'noopener');
        });
        btnRow.appendChild(btn);
        el.appendChild(btnRow);
      }

      if (item.isAlert) {
        el.style.borderLeft = '3px solid var(--threat-critical)';
        el.style.paddingLeft = '9px';
      }

      this.listEl.appendChild(el);
    }
  }

  private bindControls(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-time-range]').forEach((button) => {
      button.addEventListener('click', () => {
        const range = button.dataset.timeRange as TimeRange | undefined;
        if (!range || range === this.filter.timeRange) return;
        this.updateFilter({ timeRange: range });
      });
    });

    root.querySelectorAll<HTMLElement>('[data-category-value]').forEach((button) => {
      button.addEventListener('click', () => {
        const category = button.dataset.categoryValue as EventCategory | undefined;
        if (!category) return;
        const categories = this.filter.categories.includes(category)
          ? this.filter.categories.filter((value) => value !== category)
          : [...this.filter.categories, category];
        this.updateFilter({ categories });
      });
    });

    root.querySelectorAll<HTMLElement>('[data-level-value]').forEach((button) => {
      button.addEventListener('click', () => {
        const level = button.dataset.levelValue as ThreatLevel | undefined;
        if (!level) return;
        const threatLevels = this.filter.threatLevels.includes(level)
          ? this.filter.threatLevels.filter((value) => value !== level)
          : [...this.filter.threatLevels, level];
        this.updateFilter({ threatLevels });
      });
    });

    const searchInput = root.querySelector<HTMLInputElement>('.under-map-news__search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        if (this.searchDebounce) clearTimeout(this.searchDebounce);
        this.searchDebounce = setTimeout(() => {
          this.updateFilter({ searchQuery: searchInput.value.trim() });
        }, 180);
      });
    }
  }

  private syncControls(): void {
    if (!this.rootEl) return;

    this.rootEl.querySelectorAll<HTMLElement>('[data-time-range]').forEach((button) => {
      button.classList.toggle('active', button.dataset.timeRange === this.filter.timeRange);
    });

    this.rootEl.querySelectorAll<HTMLElement>('[data-category-value]').forEach((button) => {
      const category = button.dataset.categoryValue as EventCategory | undefined;
      button.classList.toggle('filter-chip--active', !!category && this.filter.categories.includes(category));
    });

    this.rootEl.querySelectorAll<HTMLElement>('[data-level-value]').forEach((button) => {
      const level = button.dataset.levelValue as ThreatLevel | undefined;
      button.classList.toggle('filter-chip--active', !!level && this.filter.threatLevels.includes(level));
    });

    const searchInput = this.rootEl.querySelector<HTMLInputElement>('.under-map-news__search-input');
    if (searchInput && searchInput.value !== this.filter.searchQuery) {
      searchInput.value = this.filter.searchQuery;
    }
  }

  private updateFilter(next: Partial<FilterState>): void {
    this.filter = {
      ...this.filter,
      ...next,
      categories: next.categories ? [...next.categories] : [...this.filter.categories],
      threatLevels: next.threatLevels ? [...next.threatLevels] : [...this.filter.threatLevels],
      layers: next.layers ? { ...next.layers } : { ...this.filter.layers },
      searchQuery: next.searchQuery ?? this.filter.searchQuery,
    };
    this.syncControls();
    this.applyFilter();
    this.renderList();
    this.onFilterChange?.({
      ...this.filter,
      categories: [...this.filter.categories],
      threatLevels: [...this.filter.threatLevels],
      layers: { ...this.filter.layers },
    });
  }
}
