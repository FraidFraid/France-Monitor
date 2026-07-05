import { Panel } from './Panel.ts';
import {
    applyPremiumCloseButtonHover,
    createPremiumIconHeader,
    getPremiumCloseButtonStyle,
    getPremiumModalStyle,
} from './panelHeader.ts';
import type { TransportDisruption, ThreatLevel } from '../types/index.ts';
import { renderFreshnessBadge } from './shared/truthBadge.ts';

const SEVERITY_COLORS: Record<ThreatLevel, string> = {
    critical: 'var(--threat-critical)',
    high: 'var(--threat-high)',
    medium: 'var(--threat-medium)',
    low: 'var(--threat-low)',
    info: 'var(--threat-info)',
};

const SEVERITY_LABELS: Record<ThreatLevel, string> = {
    critical: 'Critique',
    high: 'Important',
    medium: 'Modéré',
    low: 'Faible',
    info: 'Info',
};

const SEVERITY_ORDER: ThreatLevel[] = ['critical', 'high', 'medium', 'low', 'info'];

const TYPE_ICONS: Record<TransportDisruption['type'], string> = {
    cancellation: '❌',
    delay: '⏱️',
    works: '🚧',
    other: 'ℹ️',
};

const TYPE_LABELS: Record<TransportDisruption['type'], string> = {
    cancellation: 'Suppression',
    delay: 'Retard',
    works: 'Travaux',
    other: 'Autre',
};

export class TransportPanel extends Panel {
    private contentEl: HTMLElement | null = null;
    private closeBtn: HTMLElement | null = null;
    private onClose?: () => void;
    private onHover?: (disruption: TransportDisruption | null) => void;
    private onSelect?: (disruption: TransportDisruption | null) => void;
    private onLoadFullCoverage?: () => void;
    private activeDisruptions: TransportDisruption[] = [];
    private fullCoverageLoaded = false;
    private fullCoverageLoading = false;
    private dataLoaded = false;
    private mapCoverageReady = false;

    constructor(container: HTMLElement) {
        super(container, { title: 'SNCF', icon: '🚆', collapsible: false });
    }

