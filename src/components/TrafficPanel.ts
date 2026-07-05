/**
 * TrafficPanel.ts — Affichage des incidents routiers (Bouchons, Accidents, etc.)
 * Source : TomTom Traffic Incidents API (temps réel)
 */

import { Panel } from './Panel.ts';
import {
    applyPremiumCloseButtonHover,
    createPremiumIconHeader,
    getPremiumCloseButtonStyle,
    getPremiumModalStyle,
} from './panelHeader.ts';
import type { TrafficIncident } from '../services/traffic.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import { renderFreshnessBadge } from './shared/truthBadge.ts';
import { fmIcon } from './shared/icons.ts';

export class TrafficPanel extends Panel {
    private contentEl: HTMLElement | null = null;
    private closeBtn: HTMLElement | null = null;
    private data: TrafficIncident[] = [];
    /** Dernier instant (ms) où le panel a reçu des données (TomTom ne rapporte pas au Watchdog). */
    private lastDataAt: number | null = null;
    private onHoverIncident: ((id: string | null) => void) | null = null;
    private onClickIncident: ((lng: number, lat: number) => void) | null = null;

    private escapeHtml(value: string): string {
        const div = document.createElement('div');
        div.textContent = value;
        return div.innerHTML;
    }

    constructor(container: HTMLElement) {
        super(container, { title: 'Trafic', collapsible: false });
    }

    setOnHoverIncident(handler: (id: string | null) => void): void {
        this.onHoverIncident = handler;
    }

    setOnClickIncident(handler: (lng: number, lat: number) => void): void {
        this.onClickIncident = handler;
    }

