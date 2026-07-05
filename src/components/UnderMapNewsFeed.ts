import type { NewsItem, FilterState, EventCategory, ThreatLevel, TimeRange, MapLayers, NewsHistoryResponse } from '../types/index.ts';
import { NewsHeatmap } from './NewsHeatmap.ts';
import type { HeatmapClickEvent } from './NewsHeatmap.ts';
import { t } from '../services/i18n.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import { fmIcon, type IconName } from './shared/icons.ts';

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t('newsFeed.timeAgo.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('newsFeed.timeAgo.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('newsFeed.timeAgo.hours', { count: hours });
  const days = Math.floor(hours / 24);
  return t('newsFeed.timeAgo.days', { count: days });
}

const CATEGORY_ICONS: Record<string, string> = {
  social: fmIcon('hand-fist'),
  security: fmIcon('siren'),
  energy: fmIcon('zap'),
  weather: fmIcon('cloud-lightning'),
  transport: fmIcon('train-front'),
  infrastructure: fmIcon('hard-hat'),
  health: fmIcon('hospital'),
  general: fmIcon('newspaper'),
};

const LEVEL_PRIORITY: Record<ThreatLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export type NewsItemClickHandler = (item: NewsItem) => void;
export type NewsFilterChangeHandler = (filter: FilterState) => void;

type ActiveFilterPill =
  | { kind: 'time'; label: string; value: TimeRange }
  | { kind: 'search'; label: string }
  | { kind: 'category'; label: string; value: EventCategory }
  | { kind: 'level'; label: string; value: ThreatLevel };

const DEFAULT_LAYERS: MapLayers = {
  newsGroup: false,
  news: false,
  alerts: false,
  energySystems: false,
  dromEnergy: false,
  powerGrid: false,
  hydroBackbone: false,
  windMonitor: false,
  health: false,
  healthOscour: false,
  healthApl: false,
  hospitals: false,
  environmentGroup: false,
  environmental: false,
  weatherRadar: false,
  fires: false,
  traffic: false,
  trafficRoad: false,
  trafficMaritime: false,
  trafficAir: false,
  trafficRail: false,
  metroLoad: false,
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
  threatMap: false,
  gasNetwork: false,
  oilNetwork: false,
  nuclearFleet: false,
  dayNight: false,
  elus: false,
};

const DEFAULT_FILTER: FilterState = {
  timeRange: '24h',
  categories: [],
  threatLevels: [],
  layers: { ...DEFAULT_LAYERS },
  searchQuery: '',
  mode: 'live',
  historyPeriod: '7d',
  historyCategory: null,
  historyDate: null,
  historyRegion: null,
};

const TIME_OPTIONS: Array<{ label: string; value: TimeRange }> = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '48h', value: '48h' },
  { label: '7j', value: '7d' },
  { label: 'Tout', value: 'all' },
];

const CATEGORY_OPTIONS: Array<{ label: string; icon: IconName; value: EventCategory }> = [
  { label: 'Social', icon: 'hand-fist', value: 'social' },
  { label: 'Sécurité', icon: 'siren', value: 'security' },
  { label: 'Énergie', icon: 'zap', value: 'energy' },
  { label: 'Météo', icon: 'cloud-lightning', value: 'weather' },
  { label: 'Transport', icon: 'train-front', value: 'transport' },
  { label: 'Infra', icon: 'hard-hat', value: 'infrastructure' },
  { label: 'Santé', icon: 'hospital', value: 'health' },
];

const LEVEL_OPTIONS: Array<{ label: string; value: ThreatLevel; color: string }> = [
  { label: 'CRITICAL', value: 'critical', color: 'var(--threat-critical)' },
  { label: 'HIGH', value: 'high', color: 'var(--threat-high)' },
  { label: 'MEDIUM', value: 'medium', color: 'var(--threat-medium)' },
  { label: 'LOW', value: 'low', color: 'var(--threat-low)' },
  { label: 'INFO', value: 'info', color: 'var(--threat-info)' },
];

