/**
 * OilPanel - Panneau Vigilance Pétrole + Stats Réseau Pétrolier
 *
 * Affiche:
 * - Score vigilance (anneau 0-100 avec statut vert/orange/rouge)
 * - Stocks nationaux en jours de consommation
 * - Détail par produit (gazole, essence, etc.)
 * - Tendance des flux (import/export)
 */

import { Panel } from './Panel.ts';
import type { OilDashboard } from '../types/index.ts';
import { isOilPanelEnabled, getVigilanceLabel, getVigilanceColor } from '../services/oil.ts';

const OIL_PANEL_COLORS = {
  title: '#FCD34D',
  export: '#F59E0B',
  import: '#C2410C',
  importGlow: '#EA580C',
  crude: '#78350F',
  products: '#A16207',
  strategic: '#FEF9C3',
  border: 'rgba(252, 211, 77, 0.14)',
  surface: 'rgba(0,0,0,0.2)',
  surfaceSoft: 'rgba(255,255,255,0.04)',
} as const;

// ═══ OilPanel Class ═══

export class OilPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(container: HTMLElement) {
    super(container, { title: 'Pétrole - Stocks et flux', icon: '🛢️', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'oil-panel-modal';
    this.modalEl.style.cssText = `
      position: absolute;
      top: var(--right-panel-top);
      right: 20px;
      width: 360px;
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
    this.closeBtn.className = 'oil-panel-close';
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

    // Header with vigilance ring
    const header = document.createElement('div');
    header.className = 'oil-panel-header';
    header.style.cssText = `
      padding: 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 16px;
    `;
    header.innerHTML = `
      <div class="oil-ring-container" style="position: relative; width: 64px; height: 64px;">
        <svg viewBox="0 0 36 36" style="width: 64px; height: 64px; transform: rotate(-90deg);">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"></circle>
          <circle id="oil-ring-progress" cx="18" cy="18" r="15.9" fill="none" stroke="${OIL_PANEL_COLORS.export}" stroke-width="3"
            stroke-dasharray="0 100" stroke-linecap="round" style="transition: stroke-dasharray 0.5s ease, stroke 0.3s ease;"></circle>
        </svg>
        <div id="oil-ring-score" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 16px; font-weight: 700; color: var(--text-primary);">--</div>
      </div>
      <div style="flex: 1;">
        <div style="color: ${OIL_PANEL_COLORS.title}; font-weight: 600; font-size: 14px;">Pétrole - Stocks et flux</div>
        <div id="oil-status-label" style="color: ${OIL_PANEL_COLORS.export}; font-size: 11px; margin-top: 2px;">Chargement...</div>
        <div id="oil-update-time" style="font-size: 10px; color: var(--text-muted); margin-top: 4px;"></div>
      </div>
    `;
    this.modalEl.appendChild(header);

    // Content container
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'oil-panel-content';
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
      if ((e.target as HTMLElement).closest('.oil-panel-close')) return;
      if ((e.target as HTMLElement).closest('.oil-panel-content')) return;

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
      const maxX = window.innerWidth - this.modalEl.offsetWidth;
      const maxY = window.innerHeight - this.modalEl.offsetHeight;
      this.modalEl.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
      this.modalEl.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
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

  protected render(): void { }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  show(data: OilDashboard | null): void {
    if (!this.contentEl) return;

    if (!isOilPanelEnabled()) {
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
    this.contentEl.innerHTML = `
      <div style="text-align: center; padding: 32px 16px;">
        <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.6;">🔐</div>
        <div style="color: ${OIL_PANEL_COLORS.title}; font-weight: 600; margin-bottom: 12px;">
          Module Pétrole désactivé
        </div>
        <div style="margin-top: 16px; color: var(--text-muted); font-size: 10px;">
          Activez avec <code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">VITE_ENABLE_OIL_LAYER=true</code>
        </div>
      </div>
    `;
  }

  private showLoadingState(): void {
    if (!this.contentEl) return;
    this.contentEl.innerHTML = `
      <div style="text-align: center; padding: 20px;">
        <div style="font-size: 24px; margin-bottom: 12px; animation: pulse 1.5s ease-in-out infinite;">🛢️</div>
        <div style="color: ${OIL_PANEL_COLORS.title}; font-size: 11px;">Chargement des données pétrolières...</div>
      </div>
    `;
  }

  private updateHeader(data: OilDashboard): void {
    const ring = this.modalEl.querySelector('#oil-ring-progress') as SVGCircleElement;
    const scoreEl = this.modalEl.querySelector('#oil-ring-score') as HTMLElement;
    const statusLabel = this.modalEl.querySelector('#oil-status-label') as HTMLElement;
    const updateTime = this.modalEl.querySelector('#oil-update-time') as HTMLElement;

    if (ring) {
      // Score 0-100 inversé pour l'affichage (100 = critique, cercle plein)
      const displayScore = data.meta.vigilanceScore;
      ring.style.strokeDasharray = `${displayScore} 100`;
      ring.style.stroke = this.getPanelVigilanceColor(data.meta.status);
    }

    if (scoreEl) {
      scoreEl.textContent = String(data.meta.vigilanceScore);
      scoreEl.style.color = this.getPanelVigilanceColor(data.meta.status);
    }

    if (statusLabel) {
      const label = getVigilanceLabel(data.meta.status);
      statusLabel.innerHTML = `
        <span style="color: ${this.getPanelVigilanceColor(data.meta.status)}; font-weight: 600;">● ${label}</span>
        <span style="margin-left: 8px; color: var(--text-secondary);">${data.stocks.nationalStocksDays} jours de stock</span>
      `;
    }

    if (updateTime) {
      const d = new Date(data.meta.lastUpdate);
      updateTime.textContent = `Mis à jour: ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    }
  }

