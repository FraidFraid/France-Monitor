import { Panel } from './Panel.ts';
import {
  applyPremiumCloseButtonHover,
  createPremiumRingHeader,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';
import type { EcowattOfficialDay, EcowattResponse } from '../types/index.ts';
import type { SpaceWeatherData } from '../services/space-weather.ts';
import { ecowattToday, ecowattUpcoming, ecowattLastPublished, ecowattLevelLabel } from '../services/ecowatt-official.ts';
import { officialLevel, levelHex } from '../services/vigilance.ts';
import { parseApiDate, formatUpdateTime } from '../utils/format-date.ts';
import { renderTruthBadge, renderFreshnessBadge } from './shared/truthBadge.ts';
import { fmIcon } from './shared/icons.ts';

// Aucun niveau Écowatt connu (signal absent, ou repli open data) : gris neutre, jamais une
// couleur de vigilance qui ne vient pas de RTE.
const NEUTRAL_COLOR = '#8e8e93';

/** "AAAA-MM-JJ" → "JJ/MM" (le jour est déjà exprimé en heure de Paris, pas de parsing de date). */
function ddmm(isoDay: string): string {
  const [, m, d] = isoDay.split('-');
  return `${d}/${m}`;
}

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
    super(container, { title: 'Écowatt RTE', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'energy-panel-modal';
    this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
        width: '400px',
        maxHeight: 'calc(100vh - var(--right-panel-top) - 20px)',
        backgroundStart: 'rgba(9, 18, 24, 0.97)',
        backgroundEnd: 'rgba(12, 16, 22, 0.96)',
        borderColor: 'rgba(34, 197, 94, 0.18)',
      })}
      cursor: grab;
    `;

    // ─── Bouton fermeture ───
    this.closeBtnEl = this.createCloseButton(() => this.hide());
    this.closeBtnEl.classList.add('energy-panel-close');
    this.closeBtnEl.style.cssText = getPremiumCloseButtonStyle();
    applyPremiumCloseButtonHover(this.closeBtnEl);
    this.modalEl.appendChild(this.closeBtnEl);

    const header = createPremiumRingHeader({
      ringId: 'elec-ring-progress',
      centerId: 'elec-ring-icon',
      centerText: fmIcon('zap', { size: 20 }),
      centerFontSize: '20px',
      ringStroke: NEUTRAL_COLOR,
      title: 'Écowatt RTE - Réseau électrique',
      subtitle: 'Signal Écowatt',
      statusId: 'elec-signal-label',
      updateId: 'elec-update-time',
      badgeId: 'elec-truth-badge',
      gradientStart: 'rgba(22, 163, 74, 0.18)',
      gradientEnd: 'rgba(249, 115, 22, 0.08)',
      titlePrefix: 'Backbone énergétique',
      extraTopRowHtml: '<div id="elec-upcoming-band" style="margin-top:6px;"></div>',
    });
    header.className = 'energy-panel-header';
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

    if (!data) {
      this.contentEl.innerHTML = `
        <div style="text-align: center; padding: 32px 16px;">
          <div style="margin-bottom: 16px; opacity: 0.6;">${fmIcon('plug-zap', { size: 48 })}</div>
          <div style="color: var(--text-muted);">Aucune donnée Écowatt disponible.</div>
        </div>`;
      const badgeEl = this.modalEl.querySelector('#elec-truth-badge') as HTMLElement | null;
      if (badgeEl) badgeEl.innerHTML = renderTruthBadge('INDISPONIBLE', '#EF4444');
      return;
    }

    this.updateHeader(data);
    this.renderContent(data);
  }

  /** Bande J → J+3 : jour abrégé + pastille de niveau (vide pour le repli open data, jours passés). */
  private renderUpcomingBand(days: EcowattOfficialDay[]): string {
    if (days.length === 0) return '';
    return `<div style="display:flex;gap:10px;">${days.map((d, i) => {
      const color = levelHex(officialLevel(d.level));
      const label = i === 0 ? 'Auj.' : new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short' }).replace(/\.$/, '');
      return `
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px;" title="${ecowattLevelLabel(d.level)}">
          <span style="font-size:9px;color:var(--text-muted);text-transform:capitalize;">${label}</span>
          <span style="width:9px;height:9px;border-radius:50%;background:${color};display:block;"></span>
        </div>`;
    }).join('')}</div>`;
  }

  private updateHeader(data: EcowattResponse): void {
    const nowMs = Date.now();
    const official = data.official;

    const ring = this.modalEl.querySelector('#elec-ring-progress') as SVGCircleElement | null;
    const icon = this.modalEl.querySelector('#elec-ring-icon') as HTMLElement | null;
    const lbl  = this.modalEl.querySelector('#elec-signal-label') as HTMLElement | null;
    const time = this.modalEl.querySelector('#elec-update-time') as HTMLElement | null;
    const badge = this.modalEl.querySelector('#elec-truth-badge') as HTMLElement | null;
    const band = this.modalEl.querySelector('#elec-upcoming-band') as HTMLElement | null;

    const level = ecowattToday(official, nowMs);
    // Le badge dit la fraîcheur du SIGNAL Écowatt (pas celle du mix) : « TEMPS RÉEL » seulement
    // quand RTE a publié le signal du jour ; même codage que les autres badges (orange = différé).
    if (badge) {
      badge.innerHTML = official && official.source === 'rte' && level
        ? renderFreshnessBadge(['ecowatt'])
        : official?.source === 'odre'
          ? renderTruthBadge('SIGNAL DIFFÉRÉ · J-1', '#F59E0B')
          : renderTruthBadge('SIGNAL INDISPONIBLE', '#EF4444');
    }

    if (official && official.source === 'rte' && level) {
      // ── Signal du jour, publié par RTE (jour J à J+3) ──────────────────
      const color = levelHex(officialLevel(level));
      if (ring) { ring.setAttribute('stroke', color); ring.setAttribute('stroke-dasharray', '100 100'); }
      if (icon) icon.style.color = color;
      if (lbl)  { lbl.textContent = ecowattLevelLabel(level); lbl.style.color = color; }
      if (time) {
        const d = parseApiDate(official.generatedAt);
        time.textContent = d
          ? `RTE Écowatt · publié le ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${formatUpdateTime(d)}`
          : 'RTE Écowatt';
      }
      if (band) band.innerHTML = this.renderUpcomingBand(ecowattUpcoming(official, nowMs));
    } else if (official && official.source === 'odre') {
      // ── Repli open data RTE : jours PASSÉS seulement, jamais présenté comme le signal du jour ──
      const last = ecowattLastPublished(official, nowMs);
      if (ring) { ring.setAttribute('stroke', NEUTRAL_COLOR); ring.setAttribute('stroke-dasharray', '100 100'); }
      if (icon) icon.style.color = NEUTRAL_COLOR;
      if (lbl) {
        lbl.textContent = last
          ? `Dernier signal publié le ${ddmm(last.date)} : ${ecowattLevelLabel(last.level)} (open data RTE, J-1)`
          : 'Signal Écowatt indisponible';
        lbl.style.color = NEUTRAL_COLOR;
      }
      if (time) time.textContent = '';
      if (band) band.innerHTML = '';
    } else {
      // ── Ni RTE ni repli open data disponibles ──────────────────────────
      if (ring) { ring.setAttribute('stroke', NEUTRAL_COLOR); ring.setAttribute('stroke-dasharray', '0 100'); }
      if (icon) icon.style.color = NEUTRAL_COLOR;
      if (lbl)  { lbl.textContent = 'Signal Écowatt indisponible'; lbl.style.color = NEUTRAL_COLOR; }
      if (time) time.textContent = '';
      if (band) band.innerHTML = '';
    }
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
        const arrow = isImport ? `${fmIcon('trending-down', { size: 11 })} Import` : isExport ? `${fmIcon('trending-up', { size: 11 })} Export` : fmIcon('arrow-left-right', { size: 11 });
        const flag = COUNTRY_FLAGS[ic.country] ?? fmIcon('flag', { size: 11 });
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <span style="color: var(--text-secondary); font-size: 11px;">${flag} ${ic.country}</span>
            <span style="color: ${color}; font-weight: 600; font-size: 11px;">${arrow} ${absMW >= 1000 ? `${(absMW / 1000).toFixed(1)} GW` : `${Math.round(absMW)} MW`}</span>
          </div>`;
      }).join('');

      // Dépendance aux imports nets (indicatif) : part de la charge nationale couverte par les
      // imports aux frontières, plafonnée à 20 — inchangé depuis l'ancien score composite.
      const netImportMW = data.interconnections.reduce((sum, ic) => sum + Math.max(0, ic.flowMW), 0);
      const importScore = Math.min(20, Math.round((netImportMW / 10_000) * 20));

      flowsCard = `
        <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.05);">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
            <div style="font-size: 12px; font-weight: 600; color: var(--text-primary);">
              Échanges frontières
            </div>
            <div style="font-size: 10px; color: var(--text-muted);" title="Part de la charge nationale couverte par les imports aux frontières">
              Dépendance imports : <strong style="color: var(--text-secondary);">${importScore}/20</strong>
            </div>
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
        <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">${fmIcon('sun', { size: 12 })} Météo spatiale · Kp index</div>
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

  hide(opts: { silent?: boolean } = {}): void {
    if (this.modalEl) this.modalEl.style.display = 'none';
    // Masquage « silencieux » (bascule entre panneaux) : ne désactive pas la couche.
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }
}