function compareNewsPriority(a: NewsItem, b: NewsItem): number {
  const alertDelta = Number(b.isAlert) - Number(a.isAlert);
  if (alertDelta !== 0) return alertDelta;

  const levelDelta = LEVEL_PRIORITY[b.threat?.level ?? 'info'] - LEVEL_PRIORITY[a.threat?.level ?? 'info'];
  if (levelDelta !== 0) return levelDelta;

  const geoDelta = Number(!!b.locationName) - Number(!!a.locationName);
  if (geoDelta !== 0) return geoDelta;

  return b.pubDate.getTime() - a.pubDate.getTime();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function getSummaryText(item: NewsItem): string | null {
  if (item.aiSummary) return item.aiSummary;
  if (item.aiSummaryStatus === 'pending') return t('newsFeed.pendingSummary');
  if (item.summary) return truncateText(item.summary, 180);
  return null;
}

export class UnderMapNewsFeed {
  private container: HTMLElement;
  private rootEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private pulseEl: HTMLElement | null = null;
  private activeFiltersEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private items: NewsItem[] = [];
  private filteredItems: NewsItem[] = [];
  private filter: FilterState = { ...DEFAULT_FILTER, categories: [], threatLevels: [], layers: { ...DEFAULT_LAYERS } };
  private onItemClick: NewsItemClickHandler | null = null;
  private onFilterChange: NewsFilterChangeHandler | null = null;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  /** Re-render guard: signature of the last rendered list content. */
  private lastRenderKey: string | null = null;

  // History mode state
  private heatmap: NewsHeatmap | null = null;
  private heatmapContainerEl: HTMLElement | null = null;
  private historyItems: NewsItem[] = [];
  private historyCursor: string | null = null;
  private historyHasMore = false;
  private historyLoading = false;
  private historyTotalCount = 0;
  private historyFooterEl: HTMLElement | null = null;
  private heatmapCache = new Map<string, { data: NewsHistoryResponse; fetchedAt: number }>();
  // periodBarEl not needed — period buttons queried via [data-period]
  private regionSelectEl: HTMLSelectElement | null = null;
  private loadMoreEl: HTMLButtonElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    const root = document.createElement('section');
    root.className = 'under-map-card under-map-card--news';
    root.innerHTML = `
      <div class="under-map-news__mode-toggle">
        <button class="under-map-news__mode-btn active" data-mode="live">Live</button>
        <button class="under-map-news__mode-btn" data-mode="history">Historique</button>
      </div>
      <div class="under-map-card__header">
        <div class="under-map-card__header-copy">
          <div class="under-map-card__title">${t('newsFeed.title')}</div>
        </div>
        <div class="under-map-card__meta" id="under-map-news-count">${t('newsFeed.loadingCount')}</div>
      </div>
      <div class="under-map-news__controls">
        <div class="under-map-news__timebar">
          ${TIME_OPTIONS.map((option) => `
            <button
              type="button"
              class="under-map-news__time-btn ${this.filter.timeRange === option.value ? 'active' : ''}"
              data-time-range="${option.value}"
            >${option.value === 'all' ? t('newsFeed.allTime') : option.label}</button>
          `).join('')}
        </div>
        <div class="under-map-news__history-controls" style="display:none;">
          <div class="under-map-news__section-title">Couverture</div>
          <div class="under-map-news__period-bar">
            <button class="under-map-news__time-btn active" data-period="7d">7j</button>
            <button class="under-map-news__time-btn" data-period="30d">30j</button>
            <button class="under-map-news__time-btn" data-period="90d">90j</button>
          </div>
          <div id="under-map-news-heatmap"></div>
          <div class="under-map-news__history-separator"></div>
          <div class="under-map-news__section-title">Filtres</div>
          <select class="under-map-news__region-select" aria-label="Filtrer par région">
            <option value="">Toutes les régions</option>
            <option value="Bretagne">Bretagne</option>
            <option value="Nouvelle-Aquitaine">Nouvelle-Aquitaine</option>
            <option value="Occitanie">Occitanie</option>
            <option value="Auvergne-Rhône-Alpes">Auvergne-Rhône-Alpes</option>
            <option value="PACA">PACA</option>
            <option value="Grand Est">Grand Est</option>
            <option value="Hauts-de-France">Hauts-de-France</option>
            <option value="Normandie">Normandie</option>
            <option value="Nouvelle-Calédonie">Nouvelle-Calédonie</option>
            <option value="Guadeloupe">Guadeloupe</option>
            <option value="La Réunion">La Réunion</option>
            <option value="Mayotte">Mayotte</option>
          </select>
        </div>
        <div class="under-map-news__search">
          <input
            type="text"
            class="under-map-news__search-input"
            placeholder="${t('newsFeed.searchPlaceholder')}"
            aria-label="Rechercher dans l'actualité"
          />
        </div>
        <div class="under-map-news__pulse" id="under-map-news-pulse"></div>
        <div class="under-map-news__active-filters" id="under-map-news-active-filters"></div>
        <div class="under-map-news__filter-group">
          <div class="under-map-news__filter-label">${t('newsFeed.categories')}</div>
          <div class="under-map-news__filter-row">
            ${CATEGORY_OPTIONS.map((option) => `
              <button
                type="button"
                class="filter-chip ${this.filter.categories.includes(option.value) ? 'filter-chip--active' : ''}"
                data-category-value="${option.value}"
              >${fmIcon(option.icon)} ${escapeHtml(t(`newsFeed.categoryLabels.${option.value}`))}</button>
            `).join('')}
          </div>
        </div>
        <div class="under-map-news__filter-group">
          <div class="under-map-news__filter-label">${t('newsFeed.levels')}</div>
          <div class="under-map-news__filter-row">
            ${LEVEL_OPTIONS.map((option) => `
              <button
                type="button"
                class="filter-chip ${this.filter.threatLevels.includes(option.value) ? 'filter-chip--active' : ''}"
                data-level-value="${option.value}"
                style="border-left:3px solid ${option.color};"
              >${t(`newsFeed.levelLabels.${option.value}`)}</button>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="under-map-card__body under-map-news__body">
        <div class="under-map-news__list" id="under-map-news-list"></div>
      </div>
      <button class="under-map-news__load-more" style="display:none;">Charger plus (50 suivants)</button>
      <div class="under-map-news__history-footer" style="display:none;"></div>
    `;

    this.container.appendChild(root);
    this.rootEl = root;
    this.countEl = root.querySelector('#under-map-news-count');
    this.pulseEl = root.querySelector('#under-map-news-pulse');
    this.activeFiltersEl = root.querySelector('#under-map-news-active-filters');
    this.listEl = root.querySelector('#under-map-news-list');
    this.heatmapContainerEl = root.querySelector('#under-map-news-heatmap');
    this.regionSelectEl = root.querySelector('.under-map-news__region-select');
    this.loadMoreEl = root.querySelector('.under-map-news__load-more');
    this.historyFooterEl = root.querySelector<HTMLElement>('.under-map-news__history-footer');

    // Mount heatmap component
    if (this.heatmapContainerEl) {
      this.heatmap = new NewsHeatmap(this.heatmapContainerEl);
      this.heatmap.setOnCellClick((event) => this.onHeatmapCellClick(event));
    }

    this.bindControls(root);
    this.syncControls();
    this.lastRenderKey = null; // fresh DOM (mount / refreshTranslations) → force next render
    this.renderLoading();
  }

  setOnItemClick(handler: NewsItemClickHandler): void {
    this.onItemClick = handler;
  }

  setOnFilterChange(handler: NewsFilterChangeHandler): void {
    this.onFilterChange = handler;
  }

  refreshTranslations(): void {
    if (!this.rootEl) return;
    this.rootEl.remove();
    this.rootEl = null;
    this.mount();
    this.applyFilter();
    if (this.items.length > 0) {
      this.renderList();
    } else {
      this.renderLoading();
    }
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
    this.items = [...items].sort(compareNewsPriority);
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
    this.lastRenderKey = null; // list replaced by loading state → force next render
    this.countEl.textContent = t('newsFeed.loadingCount');
    if (this.pulseEl) {
      this.pulseEl.innerHTML = `
        <span class="under-map-news__pulse-pill">${t('newsFeed.loadingPulse')}</span>
      `;
    }
    if (this.activeFiltersEl) {
      this.activeFiltersEl.innerHTML = '';
      this.activeFiltersEl.hidden = true;
    }
    this.listEl.innerHTML = fmLoaderHTML({ text: 'Chargement des actualités…', variant: 'inline' });
  }

  private applyFilter(): void {
    if (this.filter.mode === 'history') {
      this.resetHistoryPagination();
      this.loadHistoryArticles();
      return;
    }
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
      if (cats.size > 0 && !cats.has(item.threat?.category ?? 'general')) return false;
      if (levels.size > 0 && !levels.has(item.threat?.level ?? 'info')) return false;
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
    this.filteredItems.sort(compareNewsPriority);
  }

  /**
   * Lightweight signature of everything renderList() displays (items, badges,
   * relative times, active filter pills). When it matches the previous render,
   * the DOM rebuild (and listener re-attachment) is skipped entirely.
   */
  private buildRenderKey(): string {
    const filterSig = [
      this.filter.timeRange,
      this.filter.searchQuery,
      this.filter.categories.join(','),
      this.filter.threatLevels.join(','),
    ].join('\u00a7');
    const itemsSig = this.filteredItems.map((item) => [
      item.id,
      item.title,
      item.aiSummary ?? '',
      item.aiSummaryStatus ?? '',
      item.summary ?? '',
      item.source,
      item.locationName ?? '',
      item.feedRegion ?? '',
      item.link ?? '',
      String(item.lat ?? ''),
      String(item.lon ?? ''),
      item.threat?.level ?? 'info',
      item.threat?.category ?? 'general',
      String(item.threat?.confidence ?? ''),
      item.threat?.source ?? '',
      String(item.isAlert ?? false),
      timeAgo(item.pubDate),
    ].join('|')).join('\u00b6');
    return `${filterSig}\u2225${itemsSig}`;
  }

  private renderList(): void {
    if (this.filter.mode === 'history') {
      return;
    }
    if (!this.listEl || !this.countEl) return;

    const renderKey = this.buildRenderKey();
    if (renderKey === this.lastRenderKey) return;
    this.lastRenderKey = renderKey;

    const now = Date.now();
    const alertCount = this.filteredItems.filter((i) => i.isAlert).length;
    const sourceCount = new Set(this.filteredItems.map((item) => item.source)).size;
    const criticalCount = this.filteredItems.filter((item) => (item.threat?.level ?? 'info') === 'critical').length;
    const highCount = this.filteredItems.filter((item) => (item.threat?.level ?? 'info') === 'high').length;
    const localizedCount = this.filteredItems.filter((item) => !!item.locationName).length;
    const freshCount = this.filteredItems.filter((item) => now - item.pubDate.getTime() <= 6 * 60 * 60 * 1000).length;
    const hasActiveFilters =
      this.filter.searchQuery.length > 0 ||
      this.filter.categories.length > 0 ||
      this.filter.threatLevels.length > 0 ||
      this.filter.timeRange !== '24h';
    this.countEl.textContent = [
      t('newsFeed.countSummary', { count: this.filteredItems.length, sources: sourceCount }),
      ...(alertCount > 0 ? [t('newsFeed.countAlerts', { count: alertCount })] : []),
      ...(hasActiveFilters ? [t('newsFeed.countFilters')] : []),
    ].join(' · ');
    if (this.pulseEl) {
      this.pulseEl.innerHTML = [
        `<span class="under-map-news__pulse-pill"><strong>${criticalCount}</strong> ${t('newsFeed.pulseCritical')}</span>`,
        `<span class="under-map-news__pulse-pill"><strong>${highCount}</strong> ${t('newsFeed.pulseHigh')}</span>`,
        `<span class="under-map-news__pulse-pill"><strong>${freshCount}</strong> ${t('newsFeed.pulseFresh')}</span>`,
        `<span class="under-map-news__pulse-pill"><strong>${localizedCount}</strong> ${t('newsFeed.pulseLocalized')}</span>`,
      ].join('');
    }
    this.renderActiveFilterPills();
    this.listEl.innerHTML = '';

    if (this.filteredItems.length === 0) {
      this.listEl.innerHTML = `
        <div class="under-map-card__empty">
          <div class="under-map-card__empty-title">${t('newsFeed.emptyTitle')}</div>
          <div class="under-map-card__empty-text">${t('newsFeed.emptyBody')}</div>
        </div>
      `;
      return;
    }

    for (const item of this.filteredItems) {
      const el = this.renderItem(item);
      this.listEl.appendChild(el);
    }
  }

  private renderItem(item: NewsItem): HTMLElement {
    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;

    const el = document.createElement('article');
    el.className = 'news-item under-map-news__item';
    if (item.isAlert) el.classList.add('news-item--alert');

    const level = item.threat?.level ?? 'info';
    const category = item.threat?.category ?? 'general';
    const icon = CATEGORY_ICONS[category] ?? fmIcon('newspaper');
    const categoryLabel = t(`newsFeed.categoryLabels.${category}`);
    const isNew = now - item.pubDate.getTime() < ONE_HOUR_MS;
    const summaryText = getSummaryText(item);
    const locationLabel = item.locationName ?? item.feedRegion ?? null;
    const confidenceLabel = item.threat?.confidence != null
      ? `${Math.round(item.threat.confidence * 100)}%`
      : null;
    const sourceLabel = item.threat?.source === 'llm'
      ? t('newsFeed.sourceLabels.llm')
      : item.threat?.source === 'ml'
        ? t('newsFeed.sourceLabels.ml')
        : item.threat?.source === 'keyword'
          ? t('newsFeed.sourceLabels.keyword')
          : null;

    el.dataset.itemId = item.id;
    el.innerHTML = `
      <div class="under-map-news__item-head">
        <div class="under-map-news__badges">
          <span class="threat-badge threat-badge--${escapeHtml(level)}">${escapeHtml(t(`newsFeed.levelLabels.${level}`))}</span>
          <span class="category-badge">${icon} ${escapeHtml(categoryLabel)}</span>
          ${item.isAlert ? `<span class="under-map-news__signal-pill under-map-news__signal-pill--alert">${escapeHtml(t('newsFeed.alert'))}</span>` : ''}
          ${isNew ? `<span class="under-map-news__signal-pill">${escapeHtml(t('newsFeed.new'))}</span>` : ''}
        </div>
        <span class="news-item-time">${escapeHtml(timeAgo(item.pubDate))}</span>
      </div>
      <div class="news-item-title">${escapeHtml(item.title)}</div>
      ${summaryText ? `<div class="news-item-summary under-map-news__summary${item.aiSummaryStatus === 'pending' && !item.aiSummary ? ' under-map-news__summary--pending' : ''}">${escapeHtml(summaryText)}</div>` : ''}
      <div class="news-item-meta under-map-news__meta">
        <span class="news-item-source">${escapeHtml(item.source)}</span>
        ${locationLabel ? `<span class="under-map-news__location">${fmIcon('map-pin')} ${escapeHtml(locationLabel)}</span>` : ''}
        ${confidenceLabel ? `<span class="under-map-news__signal-pill under-map-news__signal-pill--muted">${escapeHtml(confidenceLabel)}</span>` : ''}
        ${sourceLabel ? `<span class="under-map-news__signal-pill under-map-news__signal-pill--muted">${escapeHtml(sourceLabel)}</span>` : ''}
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

      const btn = document.createElement('a');
      btn.className = 'under-map-news__read-btn read-article-btn';
      btn.innerHTML = `${escapeHtml(t('newsFeed.readArticle'))} ${fmIcon('external-link')}`;
      btn.href = item.link;
      btn.target = '_blank';
      btn.rel = 'noopener';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      btnRow.appendChild(btn);
      el.appendChild(btnRow);
    }

    return el;
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

    this.activeFiltersEl?.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-filter-kind]');
      if (!target) return;

      const kind = target.dataset.filterKind;
      const value = target.dataset.filterValue;

      if (kind === 'time') {
        this.updateFilter({ timeRange: '24h' });
        return;
      }

      if (kind === 'search') {
        this.updateFilter({ searchQuery: '' });
        return;
      }

      if (kind === 'category' && value) {
        this.updateFilter({
          categories: this.filter.categories.filter((category) => category !== value),
        });
        return;
      }

      if (kind === 'level' && value) {
        this.updateFilter({
          threatLevels: this.filter.threatLevels.filter((level) => level !== value),
        });
        return;
      }

      if (kind === 'historyDate') {
        this.updateFilter({ historyDate: null });
        this.heatmap?.clearSelection();
        this.resetHistoryPagination();
        this.loadHistoryArticles();
        return;
      }

      if (kind === 'historyCategory') {
        this.updateFilter({ historyCategory: null });
        this.heatmap?.clearSelection();
        this.resetHistoryPagination();
        this.loadHistoryArticles();
        return;
      }

      if (kind === 'historyRegion') {
        this.updateFilter({ historyRegion: null });
        if (this.regionSelectEl) this.regionSelectEl.value = '';
        this.resetHistoryPagination();
        this.loadHistoryArticles();
        return;
      }
    });

    // Mode toggle
    root.querySelectorAll<HTMLElement>('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset['mode'] as 'live' | 'history';
        if (mode === this.filter.mode) return;
        this.updateFilter({ mode });
        this.syncModeUI();
        if (mode === 'history') this.loadHeatmap();
      });
    });

    // Period buttons
    root.querySelectorAll<HTMLElement>('[data-period]').forEach(btn => {
      btn.addEventListener('click', () => {
        const period = btn.dataset['period'] as '7d' | '30d' | '90d';
        if (period === this.filter.historyPeriod) return;
        this.updateFilter({ historyPeriod: period, historyCategory: null, historyDate: null });
        this.heatmap?.clearSelection();
        this.loadHeatmap();
      });
    });

    // Region dropdown
    this.regionSelectEl?.addEventListener('change', () => {
      const region = this.regionSelectEl!.value || null;
      this.updateFilter({ historyRegion: region });
      this.resetHistoryPagination();
      this.loadHistoryArticles();
    });

    // Load more button
    this.loadMoreEl?.addEventListener('click', () => {
      if (!this.historyLoading && this.historyHasMore) {
        this.loadHistoryArticles(true);
      }
    });
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

  private renderActiveFilterPills(): void {
    if (!this.activeFiltersEl) return;

    const pills: ActiveFilterPill[] = [];

    if (this.filter.timeRange !== '24h') {
      const rawLabel = TIME_OPTIONS.find((option) => option.value === this.filter.timeRange)?.label ?? this.filter.timeRange;
      const timeLabel = this.filter.timeRange === 'all' ? t('newsFeed.allTime') : rawLabel;
      pills.push({ kind: 'time', label: t('newsFeed.activeRange', { value: timeLabel }), value: this.filter.timeRange });
    }

    if (this.filter.searchQuery) {
      pills.push({ kind: 'search', label: t('newsFeed.activeSearch', { value: truncateText(this.filter.searchQuery, 24) }) });
    }

    for (const category of this.filter.categories) {
      pills.push({
        kind: 'category',
        label: t(`newsFeed.categoryLabels.${category}`),
        value: category,
      });
    }

    for (const level of this.filter.threatLevels) {
      pills.push({
        kind: 'level',
        label: t(`newsFeed.levelLabels.${level}`),
        value: level,
      });
    }

    // Build history-mode pills
    const historyPillsHtml: string[] = [];
    if (this.filter.mode === 'history') {
      if (this.filter.historyDate) {
        const [, m, d] = this.filter.historyDate.split('-');
        const dateLabel = `${d}/${m}`;
        historyPillsHtml.push(`
          <button
            type="button"
            class="under-map-news__active-pill"
            data-filter-kind="historyDate"
            title="${t('newsFeed.removeFilter')}"
          >${escapeHtml(dateLabel)} <span aria-hidden="true">×</span></button>
        `);
      }
      if (this.filter.historyCategory) {
        historyPillsHtml.push(`
          <button
            type="button"
            class="under-map-news__active-pill"
            data-filter-kind="historyCategory"
            title="${t('newsFeed.removeFilter')}"
          >${escapeHtml(this.filter.historyCategory)} <span aria-hidden="true">×</span></button>
        `);
      }
      if (this.filter.historyRegion) {
        historyPillsHtml.push(`
          <button
            type="button"
            class="under-map-news__active-pill"
            data-filter-kind="historyRegion"
            title="${t('newsFeed.removeFilter')}"
          >${escapeHtml(this.filter.historyRegion)} <span aria-hidden="true">×</span></button>
        `);
      }
    }

    if (pills.length === 0 && historyPillsHtml.length === 0) {
      this.activeFiltersEl.innerHTML = '';
      this.activeFiltersEl.hidden = true;
      return;
    }

    this.activeFiltersEl.hidden = false;
    this.activeFiltersEl.innerHTML = pills.map((pill) => {
      const valueAttr = 'value' in pill ? ` data-filter-value="${pill.value}"` : '';
      return `
        <button
          type="button"
          class="under-map-news__active-pill"
          data-filter-kind="${pill.kind}"${valueAttr}
          title="${t('newsFeed.removeFilter')}"
        >${escapeHtml(pill.label)} <span aria-hidden="true">×</span></button>
      `;
    }).join('') + historyPillsHtml.join('');
  }

  // ═══ History Mode ═══

  private syncModeUI(): void {
    const isHistory = this.filter.mode === 'history';
    const root = this.rootEl;
    if (!root) return;

    root.querySelectorAll<HTMLElement>('[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset['mode'] === this.filter.mode);
    });

    const timebar = root.querySelector<HTMLElement>('.under-map-news__timebar');
    const historyControls = root.querySelector<HTMLElement>('.under-map-news__history-controls');
    if (timebar) timebar.style.display = isHistory ? 'none' : '';
    if (historyControls) historyControls.style.display = isHistory ? '' : 'none';

    if (this.loadMoreEl) this.loadMoreEl.style.display = isHistory && this.historyHasMore ? '' : 'none';
    if (this.historyFooterEl) this.historyFooterEl.style.display = isHistory ? '' : 'none';

    root.querySelectorAll<HTMLElement>('[data-period]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset['period'] === this.filter.historyPeriod);
    });
  }

  private async loadHeatmap(): Promise<void> {
    const period = this.filter.historyPeriod ?? '7d';
    const now = new Date();
    const daysBack = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    const from = new Date(now.getTime() - daysBack * 86_400_000);
    const bucket = period === '90d' ? 'week' : 'day';

    const cacheKey = period;
    const cached = this.heatmapCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < 300_000) {
      this.heatmap?.update(cached.data.buckets);
      this.historyTotalCount = cached.data.buckets.reduce((sum, b) => sum + b.count, 0);
      return;
    }

    try {
      const url = `/api/news/history?from=${from.toISOString()}&to=${now.toISOString()}&bucket=${bucket}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const data: NewsHistoryResponse = await res.json();
      this.heatmapCache.set(cacheKey, { data, fetchedAt: Date.now() });
      this.heatmap?.update(data.buckets);
      this.historyTotalCount = data.buckets.reduce((sum, b) => sum + b.count, 0);
    } catch {
      // Silently fail — heatmap shows "Aucune donnée"
    }
  }

  private onHeatmapCellClick(event: HeatmapClickEvent | null): void {
    if (event) {
      const category = event.category === 'other' ? null : event.category;
      this.updateFilter({ historyCategory: category, historyDate: event.date });
    } else {
      this.updateFilter({ historyCategory: null, historyDate: null });
    }
    this.resetHistoryPagination();
    this.loadHistoryArticles();
  }

  private resetHistoryPagination(): void {
    this.historyItems = [];
    this.historyCursor = null;
    this.historyHasMore = false;
  }

  private async loadHistoryArticles(append = false): Promise<void> {
    if (this.historyLoading) return;
    this.historyLoading = true;
    if (this.loadMoreEl) this.loadMoreEl.disabled = true;

    const params = new URLSearchParams();
    const PAGE_SIZE = 50;
    params.set('limit', String(PAGE_SIZE));

    if (this.filter.historyDate) {
      params.set('since', new Date(this.filter.historyDate).toISOString());
      const start = new Date(this.filter.historyDate);
      const period = this.filter.historyPeriod ?? '7d';
      const endOffset = period === '90d' ? 7 : 1;
      const end = new Date(start.getTime() + endOffset * 86_400_000);
      params.set('until', end.toISOString());
    } else {
      const daysBack = this.filter.historyPeriod === '30d' ? 30 : this.filter.historyPeriod === '90d' ? 90 : 7;
      params.set('since', new Date(Date.now() - daysBack * 86_400_000).toISOString());
    }

    if (this.filter.historyCategory) params.set('category', this.filter.historyCategory);
    if (this.filter.threatLevels.length > 0) {
      params.set('severity', this.filter.threatLevels.join(','));
    }
    if (this.filter.historyRegion) params.set('region', this.filter.historyRegion);

    if (append && this.historyCursor) {
      params.set('before', this.historyCursor);
    }

    try {
      const res = await fetch(`/api/news?${params.toString()}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();

      const newItems: NewsItem[] = (data.items ?? []).map((row: Record<string, unknown>) => this.apiRowToNewsItem(row));

      if (append) {
        this.historyItems = [...this.historyItems, ...newItems];
      } else {
        this.historyItems = newItems;
      }

      this.historyHasMore = newItems.length >= PAGE_SIZE;
      if (newItems.length > 0) {
        const lastItem = newItems[newItems.length - 1];
        this.historyCursor = lastItem.pubDate.toISOString();
      }
    } catch {
      if (!append) this.historyItems = [];
    } finally {
      this.historyLoading = false;
      if (this.loadMoreEl) {
        this.loadMoreEl.disabled = false;
        this.loadMoreEl.style.display = this.historyHasMore ? '' : 'none';
      }
    }

    this.renderHistoryList();
  }

  private apiRowToNewsItem(row: Record<string, unknown>): NewsItem {
    const severity = String(row['severity'] ?? 'info');
    return {
      id: String(row['id'] ?? ''),
      source: String(row['feedName'] ?? ''),
      title: String(row['title'] ?? ''),
      link: String(row['link'] ?? ''),
      pubDate: new Date(String(row['publishedAt'] ?? '')),
      isAlert: severity === 'critical',
      tier: typeof row['tier'] === 'number' ? row['tier'] : undefined,
      feedRegion: row['feedRegion'] ? String(row['feedRegion']) : undefined,
      threat: {
        level: severity as ThreatLevel,
        category: (row['category'] ?? 'general') as EventCategory,
        confidence: typeof row['confidence'] === 'number' ? row['confidence'] : 0.5,
        source: 'keyword',
      },
      lat: typeof row['lat'] === 'number' ? row['lat'] : undefined,
      lon: typeof row['lon'] === 'number' ? row['lon'] : undefined,
      summary: row['description'] ? String(row['description']).slice(0, 200) : undefined,
    };
  }

  private renderHistoryList(): void {
    if (!this.listEl) return;

    let items = this.historyItems;
    if (this.filter.searchQuery) {
      const q = this.filter.searchQuery.toLowerCase();
      items = items.filter(item =>
        item.title.toLowerCase().includes(q) ||
        (item.summary ?? '').toLowerCase().includes(q)
      );
    }

    this.listEl.innerHTML = '';
    for (const item of items) {
      const el = this.renderItem(item);
      this.listEl.appendChild(el);
    }

    if (this.countEl) {
      this.countEl.textContent = String(items.length);
    }

    this.renderActiveFilterPills();

    if (this.historyFooterEl) {
      const shown = this.historyItems.length;
      const total = this.historyTotalCount;
      this.historyFooterEl.textContent = total > 0
        ? `${shown} article${shown !== 1 ? 's' : ''} affiché${shown !== 1 ? 's' : ''} sur ${total}`
        : `${shown} article${shown !== 1 ? 's' : ''} affiché${shown !== 1 ? 's' : ''}`;
    }
  }
}
