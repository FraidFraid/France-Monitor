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
import type { GasNetworkState, EcoGazSignal } from '../types/index.ts';
import { getEcoGazColor, isGasPanelEnabled, ECOGAZ_LABELS } from '../services/gas.ts';

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

export class GasPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(container: HTMLElement) {
    super(container, { title: 'EcoGaz - Réseau Gaz', icon: '🔥', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'gas-panel-modal';
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
    this.closeBtn.className = 'gas-panel-close';
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

    // Header with EcoGaz ring
    const header = document.createElement('div');
    header.className = 'gas-panel-header';
    header.style.cssText = `
      padding: 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 16px;
    `;
    header.innerHTML = `
      <div class="gas-ring-container" style="position: relative; width: 64px; height: 64px;">
        <svg viewBox="0 0 36 36" style="width: 64px; height: 64px; transform: rotate(-90deg);">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"></circle>
          <circle id="gas-ring-progress" cx="18" cy="18" r="15.9" fill="none" stroke="#06B6D4" stroke-width="3"
            stroke-dasharray="100 100" stroke-linecap="round" style="transition: stroke-dasharray 0.5s ease, stroke 0.3s ease;"></circle>
        </svg>
        <div id="gas-ring-icon" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 20px;">🔥</div>
      </div>
      <div style="flex: 1;">
        <div style="color: var(--text-primary); font-weight: 600; font-size: 14px;">EcoGaz - Météo du Gaz</div>
        <div id="gas-status-label" style="color: var(--text-muted); font-size: 11px; margin-top: 2px;">Chargement...</div>
        <div id="gas-update-time" style="font-size: 10px; color: var(--text-muted); margin-top: 4px;"></div>
      </div>
    `;
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

  show(data: GasNetworkState | null): void {
    if (!this.contentEl) return;

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
        <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.6;">🔐</div>
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
    this.contentEl.innerHTML = `
      <div style="text-align: center; padding: 20px;">
        <div style="font-size: 24px; margin-bottom: 12px; animation: pulse 1.5s ease-in-out infinite;">🔥</div>
        <div style="color: var(--text-muted);">Chargement des données...</div>
      </div>
    `;
  }

  private updateHeader(data: GasNetworkState): void {
    const ringProgress = this.modalEl.querySelector('#gas-ring-progress') as SVGCircleElement;
    const statusLabel = this.modalEl.querySelector('#gas-status-label') as HTMLElement;
    const updateTime = this.modalEl.querySelector('#gas-update-time') as HTMLElement;

    const signal = data.ecogaz.signal;
    const color = getEcoGazColor(signal);
    const label = ECOGAZ_LABELS[signal];

    // Ring fill based on signal severity (green=100%, yellow=75%, orange=50%, red=25%)
    const fillMap: Record<EcoGazSignal, number> = { green: 100, yellow: 75, orange: 50, red: 25 };
    if (ringProgress) {
      ringProgress.setAttribute('stroke-dasharray', `${fillMap[signal]} 100`);
      ringProgress.setAttribute('stroke', color);
    }

    if (statusLabel) {
      statusLabel.textContent = label;
      statusLabel.style.color = color;
    }

    if (updateTime) {
      updateTime.textContent = `MàJ: ${data.lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    }
  }

  private renderContent(data: GasNetworkState): void {
    if (!this.contentEl) return;

    const stats = data.nationalStats;
    const fillColor = this.getFillColor(stats.averageFillLevel);
    const trendIcon = stats.storageTrend === 'filling' ? '↗' : stats.storageTrend === 'withdrawing' ? '↘' : '→';
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
          <div style="font-size: 16px; font-weight: 700; color: ${fillColor};">${stats.averageFillLevel.toFixed(1)}%</div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
          <span>${stats.currentStorageTWh.toFixed(1)} / ${stats.totalStorageCapacityTWh.toFixed(1)} TWh</span>
          <span style="color: ${stats.storageTrend === 'withdrawing' ? '#A855F7' : stats.storageTrend === 'stable' ? '#8e8e93' : '#06B6D4'};">${trendIcon} ${trendLabel}</span>
        </div>
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

      <!-- Source Status -->
      <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; border: 1px solid rgba(255,255,255,0.05);">
        <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px;">
          Sources de données
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${this.renderSourceBadge('EcoGaz', data.sourceStatus.ecogaz)}
          ${this.renderSourceBadge('ODRE', data.sourceStatus.odre)}
          ${this.renderSourceBadge('GRTgaz', data.sourceStatus.grtgaz)}
          ${this.renderSourceBadge('Teréga', data.sourceStatus.terega)}
        </div>
      </div>
    `;

    this.contentEl.innerHTML = html;
  }

  private renderSourceBadge(name: string, status: 'ok' | 'stale' | 'error'): string {
    const colors: Record<string, { bg: string; text: string; dot: string }> = {
      ok: { bg: 'rgba(255,255,255,0.06)', text: '#cbd5e1', dot: '#94a3b8' },
      stale: { bg: 'rgba(255,255,255,0.06)', text: '#cbd5e1', dot: '#94a3b8' },
      error: { bg: 'rgba(255,255,255,0.06)', text: '#cbd5e1', dot: '#94a3b8' },
    };
    const c = colors[status];
    return `
      <div style="display: flex; align-items: center; gap: 4px; background: ${c.bg}; padding: 4px 8px; border-radius: 4px;">
        <div style="width: 6px; height: 6px; border-radius: 50%; background: ${c.dot};"></div>
        <span style="font-size: 10px; color: ${c.text};">${name}</span>
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

  update(data: GasNetworkState): void {
    if (this.isVisible() && data) {
      this.updateHeader(data);
      this.renderContent(data);
    }
  }
}
