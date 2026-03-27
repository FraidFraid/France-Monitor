import { Panel } from './Panel.ts';
import { RISK_LABELS } from '../types/index.ts';
import type { FloodSegment, MeteoAlert, MeteoVigilanceLevel } from '../types/index.ts';

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
  private onHoverSegment?: (id: string | null) => void;
  private weatherAlerts: MeteoAlert[] = [];
  private floodSegments: FloodSegment[] = [];
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

  setOnHoverSegment(handler: (id: string | null) => void): void {
    this.onHoverSegment = handler;
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'environment-panel-modal';
    this.modalEl.style.cssText = `
      position: fixed;
      top: var(--right-panel-top);
      right: 20px;
      width: 380px;
      max-height: calc(100vh - var(--right-panel-top) - 20px);
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      z-index: 9999;
      display: none;
      flex-direction: column;
      backdrop-filter: blur(10px);
      overflow: hidden;
    `;

    this.closeBtn = document.createElement('button');
    this.closeBtn.innerHTML = '✕';
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

    const header = document.createElement('div');
    header.className = 'environment-panel-header';
    header.style.cssText = `
      padding: 16px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: grab;
      flex-shrink: 0;
    `;
    header.innerHTML = `
      <div style="font-size: 24px;">🌦️</div>
      <div>
        <div style="color: var(--text-primary); font-weight: 600; font-size: 14px;">Environnement</div>
        <div style="color: var(--text-muted); font-size: 11px;">Météo-France + Vigicrues</div>
      </div>
    `;
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

  protected render(): void {}

  show(weatherAlerts: MeteoAlert[], floodSegments: FloodSegment[], _timeline?: unknown): void {
    this.weatherAlerts = weatherAlerts;
    this.floodSegments = floodSegments;

    if (!this.contentEl) return;
    this.modalEl.style.display = 'flex';
    this.renderContent();
  }

  hide(): void {
    this.onHoverDepartment?.(null);
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

    const weatherAlerts = this.weatherAlerts;
    const activeFloods = this.floodSegments.filter((segment) => segment.level !== 'green');

    this.contentEl.innerHTML = `
      ${this.renderWeatherSection(weatherAlerts)}
      ${this.renderFloodSection(activeFloods)}
    `;

    this.bindWeatherHoverEvents();
    this.bindFloodHoverEvents();
  }

  private renderWeatherSection(alerts: MeteoAlert[]): string {
    const weatherSummary = alerts.length > 0
      ? `${alerts.length} départements en vigilance`
      : 'Aucune vigilance départementale en cours';

    return `
      <section style="display:flex; flex-direction:column; gap:12px;">
        <div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span style="font-size:18px;">🌩️</span>
            <div style="color: var(--text-primary); font-size: 14px; font-weight: 700;">Météo-France</div>
          </div>
          <div style="color: var(--text-muted); font-size: 11px; line-height:1.5;">
            Vigilance départementale en cours.
          </div>
        </div>

        <div style="padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: rgba(255,255,255,0.03); color: var(--text-muted); font-size: 11px;">
          ${weatherSummary}
        </div>

        ${this.renderWeatherAlertsList(alerts)}
      </section>
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

        const cards = items
          .sort((a, b) => a.department.localeCompare(b.department, 'fr'))
          .map((item) => {
          const risks = item.risks.map((risk) => `
            <span style="display:inline-flex; align-items:center; gap:4px; padding:2px 6px; border-radius:999px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); font-size:10px; color:var(--text-muted);">
              ${RISK_EMOJIS[risk] ?? '⚠️'} ${RISK_LABELS[risk] ?? risk}
            </span>
          `).join('');

          return `
            <div class="environment-weather-item" data-code="${item.departmentCode}" style="background: rgba(0,0,0,0.2); border-left: 3px solid ${color}; padding: 10px 12px; border-radius: 0 6px 6px 0; cursor:pointer; transition: all 0.2s;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <div style="color: var(--text-primary); font-size: 13px; font-weight: 600;">${item.department}</div>
                <div style="color: var(--text-muted); font-size: 11px;">${item.departmentCode}</div>
              </div>
              <div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:8px;">${risks}</div>
            </div>
          `;
        }).join('');

        return `
          <details style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 0 10px;">
            <summary style="display:flex; align-items:center; gap:8px; padding: 10px 0; cursor:pointer; list-style:none;">
              <div style="width:10px; height:10px; border-radius:999px; background:${color}; flex-shrink:0;"></div>
              <div style="color:${color}; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px;">
                ${label.toUpperCase()}
              </div>
              <div style="margin-left:auto; color: var(--text-muted); font-size: 11px;">${items.length} dept.</div>
            </summary>
            <div style="display:flex; flex-direction:column; gap:8px; padding: 0 0 10px;">
              ${cards}
            </div>
          </details>
        `;
      })
      .join('');
  }

  private renderFloodSection(segments: FloodSegment[]): string {
    if (segments.length === 0) {
      return `
        <section style="display:flex; flex-direction:column; gap:10px; padding-top:8px; border-top:1px solid var(--border-color);">
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
      <section style="display:flex; flex-direction:column; gap:12px; padding-top:8px; border-top:1px solid var(--border-color);">
        <div>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span style="font-size:18px;">🌊</span>
            <div style="color: var(--text-primary); font-size: 14px; font-weight: 700;">Vigicrues</div>
          </div>
          <div style="color: var(--text-muted); font-size: 11px; line-height:1.5;">
            Ici, la lecture se fait par tronçon de rivière et non par département.
          </div>
        </div>
        <div style="padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: rgba(255,255,255,0.03); color: var(--text-muted); font-size: 11px;">
          Tracés affichables: ${matchedCount + corridorCount}/${segments.length} · recalés: ${matchedCount} · corridors: ${corridorCount}
        </div>
        ${groupsHtml}
      </section>
    `;
  }

  private bindWeatherHoverEvents(): void {
    if (!this.contentEl) return;

    this.contentEl.querySelectorAll<HTMLElement>('.environment-weather-item').forEach((card) => {
      card.onmouseenter = () => {
        card.style.background = 'rgba(255,255,255,0.08)';
        card.style.transform = 'translateX(2px)';
        this.onHoverDepartment?.(card.dataset.code ?? null);
      };
      card.onmouseleave = () => {
        card.style.background = 'rgba(0,0,0,0.2)';
        card.style.transform = 'translateX(0)';
        this.onHoverDepartment?.(null);
      };
    });
  }

  private bindFloodHoverEvents(): void {
    if (!this.contentEl) return;

    this.contentEl.querySelectorAll<HTMLElement>('.environment-flood-item').forEach((card) => {
      card.onmouseenter = () => {
        card.style.background = 'var(--bg-surface-hover)';
        this.onHoverSegment?.(card.dataset.id ?? null);
      };
      card.onmouseleave = () => {
        card.style.background = 'rgba(0,0,0,0.2)';
        this.onHoverSegment?.(null);
      };
    });
  }
}
