/**
 * FilterPanel.ts — Barre de filtres : catégories + niveaux.
 * Mounted dans la sidebar, émet des événements de changement via callback.
 * Note: La plage temporelle est gérée par TimeBar.
 */

import type {
    FilterState,
    EventCategory,
    ThreatLevel,
} from '../types/index.ts';

const DEFAULT_FILTER: FilterState = {
    timeRange: '24h',
    categories: [],
    threatLevels: [],
    layers: {
        newsGroup: false,
        news: false,
        alerts: false,
        energySystems: false,
        powerGrid: false,
        hydroBackbone: false,
        windMonitor: false,
        health: false,
        healthOscour: false,
        healthApl: false,
        hospitals: false,
        environmentGroup: false,
        environmental: false,
        fires: false,
        criticalEnergyInfra: false,
        traffic: true,
        trafficRoad: false,
        trafficMaritime: true,
        trafficAir: false,
        trafficRail: false,
        metroLoad: false,
        sovereignty: false,
        military: false,
        outages: false,
        outagesElec: false,
        outagesTelecom: false,
        outagesInternet: false,
        outagesCloud: false,
        stability: false,
        cyber: false,
        gasNetwork: false,
        oilNetwork: false,
        nuclearFleet: false,
        subseaCables: false,
    },
    searchQuery: '',
};

const CATEGORY_OPTIONS: { label: string; icon: string; value: EventCategory }[] = [
    { label: 'Social', icon: '✊', value: 'social' },
    { label: 'Sécurité', icon: '🚨', value: 'security' },
    { label: 'Énergie', icon: '⚡', value: 'energy' },
    { label: 'Météo', icon: '🌩️', value: 'weather' },
    { label: 'Transport', icon: '🚆', value: 'transport' },
    { label: 'Infra', icon: '🏗️', value: 'infrastructure' },
    { label: 'Santé', icon: '🏥', value: 'health' },
];

const LEVEL_OPTIONS: { label: string; value: ThreatLevel; color: string }[] = [
    { label: 'CRITICAL', value: 'critical', color: 'var(--threat-critical)' },
    { label: 'HIGH', value: 'high', color: 'var(--threat-high)' },
    { label: 'MEDIUM', value: 'medium', color: 'var(--threat-medium)' },
    { label: 'LOW', value: 'low', color: 'var(--threat-low)' },
    { label: 'INFO', value: 'info', color: 'var(--threat-info)' },
];

export type FilterChangeHandler = (filter: FilterState) => void;

export class FilterPanel {
    private container: HTMLElement;
    private filter: FilterState;
    private onChange: FilterChangeHandler | null = null;
    private searchDebounce: ReturnType<typeof setTimeout> | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
        this.filter = { ...DEFAULT_FILTER, categories: [], threatLevels: [] };
    }

    setOnChange(handler: FilterChangeHandler): void {
        this.onChange = handler;
    }

    getFilter(): FilterState {
        return { ...this.filter };
    }

    mount(): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'panel';
        wrapper.style.overflow = 'visible';

        // ─── Search bar ───
        const searchWrap = document.createElement('div');
        searchWrap.style.cssText = 'padding:10px 12px;border-bottom:1px solid var(--border-color);';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '🔍  Rechercher…';
        searchInput.id = 'filter-search-input';
        searchInput.style.cssText = `
      width:100%;background:var(--bg-secondary);border:1px solid var(--border-color);
      border-radius:8px;padding:6px 10px;color:var(--text-primary);font-size:12px;outline:none;
    `;
        searchInput.addEventListener('input', () => {
            if (this.searchDebounce) clearTimeout(this.searchDebounce);
            this.searchDebounce = setTimeout(() => {
                this.filter.searchQuery = searchInput.value;
                this.emit();
            }, 250);
        });
        searchWrap.appendChild(searchInput);
        wrapper.appendChild(searchWrap);

        // ─── Categories ───
        const catWrap = document.createElement('div');
        catWrap.style.cssText =
            'padding:8px 12px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border-color);flex-wrap:wrap;';

        const catLabel = document.createElement('span');
        catLabel.textContent = 'Catégories :';
        catLabel.style.cssText = 'font-size:11px;color:var(--text-muted);flex-shrink:0;width:100%;margin-bottom:2px;';
        catWrap.appendChild(catLabel);

        for (const opt of CATEGORY_OPTIONS) {
            const chip = document.createElement('button');
            chip.className = 'filter-chip';
            chip.textContent = `${opt.icon} ${opt.label}`;
            chip.dataset.catValue = opt.value;
            chip.addEventListener('click', () => {
                const idx = this.filter.categories.indexOf(opt.value);
                if (idx === -1) {
                    this.filter.categories.push(opt.value);
                    chip.classList.add('filter-chip--active');
                } else {
                    this.filter.categories.splice(idx, 1);
                    chip.classList.remove('filter-chip--active');
                }
                this.emit();
            });
            catWrap.appendChild(chip);
        }
        wrapper.appendChild(catWrap);

        // ─── Threat levels ───
        const lvlWrap = document.createElement('div');
        lvlWrap.style.cssText =
            'padding:8px 12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;';

        const lvlLabel = document.createElement('span');
        lvlLabel.textContent = 'Niveau :';
        lvlLabel.style.cssText = 'font-size:11px;color:var(--text-muted);flex-shrink:0;width:100%;margin-bottom:2px;';
        lvlWrap.appendChild(lvlLabel);

        for (const opt of LEVEL_OPTIONS) {
            const chip = document.createElement('button');
            chip.className = 'filter-chip';
            chip.style.cssText = `border-left:3px solid ${opt.color};`;
            chip.textContent = opt.label;
            chip.dataset.lvlValue = opt.value;
            chip.addEventListener('click', () => {
                const idx = this.filter.threatLevels.indexOf(opt.value);
                if (idx === -1) {
                    this.filter.threatLevels.push(opt.value);
                    chip.classList.add('filter-chip--active');
                } else {
                    this.filter.threatLevels.splice(idx, 1);
                    chip.classList.remove('filter-chip--active');
                }
                this.emit();
            });
            lvlWrap.appendChild(chip);
        }
        wrapper.appendChild(lvlWrap);

        this.container.appendChild(wrapper);
    }

    private emit(): void {
        this.onChange?.({ ...this.filter, categories: [...this.filter.categories], threatLevels: [...this.filter.threatLevels] });
    }
}