    mount(): void {
        this.modalEl = document.createElement('div');
        this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
            width: '400px',
            maxHeight: 'calc(100vh - var(--right-panel-top) - 20px)',
            backgroundStart: 'rgba(18, 15, 10, 0.97)',
            backgroundEnd: 'rgba(16, 13, 10, 0.96)',
            borderColor: 'rgba(245, 158, 11, 0.16)',
        })}
    `;

        this.closeBtn = this.createCloseButton(() => this.hide());
        this.closeBtn.style.cssText = getPremiumCloseButtonStyle();
        applyPremiumCloseButtonHover(this.closeBtn);

        this.modalEl.appendChild(this.closeBtn);

        const header = createPremiumIconHeader({
            icon: fmIcon('car-front', { size: 32 }),
            title: 'Infos Trafic',
            subtitle: 'TomTom Traffic',
            gradientStart: 'rgba(245, 158, 11, 0.16)',
            gradientEnd: 'rgba(239, 68, 68, 0.08)',
            iconGradientStart: 'rgba(245, 158, 11, 0.22)',
            iconGradientEnd: 'rgba(249, 115, 22, 0.14)',
            titlePrefix: 'Mobilité routière',
            extraTopRowHtml: `<div id="traffic-truth-badge" style="margin-top:4px;">${renderFreshnessBadge([], { lastUpdated: this.lastDataAt })}</div>`,
        });
        this.modalEl.appendChild(header);

        this.contentEl = document.createElement('div');
        this.contentEl.style.cssText = `
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    `;
        this.modalEl.appendChild(this.contentEl);
        this.container.appendChild(this.modalEl);
        this.render();
    }

    showLoading(): void {
        if (!this.contentEl || !this.modalEl) return;
        this.modalEl.style.display = 'flex';
        this.contentEl.innerHTML = fmLoaderHTML({ text: 'Chargement du trafic routier…' });
    }

    private modalEl!: HTMLElement;

    show(incidents: TrafficIncident[]): void {
        this.data = incidents;
        this.lastDataAt = Date.now();
        this.render();
        if (this.modalEl) {
            this.modalEl.style.display = 'flex';
            const badgeEl = this.modalEl.querySelector('#traffic-truth-badge');
            if (badgeEl) badgeEl.innerHTML = renderFreshnessBadge([], { lastUpdated: this.lastDataAt });
        }
    }

    hide(): void {
        if (this.modalEl) {
            this.modalEl.style.display = 'none';
        }
    }

    protected render(): void {
        if (!this.contentEl) return;
        this.contentEl.innerHTML = '';

        if (this.data.length === 0) {
            this.contentEl.innerHTML = '<div style="padding:16px;color:var(--text-muted);text-align:center;">Aucun incident détecté.</div>';
            return;
        }

        // Statistiques globales
        const severeCount = this.data.filter(i => i.severity === 'high' || i.severity === 'critical').length;
        const plannedCount = this.data.filter(i => i.timeValidity === 'future').length;

        const statsDiv = document.createElement('div');
        statsDiv.style.padding = '0 0 16px 0';
        statsDiv.style.marginBottom = '16px';
        statsDiv.style.borderBottom = '1px solid var(--border-color)';
        statsDiv.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;color:var(--text-secondary);">Incidents majeurs/critiques: <strong style="color:var(--threat-critical)">${severeCount}</strong></span>
        <span style="font-size:12px;color:var(--text-muted);">Total: ${this.data.length}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
        <span style="font-size:11px;color:var(--text-muted);">Planifiés: <strong style="color:var(--text-primary)">${plannedCount}</strong></span>
      </div>
    `;
        this.contentEl.appendChild(statsDiv);

        // Liste des incidents
        for (const inc of this.data) {
            const card = document.createElement('div');
            card.style.padding = '10px 12px';
            card.style.marginBottom = '8px';
            card.style.background = 'rgba(0,0,0,0.2)';
            card.style.borderRadius = '6px';
            // card.style.borderBottom = '1px solid var(--border-color)';
            card.style.cursor = 'pointer';
            card.style.transition = 'background 0.2s';

            card.onmouseover = () => {
                card.style.background = 'var(--bg-surface-hover)';
                if (this.onHoverIncident) this.onHoverIncident(inc.id);
            };
            card.onmouseout = () => {
                card.style.background = 'rgba(0,0,0,0.2)';
                if (this.onHoverIncident) this.onHoverIncident(null);
            };
            card.onclick = () => {
                if (this.onClickIncident) this.onClickIncident(inc.lon, inc.lat);
            };

            let badgeColor = 'var(--text-muted)';
            if (inc.severity === 'high') badgeColor = 'var(--threat-critical)';
            else if (inc.severity === 'critical') badgeColor = 'var(--threat-critical)';
            else if (inc.severity === 'medium') badgeColor = 'var(--threat-high)';

            const formatDelay = (s: number) => {
                if (!s) return '—';
                if (s < 60) return `${s}s`;
                const m = Math.floor(s / 60);
                return `+${m} min`;
            };
            const formatLength = (m: number) => {
                if (!m) return '—';
                if (m < 1000) return `${Math.round(m)}m`;
                return `${(m / 1000).toFixed(1)}km`;
            };
            const formatDate = (value?: string) => {
                if (!value) return '—';
                const date = new Date(value);
                if (Number.isNaN(date.getTime())) return value;
                return date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            };
            const routeText = inc.roadNumbers && inc.roadNumbers.length > 0 ? this.escapeHtml(inc.roadNumbers.join(', ')) : '—';
            const validityText = inc.timeValidity === 'future' ? 'Planifié' : 'En cours';

            card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${badgeColor}; box-shadow: 0 0 6px ${badgeColor}80;"></span>
            <strong style="font-size:14px;color:var(--text-primary);">${this.escapeHtml(inc.type)}</strong>
          </div>
          <span style="font-size:12px;color:var(--text-secondary);font-weight:600;background:var(--bg-surface);padding:2px 6px;border-radius:4px;border:1px solid var(--border-color);">
            ${formatDelay(inc.delay)}
          </span>
        </div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.4;margin-bottom:8px;">
          ${this.escapeHtml(inc.description)}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--text-muted);margin-bottom:8px;">
          <span>Route: <strong style="color:var(--text-primary)">${routeText}</strong></span>
          <span>État: <strong style="color:var(--text-primary)">${validityText}</strong></span>
        </div>
        ${(inc.from || inc.to) ? `
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">
          <strong style="color:var(--text-primary)">Tronçon:</strong> ${inc.from ? this.escapeHtml(inc.from) : '—'} → ${inc.to ? this.escapeHtml(inc.to) : '—'}
        </div>` : ''}
        ${(inc.startTime || inc.endTime) ? `
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">
          <strong style="color:var(--text-primary)">Fenêtre:</strong> ${formatDate(inc.startTime)} → ${formatDate(inc.endTime)}
        </div>` : ''}
        <div style="display:flex;gap:12px;font-size:11px;color:var(--text-muted);">
          <span>Long: <strong style="color:var(--text-primary)">${formatLength(inc.length)}</strong></span>
        </div>
      `;
            this.contentEl.appendChild(card);
        }
    }
}
