/**
 * NewsPanel.ts — Liste scrollable des événements d'actualité.
 * Extraite de App.ts, cette classe gère le rendu, le tri, et la sélection.
 */

import { Panel } from './Panel.ts';
import type { NewsItem, FilterState, EventCategory, ThreatLevel } from '../types/index.ts';

function renderTruthBadge(label: string, color: string): string {
    return `<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:${color}22;border:1px solid ${color}33;color:${color};font-size:9px;font-weight:700;letter-spacing:0.06em;">${label}</span>`;
}

/** Escape HTML to prevent XSS */
function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/** Format relative time in French */
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

/** Category icon map */
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

export class NewsPanel extends Panel {
    private items: NewsItem[] = [];
    private filteredItems: NewsItem[] = [];
    private filter: FilterState | null = null;
    private onItemClick: NewsItemClickHandler | null = null;
    private listEl: HTMLElement | null = null;
    private _badgeEl: HTMLElement | null = null;

    constructor(container: HTMLElement) {
        super(container, {
            title: 'Actualités',
            icon: '📡',
            collapsible: true,
            defaultCollapsed: false,
        });
    }

    /** Register a click handler for item selection */
    setOnItemClick(handler: NewsItemClickHandler): void {
        this.onItemClick = handler;
    }

    /** Update the news list */
    updateItems(items: NewsItem[], filter?: FilterState): void {
        this.items = [...items].sort(
            (a, b) => b.pubDate.getTime() - a.pubDate.getTime(),
        );
        if (filter) this.filter = filter;
        this.applyFilter();
        this.renderList();
        this._updateTruthBadge();
    }

    private _updateTruthBadge(): void {
        if (!this._badgeEl) return;
        if (this.items.length === 0) {
            this._badgeEl.innerHTML = renderTruthBadge('INDISPONIBLE', '#EF4444');
            return;
        }
        const mostRecentMs = this.items[0].pubDate.getTime();
        const ageMin = (Date.now() - mostRecentMs) / 60000;
        if (ageMin < 30) {
            this._badgeEl.innerHTML = renderTruthBadge('TEMPS RÉEL', '#10B981');
        } else if (ageMin < 120) {
            this._badgeEl.innerHTML = renderTruthBadge('CACHE FIGÉ', '#F59E0B');
        } else {
            this._badgeEl.innerHTML = renderTruthBadge('HISTORIQUE', '#60A5FA');
        }
    }

    /** Highlight item visually without scrolling (for map hover) */
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

    /** Highlight item AND scroll to it (for map click or sidebar click) */
    selectItem(itemId: string): void {
        if (!this.listEl) return;

        // First remove all highlights
        const allItems = this.listEl.querySelectorAll('.news-item');
        for (const el of allItems) {
            (el as HTMLElement).classList.remove('news-item--selected');
        }

        // Find target and scroll
        const target = this.listEl.querySelector(`[data-item-id="${itemId}"]`) as HTMLElement | null;
        if (target) {
            target.classList.add('news-item--selected');
            // Scroll the news list container (not the page) so the item is visible
            const containerTop = this.listEl.scrollTop;
            const containerHeight = this.listEl.clientHeight;
            const itemTop = target.offsetTop - this.listEl.offsetTop;
            const itemHeight = target.offsetHeight;

            // Check if item is outside visible area
            if (itemTop < containerTop || itemTop + itemHeight > containerTop + containerHeight) {
                // Scroll to put the item in the center of the visible area
                this.listEl.scrollTo({
                    top: Math.max(0, itemTop - containerHeight / 2 + itemHeight / 2),
                    behavior: 'smooth',
                });
            }
        }
    }

    // ─── Panel abstract impl ───