    mount(): void {
        this.modalEl = document.createElement('div');
        this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
            width: '400px',
            maxHeight: 'calc(100vh - var(--right-panel-top) - 20px)',
            backgroundStart: 'rgba(9, 18, 31, 0.97)',
            backgroundEnd: 'rgba(12, 16, 27, 0.96)',
            borderColor: 'rgba(96, 165, 250, 0.18)',
        })}
    `;

        this.closeBtn = document.createElement('button');
        this.closeBtn.innerHTML = '✕';
        this.closeBtn.style.cssText = getPremiumCloseButtonStyle();
        applyPremiumCloseButtonHover(this.closeBtn);
        this.closeBtn.onclick = () => this.hide();

        this.modalEl.appendChild(this.closeBtn);

        const header = createPremiumIconHeader({
            icon: '🚆',
            title: 'Perturbations SNCF',
            subtitle: 'Trafic ferroviaire',
            gradientStart: 'rgba(59, 130, 246, 0.16)',
            gradientEnd: 'rgba(14, 165, 233, 0.10)',
            iconGradientStart: 'rgba(59, 130, 246, 0.22)',
            iconGradientEnd: 'rgba(14, 165, 233, 0.14)',
            titlePrefix: 'Mobilité ferroviaire',
            extraTopRowHtml: `<div id="transport-truth-badge" style="margin-top:4px;">${renderFreshnessBadge(['sncf'])}</div>`,
        });
        this.modalEl.appendChild(header);

        this.contentEl = document.createElement('div');
        this.contentEl.style.cssText = `
      padding: 16px;
      overflow-y: auto;
      flex: 1;
      max-height: calc(100vh - var(--right-panel-top) - 110px);
    `;
        this.modalEl.appendChild(this.contentEl);
        this.container.appendChild(this.modalEl);

        this.render();
    }

    private modalEl!: HTMLElement;

    protected render(): void { }

    setOnClose(h: () => void): void {
        this.onClose = h;
    }

    setOnHover(h: (disruption: TransportDisruption | null) => void): void {
        this.onHover = h;
    }

    setOnSelect(h: (disruption: TransportDisruption | null) => void): void {
        this.onSelect = h;
    }

    setOnLoadFullCoverage(h: () => void): void {
        this.onLoadFullCoverage = h;
    }

    setFullCoverageLoading(loading: boolean): void {
        this.fullCoverageLoading = loading;
        if (this.contentEl && this.modalEl?.style.display !== 'none') {
            this.show(this.activeDisruptions, {
                fullCoverageLoaded: this.fullCoverageLoaded,
                dataLoaded: this.dataLoaded,
                mapCoverageReady: this.mapCoverageReady,
            });
        }
    }

    show(disruptions: TransportDisruption[], options?: { fullCoverageLoaded?: boolean; dataLoaded?: boolean; mapCoverageReady?: boolean }): void {
        this.activeDisruptions = disruptions;
        this.fullCoverageLoaded = options?.fullCoverageLoaded ?? this.fullCoverageLoaded;
        this.dataLoaded = options?.dataLoaded ?? true;
        this.mapCoverageReady = options?.mapCoverageReady ?? this.mapCoverageReady;
        if (!this.contentEl) return;
        this.modalEl.style.display = 'flex';

        const badgeEl = this.modalEl.querySelector('#transport-truth-badge');
        if (badgeEl) badgeEl.innerHTML = renderFreshnessBadge(['sncf']);

        if (this.activeDisruptions.length === 0) {
            const showSyncState = this.mapCoverageReady && !this.dataLoaded;
            this.contentEl.innerHTML = `
        <div style="padding: 18px 16px;">
          <div style="border:1px solid rgba(96,165,250,0.18);background:rgba(96,165,250,0.08);border-radius:8px;padding:14px 14px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
              <div style="width:10px;height:10px;border-radius:50%;background:${this.dataLoaded ? 'var(--threat-info)' : showSyncState ? 'var(--threat-info)' : 'var(--threat-medium)'};box-shadow:0 0 14px ${this.dataLoaded ? 'rgba(90,200,250,0.55)' : showSyncState ? 'rgba(90,200,250,0.45)' : 'rgba(255,204,0,0.45)'};"></div>
              <div style="font-size:11px;font-weight:750;color:var(--text-primary);text-transform:uppercase;letter-spacing:0.05em;">
                ${this.dataLoaded ? 'Aucun signal dans la liste' : showSyncState ? 'Synchronisation panneau SNCF' : 'Chargement SNCF'}
              </div>
            </div>
            <div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">
              ${this.dataLoaded
                ? 'La carte peut déjà afficher des gares issues du dernier jeu de données. Les détails apparaissent au clic sur un point.'
                : showSyncState
                  ? 'Les points sont déjà affichés sur la carte. Le panneau finalise la liste détaillée des perturbations.'
                  : 'Récupération des perturbations récentes et géolocalisation des gares impactées.'}
            </div>
            <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div style="background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.06);border-radius:7px;padding:8px;">
                <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">Mode</div>
                <div style="margin-top:3px;font-size:11px;color:#dce4f4;">${this.fullCoverageLoaded ? 'Couverture complète' : 'Couverture légère'}</div>
              </div>
              <div style="background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.06);border-radius:7px;padding:8px;">
                <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;">État</div>
                <div style="margin-top:3px;font-size:11px;color:#dce4f4;">${showSyncState ? 'Carte prête' : 'Cliquer une gare'}</div>
              </div>
            </div>
            ${this.fullCoverageLoaded ? '' : `
              <button type="button" class="sncf-full-load-btn" ${this.fullCoverageLoading || !this.dataLoaded ? 'disabled' : ''} style="margin-top:12px;width:100%;border:1px solid rgba(96,165,250,0.28);background:rgba(96,165,250,0.10);color:#BFDBFE;border-radius:6px;padding:8px 9px;font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;cursor:${this.fullCoverageLoading || !this.dataLoaded ? 'wait' : 'pointer'};">
                ${this.fullCoverageLoading ? 'Chargement complet SNCF...' : this.dataLoaded ? 'Charger la couverture complète SNCF' : 'Chargement en cours'}
              </button>
            `}
          </div>
        </div>
      `;
            this.contentEl.querySelector('.sncf-full-load-btn')?.addEventListener('click', () => {
                if (this.fullCoverageLoading || !this.dataLoaded) return;
                this.fullCoverageLoading = true;
                this.onLoadFullCoverage?.();
                this.show(this.activeDisruptions, {
                    fullCoverageLoaded: this.fullCoverageLoaded,
                    dataLoaded: this.dataLoaded,
                    mapCoverageReady: this.mapCoverageReady,
                });
            });
            return;
        }

        // Group by severity
        const bySeverity: Record<ThreatLevel, TransportDisruption[]> = {
            critical: [],
            high: [],
            medium: [],
            low: [],
            info: [],
        };

        for (const d of this.activeDisruptions) {
            bySeverity[d.severity].push(d);
        }

        // Compact severity legend strip
        const legendItems = SEVERITY_ORDER.map((severity) => `
          <div style="display:flex;align-items:center;gap:5px;font-size:10px;color:#c0c0cc;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${SEVERITY_COLORS[severity]};flex-shrink:0;"></span>
            ${SEVERITY_LABELS[severity]}
          </div>
        `).join('');

        const legend = `
      <div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px;padding:10px 12px;background:rgba(0,0,0,0.25);border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
        <div style="width:100%;font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Sévérité SNCF</div>
        ${legendItems}
      </div>
    `;

        let html = `
      ${legend}
      <div style="margin-bottom: 16px; padding: 10px 12px; background: rgba(0,0,0,0.2); border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; gap: 10px; font-size: 11px; color: var(--text-muted);">
          <span>${this.activeDisruptions.length} perturbation${this.activeDisruptions.length > 1 ? 's' : ''} · ${this.fullCoverageLoaded ? 'couverture complète' : 'couverture légère'}</span>
          <span>${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        ${this.fullCoverageLoaded ? '' : `
          <button type="button" class="sncf-full-load-btn" ${this.fullCoverageLoading ? 'disabled' : ''} style="margin-top:10px;width:100%;border:1px solid rgba(96,165,250,0.28);background:rgba(96,165,250,0.10);color:#BFDBFE;border-radius:6px;padding:7px 9px;font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;cursor:${this.fullCoverageLoading ? 'wait' : 'pointer'};">
            ${this.fullCoverageLoading ? 'Chargement complet SNCF...' : 'Charger la couverture complète SNCF'}
          </button>
        `}
      </div>
    `;

        const mappedStations = this.activeDisruptions.filter((d) => !!d.departure?.coordinates || !!d.arrival?.coordinates || !!d.coordinates).length;

        html += `
      <div style="margin-bottom: 16px; padding: 10px 12px; background: rgba(74,158,255,0.08); border: 1px solid rgba(74,158,255,0.18); border-radius: 8px;">
        <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px;">Couverture cartographique</div>
        <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.5;">
          ${mappedStations} perturbation${mappedStations > 1 ? 's' : ''} géolocalisée${mappedStations > 1 ? 's' : ''} · affichage carte limité aux gares départ/arrivée
        </div>
      </div>
    `;

        for (const severity of SEVERITY_ORDER) {
            const items = bySeverity[severity];
            if (items.length === 0) continue;

            const color = SEVERITY_COLORS[severity];
            const label = SEVERITY_LABELS[severity];

            html += `
        <div style="margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
            <div style="width: 10px; height: 10px; border-radius: 5px; background: ${color};"></div>
            <div style="color: ${color}; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
              ${label} (${items.length})
            </div>
          </div>
      `;

            for (const d of items) {
                const typeIcon = TYPE_ICONS[d.type];
                const typeLabel = TYPE_LABELS[d.type];
                const timeInfo = this.formatTimeInfo(d);
                const routeInfo = this.formatRouteInfo(d);

                html += `
          <div style="margin-bottom: 10px; background: rgba(0,0,0,0.15); border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05);"
               data-disruption-id="${d.id}"
               data-severity="${d.severity}"
               ${d.departure?.coordinates ? `data-dep-lon="${d.departure.coordinates[0]}" data-dep-lat="${d.departure.coordinates[1]}"` : ''}
               ${d.arrival?.coordinates ? `data-arr-lon="${d.arrival.coordinates[0]}" data-arr-lat="${d.arrival.coordinates[1]}"` : ''}>
            <div style="padding: 10px 12px; border-left: 3px solid ${color};">
              <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 6px;">
                <div style="color: var(--text-primary); font-size: 12px; font-weight: 600; flex: 1;">
                  ${d.trainNumber ? `<span style="color: ${color};">🚄 ${this.escapeHtml(d.trainNumber)}</span> — ` : ''}${this.escapeHtml(d.line)}
                </div>
                <div style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-muted);">
                  ${typeIcon} ${typeLabel}
                </div>
              </div>
              ${routeInfo ? `
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 6px 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">
                ${routeInfo}
              </div>
              ` : ''}
              <div style="color: var(--text-secondary); font-size: 11px; line-height: 1.4; margin-bottom: 6px;">
                ${this.escapeHtml(this.truncateText(d.description, 150))}
              </div>
              ${timeInfo ? `<div style="font-size: 10px; color: var(--text-muted);">${timeInfo}</div>` : ''}
              ${d.affectedStops && d.affectedStops.length > 0 && !d.departure ? `
                <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.05);">
                  <div style="font-size: 10px; color: var(--text-muted);">
                    Arrêts concernés: ${this.escapeHtml(d.affectedStops.slice(0, 5).join(', '))}${d.affectedStops.length > 5 ? '...' : ''}
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
        `;
            }

            html += '</div>';
        }

        this.contentEl.innerHTML = html;

        this.contentEl.querySelector('.sncf-full-load-btn')?.addEventListener('click', () => {
            if (this.fullCoverageLoading) return;
            this.fullCoverageLoading = true;
            this.onLoadFullCoverage?.();
            this.show(this.activeDisruptions, {
                fullCoverageLoaded: this.fullCoverageLoaded,
                dataLoaded: this.dataLoaded,
                mapCoverageReady: this.mapCoverageReady,
            });
        });

        // Attach hover listeners for map highlighting
        this.contentEl.querySelectorAll('[data-disruption-id]').forEach((el) => {
            const disruptionId = el.getAttribute('data-disruption-id');
            const disruption = this.activeDisruptions.find((item) => item.id === disruptionId) ?? null;

            if (disruption) {
                el.addEventListener('mouseenter', () => {
                    (el as HTMLElement).style.outline = '1px solid var(--accent-blue)';
                    (el as HTMLElement).style.boxShadow = '0 0 0 1px rgba(90,200,250,0.28), 0 0 22px rgba(90,200,250,0.10)';
                    this.onHover?.(disruption);
                });
                el.addEventListener('mouseleave', () => {
                    (el as HTMLElement).style.outline = 'none';
                    (el as HTMLElement).style.boxShadow = 'none';
                    this.onHover?.(null);
                });
                el.addEventListener('click', () => {
                    this.onSelect?.(disruption);
                });
            }
        });
    }

    hide(): void {
        if (this.modalEl) this.modalEl.style.display = 'none';
        this.onClose?.();
    }

    private getTemporalStatus(d: TransportDisruption): string {
        const now = Date.now();
        if (d.startDate && d.startDate.getTime() > now) return 'À venir';
        if (d.endDate && d.endDate.getTime() < now) return 'Terminée';
        return 'En cours';
    }

    private formatTimeInfo(d: TransportDisruption): string {
        const parts: string[] = [];
        parts.push(`Statut: ${this.getTemporalStatus(d)}`);

        if (d.startDate) {
            parts.push(`Début: ${d.startDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.startDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
        }

        if (d.endDate) {
            parts.push(`Fin prévue: ${d.endDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.endDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
        }

        return parts.join(' — ');
    }

    private formatRouteInfo(d: TransportDisruption): string {
        if (!d.departure) return '';

        const depName = this.escapeHtml(this.truncateText(d.departure.name, 25));
        const depTime = d.departure.time ?? '';

        if (!d.arrival) {
            // Single station
            return `
                <div style="flex: 1; text-align: center;">
                    <div style="font-size: 11px; color: var(--text-primary);">📍 ${depName}</div>
                    ${depTime ? `<div style="font-size: 10px; color: var(--text-muted);">${depTime}</div>` : ''}
                </div>
            `;
        }

        const arrName = this.escapeHtml(this.truncateText(d.arrival.name, 25));
        const arrTime = d.arrival.time ?? '';

        return `
            <div style="flex: 1; text-align: center;">
                <div style="font-size: 10px; color: var(--text-muted);">Départ</div>
                <div style="font-size: 11px; color: var(--text-primary);">${depName}</div>
                ${depTime ? `<div style="font-size: 10px; color: var(--accent-blue);">${depTime}</div>` : ''}
            </div>
            <div style="color: var(--text-muted);">→</div>
            <div style="flex: 1; text-align: center;">
                <div style="font-size: 10px; color: var(--text-muted);">Arrivée</div>
                <div style="font-size: 11px; color: var(--text-primary);">${arrName}</div>
                ${arrTime ? `<div style="font-size: 10px; color: var(--accent-blue);">${arrTime}</div>` : ''}
            </div>
        `;
    }

    private truncateText(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + '...';
    }

    private escapeHtml(str: string): string {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}
