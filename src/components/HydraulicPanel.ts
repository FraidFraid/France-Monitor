import { Panel } from './Panel.ts';
import type { EcowattResponse, HydraulicBackboneAsset } from '../types/index.ts';

const HYDRAULIC_PANEL_COLORS = {
  blue: '#3B82F6',
  blueSoft: 'rgba(59, 130, 246, 0.16)',
  cyan: '#22D3EE',
  cyanSoft: 'rgba(34, 211, 238, 0.14)',
  slate: '#94A3B8',
  slateSoft: 'rgba(148, 163, 184, 0.14)',
  purple: '#8B5CF6',
  purpleSoft: 'rgba(139, 92, 246, 0.15)',
  stress: '#EF4444',
  high: '#2563EB',
  normal: '#93C5FD',
  low: '#60A5FA',
  text: '#E8EEF9',
  muted: '#94A3B8',
} as const;

function formatMw(value: number | null | undefined): string {
  if (!value || value <= 0) return 'n/d';
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: value < 100 ? 1 : 0 })} MW`;
}

function formatGwh(value: number | null | undefined): string {
  if (!value || value <= 0) return 'n/d';
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: value < 100 ? 1 : 0 })} GWh/an`;
}

function formatHm3(value: number | null | undefined): string {
  if (!value || value <= 0) return 'n/d';
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} hm3`;
}

function trendLabel(trend: HydraulicBackboneAsset['signals']['hydro_trend']): string {
  switch (trend) {
    case 'stress':
      return 'Stress';
    case 'high':
      return 'Haut';
    case 'low':
      return 'Bas';
    default:
      return 'Normal';
  }
}

function trendColor(trend: HydraulicBackboneAsset['signals']['hydro_trend']): string {
  switch (trend) {
    case 'stress':
      return HYDRAULIC_PANEL_COLORS.stress;
    case 'high':
      return HYDRAULIC_PANEL_COLORS.high;
    case 'low':
      return HYDRAULIC_PANEL_COLORS.low;
    default:
      return HYDRAULIC_PANEL_COLORS.normal;
  }
}

function typeLabel(asset: HydraulicBackboneAsset): string {
  if (asset.type === 'step_storage') return 'STEP';
  if (asset.subtype === 'run_of_river') return "Fil de l'eau";
  if (asset.subtype === 'reservoir') return 'Retenue';
  return 'Barrage';
}

export class HydraulicPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;
  private onSelectAsset?: (asset: HydraulicBackboneAsset) => void;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private currentEcowatt: EcowattResponse | null = null;

  constructor(container: HTMLElement) {
    super(container, { title: 'Backbone énergétique - Hydraulique', icon: '💧', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'hydraulic-panel-modal';
    this.modalEl.style.cssText = `
      position: absolute;
      top: var(--right-panel-top);
      right: 20px;
      width: 396px;
      max-height: calc(100vh - var(--right-panel-top) - 20px);
      background: linear-gradient(180deg, rgba(8, 15, 32, 0.97), rgba(10, 16, 29, 0.96));
      border: 1px solid rgba(59, 130, 246, 0.22);
      border-radius: 14px;
      box-shadow: 0 12px 34px rgba(2, 6, 23, 0.52);
      z-index: 1000;
      display: none;
      flex-direction: column;
      backdrop-filter: blur(12px);
      cursor: grab;
      overflow: hidden;
    `;

    this.closeBtn = document.createElement('button');
    this.closeBtn.innerHTML = '✕';
    this.closeBtn.className = 'hydraulic-panel-close';
    this.closeBtn.style.cssText = `
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(255,255,255,0.08);
      border: none;
      color: ${HYDRAULIC_PANEL_COLORS.muted};
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
      this.closeBtn!.style.background = 'rgba(255,255,255,0.16)';
      this.closeBtn!.style.color = HYDRAULIC_PANEL_COLORS.text;
    };
    this.closeBtn.onmouseout = () => {
      this.closeBtn!.style.background = 'rgba(255,255,255,0.08)';
      this.closeBtn!.style.color = HYDRAULIC_PANEL_COLORS.muted;
    };
    this.closeBtn.onclick = () => this.hide();
    this.modalEl.appendChild(this.closeBtn);

    const header = document.createElement('div');
    header.style.cssText = `
      padding: 18px 16px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      display: flex;
      align-items: center;
      gap: 14px;
      background: linear-gradient(135deg, rgba(14, 116, 144, 0.22), rgba(37, 99, 235, 0.10));
    `;
    header.innerHTML = `
      <div style="position: relative; width: 68px; height: 68px;">
        <svg viewBox="0 0 36 36" style="width:68px;height:68px;transform:rotate(-90deg);">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"></circle>
          <circle id="hydraulic-ring-progress" cx="18" cy="18" r="15.9" fill="none" stroke="${HYDRAULIC_PANEL_COLORS.blue}" stroke-width="3"
            stroke-dasharray="0 100" stroke-linecap="round" style="transition: stroke-dasharray 0.5s ease, stroke 0.3s ease;"></circle>
        </svg>
        <div id="hydraulic-ring-score" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:${HYDRAULIC_PANEL_COLORS.text};">--</div>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:700;color:${HYDRAULIC_PANEL_COLORS.text};">
          Backbone énergétique - Hydraulique
        </div>
        <div id="hydraulic-status-label" style="margin-top:2px;font-size:11px;color:${HYDRAULIC_PANEL_COLORS.cyan};">
          Sélection critique - couverture non exhaustive
        </div>
        <div id="hydraulic-update-time" style="margin-top:5px;font-size:10px;color:${HYDRAULIC_PANEL_COLORS.muted};"></div>
      </div>
    `;
    this.modalEl.appendChild(header);

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'hydraulic-panel-content';
    this.contentEl.style.cssText = `
      padding: 12px;
      overflow-y: auto;
      flex: 1;
      color: ${HYDRAULIC_PANEL_COLORS.text};
    `;
    this.modalEl.appendChild(this.contentEl);

    this.container.appendChild(this.modalEl);
    this.setupDrag();
    this.render();
  }

  protected render(): void {}

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  setOnSelectAsset(handler: (asset: HydraulicBackboneAsset) => void): void {
    this.onSelectAsset = handler;
  }

  show(assets: HydraulicBackboneAsset[], ecowatt: EcowattResponse | null = null): void {
    this.currentEcowatt = ecowatt;
    this.modalEl.style.display = 'flex';
    if (assets.length === 0) {
      this.showLoadingState();
      return;
    }
    this.updateHeader(assets);
    this.renderContent(assets);
  }

  update(assets: HydraulicBackboneAsset[], ecowatt: EcowattResponse | null = this.currentEcowatt): void {
    this.currentEcowatt = ecowatt;
    if (!this.isVisible()) return;
    if (assets.length === 0) {
      this.showLoadingState();
      return;
    }
    this.updateHeader(assets);
    this.renderContent(assets);
  }

  hide(): void {
    this.modalEl.style.display = 'none';
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }

  private setupDrag(): void {
    this.modalEl.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('.hydraulic-panel-close')) return;
      if ((event.target as HTMLElement).closest('.hydraulic-panel-content')) return;

      this.isDragging = true;
      const rect = this.modalEl.getBoundingClientRect();
      this.dragOffsetX = event.clientX - rect.left;
      this.dragOffsetY = event.clientY - rect.top;
      this.modalEl.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.isDragging) return;
      const x = event.clientX - this.dragOffsetX;
      const y = event.clientY - this.dragOffsetY;
      const maxX = window.innerWidth - this.modalEl.offsetWidth;
      const maxY = window.innerHeight - this.modalEl.offsetHeight;
      this.modalEl.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
      this.modalEl.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
      this.modalEl.style.bottom = 'auto';
      this.modalEl.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.modalEl.style.cursor = 'grab';
    });
  }

  private showLoadingState(): void {
    if (!this.contentEl) return;
    this.contentEl.innerHTML = `
      <div style="text-align:center;padding:24px 16px;">
        <div style="font-size:24px;margin-bottom:10px;animation:pulse 1.5s ease-in-out infinite;">💧</div>
        <div style="font-size:11px;color:${HYDRAULIC_PANEL_COLORS.muted};">
          Consolidation du backbone hydraulique critique...
        </div>
      </div>
    `;
  }

  private updateHeader(assets: HydraulicBackboneAsset[]): void {
    const ring = this.modalEl.querySelector('#hydraulic-ring-progress') as SVGCircleElement | null;
    const scoreEl = this.modalEl.querySelector('#hydraulic-ring-score') as HTMLElement | null;
    const statusEl = this.modalEl.querySelector('#hydraulic-status-label') as HTMLElement | null;
    const updateEl = this.modalEl.querySelector('#hydraulic-update-time') as HTMLElement | null;

    const stressed = assets.filter((asset) => asset.signals.hydro_trend === 'stress').length;
    const elevated = assets.filter((asset) => asset.signals.hydro_trend === 'high' || asset.signals.hydro_trend === 'stress').length;
    const ratio = assets.length > 0 ? Math.min(100, Math.round((elevated / assets.length) * 100)) : 0;
    const topScore = assets.length > 0 ? Math.max(...assets.map((asset) => asset.criticality_score)) : 0;

    if (ring) {
      ring.style.strokeDasharray = `${ratio} 100`;
      ring.style.stroke = stressed > 0 ? HYDRAULIC_PANEL_COLORS.stress : HYDRAULIC_PANEL_COLORS.blue;
    }
    if (scoreEl) {
      scoreEl.textContent = `${assets.length}`;
    }
    if (statusEl) {
      const label = stressed > 0
        ? `${stressed} actif${stressed > 1 ? 's' : ''} en stress`
        : elevated > 0
          ? `${elevated} actif${elevated > 1 ? 's' : ''} sous pression`
          : `Pic criticité ${topScore}/100`;
      statusEl.textContent = label;
      statusEl.style.color = stressed > 0 ? HYDRAULIC_PANEL_COLORS.stress : HYDRAULIC_PANEL_COLORS.cyan;
    }
    if (updateEl) {
      const last = assets[0]?.signals.last_update;
      const date = last ? new Date(last) : null;
      updateEl.textContent = date && !Number.isNaN(date.getTime())
        ? `Signaux recalculés: ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
        : 'Signaux recalculés en continu';
    }
  }

  private renderContent(assets: HydraulicBackboneAsset[]): void {
    if (!this.contentEl) return;

    const totalMw = assets.reduce((sum, asset) => sum + (asset.capacity_mw ?? 0), 0);
    const nationalHydroMw = this.currentEcowatt?.national?.hydro ?? null;
    const stepCount = assets.filter((asset) => asset.type === 'step_storage').length;
    const regulationCount = assets.filter((asset) => asset.type === 'water_regulation').length;
    const stressed = assets.filter((asset) => asset.signals.hydro_trend === 'stress').length;
    const high = assets.filter((asset) => asset.signals.hydro_trend === 'high').length;
    const siteAccurate = assets.filter((asset) => asset.location_accuracy === 'site').length;
    const manualVerified = assets.filter((asset) => !(asset.verification_sources ?? []).some((source) => source.includes('RTE/ODRE'))).length;
    const officialVerified = assets.filter((asset) => (asset.verification_sources ?? []).some((source) => source.includes('RTE/ODRE'))).length;
    const dromAssets = assets.filter((asset) => ['Corse', 'Guyane', 'La Réunion', 'Martinique', 'Guadeloupe', 'Mayotte'].includes(asset.location.region));

    const watchlist = assets
      .slice()
      .sort((a, b) => {
        const severity = { stress: 3, high: 2, normal: 1, low: 0 };
        return severity[b.signals.hydro_trend] - severity[a.signals.hydro_trend]
          || b.criticality_score - a.criticality_score
          || (b.capacity_mw ?? 0) - (a.capacity_mw ?? 0);
      })
      .slice(0, 14);

    const stepAssets = assets
      .filter((asset) => asset.type === 'step_storage')
      .sort((a, b) => (b.capacity_mw ?? 0) - (a.capacity_mw ?? 0))
      .slice(0, 6);

    const html = `
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px;">
        ${this.renderMetricCard('Actifs', String(assets.length), 'sélection OSINT', HYDRAULIC_PANEL_COLORS.blueSoft, HYDRAULIC_PANEL_COLORS.blue)}
        ${this.renderMetricCard('Capacité', totalMw.toLocaleString('fr-FR', { maximumFractionDigits: 0 }), 'MW installés', HYDRAULIC_PANEL_COLORS.cyanSoft, HYDRAULIC_PANEL_COLORS.cyan)}
        ${this.renderMetricCard('Production', nationalHydroMw != null ? nationalHydroMw.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : 'n/d', 'MW hydro FR', 'rgba(14,165,233,0.12)', '#38BDF8')}
        ${this.renderMetricCard('STEP', String(stepCount), 'stockage', HYDRAULIC_PANEL_COLORS.purpleSoft, HYDRAULIC_PANEL_COLORS.purple)}
      </div>

      <div style="background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div>
            <div style="font-size:12px;font-weight:700;color:${HYDRAULIC_PANEL_COLORS.text};">Base vérifiée</div>
            <div style="margin-top:6px;font-size:11px;line-height:1.5;color:${HYDRAULIC_PANEL_COLORS.muted};">
              Sélection d’actifs hydrauliques critiques — couverture non exhaustive
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px;font-weight:700;color:${HYDRAULIC_PANEL_COLORS.cyan};">${officialVerified}</div>
            <div style="font-size:10px;color:${HYDRAULIC_PANEL_COLORS.muted};">sources RTE/ODRE</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px;">
          ${this.renderMiniStat('Géo site', `${siteAccurate}`, HYDRAULIC_PANEL_COLORS.blue)}
          ${this.renderMiniStat('DROM/Corse', `${dromAssets.length}`, HYDRAULIC_PANEL_COLORS.cyan)}
          ${this.renderMiniStat('Manuel', `${manualVerified}`, HYDRAULIC_PANEL_COLORS.slate)}
        </div>
        <div style="margin-top:10px;font-size:10px;color:${HYDRAULIC_PANEL_COLORS.muted};">
          Production = puissance hydro nationale instantanée issue d’Écowatt, pas la somme temps réel des 113 actifs.
        </div>
        <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">
          ${this.renderSourceBadge('RTE/ODRE 30/09/2025', HYDRAULIC_PANEL_COLORS.blueSoft, HYDRAULIC_PANEL_COLORS.blue)}
          ${this.renderSourceBadge('BAN / géocodage', HYDRAULIC_PANEL_COLORS.cyanSoft, HYDRAULIC_PANEL_COLORS.cyan)}
          ${this.renderSourceBadge('Signaux: Écowatt + Vigicrues + vigilance pluie', HYDRAULIC_PANEL_COLORS.slateSoft, HYDRAULIC_PANEL_COLORS.slate)}
        </div>
      </div>

      <div style="background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;color:${HYDRAULIC_PANEL_COLORS.text};">Watchlist critique</div>
          <div style="font-size:10px;color:${HYDRAULIC_PANEL_COLORS.muted};">clic = recentrer carte</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${watchlist.map((asset) => this.renderAssetRow(asset)).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div style="background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;">
          <div style="font-size:12px;font-weight:700;color:${HYDRAULIC_PANEL_COLORS.text};margin-bottom:10px;">STEP et flexibilité</div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${stepAssets.map((asset) => this.renderCompactAsset(asset)).join('') || `<div style="font-size:11px;color:${HYDRAULIC_PANEL_COLORS.muted};">Aucune STEP dans la sélection.</div>`}
          </div>
        </div>
        <div style="background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;">
          <div style="font-size:12px;font-weight:700;color:${HYDRAULIC_PANEL_COLORS.text};margin-bottom:10px;">Couverture & signaux</div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:11px;color:${HYDRAULIC_PANEL_COLORS.muted};">
            <div style="display:flex;justify-content:space-between;"><span>Hydro normal/bas</span><strong style="color:${HYDRAULIC_PANEL_COLORS.text};">${assets.length - high - stressed}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span>Hydro haut</span><strong style="color:${HYDRAULIC_PANEL_COLORS.high};">${high}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span>Hydro stress</span><strong style="color:${HYDRAULIC_PANEL_COLORS.stress};">${stressed}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span>Hydro FR instantané</span><strong style="color:${HYDRAULIC_PANEL_COLORS.text};">${formatMw(nationalHydroMw)}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span>Ouvrages régulation</span><strong style="color:${HYDRAULIC_PANEL_COLORS.text};">${regulationCount}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span>Puissance moyenne</span><strong style="color:${HYDRAULIC_PANEL_COLORS.text};">${Math.round(totalMw / Math.max(assets.length, 1)).toLocaleString('fr-FR')} MW</strong></div>
            <div style="display:flex;justify-content:space-between;"><span>Référentiel manuel</span><strong style="color:${HYDRAULIC_PANEL_COLORS.text};">${manualVerified}</strong></div>
          </div>
        </div>
      </div>
    `;

    this.contentEl.innerHTML = html;
    this.bindAssetClickHandlers(assets);
  }

  private renderMetricCard(label: string, value: string, detail: string, bg: string, color: string): string {
    return `
      <div style="background:${bg};border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px 8px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:${HYDRAULIC_PANEL_COLORS.muted};">${label}</div>
        <div style="margin-top:4px;font-size:17px;font-weight:700;color:${color};">${value}</div>
        <div style="margin-top:2px;font-size:10px;color:${HYDRAULIC_PANEL_COLORS.muted};">${detail}</div>
      </div>
    `;
  }

  private renderMiniStat(label: string, value: string, color: string): string {
    return `
      <div style="padding:8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:10px;color:${HYDRAULIC_PANEL_COLORS.muted};">${label}</div>
        <div style="margin-top:4px;font-size:15px;font-weight:700;color:${color};">${value}</div>
      </div>
    `;
  }

  private renderSourceBadge(label: string, bg: string, color: string): string {
    return `
      <span style="padding:4px 8px;border-radius:999px;background:${bg};color:${color};font-size:10px;font-weight:600;">
        ${label}
      </span>
    `;
  }

  private renderAssetRow(asset: HydraulicBackboneAsset): string {
    const accuracyLabel = asset.location_accuracy === 'site'
      ? 'site'
      : asset.location_accuracy === 'commune'
        ? 'commune'
        : 'approx';
    const sourceLine = asset.technology ?? asset.selection_reason ?? 'Référentiel critique';
    const stats = [
      formatMw(asset.capacity_mw),
      asset.reservoir_volume ? formatHm3(asset.reservoir_volume) : null,
      asset.annual_generation_gwh ? formatGwh(asset.annual_generation_gwh) : null,
    ].filter(Boolean).join(' · ');

    return `
      <button type="button" data-hydraulic-asset="${asset.id}" style="all:unset;cursor:pointer;display:block;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px;transition:background 0.2s ease,border-color 0.2s ease;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div style="min-width:0;">
            <div style="font-size:12px;font-weight:700;color:${HYDRAULIC_PANEL_COLORS.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${asset.name}
            </div>
            <div style="margin-top:2px;font-size:10px;color:${HYDRAULIC_PANEL_COLORS.muted};">
              ${asset.location.region}${asset.commune ? ` · ${asset.commune}` : ''} · ${typeLabel(asset)}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px;font-weight:700;color:${trendColor(asset.signals.hydro_trend)};">${asset.criticality_score}</div>
            <div style="font-size:10px;color:${HYDRAULIC_PANEL_COLORS.muted};">criticité</div>
          </div>
        </div>
        <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-size:10px;color:${HYDRAULIC_PANEL_COLORS.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${stats || sourceLine}
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <span style="padding:2px 6px;border-radius:999px;background:rgba(255,255,255,0.05);color:${HYDRAULIC_PANEL_COLORS.slate};font-size:9px;text-transform:uppercase;">${accuracyLabel}</span>
            <span style="padding:2px 6px;border-radius:999px;background:${trendColor(asset.signals.hydro_trend)}22;color:${trendColor(asset.signals.hydro_trend)};font-size:9px;font-weight:700;text-transform:uppercase;">${trendLabel(asset.signals.hydro_trend)}</span>
          </div>
        </div>
        <div style="margin-top:6px;font-size:10px;color:${HYDRAULIC_PANEL_COLORS.muted};">
          ${sourceLine}
        </div>
      </button>
    `;
  }

  private renderCompactAsset(asset: HydraulicBackboneAsset): string {
    return `
      <div style="padding:8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <div style="font-size:11px;font-weight:600;color:${HYDRAULIC_PANEL_COLORS.text};">${asset.name}</div>
          <div style="font-size:10px;color:${trendColor(asset.signals.hydro_trend)};">${trendLabel(asset.signals.hydro_trend)}</div>
        </div>
        <div style="margin-top:3px;font-size:10px;color:${HYDRAULIC_PANEL_COLORS.muted};">
          ${formatMw(asset.capacity_mw)} · ${asset.location.region}
        </div>
      </div>
    `;
  }

  private bindAssetClickHandlers(assets: HydraulicBackboneAsset[]): void {
    if (!this.contentEl || !this.onSelectAsset) return;
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    this.contentEl.querySelectorAll<HTMLElement>('[data-hydraulic-asset]').forEach((element) => {
      element.addEventListener('click', () => {
        const assetId = element.dataset.hydraulicAsset;
        if (!assetId) return;
        const asset = assetMap.get(assetId);
        if (asset) this.onSelectAsset?.(asset);
      });
      element.addEventListener('mouseenter', () => {
        element.style.background = 'rgba(59,130,246,0.10)';
        element.style.borderColor = 'rgba(59,130,246,0.28)';
      });
      element.addEventListener('mouseleave', () => {
        element.style.background = 'rgba(255,255,255,0.03)';
        element.style.borderColor = 'rgba(255,255,255,0.06)';
      });
    });
  }
}