  private renderContent(data: OilDashboard): void {
    if (!this.contentEl) return;

    // Warning banner if partial data
    const warningBanner = data.meta.partialData ? `
      <div style="background: rgba(245, 158, 11, 0.14); border: 1px solid rgba(245, 158, 11, 0.32); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px;">⚠️</span>
        <span style="color: ${OIL_PANEL_COLORS.title}; font-size: 11px;">Sources pétrolières INDISPONIBLES</span>
      </div>
    ` : '';

    // Stocks section
    const stocksSection = this.renderStocksSection(data);

    // Flows section
    const flowsSection = this.renderFlowsSection(data);

    // Origins and recent deliveries
    const originsSection = this.renderOriginsSection(data);
    const deliveriesSection = this.renderDeliveriesSection(data);

    // Products breakdown
    const productsSection = this.renderProductsSection(data);

    // Refineries summary
    const refineriesSection = this.renderRefineriesSection(data);

    this.contentEl.innerHTML = `
      ${warningBanner}
      ${stocksSection}
      ${flowsSection}
      ${originsSection}
      ${deliveriesSection}
      ${productsSection}
      ${refineriesSection}
    `;
  }

  private renderStocksSection(data: OilDashboard): string {
    const stocks = data.stocks;
    const status = data.meta.status;
    const color = this.getPanelVigilanceColor(status);

    // Progress bar pour les jours de stock (max ~120 jours)
    const progress = Math.min(100, (stocks.nationalStocksDays / 120) * 100);

    return `
      <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="color: var(--text-primary); font-weight: 600; font-size: 12px;">Stocks nationaux</span>
          <span style="color: ${color}; font-weight: 700; font-size: 14px;">${stocks.nationalStocksDays} jours</span>
        </div>
        <div style="background: rgba(255,255,255,0.1); border-radius: 4px; height: 8px; overflow: hidden;">
          <div style="background: ${color}; height: 100%; width: ${progress}%; transition: width 0.5s ease;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; margin-top: 6px;">
          <span style="color: var(--text-muted); font-size: 10px;">Réserve totale: ${this.formatTons(stocks.totalStocksTons)}</span>
          <span style="color: var(--text-muted); font-size: 10px;">Seuil critique: 30j</span>
        </div>
      </div>
    `;
  }

