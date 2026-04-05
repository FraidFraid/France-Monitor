import { Panel } from './Panel.ts';
import type { EcowattSignal, EcowattResponse } from '../types/index.ts';
import type { SpaceWeatherData } from '../services/space-weather.ts';

function renderTruthBadge(label: string, color: string): string {
  return `<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:${color}22;border:1px solid ${color}33;color:${color};font-size:9px;font-weight:700;letter-spacing:0.06em;">${label}</span>`;
}

// ─── Palette signal Écowatt ───
const SIG_COLOR: Record<EcowattSignal, string> = {
  green: '#16A34A',
  orange: '#F97316',
  red: '#EF4444',
};
const SIG_LABEL: Record<EcowattSignal, string> = {
  green: 'Consommation normale',
  orange: 'Système électrique tendu',
  red: 'Coupures ciblées possibles',
};
const SIG_ICON: Record<EcowattSignal, string> = {
  green: '⚡', orange: '⚡', red: '⚡',
};
const SIG_RING: Record<EcowattSignal, number> = { green: 100, orange: 55, red: 25 };

// ─── Palette mix énergétique ───
const MIX_COLORS = {
  nuclear: '#F59E0B',
  hydro: '#3B82F6',
  wind: '#22C55E',
  solar: '#FDE047',
  gas: '#EF4444',
  other: '#8B5CF6',
};

const COUNTRY_FLAGS: Record<string, string> = {
  'Espagne': '🇪🇸',
  'Italie': '🇮🇹',
  'Suisse': '🇨🇭',
  'All./Bel.': '🇩🇪',
  'Allemagne': '🇩🇪',
  'Belgique': '🇧🇪',
  'Royaume-Uni': '🇬🇧',
};

// Couleurs flux électrique (calées sur ELECTRIC_FLOW_STYLE dans DeckGLMap.ts)
const ELEC_EXPORT_COLOR = '#16A34A';
const ELEC_IMPORT_COLOR = '#FF4B4B';

