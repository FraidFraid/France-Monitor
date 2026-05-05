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
import {
  applyPremiumCloseButtonHover,
  createPremiumRingHeader,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';
import type { CyberState, CyberAlert, CyberCVE, CyberSeverity, ThreatEvent } from '../types/index.ts';
import { getCyberScoreColor, formatCyberDate, getSeverityColor, isCyberPanelEnabled } from '../services/cyber.ts';
import {
  DEFAULT_THREAT_EVENT_FILTERS,
  filterThreatEvents,
  type ThreatEventFilters,
  type ThreatSeverityFilter,
  type ThreatTimeFilter,
  type ThreatTypeFilter,
} from '../services/threat-map.ts';
import { computeCyberPressureAssessment } from '../services/cyber-threat-scoring.ts';

type ActiveTab = 'alertes' | 'ransomware' | 'incidents';
type ThreatFilterChangeHandler = (filters: ThreatEventFilters) => void;
type ThreatEventSelectHandler = (event: ThreatEvent) => void;

// ═══ Constantes UI ═══

function renderTruthBadge(label: string, color: string): string {
  return `<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:${color}22;border:1px solid ${color}33;color:${color};font-size:9px;font-weight:700;letter-spacing:0.06em;">${label}</span>`;
}

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
  private activeTab: ActiveTab = 'incidents';
  private threatEvents: ThreatEvent[] = [];
  private currentData: CyberState | null = null;
  private threatFilters: ThreatEventFilters = { ...DEFAULT_THREAT_EVENT_FILTERS };
  private onThreatFiltersChange: ThreatFilterChangeHandler | null = null;
  private onThreatEventSelect: ThreatEventSelectHandler | null = null;

  constructor(container: HTMLElement) {
    super(container, { title: 'Vigilance Cyber', icon: '🛡️', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'cyber-panel-modal';
    this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
        width: '400px',
        maxHeight: 'calc(100vh - var(--right-panel-top) - 20px)',
        backgroundStart: 'rgba(10, 17, 30, 0.97)',
        backgroundEnd: 'rgba(16, 12, 24, 0.96)',
        borderColor: 'rgba(16, 185, 129, 0.18)',
      })}
      height: calc(100vh - var(--right-panel-top) - 20px);
      cursor: grab;
    `;

    // Close button
    this.closeBtn = document.createElement('button');
    this.closeBtn.innerHTML = '✕';
    this.closeBtn.className = 'cyber-panel-close';
    this.closeBtn.style.cssText = getPremiumCloseButtonStyle();
    applyPremiumCloseButtonHover(this.closeBtn);
    this.closeBtn.onclick = () => this.hide();
    this.modalEl.appendChild(this.closeBtn);

    const header = createPremiumRingHeader({
      ringId: 'cyber-ring-progress',
      centerId: 'cyber-ring-score',
      centerText: '--',
      ringStroke: '#10B981',
      title: 'Pression Cyber Nationale',
      subtitle: 'Chargement...',
      statusId: 'cyber-status-label',
      badgeId: 'cyber-truth-badge',
      gradientStart: 'rgba(16, 185, 129, 0.16)',
      gradientEnd: 'rgba(99, 102, 241, 0.10)',
      titlePrefix: 'Scoring multi-signaux',
      extraTopRowHtml: '<div id="cyber-trend" style="font-size:10px;margin-top:4px;color:var(--text-muted);"></div>',
    });
    header.className = 'cyber-panel-header';
    this.modalEl.appendChild(header);

    // Content container
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'cyber-panel-content';
    this.contentEl.style.cssText = `
      padding: 12px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
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

  setOnThreatFiltersChange(handler: ThreatFilterChangeHandler): void {
    this.onThreatFiltersChange = handler;
  }

  setOnThreatEventSelect(handler: ThreatEventSelectHandler): void {
    this.onThreatEventSelect = handler;
  }

  show(data: CyberState | null): void {
    if (!this.contentEl) return;
    const wasVisible = this.isVisible();

    // Check feature flag
    if (!isCyberPanelEnabled()) {
      this.showLockedState();
      this.modalEl.style.display = 'flex';
      return;
    }

    if (!wasVisible) {
      this.activeTab = 'incidents';
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
          Ce module agrège des signaux cyber publics multi-sources :
        </div>
        <div style="margin-top: 16px; text-align: left; background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px;">
          <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 8px;">
            <strong>Sources disponibles :</strong>
          </div>
          <ul style="color: var(--text-muted); font-size: 11px; margin: 0; padding-left: 16px; line-height: 1.8;">
            <li><a href="https://www.cert.ssi.gouv.fr/" target="_blank" rel="noopener noreferrer" style="color: var(--text-accent);">CERT-FR (ANSSI)</a> - Avis et alertes techniques</li>
            <li><a href="https://ransomware.live/" target="_blank" rel="noopener noreferrer" style="color: var(--text-accent);">Ransomware.live</a> - Victimes ransomware 30 jours</li>
            <li><a href="https://nvd.nist.gov/" target="_blank" rel="noopener noreferrer" style="color: var(--text-accent);">NVD (NIST)</a> - Vulnérabilités critiques</li>
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

    const assessment = computeCyberPressureAssessment(data, this.threatEvents);
    const score = assessment.score;
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
          MàJ: ${data.meta.lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ${assessment.dominantFamily ? assessment.breakdown.find((item) => item.family === assessment.dominantFamily)?.label ?? 'multi-source' : 'faible pression'}
        </span>
      `;
    }

    const truthBadge = this.modalEl.querySelector('#cyber-truth-badge') as HTMLElement | null;
    if (truthBadge) {
      const allUp = data.meta.sources.every(s => s.isUp);
      const stale = Date.now() - data.meta.lastUpdate.getTime() > 4 * 3600 * 1000;
      if (stale || !allUp) {
        truthBadge.innerHTML = renderTruthBadge('CACHE FIGÉ', '#F59E0B');
      } else {
        truthBadge.innerHTML = renderTruthBadge('TEMPS RÉEL', '#10B981');
      }
    }
  }

  updateThreatEvents(events: ThreatEvent[]): void {
    this.threatEvents = events;
    if (this.currentData && this.isVisible()) {
      this.updateHeader(this.currentData);
    }
    if (this.activeTab === 'incidents' && this.isVisible()) {
      this.renderTabContent();
    }
  }

  getFilteredThreatEvents(): ThreatEvent[] {
    return filterThreatEvents(this.threatEvents, this.threatFilters);
  }

  selectTab(tab: ActiveTab): void {
    this.activeTab = tab;
    if (this.isVisible() && this.currentData) {
      this.renderContent(this.currentData);
    }
  }

  private renderTabBar(): string {
    const tab = (id: ActiveTab, label: string) => {
      const active = this.activeTab === id;
      return `<button data-tab="${id}" style="
        flex:1; padding:7px 4px; background:${active ? 'rgba(16,185,129,0.15)' : 'transparent'};
        border:none; border-bottom:2px solid ${active ? '#10B981' : 'transparent'};
        color:${active ? '#10B981' : 'rgba(255,255,255,0.45)'};
        font-size:10px; font-weight:700; letter-spacing:0.5px; cursor:pointer;
        text-transform:uppercase; transition:all 0.15s;">${label}</button>`;
    };
    return `<div style="display:flex; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:10px;">
      ${tab('alertes','CERT/NVD')}
      ${tab('ransomware','Leaks & Ransom')}
      ${tab('incidents','Carte incidents')}
    </div>`;
  }

  private renderContent(data: CyberState): void {
    if (!this.contentEl) return;
    this.currentData = data;

    const failedSources = data.meta.sources.filter(s => !s.isUp);
    let warningHtml = '';
    if (failedSources.length > 0) {
      const names = failedSources.map(s => s.source).join(', ');
      warningHtml = `<div style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:10px;color:#F59E0B;display:flex;align-items:center;gap:6px;"><span>⚠️</span><span>Source ${names} indisponible</span></div>`;
    }

    const assessment = computeCyberPressureAssessment(data, this.threatEvents);
    this.contentEl.innerHTML = `${warningHtml}${this.renderScoreExplanation(assessment)}${this.renderTabBar()}<div id="cyber-tab-content" style="flex:1;min-height:0;display:flex;flex-direction:column;"></div>`;
    this.renderTabContent();

    this.contentEl.querySelectorAll<HTMLElement>('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab as ActiveTab;
        this.renderContent(data);
      });
    });
    this.contentEl.querySelectorAll('a[data-external]').forEach(l => l.addEventListener('click', e => e.stopPropagation()));
  }

  private renderScoreExplanation(assessment: ReturnType<typeof computeCyberPressureAssessment>): string {
    const activeBreakdown = assessment.breakdown.filter((item) => item.score > 0);
    const rows = activeBreakdown.length > 0
      ? activeBreakdown.map((item) => {
        const pct = Math.max(4, Math.round((item.score / item.cap) * 100));
        const color = item.family === 'ransomware' ? '#ef4444'
          : item.family === 'vulnerabilities' ? '#f97316'
          : item.family === 'exposure' ? '#3b82f6'
          : item.family === 'leaks' ? '#06b6d4'
          : '#8b5cf6';
        return `
          <div style="display:grid;grid-template-columns:88px 1fr 44px;gap:8px;align-items:center;">
            <span style="font-size:10px;color:var(--text-secondary);">${item.label}</span>
            <div style="height:6px;border-radius:999px;background:rgba(255,255,255,0.08);overflow:hidden;">
              <div style="width:${pct}%;height:100%;background:${color};box-shadow:0 0 10px ${color}55;"></div>
            </div>
            <span style="font-size:10px;color:${color};font-family:monospace;text-align:right;">${item.score}/${item.cap}</span>
          </div>
        `;
      }).join('')
      : `<div style="font-size:10px;color:var(--text-muted);">Aucun signal cyber dominant à cette minute.</div>`;

    const explanation = activeBreakdown[0]?.explanation ?? 'Scoring borné par famille avec décroissance temporelle.';

    return `
      <div style="margin-bottom:10px;padding:9px 10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);">Composition de la pression</div>
          <div style="font-size:10px;color:var(--text-secondary);">${assessment.summary.france30d} signaux FR / 30j</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>
        <div style="margin-top:8px;font-size:9px;color:var(--text-muted);line-height:1.45;">
          ${explanation} Une famille seule ne peut pas saturer le score.
        </div>
      </div>
    `;
  }

  private renderTabContent(): void {
    const el = this.contentEl?.querySelector<HTMLElement>('#cyber-tab-content');
    if (!el) return;
    el.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;';
    if (this.activeTab === 'alertes' && this.currentData) {
      el.innerHTML = `<div style="display:grid;grid-template-columns:1fr;gap:10px;">${this.renderCertFrCard(this.currentData)}</div>`;
    } else if (this.activeTab === 'ransomware' && this.currentData) {
      el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${this.renderRansomwareCard(this.currentData)}${this.renderCveCard(this.currentData)}</div>`;
    } else if (this.activeTab === 'incidents') {
      el.innerHTML = this.renderIncidentsTab();
      this.bindIncidentFilters();
    }
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
            CERT-FR / NVD
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
          Leaks & Ransomware FR
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
          incidents organisationnels / 30 jours
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
            Vulnérabilités critiques
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

  private renderIncidentsTab(): string {
    const SEV_COLORS: Record<string,string> = { critical:'#ef4444', high:'#f97316', medium:'#f59e0b', low:'#3b82f6' };
    const SEV_LABELS: Record<string,string> = { critical:'CRITIQUE', high:'ÉLEVÉ', medium:'MOYEN', low:'FAIBLE' };
    const TYPE_ICONS: Record<string,string> = { ransomware:'🏴‍☠️', leak:'💧', exposure:'🔓', vulnerability:'⚠️' };
    const TYPE_LABELS: Record<string,string> = { ransomware:'Ransomware', leak:'Fuite', exposure:'Exposition', vulnerability:'Vulnérabilité' };
    const fmt = (n: number) => n >= 1_000_000 ? (n/1_000_000).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(0)+'K' : String(n);
    const formatDate = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
    const sourceLabel = (e: ThreatEvent) => e.ransomwareGroup || e.sourceLabel || e.sources[0]?.name || 'source';
    const precisionLabel = (e: ThreatEvent) => {
      const labels: Record<ThreatEvent['location']['precision'], string> = {
        hq: 'HQ',
        city: 'Ville',
        region: 'Région',
        country: 'Pays',
        unknown: 'N/A',
      };
      return `${e.location.label} · ${labels[e.location.precision]}`;
    };
    const subLabel = (e: ThreatEvent) => {
      if (e.type === 'ransomware') return `${sourceLabel(e)} · ransomware`;
      if (e.metrics?.records) return `${sourceLabel(e)} · ${fmt(e.metrics.records)} records`;
      if (e.metrics?.affectedAssets) return `${sourceLabel(e)} · ${fmt(e.metrics.affectedAssets)} assets`;
      return sourceLabel(e);
    };

    const filteredEvents = filterThreatEvents(this.threatEvents, this.threatFilters);

    if (this.threatEvents.length === 0) {
      return `<div style="text-align:center;padding:32px 16px;color:rgba(255,255,255,0.3);font-size:12px;">Aucun incident — couche <strong style="color:rgba(255,255,255,0.5);">Carte Menaces</strong> activée ?</div>`;
    }

    const totalRecords = filteredEvents.reduce((s,e) => s+(e.metrics?.records||0), 0);
    const ransomCount = filteredEvents.filter(e => e.type==='ransomware').length;
    const countryCount = new Set(filteredEvents.map(e => e.countryCode || 'FR')).size;

    const statsHtml = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-bottom:10px;">
      ${[['🎯',String(filteredEvents.length),'INCIDENTS'],['📊',fmt(totalRecords),'RECORDS'],['🏴‍☠️',String(ransomCount),'RANSOMWARE'],['🇫🇷',String(countryCount),'PAYS']]
        .map(([ic,val,lab]) => `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:6px;padding:6px;text-align:center;"><div style="font-size:13px;">${ic}</div><div style="font-size:13px;font-weight:700;color:#fff;">${val}</div><div style="font-size:8px;color:rgba(255,255,255,0.35);text-transform:uppercase;">${lab}</div></div>`).join('')}
    </div>`;

    const controlsHtml = this.renderIncidentFilters();
    const emptyHtml = `<div style="text-align:center;padding:24px 12px;color:rgba(255,255,255,0.32);font-size:12px;">Aucun incident dans ce filtre</div>`;

    const listHtml = [...filteredEvents]
      .sort((a,b) => new Date(b.date).getTime()-new Date(a.date).getTime())
      .map(e => {
        const color = SEV_COLORS[e.severity] || '#6b7280';
        const initials = e.organizationName.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || 'FR';
        return `<button data-threat-event-id="${this.escapeHtml(e.id)}" style="width:100%;text-align:left;padding:10px 8px;border:1px solid rgba(255,255,255,0.06);border-radius:8px;background:rgba(9,16,32,0.55);margin-bottom:8px;display:flex;align-items:center;gap:10px;cursor:pointer;">
          <div style="width:34px;height:34px;border-radius:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7);font-size:10px;font-weight:800;flex-shrink:0;">${this.escapeHtml(initials)}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
              <div style="font-size:12px;font-weight:700;color:#e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.flagEmoji || '🇫🇷'} ${this.escapeHtml(e.organizationName)}</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.75);white-space:nowrap;">${formatDate(e.date)}</div>
            </div>
            <div style="font-size:11px;color:rgba(255,255,255,0.72);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escapeHtml(sourceLabel(e))}</div>
            <div style="font-size:10px;color:rgba(125,211,252,0.78);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📍 ${this.escapeHtml(precisionLabel(e))}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;gap:8px;">
              <span style="font-size:10px;color:rgba(255,255,255,0.42);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${TYPE_ICONS[e.type]||''} ${TYPE_LABELS[e.type]||e.type} · ${this.escapeHtml(subLabel(e))}</span>
              <span style="font-size:9px;font-weight:700;color:${color};">${SEV_LABELS[e.severity]||e.severity.toUpperCase()}</span>
            </div>
          </div>
          <div style="width:8px;height:8px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color};flex-shrink:0;"></div>
        </button>`;
      }).join('');

    return `${statsHtml}${controlsHtml}<div style="flex:1;min-height:0;overflow-y:auto;">${listHtml || emptyHtml}</div>`;
  }

  private renderIncidentFilters(): string {
    const chip = (attr: string, value: string, label: string, active: boolean) => `<button ${attr}="${value}" style="
      border:1px solid ${active ? 'rgba(34,211,238,0.65)' : 'rgba(255,255,255,0.16)'};
      background:${active ? 'rgba(8,145,178,0.34)' : 'rgba(255,255,255,0.04)'};
      color:${active ? '#e0faff' : 'rgba(255,255,255,0.72)'};
      border-radius:999px;padding:5px 10px;font-size:9px;font-weight:800;letter-spacing:.04em;
      text-transform:uppercase;cursor:pointer;">${label}</button>`;
    const section = (label: string, inner: string) => `<div style="margin-bottom:9px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:.12em;color:rgba(255,255,255,0.72);text-transform:uppercase;margin:0 0 6px;">${label}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${inner}</div>
    </div>`;

    return `<div style="border-top:1px solid rgba(255,255,255,0.07);border-bottom:1px solid rgba(255,255,255,0.07);padding:10px 0;margin-bottom:10px;">
      <div style="position:relative;margin-bottom:10px;">
        <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,0.45);font-size:12px;">🔍</span>
        <input data-threat-search type="text" placeholder="Rechercher entreprise, domaine, secteur..." value="${this.escapeHtml(this.threatFilters.query)}" style="
          width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,0.14);border-radius:8px;
          background:rgba(255,255,255,0.055);color:#fff;font-size:11px;padding:8px 10px 8px 29px;outline:none;">
      </div>
      ${section('Sévérité', [
        chip('data-threat-severity','all','Tous',this.threatFilters.severity === 'all'),
        chip('data-threat-severity','low','Faible',this.threatFilters.severity === 'low'),
        chip('data-threat-severity','medium','Moyen',this.threatFilters.severity === 'medium'),
        chip('data-threat-severity','high','Élevé',this.threatFilters.severity === 'high'),
        chip('data-threat-severity','critical','Critique',this.threatFilters.severity === 'critical'),
      ].join(''))}
      ${section('Plus récent', [
        chip('data-threat-time','7d','7J',this.threatFilters.time === '7d'),
        chip('data-threat-time','30d','30J',this.threatFilters.time === '30d'),
        chip('data-threat-time','90d','90J',this.threatFilters.time === '90d'),
        chip('data-threat-time','1y','1 AN',this.threatFilters.time === '1y'),
        chip('data-threat-time','2y','2 ANS',this.threatFilters.time === '2y'),
        chip('data-threat-time','all','Tout',this.threatFilters.time === 'all'),
      ].join(''))}
      ${section('Type', [
        chip('data-threat-type','all','Tous',this.threatFilters.type === 'all'),
        chip('data-threat-type','leak','Fuites',this.threatFilters.type === 'leak'),
        chip('data-threat-type','ransomware','Ransomware',this.threatFilters.type === 'ransomware'),
        chip('data-threat-type','exposure','Expositions',this.threatFilters.type === 'exposure'),
        chip('data-threat-type','vulnerability','CERT/NVD',this.threatFilters.type === 'vulnerability'),
      ].join(''))}
    </div>`;
  }

  private bindIncidentFilters(): void {
    const update = (filters: Partial<ThreatEventFilters>) => {
      this.threatFilters = { ...this.threatFilters, ...filters };
      this.onThreatFiltersChange?.(this.threatFilters);
      this.renderTabContent();
    };

    this.contentEl?.querySelectorAll<HTMLElement>('[data-threat-severity]').forEach(btn => {
      btn.addEventListener('click', () => update({ severity: btn.dataset.threatSeverity as ThreatSeverityFilter }));
    });
    this.contentEl?.querySelectorAll<HTMLElement>('[data-threat-time]').forEach(btn => {
      btn.addEventListener('click', () => update({ time: btn.dataset.threatTime as ThreatTimeFilter }));
    });
    this.contentEl?.querySelectorAll<HTMLElement>('[data-threat-type]').forEach(btn => {
      btn.addEventListener('click', () => update({ type: btn.dataset.threatType as ThreatTypeFilter }));
    });

    const input = this.contentEl?.querySelector<HTMLInputElement>('[data-threat-search]');
    input?.addEventListener('input', () => update({ query: input.value.trim() }));

    this.contentEl?.querySelectorAll<HTMLElement>('[data-threat-event-id]').forEach(card => {
      card.addEventListener('mouseenter', () => { card.style.background = 'rgba(15,23,42,0.86)'; });
      card.addEventListener('mouseleave', () => { card.style.background = 'rgba(9,16,32,0.55)'; });
      card.addEventListener('click', () => {
        const event = this.threatEvents.find(e => e.id === card.dataset.threatEventId);
        if (event) this.onThreatEventSelect?.(event);
      });
    });
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
