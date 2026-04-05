import { Panel } from './Panel.ts';
import type { TransportDisruption, ThreatLevel } from '../types/index.ts';

const SEVERITY_COLORS: Record<ThreatLevel, string> = {
    critical: 'var(--threat-critical)',
    high: 'var(--threat-high)',
    medium: 'var(--threat-medium)',
    low: 'var(--threat-low)',
    info: 'var(--text-muted)',
};

const SEVERITY_LABELS: Record<ThreatLevel, string> = {
    critical: 'Critique',
    high: 'Important',
    medium: 'Modéré',
    low: 'Faible',
    info: 'Info',
};

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
    private activeDisruptions: TransportDisruption[] = [];

    constructor(container: HTMLElement) {
        super(container, { title: 'SNCF', icon: '🚆', collapsible: false });
    }

    mount(): void {
        this.modalEl = document.createElement('div');
        this.modalEl.style.cssText = `
      position: absolute;
      top: var(--right-panel-top);
      right: 20px;
      width: 380px;
      max-height: calc(100vh - var(--right-panel-top) - 20px);
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 1000;
      display: none;
      flex-direction: column;
      backdrop-filter: blur(10px);
    `;

        this.closeBtn = document.createElement('button');
        this.closeBtn.innerHTML = '✕';
        this.closeBtn.style.cssText = `
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(255,255,255,0.1);
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 14px;
      width: 28px;
      height: 28px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    `;
        this.closeBtn.onmouseover = () => {
            this.closeBtn!.style.background = 'rgba(255,255,255,0.2)';
            this.closeBtn!.style.color = 'var(--text-primary)';
        };
        this.closeBtn.onmouseout = () => {
            this.closeBtn!.style.background = 'rgba(255,255,255,0.1)';
            this.closeBtn!.style.color = 'var(--text-muted)';
        };
        this.closeBtn.onclick = () => this.hide();

        this.modalEl.appendChild(this.closeBtn);

        const header = document.createElement('div');
        header.style.cssText = `
      padding: 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 12px;
    `;
        header.innerHTML = `
      <div style="font-size: 24px;">🚆</div>
      <div>
        <div style="color: var(--text-primary); font-weight: 600; font-size: 14px;">Perturbations SNCF</div>
        <div style="color: var(--text-muted); font-size: 11px; display:flex; align-items:center; gap:6px;">Trafic ferroviaire <span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:#10B98122;border:1px solid #10B98133;color:#10B981;font-size:9px;font-weight:700;letter-spacing:0.06em;">TEMPS RÉEL</span></div>
      </div>
    `;
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

    show(disruptions: TransportDisruption[]): void {
        this.activeDisruptions = disruptions;
        if (!this.contentEl) return;
        this.modalEl.style.display = 'flex';

        if (this.activeDisruptions.length === 0) {
            this.contentEl.innerHTML = `
        <div style="text-align:center; color: var(--threat-low); padding: 20px 0;">
          <div style="font-size: 32px; margin-bottom: 12px;">✅</div>
          <div>Aucune perturbation signalée.</div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">
            Le trafic ferroviaire est normal.
          </div>
        </div>
      `;
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
        const legend = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;padding:10px 12px;background:rgba(0,0,0,0.25);border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
        <div style="width:100%;font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Sévérité</div>
        <div style="display:flex;align-items:center;gap:5px;font-size:10px;color:#c0c0cc;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--threat-critical);flex-shrink:0;"></span>Supprimé</div>
        <div style="display:flex;align-items:center;gap:5px;font-size:10px;color:#c0c0cc;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--threat-high);flex-shrink:0;"></span>Retards</div>
        <div style="display:flex;align-items:center;gap:5px;font-size:10px;color:#c0c0cc;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--threat-medium);flex-shrink:0;"></span>Réduit</div>
        <div style="display:flex;align-items:center;gap:5px;font-size:10px;color:#c0c0cc;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--threat-low);flex-shrink:0;"></span>Mineur</div>
      </div>
    `;

        let html = `
      ${legend}
      <div style="margin-bottom: 16px; padding: 8px 10px; background: rgba(0,0,0,0.2); border-radius: 8px;">
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
          <span>${this.activeDisruptions.length} perturbation${this.activeDisruptions.length > 1 ? 's' : ''}</span>
          <span>Mise à jour: ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    `;

        const mappedStations = this.activeDisruptions.filter((d) => !!d.departure?.coordinates || !!d.arrival?.coordinates || !!d.coordinates).length;
        const mappedRoutes = this.activeDisruptions.filter((d) => !!d.departure?.coordinates && !!d.arrival?.coordinates).length;

        html += `
      <div style="margin-bottom: 16px; padding: 10px 12px; background: rgba(74,158,255,0.08); border: 1px solid rgba(74,158,255,0.18); border-radius: 8px;">
        <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px;">Couverture cartographique</div>
        <div style="font-size: 11px; color: var(--text-secondary); line-height: 1.5;">
          ${mappedRoutes} trajet${mappedRoutes > 1 ? 's' : ''} traçable${mappedRoutes > 1 ? 's' : ''} sur la carte · ${mappedStations} perturbation${mappedStations > 1 ? 's' : ''} géolocalisée${mappedStations > 1 ? 's' : ''}
        </div>
      </div>
    `;

        for (const severity of ['critical', 'high', 'medium', 'low', 'info'] as ThreatLevel[]) {
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

        // Attach hover listeners for map highlighting
        this.contentEl.querySelectorAll('[data-disruption-id]').forEach((el) => {
            const disruptionId = el.getAttribute('data-disruption-id');
            const depLon = el.getAttribute('data-dep-lon');
            const depLat = el.getAttribute('data-dep-lat');
            const disruption = this.activeDisruptions.find((item) => item.id === disruptionId) ?? null;

            if (disruption && (depLon && depLat || disruption.coordinates)) {
                el.addEventListener('mouseenter', () => {
                    (el as HTMLElement).style.outline = '1px solid var(--accent-blue)';
                    this.onHover?.(disruption);
                });
                el.addEventListener('mouseleave', () => {
                    (el as HTMLElement).style.outline = 'none';
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

    private formatTimeInfo(d: TransportDisruption): string {
        const parts: string[] = [];

        if (d.startDate) {
            parts.push(`Début: ${d.startDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.startDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
        }

        if (d.endDate) {
            parts.push(`Fin prévue: ${d.endDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.endDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
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
