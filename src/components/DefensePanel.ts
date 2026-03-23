/**
 * DefensePanel - Panneau Alertes Défense
 *
 * Affiche les alertes de défense, notamment :
 * - Activités suspectes près des câbles sous-marins
 * - Navires militaires à comportement atypique
 */

import { Panel } from './Panel.ts';
import type { DefenseAlert } from '../services/cable-threats.ts';
import { formatProximityDistance } from '../utils/cable-proximity.ts';

// ═══ Constantes UI ═══

const SEVERITY_COLORS: Record<DefenseAlert['severity'], string> = {
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#3B82F6',
};

const SEVERITY_LABELS: Record<DefenseAlert['severity'], string> = {
  high: 'Critique',
  medium: 'Élevée',
  low: 'Attention',
};

const SEVERITY_ICONS: Record<DefenseAlert['severity'], string> = {
  high: '🔴',
  medium: '🟠',
  low: '🟡',
};

// ═══ DefensePanel Class ═══

export type DefenseAlertClickHandler = (alert: DefenseAlert) => void;

export class DefensePanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;
  private onAlertClick?: DefenseAlertClickHandler;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(container: HTMLElement) {
    super(container, { title: 'Alertes Défense', icon: '🛡️', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'defense-panel-modal';
    this.modalEl.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      width: 360px;
      max-height: 45vh;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 1000;
      display: none;
      flex-direction: column;
      backdrop-filter: blur(10px);
      cursor: grab;
    `;

    // Close button
    this.closeBtn = document.createElement('button');
    this.closeBtn.innerHTML = '✕';
    this.closeBtn.className = 'defense-panel-close';
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
      z-index: 10;
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

    // Header
    const header = document.createElement('div');
    header.className = 'defense-panel-header';
    header.style.cssText = `
      padding: 14px 16px;
      padding-right: 48px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 12px;
    `;
    header.innerHTML = `
      <div style="
        width: 44px;
        height: 44px;
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(147, 51, 234, 0.2));
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        flex-shrink: 0;
      ">🛡️</div>
      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="color: var(--text-primary); font-weight: 600; font-size: 14px;">Alertes Défense</span>
          <span id="defense-alert-count" style="
            background: rgba(59, 130, 246, 0.2);
            color: #3B82F6;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 600;
          ">0</span>
        </div>
        <div id="defense-status-label" style="color: var(--text-muted); font-size: 11px; margin-top: 3px;">Surveillance câbles sous-marins</div>
      </div>
    `;
    this.modalEl.appendChild(header);

    // Legend / Explanation section
    const legend = document.createElement('div');
    legend.className = 'defense-panel-legend';
    legend.style.cssText = `
      padding: 12px 14px;
      background: rgba(0,0,0,0.25);
      border-bottom: 1px solid var(--border-color);
      font-size: 11px;
    `;
    legend.innerHTML = `
      <div style="color: var(--text-muted); margin-bottom: 10px; line-height: 1.4;">
        Navires à <strong style="color: var(--text-primary);">faible vitesse</strong> (&lt;2 nœuds)
        près des <strong style="color: var(--text-primary);">câbles sous-marins</strong> (&lt;500m)
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: rgba(239,68,68,0.1); border-radius: 4px; border-left: 3px solid #EF4444;">
          <span style="color: #EF4444; font-size: 10px;">●</span>
          <span style="color: #EF4444; font-weight: 600; font-size: 11px; min-width: 55px;">Critique</span>
          <span style="color: var(--text-muted); font-size: 10px;">&lt;100m, quasi-stationnaire</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: rgba(245,158,11,0.1); border-radius: 4px; border-left: 3px solid #F59E0B;">
          <span style="color: #F59E0B; font-size: 10px;">●</span>
          <span style="color: #F59E0B; font-weight: 600; font-size: 11px; min-width: 55px;">Élevée</span>
          <span style="color: var(--text-muted); font-size: 10px;">&lt;300m, &lt;1 nœud</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: rgba(59,130,246,0.1); border-radius: 4px; border-left: 3px solid #3B82F6;">
          <span style="color: #3B82F6; font-size: 10px;">●</span>
          <span style="color: #3B82F6; font-weight: 600; font-size: 11px; min-width: 55px;">Attention</span>
          <span style="color: var(--text-muted); font-size: 10px;">&lt;500m</span>
        </div>
      </div>
    `;
    this.modalEl.appendChild(legend);

    // Content container
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'defense-panel-content';
    this.contentEl.style.cssText = `
      padding: 12px;
      overflow-y: auto;
      flex: 1;
      max-height: 340px;
    `;
    this.modalEl.appendChild(this.contentEl);

    this.container.appendChild(this.modalEl);
    this.setupDrag();
    this.render();
  }

  private setupDrag(): void {
    this.modalEl.addEventListener('mousedown', (e) => {
      // Don't drag if clicking close button, inside content, or on alert items
      const target = e.target as HTMLElement;
      if (target.closest('.defense-panel-close')) return;
      if (target.closest('.defense-panel-content')) return;
      if (target.closest('.defense-alert-item')) return;
      if (target.closest('.defense-cable-group')) return;

      this.isDragging = true;
      const rect = this.modalEl.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
      this.modalEl.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      
      const x = e.clientX - this.dragOffsetX;
      const y = e.clientY - this.dragOffsetY;
      
      // Keep panel within viewport
      const maxX = window.innerWidth - this.modalEl.offsetWidth;
      const maxY = window.innerHeight - this.modalEl.offsetHeight;
      
      this.modalEl.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
      this.modalEl.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
      
      // Remove bottom/right positioning when dragging
      this.modalEl.style.bottom = 'auto';
      this.modalEl.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.modalEl.style.cursor = 'grab';
      }
    });
  }

  protected render(): void {
    // Initial render is empty - populated by show()
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  /** Register a click handler for when user clicks on an alert item (fly-to) */
  setOnAlertClick(handler: DefenseAlertClickHandler): void {
    this.onAlertClick = handler;
  }

  show(alerts: DefenseAlert[]): void {
    if (!this.contentEl) return;

    this.modalEl.style.display = 'flex';
    this.updateHeader(alerts);
    this.renderContent(alerts);
  }

  private updateHeader(alerts: DefenseAlert[]): void {
    const countEl = this.modalEl.querySelector('#defense-alert-count') as HTMLElement;
    const statusEl = this.modalEl.querySelector('#defense-status-label') as HTMLElement;

    const highCount = alerts.filter(a => a.severity === 'high').length;
    const mediumCount = alerts.filter(a => a.severity === 'medium').length;
    const totalCount = alerts.length;

    if (countEl) {
      countEl.textContent = String(totalCount);

      // Color based on severity
      if (highCount > 0) {
        countEl.style.background = 'rgba(239, 68, 68, 0.2)';
        countEl.style.color = '#EF4444';
      } else if (mediumCount > 0) {
        countEl.style.background = 'rgba(245, 158, 11, 0.2)';
        countEl.style.color = '#F59E0B';
      } else if (totalCount > 0) {
        countEl.style.background = 'rgba(59, 130, 246, 0.2)';
        countEl.style.color = '#3B82F6';
      } else {
        countEl.style.background = 'rgba(16, 185, 129, 0.2)';
        countEl.style.color = '#10B981';
      }
    }

    if (statusEl) {
      if (totalCount === 0) {
        statusEl.textContent = 'Aucune activité suspecte détectée';
        statusEl.style.color = '#10B981';
      } else {
        const parts: string[] = [];
        if (highCount > 0) parts.push(`${highCount} critique${highCount > 1 ? 's' : ''}`);
        if (mediumCount > 0) parts.push(`${mediumCount} élevée${mediumCount > 1 ? 's' : ''}`);
        statusEl.textContent = parts.join(', ') || `${totalCount} alerte${totalCount > 1 ? 's' : ''}`;
        statusEl.style.color = highCount > 0 ? '#EF4444' : mediumCount > 0 ? '#F59E0B' : 'var(--text-muted)';
      }
    }
  }

  private renderContent(alerts: DefenseAlert[]): void {
    if (!this.contentEl) return;

    // Clear existing content
    this.contentEl.innerHTML = '';

    if (alerts.length === 0) {
      this.contentEl.innerHTML = `
        <div style="text-align: center; padding: 32px 16px;">
          <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.4;">✓</div>
          <div style="color: #10B981; font-weight: 600; margin-bottom: 8px;">
            Situation normale
          </div>
          <div style="color: var(--text-muted); font-size: 12px; line-height: 1.6;">
            Aucun navire suspect détecté<br>à proximité des câbles sous-marins
          </div>
        </div>
      `;
      return;
    }

    // Group alerts by cable
    const alertsByCable = new Map<string, DefenseAlert[]>();
    for (const alert of alerts) {
      const existing = alertsByCable.get(alert.cableId) ?? [];
      existing.push(alert);
      alertsByCable.set(alert.cableId, existing);
    }

    for (const [, cableAlerts] of alertsByCable) {
      const cableName = cableAlerts[0].cableName;
      const maxSeverity = cableAlerts.reduce((max, a) => {
        const order = { high: 2, medium: 1, low: 0 };
        return order[a.severity] > order[max] ? a.severity : max;
      }, 'low' as DefenseAlert['severity']);

      // Create cable group container
      const groupEl = document.createElement('div');
      groupEl.className = 'defense-cable-group';
      groupEl.style.cssText = `
        background: rgba(0,0,0,0.2);
        border-radius: 8px;
        margin-bottom: 10px;
        border: 1px solid rgba(255,255,255,0.05);
        overflow: hidden;
      `;

      // Cable header
      const headerEl = document.createElement('div');
      headerEl.style.cssText = `
        padding: 10px 12px;
        background: rgba(0,0,0,0.2);
        border-bottom: 1px solid rgba(255,255,255,0.05);
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      headerEl.innerHTML = `
        <span style="font-size: 14px;">🔌</span>
        <span style="color: var(--text-primary); font-size: 12px; font-weight: 600; flex: 1;">
          ${this.escapeHtml(cableName)}
        </span>
        <span style="
          background: ${SEVERITY_COLORS[maxSeverity]}20;
          color: ${SEVERITY_COLORS[maxSeverity]};
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 600;
        ">${cableAlerts.length} navire${cableAlerts.length > 1 ? 's' : ''}</span>
      `;
      groupEl.appendChild(headerEl);

      // Alert items container
      const itemsEl = document.createElement('div');
      itemsEl.style.cssText = 'padding: 8px;';

      for (const alert of cableAlerts) {
        const itemEl = this.createAlertItemElement(alert);
        itemsEl.appendChild(itemEl);
      }

      groupEl.appendChild(itemsEl);
      this.contentEl.appendChild(groupEl);
    }
  }

  /** Create a clickable alert item element */
  private createAlertItemElement(alert: DefenseAlert): HTMLElement {
    const color = SEVERITY_COLORS[alert.severity];
    const icon = SEVERITY_ICONS[alert.severity];
    const label = SEVERITY_LABELS[alert.severity];
    const isPulsing = alert.severity === 'high';

    const distStr = formatProximityDistance(alert.distanceMeters);
    const speedStr = alert.speedKnots.toFixed(1);
    const timeStr = new Date(alert.createdAt).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const itemEl = document.createElement('div');
    itemEl.className = `defense-alert-item ${isPulsing ? 'defense-pulse' : ''}`;
    itemEl.style.cssText = `
      padding: 10px;
      background: rgba(0,0,0,0.2);
      border-radius: 6px;
      border-left: 3px solid ${color};
      margin-bottom: 6px;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      ${isPulsing ? 'animation: defense-pulse 2s ease-in-out infinite;' : ''}
    `;

    itemEl.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: start; gap: 8px;">
        <div style="flex: 1;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
            <span style="font-size: 12px;">${icon}</span>
            <span style="color: var(--text-primary); font-size: 12px; font-weight: 600;">
              ${this.escapeHtml(alert.shipName)}
            </span>
          </div>
          <div style="color: var(--text-muted); font-size: 11px; line-height: 1.5;">
            <span style="color: ${color}; font-weight: 500;">${distStr}</span> du câble
            <span style="margin-left: 8px; color: var(--text-secondary);">${speedStr} kn</span>
          </div>
        </div>
        <div style="text-align: right;">
          <span style="
            background: ${color}20;
            color: ${color};
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 9px;
            font-weight: 600;
            text-transform: uppercase;
          ">${label}</span>
          <div style="color: var(--text-muted); font-size: 9px; margin-top: 4px;">${timeStr}</div>
        </div>
      </div>
      <div style="
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid rgba(255,255,255,0.05);
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--text-muted);
        font-size: 10px;
      ">
        <span>📍</span>
        <span>Cliquer pour localiser</span>
      </div>
    `;

    // Hover effects
    itemEl.addEventListener('mouseenter', () => {
      itemEl.style.background = 'rgba(255,255,255,0.05)';
      itemEl.style.transform = 'translateX(2px)';
    });
    itemEl.addEventListener('mouseleave', () => {
      itemEl.style.background = 'rgba(0,0,0,0.2)';
      itemEl.style.transform = 'translateX(0)';
    });

    // Click handler for fly-to
    itemEl.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      console.log('[DefensePanel] Click on alert:', alert.shipName, alert.coordinates);
      if (this.onAlertClick) {
        this.onAlertClick(alert);
      }
    });

    return itemEl;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  hide(): void {
    if (this.modalEl) {
      this.modalEl.style.display = 'none';
    }
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }

  update(alerts: DefenseAlert[]): void {
    if (this.isVisible()) {
      this.updateHeader(alerts);
      this.renderContent(alerts);
    }
  }

  /**
   * Returns the current alert count (for status indicators)
   */
  getAlertCount(alerts: DefenseAlert[]): { total: number; high: number; medium: number } {
    return {
      total: alerts.length,
      high: alerts.filter(a => a.severity === 'high').length,
      medium: alerts.filter(a => a.severity === 'medium').length,
    };
  }
}
