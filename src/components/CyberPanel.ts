/**
 * CyberPanel - Panneau Cybersécurité Nationale
 *
 * Affiche un tableau de bord avec :
 * - Baromètre global (anneau 0-100)
 * - Alertes CERT-FR (pulsation pour les critiques)
 * - Ransomware Tracker (compteur odomètre)
 * - CVE Radar (badges CVSS)
 */

import { Panel } from './Panel.ts';
import type { CyberState, CyberAlert, CyberCVE, CyberSeverity } from '../types/index.ts';
import { getCyberScoreColor, formatCyberDate, getSeverityColor, isCyberPanelEnabled } from '../services/cyber.ts';

// ═══ Constantes UI ═══

const SEVERITY_LABELS: Record<CyberSeverity, string> = {
  critical: 'Critique',
  high: 'Élevée',
  medium: 'Moyenne',
  low: 'Faible',
};

// ═══ CyberPanel Class ═══

export class CyberPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(container: HTMLElement) {
    super(container, { title: 'Vigilance Cyber', icon: '🛡️', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'cyber-panel-modal';
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
      cursor: grab;
    `;

    // Close button
    this.closeBtn = document.createElement('button');
    this.closeBtn.innerHTML = '✕';
    this.closeBtn.className = 'cyber-panel-close';
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

    // Header with ring chart
    const header = document.createElement('div');
    header.className = 'cyber-panel-header';
    header.style.cssText = `
      padding: 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 16px;
    `;
    header.innerHTML = `
      <div class="cyber-ring-container" style="position: relative; width: 64px; height: 64px;">
        <svg viewBox="0 0 36 36" style="width: 64px; height: 64px; transform: rotate(-90deg);">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"></circle>
          <circle id="cyber-ring-progress" cx="18" cy="18" r="15.9" fill="none" stroke="#10B981" stroke-width="3"
            stroke-dasharray="0 100" stroke-linecap="round" style="transition: stroke-dasharray 0.5s ease, stroke 0.3s ease;"></circle>
        </svg>
        <div id="cyber-ring-score" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 16px; font-weight: 700; color: var(--text-primary);">--</div>
      </div>
      <div style="flex: 1;">
        <div style="color: var(--text-primary); font-weight: 600; font-size: 14px;">Vigilance Cyber Nationale</div>
        <div id="cyber-status-label" style="color: var(--text-muted); font-size: 11px; margin-top: 2px;">Chargement...</div>
        <div id="cyber-trend" style="font-size: 10px; margin-top: 4px;"></div>
      </div>
    `;
    this.modalEl.appendChild(header);

    // Content container
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'cyber-panel-content';
    this.contentEl.style.cssText = `
      padding: 12px;
      overflow-y: auto;
      flex: 1;
    `;
    this.modalEl.appendChild(this.contentEl);

    this.container.appendChild(this.modalEl);
    this.setupDrag();
    this.render();
  }

  private setupDrag(): void {
    this.modalEl.addEventListener('mousedown', (e) => {
      // Don't drag if clicking close button or inside content
      if ((e.target as HTMLElement).closest('.cyber-panel-close')) return;
      if ((e.target as HTMLElement).closest('.cyber-panel-content')) return;
      
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
      
      // Remove top/right positioning when dragging
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

  show(data: CyberState | null): void {
    if (!this.contentEl) return;

    // Check feature flag
    if (!isCyberPanelEnabled()) {
      this.showLockedState();
      this.modalEl.style.display = 'flex';
      return;
    }

    this.modalEl.style.display = 'flex';

    if (!data) {
      this.showLoadingState();
      return;
    }

    this.updateHeader(data);
    this.renderContent(data);
  }

  private showLockedState(): void {
    if (!this.contentEl) return;

    // Update header for locked state
    const ringScore = this.modalEl.querySelector('#cyber-ring-score') as HTMLElement;
    const statusLabel = this.modalEl.querySelector('#cyber-status-label') as HTMLElement;
    const trendEl = this.modalEl.querySelector('#cyber-trend') as HTMLElement;

    if (ringScore) ringScore.textContent = '🔒';
    if (statusLabel) statusLabel.textContent = 'Fonctionnalité verrouillée';
    if (trendEl) trendEl.innerHTML = '';

    this.contentEl.innerHTML = `
      <div class="cyber-locked-state" style="text-align: center; padding: 32px 16px;">
        <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.6;">🔐</div>
        <div style="color: var(--text-primary); font-weight: 600; margin-bottom: 12px;">
          Module Cyber désactivé
        </div>
        <div style="color: var(--text-muted); font-size: 12px; line-height: 1.6;">
          Ce module agrège des données Open Data de cybersécurité :
        </div>
        <div style="margin-top: 16px; text-align: left; background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px;">
          <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 8px;">
            <strong>Sources disponibles :</strong>
          </div>
          <ul style="color: var(--text-muted); font-size: 11px; margin: 0; padding-left: 16px; line-height: 1.8;">
            <li><a href="https://www.cert.ssi.gouv.fr/" target="_blank" rel="noopener noreferrer" style="color: var(--text-accent);">CERT-FR (ANSSI)</a> - Alertes officielles</li>
            <li><a href="https://ransomware.live/" target="_blank" rel="noopener noreferrer" style="color: var(--text-accent);">Ransomware.live</a> - Victimes ransomware</li>
            <li><a href="https://nvd.nist.gov/" target="_blank" rel="noopener noreferrer" style="color: var(--text-accent);">NVD (NIST)</a> - Base CVE</li>
          </ul>
        </div>
        <div style="margin-top: 16px; color: var(--text-muted); font-size: 10px;">
          Activez avec <code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">VITE_ENABLE_CYBER_PANEL=true</code>
        </div>
      </div>
    `;
  }

  private showLoadingState(): void {
    if (!this.contentEl) return;

    this.contentEl.innerHTML = `
      <div class="cyber-bento-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        ${this.renderSkeletonCard('CERT-FR', true)}
        ${this.renderSkeletonCard('Ransomware', true)}
        ${this.renderSkeletonCard('CVE Radar', false)}
      </div>
    `;
  }

  private renderSkeletonCard(title: string, halfWidth: boolean): string {
    return `
      <div class="cyber-bento-card cyber-skeleton" style="
        background: rgba(0,0,0,0.2);
        border-radius: 8px;
        padding: 12px;
        border: 1px solid rgba(255,255,255,0.05);
        ${halfWidth ? '' : 'grid-column: span 2;'}
      ">
        <div style="color: var(--text-muted); font-size: 11px; font-weight: 600; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;">
          ${title}
        </div>
        <div class="skeleton-pulse" style="height: 16px; background: rgba(255,255,255,0.1); border-radius: 4px; margin-bottom: 8px; animation: pulse 1.5s ease-in-out infinite;"></div>
        <div class="skeleton-pulse" style="height: 12px; width: 70%; background: rgba(255,255,255,0.08); border-radius: 4px; animation: pulse 1.5s ease-in-out infinite;"></div>
      </div>
    `;
  }

  private updateHeader(data: CyberState): void {
    const ringProgress = this.modalEl.querySelector('#cyber-ring-progress') as SVGCircleElement;
    const ringScore = this.modalEl.querySelector('#cyber-ring-score') as HTMLElement;
    const statusLabel = this.modalEl.querySelector('#cyber-status-label') as HTMLElement;
    const trendEl = this.modalEl.querySelector('#cyber-trend') as HTMLElement;

    const score = data.meta.globalScore;
    const { color, label } = getCyberScoreColor(score);

    // Update ring progress (circumference is ~100)
    if (ringProgress) {
      ringProgress.setAttribute('stroke-dasharray', `${score} 100`);
      ringProgress.setAttribute('stroke', color);
    }

    if (ringScore) {
      ringScore.textContent = String(score);
      ringScore.style.color = color;
    }

    if (statusLabel) {
      statusLabel.textContent = label;
      statusLabel.style.color = color;
    }

    if (trendEl) {
      const trendIcon = data.meta.trend === 'rising' ? '↗' : data.meta.trend === 'falling' ? '↘' : '→';
      const trendColor = data.meta.trend === 'rising' ? '#EF4444' : data.meta.trend === 'falling' ? '#10B981' : 'var(--text-muted)';
      const trendLabel = data.meta.trend === 'rising' ? 'En hausse' : data.meta.trend === 'falling' ? 'En baisse' : 'Stable';

      trendEl.innerHTML = `
        <span style="color: ${trendColor}; font-weight: 500;">${trendIcon} ${trendLabel}</span>
        <span style="color: var(--text-muted); margin-left: 8px;">
          MàJ: ${data.meta.lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      `;
    }
  }

  private renderContent(data: CyberState): void {
    if (!this.contentEl) return;

    // Check for partial data warning
    const failedSources = data.meta.sources.filter(s => !s.isUp);
    let warningHtml = '';

    if (failedSources.length > 0) {
      const sourceNames = failedSources.map(s => s.source).join(', ');
      warningHtml = `
        <div class="cyber-warning" style="
          background: rgba(245, 158, 11, 0.15);
          border: 1px solid rgba(245, 158, 11, 0.3);
          border-radius: 6px;
          padding: 8px 10px;
          margin-bottom: 10px;
          font-size: 10px;
          color: #F59E0B;
          display: flex;
          align-items: center;
          gap: 6px;
        ">
          <span style="font-size: 12px;">⚠️</span>
          <span>Source ${sourceNames} indisponible, score basé sur données partielles</span>
        </div>
      `;
    }

    this.contentEl.innerHTML = `
      ${warningHtml}
      <div class="cyber-bento-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        ${this.renderCertFrCard(data)}
        ${this.renderRansomwareCard(data)}
        ${this.renderCveCard(data)}
      </div>
    `;

    // Add click handlers for external links
    this.contentEl.querySelectorAll('a[data-external]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    });
  }

  private renderCertFrCard(data: CyberState): string {
    const alerts = data.alerts.latest;
    const count = data.alerts.count30d;

    let alertsHtml = '';
    if (alerts.length === 0) {
      alertsHtml = `<div style="color: var(--text-muted); font-size: 11px; text-align: center; padding: 8px 0;">Aucune alerte récente</div>`;
    } else {
      alertsHtml = alerts.slice(0, 4).map(alert => this.renderAlertItem(alert)).join('');
    }

    return `
      <div class="cyber-bento-card cyber-cert-card" style="
        background: rgba(0,0,0,0.2);
        border-radius: 8px;
        padding: 12px;
        border: 1px solid rgba(255,255,255,0.05);
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div style="color: var(--text-muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
            CERT-FR
          </div>
          <div style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 10px; font-size: 10px; color: var(--text-secondary);">
            ${count} / 30j
          </div>
        </div>
        <div class="cyber-cert-alerts" style="display: flex; flex-direction: column; gap: 6px;">
          ${alertsHtml}
        </div>
      </div>
    `;
  }

  private renderAlertItem(alert: CyberAlert): string {
    const color = getSeverityColor(alert.severity);
    const label = SEVERITY_LABELS[alert.severity];
    const isPulsing = alert.severity === 'critical';

    return `
      <a href="${alert.url}" target="_blank" rel="noopener noreferrer" data-external
        class="cyber-alert-item ${isPulsing ? 'cyber-pulse' : ''}" style="
        display: block;
        padding: 8px;
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
        border-left: 3px solid ${color};
        text-decoration: none;
        transition: background 0.2s;
        ${isPulsing ? 'animation: cyber-pulse 2s ease-in-out infinite;' : ''}
      ">
        <div style="display: flex; justify-content: space-between; align-items: start; gap: 8px;">
          <div style="color: var(--text-primary); font-size: 11px; line-height: 1.4; flex: 1; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
            ${this.escapeHtml(alert.title)}
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
          <span style="color: ${color}; font-size: 9px; font-weight: 600; text-transform: uppercase;">${label}</span>
          <span style="color: var(--text-muted); font-size: 9px;">${formatCyberDate(alert.date)}</span>
        </div>
      </a>
    `;
  }

  private renderRansomwareCard(data: CyberState): string {
    const total = data.ransomware.total30d;
    const topSector = data.ransomware.topSectors[0];

    // Format number with leading zeros for odometer effect
    const odometerDigits = String(total).padStart(3, '0').split('');

    return `
      <div class="cyber-bento-card cyber-ransom-card" style="
        background: rgba(0,0,0,0.2);
        border-radius: 8px;
        padding: 12px;
        border: 1px solid rgba(255,255,255,0.05);
      ">
        <div style="color: var(--text-muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;">
          Ransomware FR
        </div>

        <div class="cyber-odometer" style="display: flex; justify-content: center; gap: 4px; margin: 12px 0;">
          ${odometerDigits.map(digit => `
            <div style="
              background: rgba(0,0,0,0.4);
              border: 1px solid rgba(255,255,255,0.1);
              border-radius: 4px;
              width: 28px;
              height: 38px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 20px;
              font-weight: 700;
              font-family: 'SF Mono', 'Monaco', monospace;
              color: ${total > 10 ? '#EF4444' : total > 5 ? '#F59E0B' : '#10B981'};
            ">${digit}</div>
          `).join('')}
        </div>

        <div style="text-align: center; color: var(--text-muted); font-size: 10px; margin-bottom: 8px;">
          victimes / 30 jours
        </div>

        ${topSector ? `
          <div style="
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 4px;
            padding: 6px 8px;
            text-align: center;
            font-size: 10px;
          ">
            <span style="color: var(--text-muted);">Secteur le plus visé :</span>
            <span style="color: #EF4444; font-weight: 600; margin-left: 4px;">${this.escapeHtml(topSector.sector)}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  private renderCveCard(data: CyberState): string {
    const cves = data.vulnerabilities.topCVEs;
    const criticalCount = data.vulnerabilities.criticalCount;

    let cvesHtml = '';
    if (cves.length === 0) {
      cvesHtml = `<div style="color: var(--text-muted); font-size: 11px; text-align: center; padding: 8px 0;">Aucune CVE critique récente</div>`;
    } else {
      cvesHtml = `
        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
          ${cves.slice(0, 6).map(cve => this.renderCveBadge(cve)).join('')}
        </div>
      `;
    }

    return `
      <div class="cyber-bento-card cyber-cve-card" style="
        background: rgba(0,0,0,0.2);
        border-radius: 8px;
        padding: 12px;
        border: 1px solid rgba(255,255,255,0.05);
        grid-column: span 2;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div style="color: var(--text-muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
            CVE Radar (7j)
          </div>
          <div style="background: rgba(239, 68, 68, 0.2); padding: 2px 8px; border-radius: 10px; font-size: 10px; color: #EF4444; font-weight: 600;">
            ${criticalCount} critiques
          </div>
        </div>
        ${cvesHtml}
      </div>
    `;
  }

  private renderCveBadge(cve: CyberCVE): string {
    const scoreColor = cve.score >= 9.5 ? '#DC2626' : cve.score >= 9.0 ? '#EF4444' : '#F97316';
    const isMaxScore = cve.score >= 10.0;

    return `
      <a href="${cve.url}" target="_blank" rel="noopener noreferrer" data-external
        class="cyber-cve-badge" style="
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        padding: 6px 10px;
        text-decoration: none;
        transition: all 0.2s;
      ">
        <span style="
          font-size: 12px;
          font-weight: 700;
          color: ${scoreColor};
          ${isMaxScore ? 'text-shadow: 0 0 8px rgba(220, 38, 38, 0.5);' : ''}
        ">${cve.score.toFixed(1)}</span>
        <span style="color: var(--text-secondary); font-size: 10px; font-family: 'SF Mono', monospace;">${cve.id}</span>
        <span style="color: var(--text-muted); font-size: 9px; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escapeHtml(cve.target)}</span>
      </a>
    `;
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

  update(data: CyberState): void {
    if (this.isVisible() && data) {
      this.updateHeader(data);
      this.renderContent(data);
    }
  }
}
