/**
 * SearchModal.ts — Modal de recherche globale (Cmd+K).
 * Filtre parmi les articles récents et les villes/régions de France.
 */

import type { NewsItem } from '../types/index.ts';
import { CITIES, REGIONS } from '../config/geo.ts';

export class SearchModal {
    private container: HTMLElement;
    private modalEl: HTMLElement;
    private inputEl: HTMLInputElement;
    private resultsEl: HTMLElement;
    private newsItems: NewsItem[] = [];
    private onFlyTo: ((lon: number, lat: number, zoom: number, item?: NewsItem) => void) | null = null;
    private isVisible = false;

    constructor(container: HTMLElement) {
        this.container = container;

        // Create overlay
        this.modalEl = document.createElement('div');
        this.modalEl.className = 'search-modal-overlay';
        this.modalEl.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
            z-index: 9999; display: none; align-items: flex-start; justify-content: center;
            padding-top: 10vh; opacity: 0; transition: opacity 0.2s ease;
        `;

        // Create modal content
        const content = document.createElement('div');
        content.className = 'search-modal-content';
        content.style.cssText = `
            width: 100%; max-width: 500px;
            background: var(--bg-panel); border: 1px solid var(--border-color);
            border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex; flex-direction: column;
        `;

        // Input wrapper
        const inputWrap = document.createElement('div');
        inputWrap.style.cssText = 'padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 12px;';

        const searchIcon = document.createElement('span');
        searchIcon.textContent = '';
        searchIcon.style.opacity = '0.5';

        this.inputEl = document.createElement('input');
        this.inputEl.type = 'text';
        this.inputEl.placeholder = 'Rechercher une ville, une région, un article...';
        this.inputEl.style.cssText = `
            flex: 1; background: transparent; border: none; outline: none;
            color: var(--text-primary); font-size: 16px;
        `;

        const escHint = document.createElement('span');
        escHint.textContent = 'ESC';
        escHint.style.cssText = 'font-size: 10px; padding: 4px 6px; background: var(--bg-secondary); border-radius: 4px; color: var(--text-muted);';

        inputWrap.appendChild(searchIcon);
        inputWrap.appendChild(this.inputEl);
        inputWrap.appendChild(escHint);

        // Results wrapper
        this.resultsEl = document.createElement('div');
        this.resultsEl.style.cssText = `
            flex: 1; max-height: 40vh; overflow-y: auto; padding: 8px 0;
            display: flex; flex-direction: column;
        `;

        content.appendChild(inputWrap);
        content.appendChild(this.resultsEl);
        this.modalEl.appendChild(content);
        this.container.appendChild(this.modalEl);

        this.bindEvents();
    }

    private bindEvents() {
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                this.toggle();
            }
            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        });

        // Click outside to close
        this.modalEl.addEventListener('click', (e) => {
            if (e.target === this.modalEl) {
                this.hide();
            }
        });

        // Search input logic
        this.inputEl.addEventListener('input', () => this.renderResults());
    }

    public setOnFlyTo(handler: (lon: number, lat: number, zoom: number, item?: NewsItem) => void) {
        this.onFlyTo = handler;
    }

    public updateNewsItems(items: NewsItem[]) {
        this.newsItems = items;
        if (this.isVisible) {
            this.renderResults();
        }
    }

    public toggle() {
        if (this.isVisible) this.hide();
        else this.show();
    }

    public show() {
        this.isVisible = true;
        this.modalEl.style.display = 'flex';
        // forced reflow for transition
        void this.modalEl.offsetWidth;
        this.modalEl.style.opacity = '1';
        this.inputEl.value = '';
        this.renderResults();
        this.inputEl.focus();
    }

    public hide() {
        this.isVisible = false;
        this.modalEl.style.opacity = '0';
        setTimeout(() => {
            if (!this.isVisible) this.modalEl.style.display = 'none';
        }, 200);
    }

    private renderResults() {
        this.resultsEl.innerHTML = '';
        const q = this.inputEl.value.toLowerCase().trim();

        if (q.length === 0) {
            const hint = document.createElement('div');
            hint.textContent = 'Tapez pour rechercher...';
            hint.style.cssText = 'padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;';
            this.resultsEl.appendChild(hint);
            return;
        }

        const hits: Array<{ title: string; subtitle: string; icon: string; action: () => void }> = [];

        // 1. Search in Cities
        for (const [name, [lon, lat]] of Object.entries(CITIES)) {
            if (name.toLowerCase().includes(q)) {
                hits.push({
                    title: name,
                    subtitle: 'Ville',
                    icon: '📍',
                    action: () => this.flyAndClose(lon, lat, 12)
                });
            }
        }

        // 2. Search in Regions
        for (const [_id, region] of Object.entries(REGIONS)) {
            if (region.name.toLowerCase().includes(q)) {
                hits.push({
                    title: region.name,
                    subtitle: 'Région',
                    icon: '🗺️',
                    action: () => this.flyAndClose(region.center[0], region.center[1], 8)
                });
            }
        }

        // 3. Search in News Items (only those with coordinates)
        const geolocatedNews = this.newsItems.filter(item => item.lon != null && item.lat != null);
        for (const item of geolocatedNews) {
            if (item.title.toLowerCase().includes(q) || item.source.toLowerCase().includes(q) || (item.locationName && item.locationName.toLowerCase().includes(q))) {
                hits.push({
                    title: item.title,
                    subtitle: `${item.source} • ${item.locationName ?? 'France'}`,
                    icon: item.threat?.level === 'critical' ? '🔴' : '📰',
                    action: () => this.flyAndClose(item.lon!, item.lat!, 12, item)
                });
            }
        }

        // Only keep top 10 results
        const topHits = hits.slice(0, 10);

        if (topHits.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'Aucun résultat trouvé.';
            empty.style.cssText = 'padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;';
            this.resultsEl.appendChild(empty);
            return;
        }

        for (const hit of topHits) {
            const row = document.createElement('div');
            row.className = 'search-result-item'; // CSS to be added if needed, or inline
            row.style.cssText = `
                padding: 10px 16px; display: flex; align-items: center; gap: 12px;
                cursor: pointer; transition: background 0.2s; border-bottom: 1px solid rgba(255,255,255,0.05);
            `;
            row.addEventListener('mouseover', () => row.style.background = 'var(--bg-secondary)');
            row.addEventListener('mouseout', () => row.style.background = 'transparent');
            row.addEventListener('click', hit.action);

            const iconWrap = document.createElement('div');
            iconWrap.textContent = hit.icon;
            iconWrap.style.fontSize = '18px';

            const textWrap = document.createElement('div');
            textWrap.style.cssText = 'display: flex; flex-direction: column; overflow: hidden;';

            const titleWrap = document.createElement('div');
            titleWrap.textContent = hit.title;
            titleWrap.style.cssText = 'font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

            const subWrap = document.createElement('div');
            subWrap.textContent = hit.subtitle;
            subWrap.style.cssText = 'font-size: 11px; color: var(--text-muted);';

            textWrap.appendChild(titleWrap);
            textWrap.appendChild(subWrap);
            row.appendChild(iconWrap);
            row.appendChild(textWrap);

            this.resultsEl.appendChild(row);
        }
    }

    private flyAndClose(lon: number, lat: number, zoom: number, item?: NewsItem) {
        if (this.onFlyTo) this.onFlyTo(lon, lat, zoom, item);
        this.hide();
    }
}
