/**
 * GasPanel - Panneau EcoGaz + Stats Réseau Gaz
 *
 * Affiche:
 * - Signal EcoGaz (anneau 4 niveaux: vert/jaune/orange/rouge)
 * - Stats stockage national (jauge + tendance)
 * - Liste terminaux + statut
 * - PIR flows summary
 */

import { Panel } from './Panel.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import {
  applyPremiumCloseButtonHover,
  createPremiumRingHeader,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';
import type { GasNetworkState, EcoGazSignal, BiogasState } from '../types/index.ts';
import { getEcoGazColor, isGasPanelEnabled, ECOGAZ_LABELS } from '../services/gas.ts';
import { renderTruthBadge } from './shared/truthBadge.ts';
import { fmIcon } from './shared/icons.ts';

const GAS_PANEL_COLORS = {
  terminal: '#A78BFA',
  import: '#A855F7',
  export: '#06B6D4',
  storageHigh: '#6EE7B7',
  storageMedium: '#2DD4BF',
  storageLow: '#0891B2',
  storageCritical: '#1E3A8A',
  terminalActiveBg: 'rgba(167, 139, 250, 0.18)',
  terminalMaintenanceBg: 'rgba(30, 58, 138, 0.22)',
} as const;

// ═══ GasPanel Class ═══

const ECOGAZ_SHORT: Record<EcoGazSignal, string> = {
  green: 'Normal', yellow: 'Vigilance', orange: 'Alerte', red: 'Critique', unknown: '?',
};