    protected render(): void {
        if (!this.bodyEl) return;

        this._badgeEl = document.createElement('div');
        this._badgeEl.style.cssText = 'padding:4px 8px 0;';
        this.bodyEl.appendChild(this._badgeEl);

        this.listEl = document.createElement('div');
        this.listEl.className = 'news-list';
        this.listEl.style.cssText =
            'max-height: calc(100vh - 220px); overflow-y: auto;';
        this.listEl.innerHTML = `
      <p style="color:var(--text-muted);font-size:12px;padding:16px;">
        Chargement des actualités…
      </p>
    `;
        this.bodyEl.appendChild(this.listEl);
    }

    // ─── Private ───

    private applyFilter(): void {
        if (!this.filter) {
            this.filteredItems = this.items;
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
            if (cats.size > 0 && item.threat && !cats.has(item.threat.category)) return false;
            if (levels.size > 0 && item.threat && !levels.has(item.threat.level)) return false;
            if (this.filter!.searchQuery) {
                const q = this.filter!.searchQuery.toLowerCase();
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
        if (!this.listEl) return;

        const alertCount = this.filteredItems.filter((i) => i.isAlert).length;
        this.setBadge(this.filteredItems.length, alertCount > 0);

        this.listEl.innerHTML = '';

        if (this.filteredItems.length === 0) {
            this.listEl.innerHTML = `
        <p style="color:var(--text-muted);font-size:12px;padding:16px;text-align:center;">
          Aucune actualité correspondant aux filtres
        </p>
      `;
            return;
        }

        const now = Date.now();
        const ONE_HOUR_MS = 60 * 60 * 1000;

        for (const item of this.filteredItems) {
            const el = document.createElement('div');
            el.className = 'news-item';
            if (item.isAlert) el.classList.add('news-item--alert');

            const level = item.threat?.level ?? 'info';
            const category = item.threat?.category ?? 'general';
            const icon = CATEGORY_ICONS[category] ?? '📰';

            // Check if article is new (< 1 hour)
            const isNew = now - item.pubDate.getTime() < ONE_HOUR_MS;
            const newBadge = isNew ? '<span class="badge-new">NEW</span>' : '';

            el.dataset.itemId = item.id;

            el.innerHTML = `
        <div class="news-item-title">${escapeHtml(item.title)}${newBadge}</div>
        ${item.aiSummary ? `<div class="news-item-summary" style="font-size:12px;margin-top:4px;margin-bottom:6px;font-style:italic;color:var(--text-secondary);">${escapeHtml(item.aiSummary)}</div>` : ''}
        <div class="news-item-meta">
          <span class="threat-badge threat-badge--${escapeHtml(level)}">${escapeHtml(level)}</span>
          <span class="category-badge">${icon} ${escapeHtml(category)}</span>
          <span class="news-item-source">${escapeHtml(item.source)}</span>
          <span class="news-item-time">${escapeHtml(timeAgo(item.pubDate))}</span>
          ${item.threat?.source === 'ml' ? '<span title="IA" style="font-size:10px;margin-left:auto;">🤖</span>' : ''}
        </div>
      `;

            // Clic sur la carte = flyTo sur le point
            el.style.cursor = 'pointer';
            el.addEventListener('click', (e) => {
                // Ignore si on a cliqué sur le bouton "Lire"
                if ((e.target as HTMLElement).closest('.read-article-btn')) return;
                this.selectItem(item.id);
                if (item.lat != null && item.lon != null && this.onItemClick) {
                    this.onItemClick(item);
                }
            });

            // Bouton "Lire l'article" séparé (via DOM API, pas innerHTML)
            if (item.link && item.link !== '#') {
                const btnRow = document.createElement('div');
                btnRow.style.marginTop = '6px';

                const btn = document.createElement('button');
                btn.className = 'read-article-btn';
                btn.textContent = 'Lire l\'article ↗';
                btn.style.cssText = 'font-size:11px;padding:3px 8px;background:rgba(108,140,255,0.15);border:1px solid rgba(108,140,255,0.4);border-radius:4px;color:#8cacff;cursor:pointer;font-family:inherit;';
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
}
