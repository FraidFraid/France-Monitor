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
import {
  applyPremiumCloseButtonHover,
  createPremiumRingHeader,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';
import type { FuelTensionDashboard, OilDashboard } from '../types/index.ts';
import { isOilPanelEnabled, getVigilanceLabel, getVigilanceColor } from '../services/oil.ts';
import { getFuelBadgeColor, getFuelTensionLevelColor } from '../services/fuel-tension.ts';
import {
  filterFuelPriceSeries,
  formatFuelDeltaCents,
  formatFuelPrice,
  renderFuelPriceChartSvg,
  type FuelPriceChartRange,
} from '../utils/fuelPriceChart.ts';

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

const OIL_PANEL_TITLE = 'Pétrole – Réseau & stocks';
const OIL_PANEL_DESCRIPTION = 'Deux lectures complémentaires: une référence France structurale, et une vue harmonisée plus fraîche mais provisoire.';
const OIL_PANEL_FRESHNESS_BADGE = 'FR STRUCTURAL + JODI/UFIP';
const OIL_PANEL_SOURCES_TEXT = 'Référence FR: SDES, INSEE, CPDP/UFIP, data.gouv';
const OIL_PANEL_COMPLEMENT_TEXT = 'Complément fraîcheur: JODI Oil, JODI Gas, UFIP mensuel';
const OIL_PANEL_DAILY_TEXT = 'Vue Daily: prix et ruptures carburants, pas volumes livrés';
const OIL_PANEL_FRESHNESS_TEXT = 'Vue JODI/UFIP: plus fraîche pour 2025–2026, mais méthodologie mixte et provisoire.';
const OIL_PANEL_DISCLAIMER_TEXT = 'Limite: pas de télémesure live du raffinage, des oléoducs ni des livraisons station.';

// ═══ OilPanel Class ═══

export class OilPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;
  private onFuelTensionMapVisibilityChange?: (visible: boolean) => void;
  private latestOilData: OilDashboard | null = null;
  private latestFuelTensionData: FuelTensionDashboard | null = null;
  private fuelTensionSearch = '';
  private fuelTensionListVisible = false;
  private fuelTensionMapVisible = true;
  private fuelPriceHistoryRange: FuelPriceChartRange = '1m';
  private latestVisibleFuelPriceSeries: Array<{
    fuelType: string;
    label: string;
    color: string;
    points: Array<{ timestamp: string; price: number }>;
  }> = [];
  private freshnessSectionExpanded = false;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(container: HTMLElement) {
    super(container, { title: OIL_PANEL_TITLE, icon: '🛢️', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'oil-panel-modal';
    this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
        width: '400px',
        maxHeight: 'calc(100vh - var(--right-panel-top) - 20px)',
        backgroundStart: 'rgba(24, 18, 8, 0.97)',
        backgroundEnd: 'rgba(16, 12, 9, 0.96)',
        borderColor: 'rgba(252, 211, 77, 0.18)',
        extra: 'max-width: min(400px, calc(100vw - 24px));',
      })}
      cursor: grab;
    `;

    // Close button
    this.closeBtn = document.createElement('button');
    this.closeBtn.innerHTML = '✕';
    this.closeBtn.className = 'oil-panel-close';
    this.closeBtn.style.cssText = getPremiumCloseButtonStyle();
    applyPremiumCloseButtonHover(this.closeBtn);
    this.closeBtn.onclick = () => this.hide();
    this.modalEl.appendChild(this.closeBtn);

    const header = createPremiumRingHeader({
      ringId: 'oil-ring-progress',
      centerId: 'oil-ring-score',
      centerText: '--',
      ringStroke: OIL_PANEL_COLORS.export,
      title: OIL_PANEL_TITLE,
      subtitle: 'Chargement...',
      statusId: 'oil-status-label',
      updateId: 'oil-update-time',
      gradientStart: 'rgba(245, 158, 11, 0.18)',
      gradientEnd: 'rgba(194, 65, 12, 0.10)',
      titlePrefix: 'Backbone énergétique',
      textColor: OIL_PANEL_COLORS.title,
    });
    header.className = 'oil-panel-header';
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

  setOnFuelTensionMapVisibilityChange(handler: (visible: boolean) => void): void {
    this.onFuelTensionMapVisibilityChange = handler;
  }

  isFuelTensionMapVisible(): boolean {
    return this.fuelTensionMapVisible;
  }

  show(data: OilDashboard | null, fuelTension: FuelTensionDashboard | null = null): void {
    if (!this.contentEl) return;
    this.latestOilData = data;
    this.latestFuelTensionData = fuelTension;

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

    this.updateHeader(data, fuelTension);
    this.renderContent(data, fuelTension);
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

  private updateHeader(data: OilDashboard, fuelTension: FuelTensionDashboard | null = null): void {
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
        <span style="margin-left: 8px;">${this.renderFreshnessBadge(OIL_PANEL_FRESHNESS_BADGE)}</span>
      `;
    }

    if (updateTime) {
      const oilDate = new Date(data.meta.lastUpdate);
      const fuelDate = fuelTension?.generatedAt ? new Date(fuelTension.generatedAt) : null;
      const fuelLabel = fuelDate
        ? `carburants quasi-live ${fuelDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
        : 'carburants quasi-live en attente';
      updateTime.textContent = `Oil UI ${oilDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · ${fuelLabel}`;
    }
  }

  private renderContent(data: OilDashboard, fuelTension: FuelTensionDashboard | null = null): void {
    if (!this.contentEl) return;

    // Warning banner if partial data
    const warningBanner = data.meta.partialData ? `
      <div style="background: rgba(245, 158, 11, 0.14); border: 1px solid rgba(245, 158, 11, 0.32); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px;">⚠️</span>
        <span style="color: ${OIL_PANEL_COLORS.title}; font-size: 11px;">Une ou plusieurs sources OIL ont basculé en fallback consolidé.</span>
      </div>
    ` : '';

    const freshnessSection = this.renderFreshnessSection();
    const structuralHeader = this.renderViewHeader(
      'Vue France structurale (SDES/CPDP)',
      'Backbone FR pour stocks, flux, origines, capacités et raffinage. Référentiel principal du layer pétrole.',
      [
        this.renderFreshnessBadge(data.meta.freshness.dashboard.label),
        this.renderFreshnessBadge(data.meta.freshness.infrastructure.label),
      ],
    );
    const stocksSection = this.renderStocksSection(data);
    const flowsSection = this.renderFlowsSection(data);
    const originsSection = this.renderOriginsSection(data);
    const productsSection = this.renderProductsSection(data);
    const refineriesSection = this.renderRefineriesSection(data);
    const harmonizedHeader = this.renderViewHeader(
      'Vue harmonisée JODI/UFIP',
      'Complément plus frais pour 2025–2026. Méthodologie mixte France + international, à lire comme signal provisoire.',
      [
        this.renderFreshnessBadge(data.meta.freshness.harmonized.label),
        this.renderDynamicBadge('INTERNATIONAL', '#60A5FA'),
      ],
    );
    const harmonizedSection = this.renderHarmonizedSection(data);
    const deliveriesSection = this.renderDeliveriesSection(data);
    const fuelTensionSection = this.renderFuelTensionSection(fuelTension);
    const fuelPriceHistorySection = this.renderFuelPriceHistorySection(data, fuelTension);

    this.contentEl.innerHTML = `
      ${warningBanner}
      ${freshnessSection}
      ${structuralHeader}
      ${stocksSection}
      ${flowsSection}
      ${originsSection}
      ${productsSection}
      ${refineriesSection}
      ${harmonizedHeader}
      ${harmonizedSection}
      ${deliveriesSection}
      ${fuelTensionSection}
      ${fuelPriceHistorySection}
    `;

    this.bindFreshnessSectionToggle();
    this.bindFuelTensionSearch();
    this.bindFuelPriceHistoryControls();
    this.bindFuelPriceHistoryTooltip();
  }

  private renderFreshnessSection(): string {
    const expanded = this.freshnessSectionExpanded;

    return `
      <details
        id="oil-freshness-section"
        style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};"
        ${expanded ? 'open' : ''}
      >
        <summary style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; cursor: pointer; list-style: none;">
          <div style="flex: 1; min-width: 0;">
            <div style="color: var(--text-primary); font-weight: 700; font-size: 13px; line-height: 1.25; white-space: nowrap;">Sources & fraîcheur</div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
              ${this.renderFreshnessBadge(OIL_PANEL_FRESHNESS_BADGE)}
            </div>
          </div>
          <span style="color: var(--text-muted); font-size: 10px; flex-shrink: 0; margin-top: 2px;">${expanded ? 'Masquer' : 'Afficher'}</span>
        </summary>
        <div style="color: var(--text-secondary); font-size: 11px; line-height: 1.55; margin: 12px 0 10px;">${OIL_PANEL_DESCRIPTION}</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div style="background: ${OIL_PANEL_COLORS.surfaceSoft}; border: 1px solid rgba(252, 211, 77, 0.08); border-radius: 6px; padding: 8px;">
            <div style="color: var(--text-muted); font-size: 10px; line-height: 1.55;">${OIL_PANEL_SOURCES_TEXT}</div>
          </div>
          <div style="background: ${OIL_PANEL_COLORS.surfaceSoft}; border: 1px solid rgba(252, 211, 77, 0.08); border-radius: 6px; padding: 8px;">
            <div style="color: var(--text-muted); font-size: 10px; line-height: 1.55;">${OIL_PANEL_COMPLEMENT_TEXT}</div>
          </div>
          <div style="background: ${OIL_PANEL_COLORS.surfaceSoft}; border: 1px solid rgba(252, 211, 77, 0.08); border-radius: 6px; padding: 8px;">
            <div style="color: var(--text-muted); font-size: 10px; line-height: 1.55;">${OIL_PANEL_DAILY_TEXT}</div>
          </div>
          <div style="background: ${OIL_PANEL_COLORS.surfaceSoft}; border: 1px solid rgba(252, 211, 77, 0.08); border-radius: 6px; padding: 8px;">
            <div style="color: var(--text-muted); font-size: 10px; line-height: 1.55;">${OIL_PANEL_FRESHNESS_TEXT}</div>
          </div>
          <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.16); border-radius: 6px; padding: 8px;">
            <div style="color: var(--text-muted); font-size: 10px; line-height: 1.55;">${OIL_PANEL_DISCLAIMER_TEXT}</div>
          </div>
        </div>
      </details>
    `;
  }

  private renderViewHeader(title: string, subtitle: string, badges: string[] = []): string {
    const uniqueBadges = Array.from(new Set(badges.filter(Boolean)));

    return `
      <div style="margin: 12px 0 10px;">
        <div style="color: var(--text-primary); font-weight: 700; font-size: 12px; letter-spacing: 0.02em; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</div>
        ${uniqueBadges.length > 0 ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; margin-bottom:6px;">${uniqueBadges.join('')}</div>` : ''}
        <div style="color: var(--text-muted); font-size: 10px; line-height: 1.55; max-width: 100%;">${subtitle}</div>
      </div>
    `;
  }

  private renderHarmonizedSection(data: OilDashboard): string {
    const harmonized = data.harmonized;
    if (!harmonized?.available) {
      return `
        <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px dashed rgba(255,255,255,0.12); color: var(--text-muted); font-size: 11px;">
          Vue harmonisée indisponible sur ce cycle. Le layer continue d’utiliser le backbone France structurale.
        </div>
      `;
    }

    const oilRows = harmonized.oilProducts
      .filter((row) => row.demandKbd !== null || row.importsKbd !== null)
      .map((row) => `
        <tr>
          <td style="padding:4px 0;color:var(--text-secondary);font-size:11px;">${this.escapeHtml(row.product)}</td>
          <td style="padding:4px 0;color:var(--text-primary);font-size:11px;text-align:right;">${this.formatKbd(row.demandKbd)}</td>
          <td style="padding:4px 0;color:var(--text-primary);font-size:11px;text-align:right;">${this.formatKbd(row.importsKbd)}</td>
        </tr>
      `)
      .join('');

    const gasDemandBcm = harmonized.gasTotalDemandTj != null
      ? harmonized.gasTotalDemandTj / 36_000
      : null;
    const lngShare = harmonized.gasLngSharePct;
    const pipeShare = lngShare == null ? null : Math.max(0, 100 - lngShare);

    return `
      <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
          <span style="color: var(--text-primary); font-weight: 600; font-size: 12px;">Signal mensuel harmonisé</span>
          <span style="display:flex; align-items:center; gap:6px;">
            ${harmonized.provisional ? this.renderDynamicBadge('PROVISOIRE', '#F59E0B') : ''}
            ${this.renderFreshnessBadge(data.meta.freshness.harmonized.label)}
          </span>
        </div>
        <div style="color: var(--text-muted); font-size: 10px; line-height: 1.45; margin-bottom: 10px;">
          ${this.escapeHtml(harmonized.sourceLabel)}${harmonized.oilDataMonth || harmonized.gasDataMonth || harmonized.latestUfipPeriodLabel ? ` · ${this.escapeHtml([harmonized.oilDataMonth, harmonized.gasDataMonth, harmonized.latestUfipPeriodLabel].filter(Boolean).join(' · '))}` : ''}
        </div>
        ${oilRows ? `
          <table style="width:100%; border-collapse:collapse; margin-bottom:10px;">
            <thead>
              <tr>
                <th style="padding:0 0 6px; color:var(--text-muted); font-size:10px; text-align:left;">Produit</th>
                <th style="padding:0 0 6px; color:var(--text-muted); font-size:10px; text-align:right;">Demande</th>
                <th style="padding:0 0 6px; color:var(--text-muted); font-size:10px; text-align:right;">Imports</th>
              </tr>
            </thead>
            <tbody>
              ${oilRows}
              ${harmonized.crudeImportsKbd != null ? `
                <tr>
                  <td style="padding:4px 0;color:var(--text-secondary);font-size:11px;">Crude</td>
                  <td style="padding:4px 0;color:var(--text-muted);font-size:11px;text-align:right;">—</td>
                  <td style="padding:4px 0;color:var(--text-primary);font-size:11px;text-align:right;">${this.formatKbd(harmonized.crudeImportsKbd)}</td>
                </tr>
              ` : ''}
            </tbody>
          </table>
        ` : ''}
        ${(gasDemandBcm != null || lngShare != null) ? `
          <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-bottom:10px;">
            ${gasDemandBcm != null ? `<span style="color: var(--text-primary); font-size: 12px; font-weight: 600;">Gaz: ${gasDemandBcm.toFixed(gasDemandBcm >= 10 ? 0 : 1)} BCM/an</span>` : ''}
            ${lngShare != null ? this.renderDynamicBadge(`LNG ${lngShare.toFixed(0)}%`, lngShare >= 70 ? '#F97316' : lngShare >= 40 ? '#FBBF24' : '#60A5FA') : ''}
            ${pipeShare != null ? this.renderDynamicBadge(`Pipeline ${pipeShare.toFixed(0)}%`, '#6B7280') : ''}
          </div>
        ` : ''}
        <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.16); border-radius: 6px; padding: 8px;">
          <div style="color: var(--text-muted); font-size: 10px; line-height: 1.45;">${this.escapeHtml(harmonized.caveat)}</div>
        </div>
      </div>
    `;
  }

  private bindFreshnessSectionToggle(): void {
    if (!this.contentEl) return;
    const details = this.contentEl.querySelector('#oil-freshness-section') as HTMLDetailsElement | null;
    if (!details) return;

    details.addEventListener('toggle', () => {
      this.freshnessSectionExpanded = details.open;
    });
  }

  private renderFuelPriceHistorySection(data: OilDashboard, fuelTension: FuelTensionDashboard | null = null): string {
    const history = data.fuelPriceHistory;
    if (!history || history.series.length === 0) {
      const currentPriceChips = fuelTension
        ? Object.entries(fuelTension.national.avgPrices)
          .map(([fuelType, price]) => `
            <span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.06); border-radius: 999px; padding: 3px 7px; color: var(--text-secondary); font-size: 9px;">
              <span style="color: var(--text-muted);">${fuelType.toUpperCase()}</span>
              <strong style="color: var(--text-primary); font-weight: 600;">${price.toFixed(3)}€</strong>
            </span>
          `)
          .join('')
        : '';

      return `
        <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
            <span style="color: var(--text-primary); font-weight: 600; font-size: 12px;">Prix moyens carburants</span>
            <span style="display:flex; align-items:center; gap:6px;">
              ${this.renderDynamicBadge('FALLBACK', '#F59E0B')}
            </span>
          </div>
          <div style="color: var(--text-muted); font-size: 10px; line-height: 1.45; margin-bottom: 10px;">
            Historique journalier indisponible sur ce cycle. La courbe n’a pas pu être reconstruite, mais les niveaux prix/ruptures restent visibles ci-dessous. Ce bloc ne mesure pas des volumes livrés.
          </div>
          ${currentPriceChips
            ? `<div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;">${currentPriceChips}</div>`
            : ''}
          <div style="padding: 10px 12px; border-radius: 8px; border: 1px dashed rgba(255,255,255,0.12); color: var(--text-muted); font-size: 11px;">
            Source prix carburants: ${data.sourceStatus.fuelPrices === 'error' ? 'erreur amont' : 'données indisponibles'} · signal prix/ruptures uniquement.
          </div>
        </div>
      `;
    }

    const rangeLabel = this.fuelPriceHistoryRange === '1m' ? '1 mois' : '1 an';
    const visibleSeries = filterFuelPriceSeries(history, this.fuelPriceHistoryRange);
    this.latestVisibleFuelPriceSeries = visibleSeries.map((series) => ({
      fuelType: series.fuelType,
      label: series.label,
      color: series.color,
      points: series.points.map((point) => ({ timestamp: point.timestamp, price: point.price })),
    }));
    const chartSvg = renderFuelPriceChartSvg(visibleSeries, {
      width: 320,
      height: 170,
      showAxes: true,
    });

    const legendRows = visibleSeries.map((series) => {
      const delta = this.fuelPriceHistoryRange === '1m' ? series.delta30dCents : series.delta7dCents;
      const deltaLabel = this.fuelPriceHistoryRange === '1m' ? '30j' : '7j';
      const deltaColor = delta == null
        ? 'var(--text-muted)'
        : delta > 0
          ? OIL_PANEL_COLORS.importGlow
          : delta < 0
            ? '#34D399'
            : 'var(--text-primary)';

      return `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:7px 0; border-top:1px solid rgba(255,255,255,0.05);">
          <div style="display:flex; align-items:center; gap:8px; min-width:0;">
            <span style="display:inline-flex; width:10px; height:10px; border-radius:999px; background:${series.color}; flex-shrink:0;"></span>
            <span style="color: var(--text-secondary); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escapeHtml(series.label)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
            <span style="color: var(--text-primary); font-size:11px; font-weight:600;">${formatFuelPrice(series.latestPrice)}</span>
            <span style="color:${deltaColor}; font-size:10px; font-weight:700;">${deltaLabel} ${formatFuelDeltaCents(delta)}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
        <div style="display:flex; justify-content:flex-start; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
          <span style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${this.renderFreshnessBadge(data.meta.freshness.fuelPrices.label)}
            <button id="fuel-price-range-1m" type="button" style="${this.getToggleButtonStyle(this.fuelPriceHistoryRange === '1m')}">1 mois</button>
            <button id="fuel-price-range-1y" type="button" style="${this.getToggleButtonStyle(this.fuelPriceHistoryRange === '1y')}">1 an</button>
          </span>
        </div>
        <div style="color: var(--text-primary); font-weight: 600; font-size: 12px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom:8px;">Prix & ruptures carburants</div>
        <div style="color: var(--text-muted); font-size: 10px; line-height: 1.45; margin-bottom: 10px;">
          ${this.escapeHtml(history.sourceLabel)} · vue ${rangeLabel} · prix/disponibilité, pas volumes livrés.
        </div>
        <div id="fuel-price-chart-container" style="position: relative; padding: 6px 0 2px;">
          ${chartSvg || '<div style="color: var(--text-muted); font-size: 11px;">Historique carburants indisponible.</div>'}
          <div
            id="fuel-price-hover-tooltip"
            style="display:none; position:absolute; z-index:12; pointer-events:none; min-width:200px; max-width:260px; background:rgba(12,12,18,0.96); border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:8px 10px; box-shadow:0 8px 24px rgba(0,0,0,0.45);"
          ></div>
        </div>
        <div style="display:flex; flex-direction:column; margin-top:8px;">
          ${legendRows}
        </div>
      </div>
    `;
  }

  private renderFuelTensionSection(fuelTension: FuelTensionDashboard | null): string {
    if (!fuelTension) {
      return `
        <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="color: var(--text-primary); font-weight: 600; font-size: 12px;">Tension carburants</span>
            ${this.renderDynamicBadge('QUASI-LIVE', '#FBBF24')}
          </div>
          <div style="color: var(--text-muted); font-size: 11px;">Chargement du signal carburants quasi temps réel…</div>
        </div>
      `;
    }

    const degradedBanner = fuelTension.degraded ? `
      <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.18); border-radius: 6px; padding: 8px; margin-bottom: 10px; color: #FCA5A5; font-size: 10px; line-height: 1.45;">
        Mode dégradé carburants : ${fuelTension.errorMessage ?? 'données indisponibles pour ce cycle.'}
      </div>
    ` : '';

    const filteredSummaries = fuelTension.summaries.filter((summary) => {
      if (!this.fuelTensionSearch.trim()) return true;
      const query = this.fuelTensionSearch.trim().toLowerCase();
      return summary.departmentName.toLowerCase().includes(query) || summary.departmentCode.toLowerCase().includes(query);
    });

    const cards = filteredSummaries.map((summary) => {
      const levelColor = getFuelTensionLevelColor(summary.tensionLevel);
      const badgeColor = getFuelBadgeColor(summary.freshness.badge);
      const prices = summary.fuelSignals
        .filter((signal) => signal.avgPrice !== null)
        .map((signal) => `
          <span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.07); border-radius: 999px; padding: 3px 7px; color: var(--text-secondary); font-size: 9px;">
            <span style="color: var(--text-muted);">${signal.fuelType.toUpperCase()}</span>
            <strong style="color: var(--text-primary); font-weight: 600;">${signal.avgPrice?.toFixed(3)}€</strong>
          </span>
        `)
        .join('');

      return `
        <div style="position: relative; background: linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)); border: 1px solid rgba(255,255,255,0.07); border-left: 4px solid ${levelColor}; border-radius: 10px; padding: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
            <div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <strong style="color: var(--text-primary); font-size: 12px;">${summary.departmentName}</strong>
                <span style="color: var(--text-muted); font-size: 10px;">${summary.departmentCode}</span>
              </div>
              <div style="color: var(--text-muted); font-size: 10px; margin-top: 3px;">${summary.stationCount} stations exploitées</div>
            </div>
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
              <span style="color: ${levelColor}; font-size: 10px; font-weight: 700; letter-spacing: 0.05em;">${summary.tensionLevel}</span>
              ${this.renderDynamicBadge(summary.freshness.badge, badgeColor)}
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 10px;">
            <div style="background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 8px;">
              <div style="color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;">Delta 7j</div>
              <div style="color: ${summary.deltaPrice7d !== null && summary.deltaPrice7d > 0 ? levelColor : 'var(--text-primary)'}; font-size: 13px; font-weight: 700; margin-top: 4px;">
                ${summary.deltaPrice7d === null ? 'n.d.' : `${summary.deltaPrice7d > 0 ? '+' : ''}${summary.deltaPrice7d.toFixed(1)} cts`}
              </div>
            </div>
            <div style="background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 8px;">
              <div style="color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;">Anomalies</div>
              <div style="color: ${summary.anomalyShare >= 15 ? levelColor : 'var(--text-primary)'}; font-size: 13px; font-weight: 700; margin-top: 4px;">
                ${summary.anomalyShare.toFixed(1)}%
              </div>
            </div>
            <div style="background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 8px;">
              <div style="color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;">Fraîcheur</div>
              <div style="color: var(--text-primary); font-size: 13px; font-weight: 700; margin-top: 4px;">
                ${this.formatAgeMinutes(summary.avgUpdateAgeMinutes)}
              </div>
            </div>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;">
            ${prices || '<span style="color: var(--text-muted); font-size: 9px;">Prix indisponibles sur les carburants suivis</span>'}
          </div>
        </div>
      `;
    }).join('');

    const noResults = filteredSummaries.length === 0
      ? `<div style="padding: 12px; border-radius: 8px; border: 1px dashed rgba(255,255,255,0.12); color: var(--text-muted); font-size: 11px;">Aucun département ne correspond à la recherche.</div>`
      : '';

    const topDepartments = fuelTension.national.topDepartments.map((summary) => `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 8px 10px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-flex; width: 8px; height: 8px; border-radius: 999px; background: ${getFuelTensionLevelColor(summary.tensionLevel)};"></span>
          <span style="color: var(--text-primary); font-size: 11px; font-weight: 600;">${summary.departmentName}</span>
          <span style="color: var(--text-muted); font-size: 10px;">${summary.departmentCode}</span>
        </div>
        <div style="text-align: right;">
          <div style="color: ${getFuelTensionLevelColor(summary.tensionLevel)}; font-size: 10px; font-weight: 700;">${summary.tensionLevel}</div>
          <div style="color: var(--text-muted); font-size: 9px;">${summary.anomalyShare.toFixed(1)}% anomalies</div>
        </div>
      </div>
    `).join('');

    const nationalPriceChips = Object.entries(fuelTension.national.avgPrices)
      .map(([fuelType, price]) => `
        <span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.06); border-radius: 999px; padding: 3px 7px; color: var(--text-secondary); font-size: 9px;">
          <span style="color: var(--text-muted);">${fuelType.toUpperCase()}</span>
          <strong style="color: var(--text-primary); font-weight: 600;">${price.toFixed(3)}€</strong>
        </span>
      `)
      .join('');

    return `
      <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="color: var(--text-primary); font-weight: 600; font-size: 12px;">Tension carburants</span>
          <span style="display: flex; align-items: center; gap: 6px;">
            ${this.renderDynamicBadge('FRANCE ENTIÈRE', '#60A5FA')}
            ${this.renderDynamicBadge('QUASI-LIVE', '#FBBF24')}
          </span>
        </div>
        <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 10px; line-height: 1.45;">
          ${fuelTension.sourceLabel} · ${fuelTension.coverageLabel}
        </div>
        ${degradedBanner}
        <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px;">
          <div style="background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 8px;">
            <div style="color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;">Stations exploitées</div>
            <div style="color: var(--text-primary); font-size: 14px; font-weight: 700; margin-top: 4px;">${fuelTension.national.stationCount.toLocaleString('fr-FR')}</div>
          </div>
          <div style="background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 8px;">
            <div style="color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;">Départements couverts</div>
            <div style="color: var(--text-primary); font-size: 14px; font-weight: 700; margin-top: 4px;">${fuelTension.national.departmentCount}</div>
          </div>
          <div style="background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 8px;">
            <div style="color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;">Anomalies nationales</div>
            <div style="color: ${fuelTension.national.anomalyShare >= 18 ? '#F97316' : 'var(--text-primary)'}; font-size: 14px; font-weight: 700; margin-top: 4px;">${fuelTension.national.anomalyShare.toFixed(1)}%</div>
          </div>
          <div style="background: rgba(0,0,0,0.18); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 8px;">
            <div style="color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em;">Fraîcheur nat. moy./méd.</div>
            <div style="color: var(--text-primary); font-size: 13px; font-weight: 700; margin-top: 4px;">${this.formatAgeMinutes(fuelTension.national.avgUpdateAgeMinutes)} / ${this.formatAgeMinutes(fuelTension.national.medianUpdateAgeMinutes)}</div>
          </div>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">
          ${nationalPriceChips || '<span style="color: var(--text-muted); font-size: 10px;">Prix moyens nationaux indisponibles</span>'}
        </div>
        <div style="margin-bottom: 10px;">
          <div style="color: var(--text-primary); font-weight: 600; font-size: 11px; margin-bottom: 8px;">Top 5 départements sous tension</div>
          <div style="display: flex; flex-direction: column; gap: 6px;">${topDepartments}</div>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <div style="color: var(--text-primary); font-weight: 600; font-size: 11px;">Départements</div>
            <button id="fuel-tension-toggle-list" type="button" style="${this.getToggleButtonStyle(this.fuelTensionListVisible)}">Liste ${this.fuelTensionListVisible ? 'ON' : 'OFF'}</button>
            <button id="fuel-tension-toggle-map" type="button" style="${this.getToggleButtonStyle(this.fuelTensionMapVisible)}">Carte ${this.fuelTensionMapVisible ? 'ON' : 'OFF'}</button>
          </div>
          <input
            id="fuel-tension-search"
            type="search"
            value="${this.escapeHtml(this.fuelTensionSearch)}"
            placeholder="Rechercher un département"
            style="width: 170px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; color: var(--text-primary); padding: 7px 10px; font-size: 11px; outline: none; ${this.fuelTensionListVisible ? '' : 'display:none;'}"
          />
        </div>
        <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 10px;">Tri: niveau de tension, puis part d’anomalies décroissante. La couche carte peut être masquée sans couper la synthèse nationale.</div>
        ${this.fuelTensionListVisible ? `<div style="display: flex; flex-direction: column; gap: 10px;">${cards || noResults}</div>` : '<div style="padding: 10px 12px; border-radius: 8px; border: 1px dashed rgba(255,255,255,0.12); color: var(--text-muted); font-size: 11px;">Liste départementale masquée. La synthèse nationale et le top 5 restent visibles.</div>'}
        <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.16); border-radius: 6px; padding: 8px; margin-top: 10px;">
          <div style="color: var(--text-muted); font-size: 10px; line-height: 1.45;">${fuelTension.disclaimerFr}</div>
        </div>
      </div>
    `;
  }

  private bindFuelTensionSearch(): void {
    if (!this.contentEl || !this.latestOilData || !this.latestFuelTensionData) return;
    const input = this.contentEl.querySelector('#fuel-tension-search') as HTMLInputElement | null;
    const toggleList = this.contentEl.querySelector('#fuel-tension-toggle-list') as HTMLButtonElement | null;
    const toggleMap = this.contentEl.querySelector('#fuel-tension-toggle-map') as HTMLButtonElement | null;
    if (!input) return;

    input.oninput = () => {
      this.fuelTensionSearch = input.value;
      this.renderContent(this.latestOilData!, this.latestFuelTensionData);
    };

    if (toggleList) {
      toggleList.onclick = () => {
        this.fuelTensionListVisible = !this.fuelTensionListVisible;
        if (!this.fuelTensionListVisible) this.fuelTensionSearch = '';
        this.renderContent(this.latestOilData!, this.latestFuelTensionData);
      };
    }

    if (toggleMap) {
      toggleMap.onclick = () => {
        this.fuelTensionMapVisible = !this.fuelTensionMapVisible;
        this.onFuelTensionMapVisibilityChange?.(this.fuelTensionMapVisible);
        this.renderContent(this.latestOilData!, this.latestFuelTensionData);
      };
    }
  }

  private bindFuelPriceHistoryControls(): void {
    if (!this.contentEl || !this.latestOilData) return;

    const btn1m = this.contentEl.querySelector('#fuel-price-range-1m') as HTMLButtonElement | null;
    const btn1y = this.contentEl.querySelector('#fuel-price-range-1y') as HTMLButtonElement | null;

    btn1m?.addEventListener('click', () => {
      if (this.fuelPriceHistoryRange === '1m') return;
      this.fuelPriceHistoryRange = '1m';
      this.renderContent(this.latestOilData!, this.latestFuelTensionData);
    });

    btn1y?.addEventListener('click', () => {
      if (this.fuelPriceHistoryRange === '1y') return;
      this.fuelPriceHistoryRange = '1y';
      this.renderContent(this.latestOilData!, this.latestFuelTensionData);
    });
  }

  private bindFuelPriceHistoryTooltip(): void {
    if (!this.contentEl || this.latestVisibleFuelPriceSeries.length === 0) return;

    const container = this.contentEl.querySelector('#fuel-price-chart-container') as HTMLElement | null;
    const tooltip = this.contentEl.querySelector('#fuel-price-hover-tooltip') as HTMLElement | null;
    const svg = container?.querySelector('svg') as SVGSVGElement | null;
    if (!container || !tooltip || !svg) return;

    const timestampSet = new Set<number>();
    for (const series of this.latestVisibleFuelPriceSeries) {
      for (const point of series.points) {
        const time = new Date(point.timestamp).getTime();
        if (Number.isFinite(time)) timestampSet.add(time);
      }
    }
    const timeline = Array.from(timestampSet).sort((a, b) => a - b);
    if (timeline.length === 0) return;

    const valuesBySeries = this.latestVisibleFuelPriceSeries.map((series) => ({
      label: series.label,
      color: series.color,
      byTime: new Map(series.points
        .map((point) => [new Date(point.timestamp).getTime(), point.price] as const)
        .filter(([time, price]) => Number.isFinite(time) && Number.isFinite(price))),
    }));

    const formatDate = (timestamp: number): string => new Date(timestamp).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

    const renderTooltipHtml = (timestamp: number): string => {
      const rows = valuesBySeries.map((series) => {
        const value = series.byTime.get(timestamp);
        const display = value == null ? 'n.d.' : `${value.toFixed(3).replace('.', ',')} €/L`;
        return `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:5px;">
            <div style="display:flex; align-items:center; gap:6px; min-width:0;">
              <span style="display:inline-flex; width:8px; height:8px; border-radius:999px; background:${series.color}; flex-shrink:0;"></span>
              <span style="font-size:11px; color:#d4d4dd; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.escapeHtml(series.label)}</span>
            </div>
            <span style="font-size:11px; color:#ffffff; font-weight:600; flex-shrink:0;">${display}</span>
          </div>
        `;
      }).join('');

      return `
        <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.07em; color:#fbbf24; font-weight:700;">Prix carburants</div>
        <div style="font-size:12px; color:#ffffff; font-weight:700; margin-top:3px;">${formatDate(timestamp)}</div>
        <div style="margin-top:4px;">${rows}</div>
      `;
    };

    const nearestTimestamp = (mouseX: number): number => {
      const rect = svg.getBoundingClientRect();
      const ratio = rect.width > 0 ? (mouseX - rect.left) / rect.width : 0;
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      const target = timeline[0] + clampedRatio * (timeline[timeline.length - 1] - timeline[0]);
      let best = timeline[0];
      let bestDelta = Math.abs(best - target);
      for (let i = 1; i < timeline.length; i += 1) {
        const delta = Math.abs(timeline[i] - target);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = timeline[i];
        }
      }
      return best;
    };

    const hide = (): void => {
      tooltip.style.display = 'none';
    };

    svg.addEventListener('mousemove', (event) => {
      const ts = nearestTimestamp(event.clientX);
      tooltip.innerHTML = renderTooltipHtml(ts);
      tooltip.style.display = 'block';

      const containerRect = container.getBoundingClientRect();
      const offsetX = event.clientX - containerRect.left + 14;
      const offsetY = event.clientY - containerRect.top - 8;
      const estimatedWidth = 230;
      const estimatedHeight = 170;
      const left = Math.max(6, Math.min(offsetX, containerRect.width - estimatedWidth - 6));
      const top = Math.max(6, Math.min(offsetY, containerRect.height - estimatedHeight - 6));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    });

    svg.addEventListener('mouseleave', hide);
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
          <span class="oil-stock-tooltip-trigger" style="display:flex; align-items:center; gap:6px; min-width:0; padding:4px 8px; margin:-4px -8px; border-radius:8px; cursor:help; position:relative;">
            <span style="color: var(--text-primary); font-weight: 600; font-size: 12px;">Stocks nationaux</span>
            <span
              style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:999px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04); color:var(--text-muted); font-size:10px; flex-shrink:0;"
            >i</span>
            <span class="oil-stock-tooltip-bubble">
              <strong>France Monitor</strong><br>
              jours = stocks physiques FR / consommation moyenne FR<br><br>
              <strong>Méthode IEA</strong><br>
              jours = stocks IEA / net imports
            </span>
          </span>
          ${this.renderFreshnessBadge(data.meta.freshness.dashboard.label)}
        </div>
        <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 8px;">${data.meta.freshness.dashboard.detail}</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
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
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="color: var(--text-primary); font-weight: 600; font-size: 12px;">Flux pétroliers</span>
          ${this.renderFreshnessBadge(data.meta.freshness.dashboard.label)}
        </div>
        <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 10px;">Arcs estimés à partir d’un bilan annuel et de signaux mensuels, pas de flux mesurés en direct.</div>
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
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="color: var(--text-primary); font-weight: 600; font-size: 12px;">Par produit</span>
          ${this.renderFreshnessBadge(data.meta.freshness.dashboard.label)}
        </div>
        ${items}
      </div>
    `;
  }

  private renderOriginsSection(data: OilDashboard): string {
    if (data.origins.length === 0) return '';

    const topOrigins = data.origins.slice(0, 4);
    return `
      <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="color: var(--text-primary); font-weight: 600; font-size: 12px;">Origine du brut</span>
          ${this.renderFreshnessBadge(data.meta.freshness.dashboard.label)}
        </div>
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

    const periodLabel = latest.periodLabel.replace(/^en\s+/i, '').trim() || latest.periodLabel;
    const publicationLabel = latest.publicationDate ?? 'n.d.';
    const roadFuelTrendLabel = latest.roadFuelYoYPct === null
      ? 'n.d.'
      : `${latest.roadFuelYoYPct > 0 ? '+' : ''}${latest.roadFuelYoYPct.toFixed(1)}%`;
    const roadFuelTrendColor = latest.roadFuelYoYPct === null
      ? 'var(--text-muted)'
      : latest.roadFuelYoYPct > 0 ? OIL_PANEL_COLORS.export : latest.roadFuelYoYPct < 0 ? OIL_PANEL_COLORS.importGlow : 'var(--text-primary)';
    const metricCard = (
      label: string,
      value: string,
      trendLabel: string,
      trendColor: string,
      accentColor: string,
      note: string,
    ): string => `
      <div style="background: rgba(255,255,255,0.035); border: 1px solid ${accentColor}; border-radius: 8px; padding: 10px 12px; min-width: 0;">
        <div style="color: var(--text-muted); font-size: 10px; line-height: 1.2; margin-bottom: 7px;">${label}</div>
        <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px;">
          <div style="color: var(--text-primary); font-weight: 700; font-size: 15px; line-height: 1;">${value}</div>
          <div style="color: ${trendColor}; font-size: 11px; font-weight: 700; white-space: nowrap;">${trendLabel}</div>
        </div>
        <div style="color: var(--text-muted); font-size: 9px; line-height: 1.35; margin-top: 7px;">${note}</div>
      </div>
    `;

    return `
      <div style="background: ${OIL_PANEL_COLORS.surface}; border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid ${OIL_PANEL_COLORS.border};">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px;">
          <div style="min-width: 0;">
            <div style="color: var(--text-primary); font-weight: 700; font-size: 13px; line-height: 1.2;">UFIP mensuel</div>
            <div style="color: var(--text-muted); font-size: 10px; line-height: 1.35; margin-top: 3px;">Livraisons CPDP / produits pétroliers</div>
          </div>
          <span style="display: flex; align-items: center; flex-shrink: 0;">
            ${this.renderFreshnessBadge(data.meta.freshness.deliveries.label)}
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px;">
          <div style="background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 8px 10px;">
            <div style="color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px;">Mois de données</div>
            <div style="color: var(--text-primary); font-size: 12px; font-weight: 700; line-height: 1.25;">${this.escapeHtml(periodLabel)}</div>
          </div>
          <div style="background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 8px 10px;">
            <div style="color: var(--text-muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px;">Publication</div>
            <div style="color: var(--text-primary); font-size: 12px; font-weight: 700; line-height: 1.25;">${this.escapeHtml(publicationLabel)}</div>
          </div>
        </div>

        <div style="color: var(--text-muted); font-size: 10px; line-height: 1.45; margin-bottom: 10px;">${latest.sourceLabel ?? data.meta.freshness.deliveries.detail}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          ${metricCard(
            'Produits énergétiques',
            latest.totalProductsMillionTons === null ? 'Volume n.d.' : `${latest.totalProductsMillionTons.toFixed(2)} Mt`,
            totalTrendLabel,
            totalTrendColor,
            'rgba(245, 158, 11, 0.16)',
            'Variation annuelle du total produits.',
          )}
          ${metricCard(
            'Carburants routiers',
            latest.roadFuelMillionM3 === null ? 'Volume n.d.' : `${latest.roadFuelMillionM3.toFixed(3)} Mm3`,
            roadFuelTrendLabel,
            roadFuelTrendColor,
            'rgba(194, 65, 12, 0.16)',
            'Variation annuelle des livraisons routières.',
          )}
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
          <span style="display: flex; align-items: center; gap: 8px;">
            ${this.renderFreshnessBadge(data.meta.freshness.infrastructure.label)}
            <span style="color: var(--text-muted); font-size: 11px;">${activeCount}/${refineries.length} actives</span>
          </span>
        </div>
        <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 8px;">${data.meta.freshness.infrastructure.detail}</div>
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

  private formatKbd(value: number | null): string {
    if (value == null || Number.isNaN(value)) return '—';
    return `${value.toFixed(value >= 100 ? 1 : 3)} kbd`;
  }

  private renderFreshnessBadge(label: string): string {
    const normalizedLabel = label.trim() === 'FR STRUCTURAL' ? 'STRUCTURAL' : label;
    return `<span style="display: inline-flex; align-items: center; justify-content: center; min-width: 74px; padding: 2px 8px; border-radius: 999px; background: rgba(252, 211, 77, 0.12); border: 1px solid rgba(252, 211, 77, 0.18); color: ${OIL_PANEL_COLORS.title}; font-size: 9px; font-weight: 700; letter-spacing: 0.06em;">${normalizedLabel}</span>`;
  }

  private renderDynamicBadge(label: string, color: string): string {
    return `<span style="display: inline-flex; align-items: center; justify-content: center; min-width: 74px; padding: 2px 8px; border-radius: 999px; background: ${color}22; border: 1px solid ${color}33; color: ${color}; font-size: 9px; font-weight: 700; letter-spacing: 0.06em;">${label}</span>`;
  }

  private getToggleButtonStyle(active: boolean): string {
    return [
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'padding:5px 9px',
      'border-radius:999px',
      `border:1px solid ${active ? 'rgba(96,165,250,0.45)' : 'rgba(255,255,255,0.08)'}`,
      `background:${active ? 'rgba(96,165,250,0.16)' : 'rgba(255,255,255,0.04)'}`,
      `color:${active ? '#93C5FD' : 'var(--text-muted)'}`,
      'font-size:10px',
      'font-weight:700',
      'cursor:pointer',
    ].join(';');
  }

  private formatAgeMinutes(value: number | null): string {
    if (value === null || Number.isNaN(value)) return 'n.d.';
    if (value < 60) return `${Math.round(value)} min`;
    if (value < 24 * 60) return `${(value / 60).toFixed(1)} h`;
    return `${(value / (24 * 60)).toFixed(1)} j`;
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

  update(data: OilDashboard, fuelTension: FuelTensionDashboard | null = null): void {
    if (this.modalEl.style.display === 'none') return;
    this.latestOilData = data;
    this.latestFuelTensionData = fuelTension;
    this.updateHeader(data, fuelTension);
    this.renderContent(data, fuelTension);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  isVisible(): boolean {
    return this.modalEl.style.display !== 'none';
  }
}