  private renderFlowsSection(data: OilDashboard): string {
    const flows = data.flows;
    const trendIcon = flows.trend === 'up' ? '↗' : flows.trend === 'down' ? '↘' : '→';
    const trendColor = flows.trend === 'up' ? OIL_PANEL_COLORS.export : flows.trend === 'down' ? OIL_PANEL_COLORS.importGlow : '#a8a29e';
    const trendLabel = flows.trend === 'up' ? 'En hausse' : flows.trend === 'down' ? 'En baisse' : 'Stable';

    return `
      <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
        <div style="color: var(--text-primary); font-weight: 600; font-size: 12px; margin-bottom: 10px;">Flux pétroliers</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div style="background: rgba(194, 65, 12, 0.12); border: 1px solid rgba(194, 65, 12, 0.22); border-radius: 8px; padding: 10px; text-align: center;">
            <div style="color: ${OIL_PANEL_COLORS.import}; font-size: 10px; margin-bottom: 2px; text-transform: uppercase;">Import</div>
            <div style="color: var(--text-primary); font-weight: 600; font-size: 12px;">${this.formatTons(flows.importTonsPerDay)}/j</div>
          </div>
          <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.22); border-radius: 8px; padding: 10px; text-align: center;">
            <div style="color: ${OIL_PANEL_COLORS.export}; font-size: 10px; margin-bottom: 2px; text-transform: uppercase;">Export</div>
            <div style="color: var(--text-primary); font-weight: 600; font-size: 12px;">${this.formatTons(flows.exportTonsPerDay)}/j</div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border-color);">
          <span style="color: var(--text-muted); font-size: 11px;">Solde net: <strong style="color: var(--text-primary);">+${this.formatTons(flows.netImportTonsPerDay)}/j</strong></span>
          <span style="color: ${trendColor}; font-size: 11px;">${trendIcon} ${trendLabel}</span>
        </div>
      </div>
    `;
  }

