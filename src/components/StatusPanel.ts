/**
 * StatusPanel.ts — Indicateur d'état pour chaque source de données.
 * Pastille verte/orange/rouge + dernière mise à jour.
 * Pattern WorldMonitor : affichage compact dans le header ou sidebar.
 */

import type { DataSourceStatus } from '../types/index.ts';
import { t } from '../services/i18n.ts';

interface StatusPanelOptions {
    variant?: 'panel' | 'dropdown';
    title?: string;
    icon?: string;
}

const STATUS_ICONS: Record<string, string> = {
    ok: '🟢',
    stale: '🟡',
    error: '🔴',
    loading: '⏳',
};

const STATUS_LABELS: Record<string, string> = {
    ok: 'status.realtime',
    stale: 'status.stale',
    error: 'status.unavailable',
    loading: 'status.loading',
};

const SOURCE_NAME_KEYS: Record<string, string> = {
    'RSS PQR': 'status.initialSources.rss',
    'Écowatt RTE': 'status.initialSources.ecowatt',
    'Hub’Eau hydrométrie': 'status.initialSources.hubeau',
    'Éolien France': 'status.initialSources.eolien',
    'Météo-France': 'status.initialSources.meteo',
    Vigicrues: 'status.initialSources.vigicrues',
    'AIS maritime': 'status.initialSources.ais',
    'Vols militaires': 'status.initialSources.militaryFlights',
    'Trafic aérien': 'status.initialSources.airTraffic',
    'SPF / DREES': 'status.initialSources.health',
    SNCF: 'status.initialSources.sncf',
};

const SOURCE_DETAIL_KEYS: Record<string, string> = {
    'API publique open data, licence Etalab': 'status.details.hubeau',
    'adsb.fi → airplanes.live → OpenSky': 'status.details.militaryFlights',
    'OpenSky + airplanes.live · source publique limitée': 'status.details.airTraffic',
};

function translateSourceName(name: string): string {
    const key = SOURCE_NAME_KEYS[name];
    return key ? t(key) : name;
}

function translateDetail(detail: string): string {
    const key = SOURCE_DETAIL_KEYS[detail];
    return key ? t(key) : detail;
}