export class GasPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private showPipeline = false;
  private onPipelineToggle?: (show: boolean) => void;
  private lastGasData: GasNetworkState | null = null;
  private activeTab: 'gas' | 'biogas' = 'gas';
  private biogasState: BiogasState | null = null;
  private _tabListenerAttached = false;

  constructor(container: HTMLElement) {
    super(container, { title: 'EcoGaz - Réseau Gaz', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'gas-panel-modal';
    this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
        width: '400px',
        maxHeight: 'calc(100vh - var(--right-panel-top) - 20px)',
        backgroundStart: 'rgba(9, 18, 31, 0.97)',
        backgroundEnd: 'rgba(12, 16, 27, 0.96)',
        borderColor: 'rgba(34, 211, 238, 0.18)',
      })}
      cursor: grab;
    `;

    // Close button
    this.closeBtn = this.createCloseButton(() => this.hide());
    this.closeBtn.classList.add('gas-panel-close');
    this.closeBtn.style.cssText = getPremiumCloseButtonStyle();
    applyPremiumCloseButtonHover(this.closeBtn);
    this.modalEl.appendChild(this.closeBtn);

    const header = createPremiumRingHeader({
      ringId: 'gas-ring-progress',
      centerId: 'gas-ring-icon',
      centerText: fmIcon('flame', { size: 20 }),
      centerFontSize: '20px',
      ringStroke: '#06B6D4',
      title: 'Réseau Gaz National',
      subtitle: 'Chargement...',
      statusId: 'gas-status-label',
      updateId: 'gas-update-time',
      badgeId: 'gas-truth-badge',
      gradientStart: 'rgba(6, 182, 212, 0.18)',
      gradientEnd: 'rgba(168, 85, 247, 0.10)',
      titlePrefix: 'Backbone énergétique',
      extraTopRowHtml: '<div id="gas-forecast" style="display:flex;gap:6px;margin-top:6px;"></div>',
    });
    header.className = 'gas-panel-header';
    this.modalEl.appendChild(header);

    // Content container
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'gas-panel-content';
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
      if ((e.target as HTMLElement).closest('.gas-panel-close')) return;
      if ((e.target as HTMLElement).closest('.gas-panel-content')) return;

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

  setPipelineCallback(cb: (show: boolean) => void): void {
    this.onPipelineToggle = cb;
  }

  show(data: GasNetworkState | null, biogasState?: BiogasState | null): void {
    if (!this.contentEl) return;

    if (biogasState !== undefined) this.biogasState = biogasState ?? null;

    if (!isGasPanelEnabled()) {
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
        <div style="margin-bottom: 16px; opacity: 0.6;">${fmIcon('lock-keyhole', { size: 48 })}</div>
        <div style="color: var(--text-primary); font-weight: 600; margin-bottom: 12px;">
          Module Gaz désactivé
        </div>
        <div style="margin-top: 16px; color: var(--text-muted); font-size: 10px;">
          Activez avec <code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">VITE_ENABLE_GAS_PANEL=true</code>
        </div>
      </div>
    `;
  }

  private showLoadingState(): void {
    if (!this.contentEl) return;
    this.contentEl.innerHTML = fmLoaderHTML({ text: 'Chargement des données…' });
  }

  private updateHeader(data: GasNetworkState): void {
    const ringProgress = this.modalEl.querySelector('#gas-ring-progress') as SVGCircleElement;
    const ringIcon     = this.modalEl.querySelector('#gas-ring-icon') as HTMLElement | null;
    const statusLabel  = this.modalEl.querySelector('#gas-status-label') as HTMLElement;
    const updateTime   = this.modalEl.querySelector('#gas-update-time') as HTMLElement;

    const signal = data.ecogaz.signal;
    const color  = getEcoGazColor(signal);
    const label  = ECOGAZ_LABELS[signal];

    // ── Composante 1 : Signal EcoGaz (40 pts) ────────────────────────────
    const signalMap: Record<EcoGazSignal, number> = { green: 0, yellow: 13, orange: 27, red: 40, unknown: 0 };
    const signalScore = signalMap[signal];

    // ── Composante 2 : Niveau de stockage inversé (40 pts) ───────────────
    // Faible stockage = tension. Fill à 100% = 0pt, Fill à 0% = 40pt
    const fill = Math.max(0, Math.min(100, data.nationalStats.averageFillLevel));
    const storageScore = Math.round((1 - fill / 100) * 40);

    // ── Composante 3 : Import net (20 pts) ───────────────────────────────
    // Dépendance aux imports = tension sur la souveraineté
    const netImport = Math.max(0, data.nationalStats.totalImportGWhDay - data.nationalStats.totalExportGWhDay);
    const importScore = Math.min(20, (netImport / 3000) * 20);

    // ── Score total ───────────────────────────────────────────────────────
    const gasScore = Math.round(signalScore + storageScore + importScore);

    if (ringProgress) {
      ringProgress.setAttribute('stroke-dasharray', `${gasScore} 100`);
      ringProgress.setAttribute('stroke', color);
    }
    if (ringIcon) {
      ringIcon.textContent = String(gasScore);
      ringIcon.style.fontSize = '20px';
      ringIcon.style.fontWeight = '700';
      ringIcon.style.color = color;
    }

    if (statusLabel) {
      statusLabel.textContent = label;
      statusLabel.style.color = color;
    }

    if (updateTime) {
      updateTime.textContent = `MàJ: ${data.lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    }

    const forecastEl = this.modalEl.querySelector('#gas-forecast') as HTMLElement | null;
    if (forecastEl) {
      const days = ['J+1', 'J+2', 'J+3'];
      forecastEl.innerHTML = data.ecogaz.forecast.slice(0, 3).map((f, i) => {
        const fc = getEcoGazColor(f.signal);
        const fl = ECOGAZ_SHORT[f.signal];
        return `<div title="${ECOGAZ_LABELS[f.signal]}" style="font-size:9px; padding:2px 6px; border-radius:3px; background:${fc}22; color:${fc}; border:1px solid ${fc}55; white-space:nowrap;">${days[i]} ${fl}</div>`;
      }).join('');
    }

    const truthBadge = this.modalEl.querySelector('#gas-truth-badge') as HTMLElement | null;
    if (truthBadge) {
      const statuses = Object.values(data.sourceStatus) as Array<'ok' | 'stale' | 'error'>;
      if (statuses.some(s => s === 'error')) {
        truthBadge.innerHTML = renderTruthBadge('INDISPONIBLE', '#EF4444');
      } else if (statuses.some(s => s === 'stale')) {
        truthBadge.innerHTML = renderTruthBadge('CACHE FIGÉ', '#F59E0B');
      } else {
        truthBadge.innerHTML = renderTruthBadge('TEMPS RÉEL', '#10B981');
      }
    }
  }

  private renderContent(data: GasNetworkState): void {
    if (!this.contentEl) return;
    this.lastGasData = data;

    const tabBar = this.renderTabBar();

    if (this.activeTab === 'biogas') {
      this.contentEl.innerHTML = tabBar + this.renderBiogasTab();
      requestAnimationFrame(() => this.renderBiogasSparkline());
      this.ensureTabListeners();
      return;
    }

    const stats = data.nationalStats;
    const fillColor = this.getFillColor(stats.averageFillLevel);
    const trendIcon = stats.storageTrend === 'filling' ? fmIcon('trending-up', { size: 11 }) : stats.storageTrend === 'withdrawing' ? fmIcon('trending-down', { size: 11 }) : '→';
    const trendLabel = stats.storageTrend === 'filling' ? 'Remplissage' : stats.storageTrend === 'withdrawing' ? 'Soutirage' : 'Stable';

    const html = `
      <!-- Storage Stats Card -->
      <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.05);">
        <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px;">
          Stockages Nationaux
        </div>

        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 10px;">
          <div style="flex: 1;">
            <div style="height: 12px; background: rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden;">
              <div style="height: 100%; width: ${stats.averageFillLevel}%; background: ${fillColor}; transition: width 0.5s ease;"></div>
            </div>
          </div>
          <div>
            <div style="font-size: 16px; font-weight: 700; color: ${fillColor}; text-align: right;">${stats.averageFillLevel.toFixed(1)}%</div>
            ${data.sourceStatus.odre === 'stale' ? `<div style="font-size: 9px; color: #F59E0B; text-align: right; margin-top: 1px;">estimé</div>` : ''}
            ${data.sourceStatus.odre === 'error' ? `<div style="font-size: 9px; color: #EF4444; text-align: right; margin-top: 1px;">indisponible</div>` : ''}
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
          <span>${stats.currentStorageTWh.toFixed(1)} / ${stats.totalStorageCapacityTWh.toFixed(1)} TWh</span>
          <span style="color: ${stats.storageTrend === 'withdrawing' ? '#A855F7' : stats.storageTrend === 'stable' ? '#8e8e93' : '#06B6D4'};">${trendIcon} ${trendLabel}</span>
        </div>
        
        ${stats.storageNetFlowGWhDay !== undefined && !Number.isNaN(stats.storageNetFlowGWhDay) ? `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.05); font-size: 11px;">
          <span style="color: var(--text-muted);">Débit net national</span>
          <strong style="color: ${stats.storageNetFlowGWhDay > 0 ? '#22C55E' : '#EF4444'};">${stats.storageNetFlowGWhDay > 0 ? '+' : ''}${stats.storageNetFlowGWhDay.toFixed(0)} GWh/j</strong>
        </div>
        ` : ''}
      </div>

      <!-- Import/Export Summary -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
        <div style="background: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.22); border-radius: 8px; padding: 10px; text-align: center;">
          <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Import</div>
          <div style="font-size: 16px; font-weight: 700; color: ${GAS_PANEL_COLORS.import};">${stats.totalImportGWhDay.toFixed(0)}</div>
          <div style="font-size: 9px; color: var(--text-muted);">GWh/jour</div>
        </div>
        <div style="background: rgba(6, 182, 212, 0.12); border: 1px solid rgba(6, 182, 212, 0.22); border-radius: 8px; padding: 10px; text-align: center;">
          <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">Export</div>
          <div style="font-size: 16px; font-weight: 700; color: ${GAS_PANEL_COLORS.export};">${stats.totalExportGWhDay.toFixed(0)}</div>
          <div style="font-size: 9px; color: var(--text-muted);">GWh/jour</div>
        </div>
      </div>

      <!-- Terminals Status -->
      <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.05);">
        <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px;">
          Terminaux Méthaniers (${data.terminals.length})
        </div>
        ${data.terminals.map(t => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <span style="color: var(--text-secondary); font-size: 11px;">${t.name}</span>
            <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: ${t.status === 'active' ? GAS_PANEL_COLORS.terminalActiveBg : GAS_PANEL_COLORS.terminalMaintenanceBg}; color: ${t.status === 'active' ? GAS_PANEL_COLORS.terminal : GAS_PANEL_COLORS.storageCritical};">
              ${t.status === 'active' ? 'Actif' : 'Maintenance'}
            </span>
          </div>
        `).join('')}
      </div>

      <!-- Storages List -->
      <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.05);">
        <div id="gas-storages-toggle" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; cursor: pointer; user-select: none;">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-primary);">
            Stockages Souterrains (${data.storages.length})
          </div>
          <div id="gas-storages-chevron" style="color: var(--text-muted); font-size: 10px; transition: transform 0.2s;">▼</div>
        </div>
        <div id="gas-storages-list" style="display: none; margin-top: 10px;">
          ${[...data.storages].sort((a,b) => b.capacityTWh - a.capacityTWh).map(s => `
            <div style="padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
                <span style="color: var(--text-secondary); font-size: 11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${s.name}">${s.name} <span style="color:var(--text-muted); font-size:9px;">(${s.operator})</span></span>
                <span style="font-size: 10px; font-weight: 600; color: ${this.getFillColor(s.fillLevel)};">${s.fillLevel.toFixed(1)}%</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="flex: 1; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                  <div style="height: 100%; width: ${s.fillLevel}%; background: ${this.getFillColor(s.fillLevel)};"></div>
                </div>
                <div style="font-size: 9px; color: var(--text-muted); min-width: 45px; text-align: right;">${s.currentStockTWh ? s.currentStockTWh.toFixed(1) : (s.capacityTWh * s.fillLevel / 100).toFixed(1)} TWh</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Pipeline toggle -->
      <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:11px; color:var(--text-secondary);">Gazoducs principaux</span>
        <button id="gas-pipeline-toggle" style="
          width:36px; height:20px; border-radius:10px; border:none; cursor:pointer; position:relative;
          background:${this.showPipeline ? '#10B981' : 'rgba(255,255,255,0.15)'};
          transition: background 0.2s;
        ">
          <span style="
            position:absolute; top:3px; left:${this.showPipeline ? '17px' : '3px'};
            width:14px; height:14px; border-radius:50%; background:#fff;
            transition: left 0.2s;
          "></span>
        </button>
      </div>

      <!-- Source Status -->
      <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; border: 1px solid rgba(255,255,255,0.05);">
        <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px;">
          Sources de données
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${this.renderSourceBadge('EcoGaz', data.sourceStatus.ecogaz)}
          ${this.renderSourceBadge('ODRE', data.sourceStatus.odre)}
          ${this.renderSourceBadge('PEG NaTran', data.sourceStatus.grtgaz)}
          ${this.renderSourceBadge('Teréga', data.sourceStatus.terega)}
        </div>
      </div>
    `;

    this.contentEl.innerHTML = tabBar + html;

    const storagesToggle = this.contentEl.querySelector('#gas-storages-toggle') as HTMLElement | null;
    const storagesList = this.contentEl.querySelector('#gas-storages-list') as HTMLElement | null;
    const storagesChevron = this.contentEl.querySelector('#gas-storages-chevron') as HTMLElement | null;
    
    if (storagesToggle && storagesList && storagesChevron) {
      storagesToggle.addEventListener('click', () => {
        const isHidden = storagesList.style.display === 'none';
        storagesList.style.display = isHidden ? 'block' : 'none';
        storagesChevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
      });
    }

    const pipelineBtn = this.contentEl.querySelector('#gas-pipeline-toggle') as HTMLButtonElement | null;
    pipelineBtn?.addEventListener('click', () => {
      this.showPipeline = !this.showPipeline;
      this.onPipelineToggle?.(this.showPipeline);
      if (this.lastGasData) this.renderContent(this.lastGasData);
    });

    this.ensureTabListeners();
  }

  private renderTabBar(): string {
    const mkTab = (id: 'gas' | 'biogas', label: string) => {
      const active = this.activeTab === id;
      return `<button data-tab="${id}" style="
          flex:1; padding:6px 0; border:none; cursor:pointer;
          background:${active ? 'rgba(255,255,255,0.1)' : 'transparent'};
          color:${active ? '#fff' : 'rgba(255,255,255,0.5)'};
          border-bottom:${active ? '2px solid #06B6D4' : '2px solid transparent'};
          font-size:12px; font-weight:600; transition:all 0.2s;
      ">${label}</button>`;
    };
    return `<div style="display:flex; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:8px;">
        ${mkTab('gas', `${fmIcon('flame', { size: 12 })} Réseau Gaz`)}
        ${mkTab('biogas', `${fmIcon('leaf', { size: 12 })} Biométhane`)}
    </div>`;
  }

  private renderBiogasTab(): string {
    const s = this.biogasState;
    if (!s || s.daily.length === 0) {
      return '<div style="padding:16px;color:rgba(255,255,255,0.5);text-align:center;">Données biométhane indisponibles</div>';
    }

    const ratio = s.avg7dMWh > 0 ? s.latestMWh / s.avg7dMWh : 1;
    const signalColor = ratio >= 0.9 ? '#22c55e' : ratio >= 0.7 ? '#f59e0b' : '#ef4444';
    const signalLabel = ratio >= 0.9 ? 'Normal' : ratio >= 0.7 ? 'Baisse' : 'Alerte';

    const deltaStr = s.deltaJ1Pct != null
      ? `${s.deltaJ1Pct > 0 ? '↑' : '↓'} ${s.deltaJ1Pct > 0 ? '+' : ''}${s.deltaJ1Pct.toFixed(1)}% vs J-1`
      : 'Delta J-1 indisponible';
    const deltaColor = s.deltaJ1Pct != null
      ? (s.deltaJ1Pct >= 0 ? '#22c55e' : '#ef4444')
      : '#6b7280';

    const latest = s.daily[0];
    const sitesCount = latest?.sitesCount ?? 0;

    const alertHtml = s.alert
      ? `<div style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:8px 12px;margin-bottom:8px;color:#fca5a5;font-size:12px;">
              ${fmIcon('triangle-alert', { size: 12 })} Chute -${s.alert.severityPct.toFixed(1)}% production vs moyenne 7j
             </div>`
      : '';

    return `
        ${alertHtml}
        <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:12px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="width:10px;height:10px;border-radius:50%;background:${signalColor};display:inline-block;"></span>
                <span style="color:#fff;font-size:14px;font-weight:600;">${s.latestMWh.toLocaleString('fr-FR')} MWh</span>
                <span style="color:${deltaColor};font-size:12px;margin-left:auto;">${deltaStr}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,0.5);">
                <span>Production journalière · ${signalLabel}</span>
                <span>Moy. 7j : ${s.avg7dMWh.toLocaleString('fr-FR')} MWh</span>
            </div>
        </div>
        <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:12px;margin-bottom:8px;">
            <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:6px;">Production 30 jours</div>
            <canvas id="biogas-sparkline" width="340" height="50" style="width:100%;height:50px;"></canvas>
        </div>
        <div style="font-size:10px;color:rgba(255,255,255,0.35);text-align:right;">
            ${sitesCount} sites · ${latest?.date ?? '—'} · ${latest?.status ?? ''}
        </div>
    `;
  }

  private renderBiogasSparkline(): void {
    const canvas = document.getElementById('biogas-sparkline') as HTMLCanvasElement | null;
    if (!canvas || !this.biogasState) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const points = this.biogasState.daily
      .filter(d => d.sitesCount > 100)
      .map(d => d.productionMWh)
      .reverse();

    if (points.length < 3) return;

    const w = canvas.width; const h = canvas.height;
    const max = Math.max(...points); const min = Math.min(...points);
    const range = max - min || 1;

    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    points.forEach((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = 'rgba(34, 197, 94, 0.1)'; ctx.fill();
  }

  private ensureTabListeners(): void {
    if (this._tabListenerAttached || !this.contentEl) return;
    this._tabListenerAttached = true;
    this.contentEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement | null;
      if (!btn) return;
      const tab = btn.dataset.tab as 'gas' | 'biogas';
      if (tab === this.activeTab) return;
      this.activeTab = tab;
      if (this.lastGasData) this.renderContent(this.lastGasData);
    });
  }

  private renderSourceBadge(name: string, status: 'ok' | 'stale' | 'error'): string {
    const colors: Record<string, { bg: string; text: string; dot: string }> = {
      ok:    { bg: 'rgba(16, 185, 129, 0.10)', text: '#6EE7B7', dot: '#10B981' },
      stale: { bg: 'rgba(245, 158, 11, 0.10)', text: '#FCD34D', dot: '#F59E0B' },
      error: { bg: 'rgba(239, 68, 68, 0.10)',  text: '#FCA5A5', dot: '#EF4444' },
    };
    const c = colors[status];
    const label = status === 'ok' ? name : status === 'stale' ? `${name} (cache)` : `${name} (erreur)`;
    return `
      <div style="display: flex; align-items: center; gap: 4px; background: ${c.bg}; padding: 4px 8px; border-radius: 4px;">
        <div style="width: 6px; height: 6px; border-radius: 50%; background: ${c.dot};"></div>
        <span style="font-size: 10px; color: ${c.text};">${label}</span>
      </div>
    `;
  }

  private getFillColor(fillLevel: number): string {
    if (fillLevel < 30) return GAS_PANEL_COLORS.storageCritical;
    if (fillLevel < 50) return GAS_PANEL_COLORS.storageLow;
    if (fillLevel < 70) return GAS_PANEL_COLORS.storageMedium;
    return GAS_PANEL_COLORS.storageHigh;
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

  update(data: GasNetworkState, biogasState?: BiogasState | null): void {
    if (biogasState !== undefined) this.biogasState = biogasState ?? null;
    if (this.isVisible() && data) {
      this.updateHeader(data);
      this.renderContent(data);
    }
  }
}
