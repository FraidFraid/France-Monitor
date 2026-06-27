import { Panel } from './Panel.ts';
import {
  applyPremiumCloseButtonHover,
  createPremiumIconHeader,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';
import { RISK_LABELS } from '../types/index.ts';
import type { FloodSegment, MeteoAlert, MeteoVigilanceLevel } from '../types/index.ts';
import type { VigilanceTimeline } from '../services/vigilance-meteo.ts';
import { fmLoaderHTML } from './shared/loader.ts';

const METEO_COLORS: Record<MeteoVigilanceLevel, string> = {
  violet: 'var(--threat-critical)',
  red: 'var(--threat-critical)',
  orange: 'var(--threat-high)',
  yellow: 'var(--threat-medium)',
  green: 'var(--threat-low)',
};

const FLOOD_COLORS: Record<string, string> = {
  red: 'var(--threat-critical)',
  orange: 'var(--threat-high)',
  yellow: 'var(--threat-medium)',
  green: 'var(--threat-low)',
};

const RISK_EMOJIS: Record<string, string> = {
  wind: '💨',
  'rain-flood': '🌧️',
  thunderstorm: '⛈️',
  flood: '🌊',
  'snow-ice': '❄️',
  heat: '🌡️',
  cold: '🥶',
  avalanche: '🏔️',
  'wave-surge': '🌊',
};

function describeFloodTrace(item: FloodSegment): string {
  if (item.dataSource === 'mock') return 'Tracé reconstruit';
  if (item.geometryFidelity === 'matched') return 'Tracé hydrographique recalé';
  if (item.geometryFidelity === 'fallback') return 'Corridor hydrographique';
  return 'Tracé brut';
}

export class EnvironmentPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;
  private onHoverDepartment?: (code: string | null) => void;
  private onSelectDepartment?: (code: string | null) => void;
  private onShowWeatherAlerts?: (alerts: MeteoAlert[]) => void;
  private onHoverSegment?: (id: string | null) => void;
  private onSelectSegment?: (id: string) => void;
  private weatherAlerts: MeteoAlert[] = [];
  private weatherTimeline: VigilanceTimeline | null = null;
  private selectedDepartmentCode: string | null = null;
  private selectedWeatherPeriod: 'current' | 'next' = 'current';
  private floodSegments: FloodSegment[] = [];
  /** Re-render guard: HTML string of the last rendered content. */
  private lastRenderedHtml: string | null = null;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(container: HTMLElement) {
    super(container, { title: 'Environnement', icon: '🌦️', collapsible: false });
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  setOnHoverDepartment(handler: (code: string | null) => void): void {
    this.onHoverDepartment = handler;
  }

  setOnSelectDepartment(handler: (code: string | null) => void): void {
    this.onSelectDepartment = handler;
  }

  setOnShowWeatherAlerts(handler: (alerts: MeteoAlert[]) => void): void {
    this.onShowWeatherAlerts = handler;
  }

  setOnHoverSegment(handler: (id: string | null) => void): void {
    this.onHoverSegment = handler;
  }

  setOnSelectSegment(handler: (id: string) => void): void {
    this.onSelectSegment = handler;
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'environment-panel-modal';
    this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
        width: '400px',
        maxHeight: 'calc(100vh - var(--right-panel-top) - 20px)',
        backgroundStart: 'rgba(8, 18, 31, 0.97)',
        backgroundEnd: 'rgba(10, 16, 26, 0.96)',
        borderColor: 'rgba(56, 189, 248, 0.16)',
        position: 'fixed',
        zIndex: 9999,
      })}
    `;

    this.closeBtn = document.createElement('button');
    this.closeBtn.innerHTML = '✕';
    this.closeBtn.style.cssText = getPremiumCloseButtonStyle();
    applyPremiumCloseButtonHover(this.closeBtn);
    this.closeBtn.onclick = () => this.hide();
    this.modalEl.appendChild(this.closeBtn);

    const header = createPremiumIconHeader({
      icon: '🌦️',
      title: 'Environnement',
      subtitle: 'Météo-France + Vigicrues',
      gradientStart: 'rgba(56, 189, 248, 0.16)',
      gradientEnd: 'rgba(34, 197, 94, 0.10)',
      iconGradientStart: 'rgba(56, 189, 248, 0.22)',
      iconGradientEnd: 'rgba(34, 197, 94, 0.14)',
      titlePrefix: 'Multi-risques',
    });
    header.className = 'environment-panel-header';
    header.style.cursor = 'grab';
    header.style.flexShrink = '0';
    this.modalEl.appendChild(header);

    this.contentEl = document.createElement('div');
    this.contentEl.style.cssText = `
      padding: 16px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
    `;
    this.modalEl.appendChild(this.contentEl);

    document.body.appendChild(this.modalEl);
    this.setupDrag(header);
    this.render();
  }

  showLoading(): void {
    if (!this.contentEl) return;
    this.modalEl.style.display = 'flex';
    this.contentEl.innerHTML = fmLoaderHTML({ text: 'Chargement météo & crues…' });
  }

  protected render(): void {}

  show(weatherAlerts: MeteoAlert[], floodSegments: FloodSegment[], timeline?: VigilanceTimeline): void {
    this.weatherAlerts = weatherAlerts;
    this.weatherTimeline = timeline ?? null;
    this.floodSegments = floodSegments;

    if (!this.contentEl) return;
    this.modalEl.style.display = 'flex';
    this.renderContent();
  }

  hide(): void {
    this.selectedDepartmentCode = null;
    // Selection was cleared while the DOM keeps its styles → force next render.
    this.lastRenderedHtml = null;
    this.onHoverDepartment?.(null);
    this.onSelectDepartment?.(null);
    this.onHoverSegment?.(null);
    if (this.modalEl) this.modalEl.style.display = 'none';
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }

  private setupDrag(handle: HTMLElement): void {
    handle.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('button')) return;

      this.isDragging = true;
      const rect = this.modalEl.getBoundingClientRect();
      this.dragOffsetX = event.clientX - rect.left;
      this.dragOffsetY = event.clientY - rect.top;
      handle.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.isDragging) return;

      const x = event.clientX - this.dragOffsetX;
      const y = event.clientY - this.dragOffsetY;
      const maxX = window.innerWidth - this.modalEl.offsetWidth;
      const maxY = window.innerHeight - this.modalEl.offsetHeight;
      this.modalEl.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
      this.modalEl.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
      this.modalEl.style.right = 'auto';
      this.modalEl.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      handle.style.cursor = 'grab';
    });
  }

  private renderContent(): void {
    if (!this.contentEl) return;

    const weatherAlerts = this.weatherTimeline?.currentDayAlerts.length
      ? this.weatherTimeline.currentDayAlerts
      : this.weatherAlerts;
    const activeFloods = this.floodSegments.filter((segment) => segment.level !== 'green');

    const html = `
      ${this.renderWeatherSection(weatherAlerts)}
      ${this.renderFloodSection(activeFloods)}
    `;

    // Skip the innerHTML rebuild (and listener re-binding) when the markup is
    // identical — selection state is reapplied via applyWeatherCardState on the
    // existing DOM, so skipping keeps it intact.
    if (html === this.lastRenderedHtml) return;
    this.lastRenderedHtml = html;

    this.contentEl.innerHTML = html;

    this.bindWeatherHoverEvents();
    this.bindWeatherMapButtons();
    this.bindFloodHoverEvents();
  }

  private renderWeatherSection(alerts: MeteoAlert[]): string {
    const nextDayAlerts = this.weatherTimeline?.nextDayAlerts ?? [];
    const currentDayDate = this.weatherTimeline?.currentDayDate ?? new Date();
    const currentDayLabel = currentDayDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const nextDayLabel = this.weatherTimeline?.nextDayDate
      ? this.weatherTimeline.nextDayDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
      : 'demain';
    const weatherSummary = alerts.length > 0
      ? `${alerts.length} départements en vigilance`
      : 'Aucune vigilance départementale en cours';
    const nextDaySummary = nextDayAlerts.length > 0
      ? `${nextDayAlerts.length} départements surveillés demain`
      : 'Aucune vigilance J+1 notable dans le flux.';

    return `
      <section style="display:flex; flex-direction:column; gap:12px;">
        <div style="display:flex; flex-direction:column; gap:10px; padding: 12px; border:1px solid rgba(56,189,248,0.12); border-radius:8px; background:rgba(56,189,248,0.045);">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                <span style="font-size:18px;">🌩️</span>
                <div style="color: var(--text-primary); font-size: 14px; font-weight: 700;">Météo-France</div>
              </div>
              <div style="color: var(--text-muted); font-size: 11px; line-height:1.5;">
                Vigilance courante et prévision J+1. Cliquer une carte fixe le département sur la carte.
              </div>
            </div>
            <div style="padding:3px 8px; border-radius:999px; border:1px solid rgba(56,189,248,0.22); color:#7dd3fc; background:rgba(56,189,248,0.08); font-size:9px; font-weight:700; letter-spacing:0.05em; white-space:nowrap;">LIVE</div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div style="padding: 9px 10px; border: 1px solid rgba(255,255,255,0.06); border-radius: 7px; background: rgba(0,0,0,0.18);">
              <div style="color:var(--text-muted); font-size:10px; text-transform:uppercase; letter-spacing:0.04em;">Maintenant</div>
              <div style="color:var(--text-primary); font-size:12px; font-weight:700; margin-top:3px;">${weatherSummary}</div>
            </div>
            <div style="padding: 9px 10px; border: 1px solid rgba(255,255,255,0.06); border-radius: 7px; background: rgba(0,0,0,0.18);">
              <div style="color:var(--text-muted); font-size:10px; text-transform:uppercase; letter-spacing:0.04em;">Demain</div>
              <div style="color:var(--text-primary); font-size:12px; font-weight:700; margin-top:3px;">${nextDaySummary}</div>
            </div>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <div style="color:#fff; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em;">Aujourd'hui</div>
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="color:#fff; font-size:10px;">${currentDayLabel}</div>
              ${this.renderWeatherMapButton('current')}
            </div>
          </div>
        ${this.renderWeatherAlertsList(alerts)}
        </div>
        ${this.renderNextDayWeatherSection(nextDayAlerts, nextDaySummary, nextDayLabel)}
      </section>
    `;
  }

  private renderWeatherMapButton(period: 'current' | 'next'): string {
    const active = this.selectedWeatherPeriod === period;
    const label = active ? 'Carte affichée' : period === 'current' ? 'Afficher J' : 'Afficher J+1';
    return `
      <button type="button" class="environment-weather-map-button" data-period="${period}" style="appearance:none; border:1px solid ${active ? 'rgba(250,204,21,0.85)' : 'rgba(125,211,252,0.26)'}; background:${active ? 'rgba(250,204,21,0.18)' : 'rgba(125,211,252,0.08)'}; color:${active ? '#facc15' : '#7dd3fc'}; border-radius:999px; padding:4px 9px; font-size:9px; font-weight:900; text-transform:uppercase; cursor:pointer; white-space:nowrap; box-shadow:${active ? '0 0 14px rgba(250,204,21,0.16)' : 'none'};">${label}</button>
    `;
  }

  private renderNextDayWeatherSection(alerts: MeteoAlert[], summary: string, dateLabel: string): string {
    if (alerts.length === 0) {
      return `
        <div style="margin-top:2px; padding: 10px 12px; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; background: rgba(255,255,255,0.02); color: var(--text-muted); font-size: 11px; line-height:1.5;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:4px;">
            <span style="color: var(--text-primary); font-size: 12px; font-weight: 700;">J+1 · ${dateLabel}</span>
            <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.4px;">prévision</span>
          </div>
          ${summary}
        </div>
      `;
    }

    return `
      <div style="display:flex; flex-direction:column; gap:8px; margin-top:2px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <div>
            <div style="color: #fff; font-size: 12px; font-weight: 800;">J+1 · ${dateLabel}</div>
            <div style="color: var(--text-muted); font-size: 11px; margin-top:2px;">${summary}</div>
          </div>
          ${this.renderWeatherMapButton('next')}
        </div>
        <div style="color:var(--text-muted); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em;">Prévision J+1</div>
        ${this.renderWeatherAlertsList(alerts)}
      </div>
    `;
  }

  private renderWeatherAlertsList(alerts: MeteoAlert[]): string {
    if (alerts.length === 0) {
      return `
        <div style="text-align:center; color: var(--text-muted); padding: 18px 0 6px;">
          <div style="font-size: 30px; margin-bottom: 10px; opacity: 0.5;">☀️</div>
          <div style="font-size: 12px;">Aucune vigilance météo notable sur cette tranche.</div>
        </div>
      `;
    }

    const grouped: Record<string, MeteoAlert[]> = { violet: [], red: [], orange: [], yellow: [] };
    const levels: MeteoVigilanceLevel[] = ['violet', 'red', 'orange', 'yellow', 'green'];
    const sorted = [...alerts].sort((a, b) => levels.indexOf(a.level) - levels.indexOf(b.level));

    for (const alert of sorted) {
      if (grouped[alert.level]) grouped[alert.level].push(alert);
    }

    return Object.entries(grouped)
      .filter(([, items]) => items.length > 0)
      .map(([level, items]) => {
        const color = METEO_COLORS[level as MeteoVigilanceLevel];
        const label = level === 'violet' ? 'Crise' : level === 'red' ? 'Rouge' : level === 'orange' ? 'Orange' : 'Jaune';
        const riskSummary = [...new Set(items.flatMap((item) => item.risks))]
          .map((risk) => `${RISK_EMOJIS[risk] ?? '⚠️'} ${RISK_LABELS[risk] ?? risk}`)
          .join(' · ');

        const cards = items
          .sort((a, b) => a.department.localeCompare(b.department, 'fr'))
          .map((item) => {
          const riskIcons = item.risks.map((risk) => RISK_EMOJIS[risk] ?? '⚠️').join(' ');
          const riskText = item.risks.map((risk) => RISK_LABELS[risk] ?? risk).join(', ');

          return `
            <button type="button" class="environment-weather-item" data-code="${item.departmentCode}" title="${item.department} · ${riskText}" style="width:100%; min-width:0; text-align:left; appearance:none; background: rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.06); border-left: 3px solid ${color}; padding: 8px 9px; border-radius: 6px; cursor:pointer; transition: all 0.2s;">
              <div style="display:flex; align-items:center; gap:7px; min-width:0;">
                <span style="font-size:12px; flex-shrink:0;">${riskIcons || '⚠️'}</span>
                <span style="color: var(--text-primary); font-size: 12px; font-weight: 650; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.department}</span>
                <span style="margin-left:auto; color: var(--text-muted); font-size: 10px; flex-shrink:0;">${item.departmentCode}</span>
                <span class="environment-weather-selected-dot" style="display:none; width:6px; height:6px; border-radius:999px; background:#7dd3fc; box-shadow:0 0 8px rgba(125,211,252,0.8); flex-shrink:0;"></span>
              </div>
            </button>
          `;
        }).join('');

        return `
          <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="width:10px; height:10px; border-radius:999px; background:${color}; flex-shrink:0;"></div>
              <div style="color:${color}; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px;">
                ${label.toUpperCase()}
              </div>
              <div style="margin-left:auto; color: var(--text-muted); font-size: 11px;">${items.length} dept.</div>
            </div>
            ${riskSummary ? `<div style="color:var(--text-muted); font-size:11px; margin-top:6px; line-height:1.4;">${riskSummary}</div>` : ''}
            <div style="display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:6px; margin-top:9px; max-height:170px; overflow-y:auto; padding-right:2px;">
              ${cards}
            </div>
          </div>
        `;
      })
      .join('');
  }

  private renderFloodSection(segments: FloodSegment[]): string {
    if (segments.length === 0) {
      return `
        <section style="display:flex; flex-direction:column; gap:10px; padding-top:12px; border-top:1px solid var(--border-color);">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">🌊</span>
            <div style="color: var(--text-primary); font-size: 14px; font-weight: 700;">Vigicrues</div>
          </div>
          <div style="color: var(--text-muted); font-size: 11px; line-height:1.5;">
            Aucun tronçon jaune, orange ou rouge dans le flux actuel.
          </div>
        </section>
      `;
    }

    const matchedCount = segments.filter((segment) => segment.geometryFidelity === 'matched').length;
    const corridorCount = segments.filter((segment) => segment.geometryFidelity === 'fallback').length;
    const reconstructedCount = segments.filter((segment) => segment.dataSource === 'mock').length;
    const grouped: Record<string, FloodSegment[]> = { red: [], orange: [], yellow: [] };

    for (const segment of segments) {
      if (grouped[segment.level]) grouped[segment.level].push(segment);
    }

    const groupsHtml = Object.entries(grouped)
      .filter(([, items]) => items.length > 0)
      .map(([level, items]) => {
        const color = FLOOD_COLORS[level];
        const label = level === 'red' ? 'Rouge' : level === 'orange' ? 'Orange' : 'Jaune';

        const cards = items.map((item) => `
          <div class="environment-flood-item" data-id="${item.id}" style="background: rgba(0,0,0,0.2); border-left: 3px solid ${color}; padding: 10px 12px; border-radius: 0 6px 6px 0; cursor:pointer; transition: all 0.2s;">
            <div style="color: var(--text-primary); font-size: 13px; font-weight: 600;">${item.name}</div>
            <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">
              ${describeFloodTrace(item)} · confiance ${Math.round(item.matchConfidence * 100)}%
            </div>
          </div>
        `).join('');

        return `
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="width:10px; height:10px; border-radius:999px; background:${color};"></div>
              <div style="color:${color}; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px;">${label}</div>
              <div style="margin-left:auto; color: var(--text-muted); font-size: 11px;">${items.length} tronçons</div>
            </div>
            ${cards}
          </div>
        `;
      })
      .join('');

    return `
      <section style="display:flex; flex-direction:column; gap:12px; padding-top:12px; border-top:1px solid var(--border-color);">
        <div style="display:flex; flex-direction:column; gap:10px; padding: 12px; border:1px solid rgba(34,197,94,0.12); border-radius:8px; background:rgba(34,197,94,0.04);">
          <div>
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
              <span style="font-size:18px;">🌊</span>
              <div style="color: var(--text-primary); font-size: 14px; font-weight: 700;">Vigicrues</div>
            </div>
            <div style="color: var(--text-muted); font-size: 11px; line-height:1.5;">
              Lecture par tronçon de rivière. Cliquer un tronçon centre la carte dessus.
            </div>
          </div>
          <div style="padding: 9px 10px; border: 1px solid rgba(255,255,255,0.06); border-radius: 7px; background: rgba(0,0,0,0.18); color: var(--text-muted); font-size: 11px;">
            ${segments.length} tronçons actifs · affichables ${matchedCount + corridorCount}/${segments.length} · recalés ${matchedCount} · corridors ${corridorCount}${reconstructedCount > 0 ? ` · reconstruits ${reconstructedCount}` : ''}
          </div>
        </div>
        ${groupsHtml}
      </section>
    `;
  }

  private bindWeatherHoverEvents(): void {
    if (!this.contentEl) return;

    this.contentEl.querySelectorAll<HTMLElement>('.environment-weather-item').forEach((card) => {
      this.applyWeatherCardState(card);

      card.onmouseenter = () => {
        if (card.dataset.code !== this.selectedDepartmentCode) {
          card.style.background = 'rgba(255,255,255,0.08)';
          card.style.transform = 'translateX(2px)';
        }
        this.onHoverDepartment?.(card.dataset.code ?? null);
      };
      card.onmouseleave = () => {
        this.applyWeatherCardState(card);
        this.onHoverDepartment?.(null);
      };
      card.onclick = () => {
        const code = card.dataset.code ?? null;
        this.selectedDepartmentCode = this.selectedDepartmentCode === code ? null : code;
        this.onHoverDepartment?.(null);
        this.onSelectDepartment?.(this.selectedDepartmentCode);
        this.refreshWeatherCardStates();
      };
      card.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        card.click();
      };
    });
  }

  private bindWeatherMapButtons(): void {
    if (!this.contentEl) return;

    this.contentEl.querySelectorAll<HTMLButtonElement>('.environment-weather-map-button').forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        const period = button.dataset.period === 'next' ? 'next' : 'current';
        const alerts = period === 'next'
          ? this.weatherTimeline?.nextDayAlerts ?? []
          : this.weatherTimeline?.currentDayAlerts.length
            ? this.weatherTimeline.currentDayAlerts
            : this.weatherAlerts;
        this.selectedWeatherPeriod = period;
        this.selectedDepartmentCode = null;
        this.onHoverDepartment?.(null);
        this.onSelectDepartment?.(null);
        this.onShowWeatherAlerts?.(alerts);
        this.renderContent();
      };
    });
  }

  private refreshWeatherCardStates(): void {
    if (!this.contentEl) return;
    this.contentEl.querySelectorAll<HTMLElement>('.environment-weather-item').forEach((card) => {
      this.applyWeatherCardState(card);
    });
  }

  private applyWeatherCardState(card: HTMLElement): void {
    const isSelected = card.dataset.code === this.selectedDepartmentCode;
    const dot = card.querySelector<HTMLElement>('.environment-weather-selected-dot');
    card.style.background = isSelected ? 'rgba(56,189,248,0.13)' : 'rgba(0,0,0,0.2)';
    card.style.borderTopColor = isSelected ? 'rgba(125,211,252,0.35)' : 'rgba(255,255,255,0.06)';
    card.style.borderRightColor = isSelected ? 'rgba(125,211,252,0.35)' : 'rgba(255,255,255,0.06)';
    card.style.borderBottomColor = isSelected ? 'rgba(125,211,252,0.35)' : 'rgba(255,255,255,0.06)';
    card.style.transform = isSelected ? 'translateX(2px)' : 'translateX(0)';
    if (dot) dot.style.display = isSelected ? 'inline-block' : 'none';
  }

  private bindFloodHoverEvents(): void {
    if (!this.contentEl) return;

    this.contentEl.querySelectorAll<HTMLElement>('.environment-flood-item').forEach((card) => {
      card.onmouseenter = () => {
        card.style.background = 'var(--bg-surface-hover)';
        card.style.transform = 'translateX(2px)';
        this.onHoverSegment?.(card.dataset.id ?? null);
      };
      card.onmouseleave = () => {
        card.style.background = 'rgba(0,0,0,0.2)';
        card.style.transform = 'translateX(0)';
        this.onHoverSegment?.(null);
      };
      card.onclick = () => {
        const id = card.dataset.id;
        if (id) this.onSelectSegment?.(id);
      };
    });
  }
}