/** Format "dernière mise à jour" */
function formatLastUpdate(date: Date | null): string {
    if (!date) return '—';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return t('status.justNow');
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t('status.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    return t('status.hoursAgo', { count: hours });
}

/** Format âge du cache en compact (ex: "2 min", "47 s", "1h 3min") */
function formatCacheAge(ms: number | null | undefined): string | null {
    if (ms === null || ms === undefined) return null;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? `${h}h ${rm}min` : `${h}h`;
}

/** Format temps de réponse (ex: "312ms", "~2.1s") */
function formatResponseTime(ms: number | null | undefined): string | null {
    if (ms === null || ms === undefined) return null;
    if (ms < 1000) return `${ms}ms`;
    return `~${(ms / 1000).toFixed(1)}s`;
}

export class StatusPanel {
    private container: HTMLElement;
    private sources: DataSourceStatus[] = [];
    private listEl: HTMLElement | null = null;
    private triggerEl: HTMLButtonElement | null = null;
    private dropdownEl: HTMLElement | null = null;
    private readonly variant: 'panel' | 'dropdown';
    private readonly title: string;
    private readonly icon: string;
    private isOpen = false;

    private onSourceClick: ((name: string) => void) | null = null;

    constructor(container: HTMLElement, options: StatusPanelOptions = {}) {
        this.container = container;
        this.variant = options.variant ?? 'panel';
        this.title = options.title ?? t('status.title');
        this.icon = options.icon ?? '📡';
    }

    setOnSourceClick(handler: (name: string) => void): void {
        this.onSourceClick = handler;
    }

    mount(): void {
        if (this.variant === 'dropdown') {
            this.mountDropdown();
            return;
        }

        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.setAttribute('data-panel', 'status');

        // Header (non-collapsible pour le status)
        const header = document.createElement('div');
        header.className = 'panel-header';
        header.style.cursor = 'default';
        header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:14px;">${this.icon}</span>
        <span class="panel-title">${this.title}</span>
      </div>
    `;
        panel.appendChild(header);

        // Body
        this.listEl = document.createElement('div');
        this.listEl.style.padding = '8px 12px';
        panel.appendChild(this.listEl);

        this.container.appendChild(panel);

        // Init with placeholder sources
        this.setSources([
            { name: 'RSS PQR', lastUpdate: null, status: 'loading' },
            { name: 'Écowatt RTE', lastUpdate: null, status: 'loading' },
            { name: 'Hub’Eau hydrométrie', lastUpdate: null, status: 'loading', detail: 'API publique open data, licence Etalab' },
            { name: 'Éolien France', lastUpdate: null, status: 'loading' },
            { name: 'Météo-France', lastUpdate: null, status: 'loading' },
            { name: 'Vigicrues', lastUpdate: null, status: 'loading' },
            { name: 'AIS maritime', lastUpdate: null, status: 'loading' },
            { name: 'Vols militaires', lastUpdate: null, status: 'loading', detail: 'adsb.fi → airplanes.live → OpenSky' },
            { name: 'Trafic aérien', lastUpdate: null, status: 'loading', detail: 'OpenSky + airplanes.live · source publique limitée' },
            { name: 'SPF / DREES', lastUpdate: null, status: 'loading' },
            { name: 'SNCF', lastUpdate: null, status: 'loading' },
        ]);
    }

    private mountDropdown(): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'status-menu';

        this.triggerEl = document.createElement('button');
        this.triggerEl.className = 'status-menu-trigger';
        this.triggerEl.type = 'button';
        this.triggerEl.setAttribute('aria-expanded', 'false');
        this.triggerEl.innerHTML = `
          ${this.icon ? `<span class="status-menu-trigger__icon">${this.icon}</span>` : ''}
          <span class="status-menu-trigger__label">${this.title}</span>
          <span class="status-menu-trigger__summary">${t('status.loading')}</span>
          <span class="status-menu-trigger__caret">▾</span>
        `;
        this.triggerEl.addEventListener('click', (event) => {
            event.stopPropagation();
            this.setOpen(!this.isOpen);
        });

        this.dropdownEl = document.createElement('div');
        this.dropdownEl.className = 'status-menu-dropdown';
        this.dropdownEl.setAttribute('data-open', 'false');
        this.dropdownEl.innerHTML = `
          <div class="status-menu-dropdown__header">
            ${this.icon ? `<span class="status-menu-dropdown__icon">${this.icon}</span>` : ''}
            <span class="status-menu-dropdown__title">${this.title}</span>
          </div>
        `;

        this.listEl = document.createElement('div');
        this.listEl.className = 'status-menu-dropdown__list';
        this.dropdownEl.appendChild(this.listEl);

        wrapper.appendChild(this.triggerEl);
        wrapper.appendChild(this.dropdownEl);
        this.container.appendChild(wrapper);

        document.addEventListener('click', (event) => {
            if (!wrapper.contains(event.target as Node)) {
                this.setOpen(false);
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.setOpen(false);
            }
        });

        this.setSources([
            { name: 'RSS PQR', lastUpdate: null, status: 'loading' },
            { name: 'Écowatt RTE', lastUpdate: null, status: 'loading' },
            { name: 'Hub’Eau hydrométrie', lastUpdate: null, status: 'loading', detail: 'API publique open data, licence Etalab' },
            { name: 'Météo-France', lastUpdate: null, status: 'loading' },
            { name: 'Vigicrues', lastUpdate: null, status: 'loading' },
            { name: 'AIS maritime', lastUpdate: null, status: 'loading' },
            { name: 'Vols militaires', lastUpdate: null, status: 'loading', detail: 'adsb.fi → airplanes.live → OpenSky' },
            { name: 'Trafic aérien', lastUpdate: null, status: 'loading', detail: 'OpenSky + airplanes.live · source publique limitée' },
            { name: 'SPF / DREES', lastUpdate: null, status: 'loading' },
            { name: 'SNCF', lastUpdate: null, status: 'loading' },
        ]);
    }

    /** Update all sources at once */
    setSources(sources: DataSourceStatus[]): void {
        this.sources = sources;
        this.updateTriggerSummary();
        this.renderList();
    }

    refreshTranslations(): void {
        this.container.querySelectorAll<HTMLElement>('.status-menu-trigger__label, .status-menu-dropdown__title, .panel-title')
            .forEach((el) => { el.textContent = t('status.title'); });
        this.updateTriggerSummary();
        this.renderList();
    }

    /** Update a single source by name */
    updateSource(name: string, update: Partial<DataSourceStatus>): void {
        const idx = this.sources.findIndex((s) => s.name === name);
        if (idx === -1) {
            this.sources.push({ name, lastUpdate: null, status: 'loading', ...update });
        } else {
            this.sources[idx] = { ...this.sources[idx], ...update };
        }
        this.updateTriggerSummary();
        this.renderList();
    }

    private setOpen(open: boolean): void {
        this.isOpen = open;
        this.triggerEl?.setAttribute('aria-expanded', String(open));
        this.dropdownEl?.setAttribute('data-open', String(open));
    }

    private updateTriggerSummary(): void {
        if (!this.triggerEl) return;

        const ok = this.sources.filter((src) => src.status === 'ok').length;
        const errors = this.sources.filter((src) => src.status === 'error').length;
        const stale = this.sources.filter((src) => src.status === 'stale').length;
        const loading = this.sources.filter((src) => src.status === 'loading').length;

        let summary = t('status.summaryRealtime', { ok, total: this.sources.length });
        if (errors > 0) {
            summary = t('status.summaryUnavailable', { count: errors });
        } else if (stale > 0) {
            summary = t('status.summaryStale', { count: stale });
        } else if (loading > 0) {
            summary = t('status.loading');
        }

        const summaryEl = this.triggerEl.querySelector('.status-menu-trigger__summary');
        if (summaryEl) {
            summaryEl.textContent = summary;
        }

        this.triggerEl.setAttribute('data-state', errors > 0 ? 'error' : stale > 0 ? 'stale' : loading > 0 ? 'loading' : 'ok');
    }

    private renderList(): void {
        if (!this.listEl) return;
        this.listEl.innerHTML = '';

        for (const src of this.sources) {
            const row = document.createElement('div');
            row.style.cssText =
                'display:flex;align-items:flex-start;justify-content:space-between;padding:5px 8px;border-radius:4px;transition:background 0.2s;';

            row.onmouseover = () => { row.style.background = 'var(--bg-surface-hover)'; };
            row.onmouseout = () => { row.style.background = 'transparent'; };

            row.addEventListener('click', () => {
                this.setOpen(false);
                if (this.onSourceClick) this.onSourceClick(src.name);
            });

            const left = document.createElement('div');
            left.style.cssText = 'display:flex;align-items:flex-start;gap:6px;min-width:0;flex:1;';

            const dotWrap = document.createElement('span');
            dotWrap.style.cssText = 'margin-top:2px;flex-shrink:0;';
            dotWrap.innerHTML = `<span class="status-dot status-dot--${src.status}"></span>`;

            const textWrap = document.createElement('div');
            textWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;';

            // ── Nom de la source ──
            const nameEl = document.createElement('span');
            nameEl.style.cssText = 'font-size:12px;color:var(--text-secondary);';
            nameEl.textContent = translateSourceName(src.name);
            textWrap.appendChild(nameEl);

            // ── Détail statique (provenance, licence…) ──
            if (src.detail) {
                const detailEl = document.createElement('span');
                detailEl.style.cssText = 'font-size:10px;color:var(--text-muted);max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                detailEl.title = translateDetail(src.detail);
                detailEl.textContent = translateDetail(src.detail);
                textWrap.appendChild(detailEl);
            }

            // ── Ligne de métriques Watchdog (optionnelle) ──
            const metricParts: Array<{ text: string; color?: string }> = [];

            // Âge du cache
            const cacheStr = formatCacheAge(src.cacheAgeMs);
            if (cacheStr) {
                // Orange si > 8 min (80% du TTL 10min par défaut)
                const isAging = (src.cacheAgeMs ?? 0) > 8 * 60_000;
                metricParts.push({
                    text: t('status.metricCache', { value: cacheStr }),
                    color: isAging ? 'var(--threat-medium, #f59e0b)' : undefined,
                });
            }

            // Compteur de fallbacks
            if (src.fallbackCount && src.fallbackCount > 0) {
                metricParts.push({
                    text: t('status.metricFallback', { count: src.fallbackCount }),
                    color: 'var(--threat-medium, #f59e0b)',
                });
            }

            // Temps de réponse
            const rtStr = formatResponseTime(src.responseTimeMs);
            if (rtStr) {
                metricParts.push({ text: rtStr });
            }

            // Dernier échec récent (< 30 min)
            if (src.lastError) {
                const errorAgeMs = Date.now() - src.lastError.getTime();
                if (errorAgeMs < 30 * 60_000) {
                    const errAge = formatCacheAge(errorAgeMs);
                    metricParts.push({
                        text: t('status.metricError', { value: errAge ?? '' }),
                        color: 'var(--threat-critical, #ef4444)',
                    });
                }
            }

            if (metricParts.length > 0) {
                const metricsEl = document.createElement('div');
                metricsEl.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:1px;';
                for (const part of metricParts) {
                    const chip = document.createElement('span');
                    chip.style.cssText = `font-size:9px;color:${part.color ?? 'var(--text-muted)'};`;
                    chip.textContent = part.text;
                    metricsEl.appendChild(chip);
                }
                textWrap.appendChild(metricsEl);
            }

            left.appendChild(dotWrap);
            left.appendChild(textWrap);

            const right = document.createElement('div');
            right.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:4px;';

            if (src.error && src.status === 'error') {
                const errEl = document.createElement('span');
                errEl.style.cssText = 'font-size:10px;color:var(--threat-critical);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                errEl.title = src.error;
                errEl.textContent = src.error;
                right.appendChild(errEl);
            } else {
                const timeEl = document.createElement('span');
                timeEl.style.cssText = 'font-size:10px;color:var(--text-muted);';
                timeEl.textContent = formatLastUpdate(src.lastUpdate);
                right.appendChild(timeEl);
            }

            const statusEl = document.createElement('span');
            statusEl.textContent = STATUS_ICONS[src.status] ?? '❓';
            statusEl.title = t(STATUS_LABELS[src.status] ?? src.status);
            right.appendChild(statusEl);

            row.appendChild(left);
            row.appendChild(right);
            this.listEl.appendChild(row);
        }
    }
}