  private renderProductsSection(data: OilDashboard): string {
    const products = data.stocks.byProduct;
    if (products.length === 0) return '';

    const items = products.map(p => {
      const trendIcon = p.trend === 'up' ? '▲' : p.trend === 'down' ? '▼' : '–';
      const trendColor = p.trend === 'up' ? OIL_PANEL_COLORS.export : p.trend === 'down' ? OIL_PANEL_COLORS.importGlow : '#a8a29e';
      const daysColor = p.daysCover < 30 ? OIL_PANEL_COLORS.importGlow : p.daysCover < 60 ? OIL_PANEL_COLORS.export : OIL_PANEL_COLORS.title;

      return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
          <span style="color: var(--text-secondary); font-size: 11px;">${p.product}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="color: ${daysColor}; font-size: 11px; font-weight: 500;">${p.daysCover}j</span>
            <span style="color: ${trendColor}; font-size: 10px;">${trendIcon}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
        <div style="color: var(--text-primary); font-weight: 600; font-size: 12px; margin-bottom: 8px;">Par produit</div>
        ${items}
      </div>
    `;
  }

  private renderOriginsSection(data: OilDashboard): string {
    if (data.origins.length === 0) return '';

    const topOrigins = data.origins.slice(0, 4);
    return `
      <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
        <div style="color: var(--text-primary); font-weight: 600; font-size: 12px; margin-bottom: 8px;">Origine du brut</div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${topOrigins.map((origin) => `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="color: var(--text-secondary); font-size: 11px;">${origin.label}</span>
              <span style="color: ${OIL_PANEL_COLORS.title}; font-size: 11px; font-weight: 600;">${origin.sharePct.toFixed(1)}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  private renderDeliveriesSection(data: OilDashboard): string {
    const latest = data.deliveries[0];
    if (!latest) return '';

    const totalTrend = latest.totalProductsYoYPct ?? latest.roadFuelYoYPct;
    const totalTrendLabel = totalTrend === null
      ? 'n.d.'
      : `${totalTrend > 0 ? '+' : ''}${totalTrend.toFixed(1)}%`;
    const totalTrendColor = totalTrend === null
      ? 'var(--text-muted)'
      : totalTrend > 0 ? OIL_PANEL_COLORS.export : totalTrend < 0 ? OIL_PANEL_COLORS.importGlow : 'var(--text-primary)';

    return `
      <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="color: var(--text-primary); font-weight: 600; font-size: 12px;">Livraisons récentes</span>
          <span style="color: var(--text-muted); font-size: 10px;">${latest.periodLabel}</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div style="background: ${OIL_PANEL_COLORS.surfaceSoft}; border: 1px solid rgba(245, 158, 11, 0.14); border-radius: 6px; padding: 8px;">
            <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 2px;">Produits énergétiques</div>
            <div style="color: var(--text-primary); font-weight: 600; font-size: 12px;">
              ${latest.totalProductsMillionTons === null ? 'n.d.' : `${latest.totalProductsMillionTons.toFixed(2)} Mt`}
            </div>
            <div style="color: ${totalTrendColor}; font-size: 10px; margin-top: 2px;">${totalTrendLabel} vs N-1</div>
          </div>
          <div style="background: ${OIL_PANEL_COLORS.surfaceSoft}; border: 1px solid rgba(194, 65, 12, 0.14); border-radius: 6px; padding: 8px;">
            <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 2px;">Carburants routiers</div>
            <div style="color: var(--text-primary); font-weight: 600; font-size: 12px;">
              ${latest.roadFuelMillionM3 === null ? 'n.d.' : `${latest.roadFuelMillionM3.toFixed(3)} Mm3`}
            </div>
            <div style="color: ${this.getTrendColor(latest.roadFuelYoYPct)}; font-size: 10px; margin-top: 2px;">
              ${this.formatPct(latest.roadFuelYoYPct)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderRefineriesSection(data: OilDashboard): string {
    const refineries = data.refineries;
    const activeCount = refineries.filter(r => r.status === 'active').length;
    const totalCapacity = refineries.reduce((sum, r) => sum + r.capacityMtPerYear, 0);

    return `
      <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="color: var(--text-primary); font-weight: 600; font-size: 12px;">Raffineries</span>
          <span style="color: var(--text-muted); font-size: 11px;">${activeCount}/${refineries.length} actives</span>
        </div>
        <div style="color: var(--text-muted); font-size: 11px;">
          Capacité totale: <strong style="color: var(--text-primary);">${totalCapacity.toFixed(1)} Mt/an</strong>
        </div>
        <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px;">
          ${refineries.map(r => `
            <span style="background: ${r.status === 'active' ? 'rgba(252, 211, 77, 0.16)' : 'rgba(120, 53, 15, 0.28)'}; color: ${r.status === 'active' ? OIL_PANEL_COLORS.title : OIL_PANEL_COLORS.products}; font-size: 9px; padding: 2px 6px; border-radius: 4px;">${r.name}</span>
          `).join('')}
        </div>
      </div>
    `;
  }

  private formatTons(tons: number): string {
    if (tons >= 1_000_000) {
      return (tons / 1_000_000).toFixed(1) + ' Mt';
    } else if (tons >= 1_000) {
      return Math.round(tons / 1_000) + ' kt';
    }
    return Math.round(tons) + ' t';
  }

  private formatPct(value: number | null): string {
    if (value === null || Number.isNaN(value)) return 'n.d.';
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}% vs N-1`;
  }

  private getTrendColor(value: number | null): string {
    if (value === null || Number.isNaN(value)) return 'var(--text-muted)';
    if (value > 0) return OIL_PANEL_COLORS.export;
    if (value < 0) return OIL_PANEL_COLORS.importGlow;
    return 'var(--text-primary)';
  }

  private getPanelVigilanceColor(status: OilDashboard['meta']['status']): string {
    switch (status) {
      case 'critical':
        return OIL_PANEL_COLORS.importGlow;
      case 'tense':
        return OIL_PANEL_COLORS.export;
      case 'normal':
        return OIL_PANEL_COLORS.title;
      default:
        return getVigilanceColor(status);
    }
  }

  hide(): void {
    this.modalEl.style.display = 'none';
    if (this.onClose) {
      this.onClose();
    }
  }

  update(data: OilDashboard): void {
    if (this.modalEl.style.display === 'none') return;
    this.updateHeader(data);
    this.renderContent(data);
  }

  isVisible(): boolean {
    return this.modalEl.style.display !== 'none';
  }
}