export class EnergyPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtnEl: HTMLElement | null = null;
  private onClose?: () => void;
  private _kpCardEl: HTMLElement | null = null;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(container: HTMLElement) {
    super(container, { title: 'Écowatt RTE', icon: '⚡', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'energy-panel-modal';
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

    // ─── Bouton fermeture ───
    this.closeBtnEl = document.createElement('button');
    this.closeBtnEl.innerHTML = '✕';
    this.closeBtnEl.className = 'energy-panel-close';
    this.closeBtnEl.style.cssText = `
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
    this.closeBtnEl.onmouseover = () => {
      this.closeBtnEl!.style.background = 'rgba(255,255,255,0.2)';
      this.closeBtnEl!.style.color = 'var(--text-primary)';
    };
    this.closeBtnEl.onmouseout = () => {
      this.closeBtnEl!.style.background = 'rgba(255,255,255,0.1)';
      this.closeBtnEl!.style.color = 'var(--text-muted)';
    };
    this.closeBtnEl.onclick = () => this.hide();
    this.modalEl.appendChild(this.closeBtnEl);

    // ─── Header : ring + titre + signal + heure ───
    const header = document.createElement('div');
    header.className = 'energy-panel-header';
    header.style.cssText = `
      padding: 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 16px;
    `;
    header.innerHTML = `
      <div class="energy-ring-container" style="position: relative; width: 64px; height: 64px;">
        <svg viewBox="0 0 36 36" style="width: 64px; height: 64px; transform: rotate(-90deg);">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"></circle>
          <circle id="elec-ring-progress" cx="18" cy="18" r="15.9" fill="none"
            stroke="${SIG_COLOR.green}" stroke-width="3"
            stroke-dasharray="100 100" stroke-linecap="round"
            style="transition: stroke-dasharray 0.5s ease, stroke 0.3s ease;"></circle>
        </svg>
        <div id="elec-ring-icon" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 20px;">⚡</div>
      </div>
      <div style="flex: 1;">
        <div style="color: var(--text-primary); font-weight: 600; font-size: 14px;">Écowatt RTE - Météo de l'électricité</div>
        <div id="elec-signal-label" style="color: ${SIG_COLOR.green}; font-size: 11px; margin-top: 2px;">${SIG_LABEL.green}</div>
        <div id="elec-update-time" style="font-size: 10px; color: var(--text-muted); margin-top: 4px;"></div>
        <div id="elec-truth-badge" style="margin-top:4px;"></div>
      </div>
    `;
    this.modalEl.appendChild(header);

    // ─── Contenu scrollable ───
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'energy-panel-content';
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
      if ((e.target as HTMLElement).closest('.energy-panel-close')) return;
      if ((e.target as HTMLElement).closest('.energy-panel-content')) return;

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

  setOnClose(h: () => void): void { this.onClose = h; }

  show(data: EcowattResponse | null): void {
    if (!this.contentEl) return;
    this.modalEl.style.display = 'flex';

    if (!data || Object.keys(data.signals).length === 0) {
      this.contentEl.innerHTML = `
        <div style="text-align: center; padding: 32px 16px;">
          <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.6;">🔌</div>
          <div style="color: var(--text-muted);">Aucune donnée Écowatt disponible.</div>
        </div>`;
      const badgeEl = this.modalEl.querySelector('#elec-truth-badge') as HTMLElement | null;
      if (badgeEl) badgeEl.innerHTML = renderTruthBadge('INDISPONIBLE', '#EF4444');
      return;
    }

    this.updateHeader(data);
    this.renderContent(data);
  }

  private updateHeader(data: EcowattResponse): void {
    const valMap: Record<EcowattSignal, number> = { red: 3, orange: 2, green: 1 };
    const allSigs = Object.values(data.signals) as EcowattSignal[];
    const worstSig: EcowattSignal = allSigs.reduce(
      (worst, s) => valMap[s] > valMap[worst] ? s : worst,
      'green' as EcowattSignal
    );

    const ring = this.modalEl.querySelector('#elec-ring-progress') as SVGCircleElement | null;
    const icon = this.modalEl.querySelector('#elec-ring-icon') as HTMLElement | null;
    const lbl = this.modalEl.querySelector('#elec-signal-label') as HTMLElement | null;
    const time = this.modalEl.querySelector('#elec-update-time') as HTMLElement | null;

    if (ring) {
      ring.setAttribute('stroke', SIG_COLOR[worstSig]);
      ring.setAttribute('stroke-dasharray', `${SIG_RING[worstSig]} 100`);
    }
    if (icon) icon.textContent = SIG_ICON[worstSig];
    if (lbl) { lbl.textContent = SIG_LABEL[worstSig]; lbl.style.color = SIG_COLOR[worstSig]; }
    if (time) time.textContent = `MàJ : ${data.national.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    const badge = this.modalEl.querySelector('#elec-truth-badge') as HTMLElement | null;
    if (badge) badge.innerHTML = renderTruthBadge('TEMPS RÉEL', '#10B981');
  }

  private renderContent(data: EcowattResponse): void {
    if (!this.contentEl) return;

    const nat = data.national;
    const totalMW = nat.total > 0 ? nat.total : 1;
    const lowCarbonMW = nat.nuclear + nat.hydro + nat.wind + nat.solar;
    const lowCarbonPct = Math.round((lowCarbonMW / totalMW) * 100);
    const fmtGW = (mw: number) => mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${Math.round(mw)} MW`;
    const pct = (mw: number) => `${((mw / totalMW) * 100).toFixed(0)}%`;
    const seg = (mw: number, color: string, title: string) =>
      mw > 0 ? `<div style="width:${pct(mw)};background:${color};height:100%;" title="${title}"></div>` : '';
    const dot = (color: string) =>
      `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px;flex-shrink:0;"></span>`;

    // ─── Card : Production nationale ───
    const mixCard = `
      <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.05);">
        <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px;">
          Production nationale
        </div>

        <div style="display: flex; height: 10px; border-radius: 5px; overflow: hidden; margin-bottom: 10px; gap: 1px;">
          ${seg(nat.nuclear, MIX_COLORS.nuclear, 'Nucléaire')}
          ${seg(nat.hydro, MIX_COLORS.hydro, 'Hydraulique')}
          ${seg(nat.wind, MIX_COLORS.wind, 'Éolien')}
          ${seg(nat.solar, MIX_COLORS.solar, 'Solaire')}
          ${seg(nat.gas, MIX_COLORS.gas, 'Thermique')}
          ${seg(nat.other, MIX_COLORS.other, 'Divers')}
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px 10px; font-size: 11px; color: var(--text-muted); margin-bottom: 10px;">
          <div style="display:flex;align-items:center;">${dot(MIX_COLORS.nuclear)}Nucléaire <strong style="color:var(--text-primary);margin-left:4px;">${fmtGW(nat.nuclear)}</strong></div>
          <div style="display:flex;align-items:center;">${dot(MIX_COLORS.hydro)}Hydro <strong style="color:var(--text-primary);margin-left:4px;">${fmtGW(nat.hydro)}</strong></div>
          <div style="display:flex;align-items:center;">${dot(MIX_COLORS.wind)}Éolien <strong style="color:var(--text-primary);margin-left:4px;">${fmtGW(nat.wind)}</strong></div>
          <div style="display:flex;align-items:center;">${dot(MIX_COLORS.solar)}Solaire <strong style="color:var(--text-primary);margin-left:4px;">${fmtGW(nat.solar)}</strong></div>
          <div style="display:flex;align-items:center;">${dot(MIX_COLORS.gas)}Thermique <strong style="color:var(--text-primary);margin-left:4px;">${fmtGW(nat.gas)}</strong></div>
          <div style="display:flex;align-items:center;">${dot(MIX_COLORS.other)}Divers <strong style="color:var(--text-primary);margin-left:4px;">${fmtGW(nat.other)}</strong></div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06);">
          <span>Total</span>
          <strong style="color: var(--text-primary);">${fmtGW(nat.total)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-top: 4px;">
          <span>Bas-carbone</span>
          <strong style="color: #22C55E;">${lowCarbonPct} %</strong>
        </div>
      </div>`;

    // ─── Card : Échanges frontières ───
    let flowsCard = '';
    if (data.interconnections.length > 0) {
      const rows = data.interconnections.map(ic => {
        const isImport = ic.flowMW > 200;
        const isExport = ic.flowMW < -200;
        const absMW = Math.abs(ic.flowMW);
        const color = isImport ? ELEC_IMPORT_COLOR : isExport ? ELEC_EXPORT_COLOR : '#8e8e93';
        const arrow = isImport ? '↙ Import' : isExport ? '↗ Export' : '↔';
        const flag = COUNTRY_FLAGS[ic.country] ?? '🏳';
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <span style="color: var(--text-secondary); font-size: 11px;">${flag} ${ic.country}</span>
            <span style="color: ${color}; font-weight: 600; font-size: 11px;">${arrow} ${absMW >= 1000 ? `${(absMW / 1000).toFixed(1)} GW` : `${Math.round(absMW)} MW`}</span>
          </div>`;
      }).join('');

      flowsCard = `
        <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.05);">
          <div style="font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 10px;">
            Échanges frontières
          </div>
          ${rows}
        </div>`;
    }

    this.contentEl.innerHTML = mixCard + flowsCard;
    // Ré-attacher la carte Kp (innerHTML la détache du DOM sans invalider la référence)
    if (this._kpCardEl) this.contentEl.appendChild(this._kpCardEl);
  }

  /**
   * Met à jour (ou crée) la carte Kp index dans le panel énergie.
   * Appeler après fetchSpaceWeather() dans App.ts.
   */
  updateSpaceWeather(data: SpaceWeatherData): void {
    if (!this.contentEl) return;
    if (!this._kpCardEl) {
      this._kpCardEl = document.createElement('div');
      this.contentEl.appendChild(this._kpCardEl);
    }
    this._kpCardEl.innerHTML = `
      <div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:12px;margin-bottom:12px;border:1px solid ${data.color}40;">
        <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">☀️ Météo spatiale · Kp index</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:28px;font-weight:700;color:${data.color};font-family:monospace;min-width:24px;text-align:center;">${data.kpIndex}</div>
          <div>
            <div style="font-size:12px;color:${data.color};font-weight:600;">${data.levelLabel}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px;line-height:1.4;">${data.riskFrance}</div>
          </div>
        </div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:6px;text-align:right;">Source : NOAA SWPC · MàJ ${data.fetchedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>`.trim();
  }

  hide(): void {
    if (this.modalEl) this.modalEl.style.display = 'none';
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }
}
