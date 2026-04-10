import { Panel } from './Panel.ts';
import {
  applyPremiumCloseButtonHover,
  createPremiumIconHeader,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';
import type { MeteoAlert } from '../types/index.ts';
import { RISK_LABELS } from '../types/index.ts';
import type { VigilanceTimeline, VigilanceTimeSlot } from '../services/vigilance-meteo.ts';

function renderTruthBadge(label: string, color: string): string {
  return `<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:${color}22;border:1px solid ${color}33;color:${color};font-size:9px;font-weight:700;letter-spacing:0.06em;">${label}</span>`;
}

const METEO_COLORS: Record<string, string> = {
  red: 'var(--threat-critical)',
  orange: 'var(--threat-high)',
  yellow: 'var(--threat-medium)',
  green: 'var(--threat-low)',
  violet: 'var(--threat-critical)',
};

// Risk emoji mapping for visual display
const RISK_EMOJIS: Record<string, string> = {
  'wind': '💨',
  'rain-flood': '🌧️',
  'thunderstorm': '⛈️',
  'flood': '🌊',
  'snow-ice': '❄️',
  'heat': '🌡️',
  'cold': '🥶',
  'avalanche': '🏔️',
  'wave-surge': '🌊',
};

export class WeatherPanel extends Panel {
  private contentEl: HTMLElement | null = null;
  private timelineEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;
  private activeAlerts: MeteoAlert[] = [];
  private timeline: VigilanceTimeline | null = null;
  private selectedSlotIndex: number = -1; // -1 = show current slot
  private onHoverDepartment?: (code: string | null) => void;
  private onSlotChange?: (slotIndex: number, alerts: MeteoAlert[]) => void;

  setOnHoverDepartment(handler: (code: string | null) => void): void {
    this.onHoverDepartment = handler;
  }

  setOnSlotChange(handler: (slotIndex: number, alerts: MeteoAlert[]) => void): void {
    this.onSlotChange = handler;
  }

  constructor(container: HTMLElement) {
    // Use abstract Panel but trick it to not render as a sidebar block
    super(container, { title: 'Météo-France', icon: '🌩️', collapsible: false });
  }

  // Override mount entirely because it's a floating modal, not a sidebar panel
  mount(): void {

    // Style the element as a floating modal
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'weather-panel-modal';
    this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
        width: '400px',
        maxHeight: 'calc(100vh - var(--right-panel-top) - 20px)',
        backgroundStart: 'rgba(10, 18, 30, 0.97)',
        backgroundEnd: 'rgba(12, 16, 24, 0.96)',
        borderColor: 'rgba(244, 114, 182, 0.16)',
      })}
    `;

    // Create close button
    this.closeBtn = document.createElement('button');
    this.closeBtn.innerHTML = '✕';
    this.closeBtn.style.cssText = getPremiumCloseButtonStyle();
    applyPremiumCloseButtonHover(this.closeBtn);
    this.closeBtn.onclick = () => this.hide();

    this.modalEl.appendChild(this.closeBtn);

    // Header
    const header = createPremiumIconHeader({
      icon: '🌩️',
      title: 'Météo-France',
      subtitle: 'Vigilance Nationale',
      gradientStart: 'rgba(59, 130, 246, 0.16)',
      gradientEnd: 'rgba(244, 114, 182, 0.10)',
      iconGradientStart: 'rgba(59, 130, 246, 0.22)',
      iconGradientEnd: 'rgba(251, 113, 133, 0.14)',
      badgeId: 'weather-truth-badge',
      titlePrefix: 'Atmosphère & vigilance',
    });
    this.modalEl.appendChild(header);

    // Timeline container
    this.timelineEl = document.createElement('div');
    this.timelineEl.style.cssText = `
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      background: rgba(0,0,0,0.15);
    `;
    this.modalEl.appendChild(this.timelineEl);

    // Content
    this.contentEl = document.createElement('div');
    this.contentEl.style.cssText = `
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    `;
    this.modalEl.appendChild(this.contentEl);

    this.container.appendChild(this.modalEl);

    // Required by base Panel, even if we don't use the standard panel structure
    this.render();
  }

  private modalEl!: HTMLElement;

  // Required by Panel base class
  protected render(): void { }

  setOnClose(h: () => void): void {
    this.onClose = h;
  }

  /**
   * Show panel with timeline support.
   * If timeline is provided, display timeline UI.
   * Falls back to simple alerts display if no timeline.
   */
  show(alerts: MeteoAlert[], timeline?: VigilanceTimeline): void {
    this.activeAlerts = alerts;
    this.timeline = timeline ?? null;

    if (this.timeline) {
      this.selectedSlotIndex = this.timeline.currentSlotIndex;
    }

    if (!this.contentEl) return;
    this.modalEl.style.display = 'flex';

    const truthBadge = this.modalEl.querySelector('#weather-truth-badge') as HTMLElement | null;
    if (truthBadge) {
      const hasData = alerts.length > 0 || (timeline != null && timeline.slots.length > 0);
      truthBadge.innerHTML = hasData
        ? renderTruthBadge('TEMPS RÉEL', '#10B981')
        : renderTruthBadge('INDISPONIBLE', '#EF4444');
    }

    // Render timeline if available
    this.renderTimeline();

    // Get alerts to display (from timeline slot or direct alerts)
    const displayAlerts = this.getDisplayAlerts();
    this.renderAlerts(displayAlerts);
  }

  /**
   * Get alerts to display based on selected slot or direct alerts.
   */
  private getDisplayAlerts(): MeteoAlert[] {
    if (this.timeline && this.selectedSlotIndex >= 0) {
      return this.timeline.slots[this.selectedSlotIndex]?.alerts ?? [];
    }
    return this.activeAlerts;
  }

  /**
   * Render the timeline bar with 8 slots of 3h each.
   */
  private renderTimeline(): void {
    if (!this.timelineEl) return;

    if (!this.timeline) {
      this.timelineEl.style.display = 'none';
      return;
    }

    this.timelineEl.style.display = 'block';

    const slots = this.timeline.slots;
    const currentIdx = this.timeline.currentSlotIndex;

    let html = `
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
            Prévisions par tranche horaire
          </span>
          <span style="font-size: 10px; color: var(--text-muted);">
            ${this.formatSlotDate(slots[this.selectedSlotIndex])}
          </span>
        </div>
        <div style="display: flex; gap: 2px; height: 36px;">
    `;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const isSelected = i === this.selectedSlotIndex;
      const isCurrent = i === currentIdx;
      const hasAlerts = slot.alerts.length > 0;
      const maxLevel = this.getMaxAlertLevel(slot.alerts);

      // Determine slot color based on max alert level
      const slotColor = hasAlerts ? (METEO_COLORS[maxLevel] ?? 'var(--text-muted)') : 'transparent';
      const borderColor = isSelected ? 'var(--accent-primary)' : isCurrent ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)';
      const bgOpacity = isSelected ? '0.25' : hasAlerts ? '0.15' : '0.05';

      html += `
        <div
          class="timeline-slot"
          data-slot="${i}"
          style="
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: ${hasAlerts ? slotColor.replace(')', `, ${bgOpacity})`) : `rgba(255,255,255,${bgOpacity})`};
            border: 2px solid ${borderColor};
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s ease;
            position: relative;
            ${isSelected ? 'transform: scale(1.05); z-index: 2;' : ''}
          "
        >
          <span style="font-size: 9px; font-weight: 600; color: ${isSelected ? '#fff' : 'var(--text-muted)'};">
            ${slot.label.split('-')[0]}
          </span>
          ${hasAlerts ? `<span style="font-size: 10px; margin-top: 1px;">${this.getSlotEmoji(slot)}</span>` : ''}
          ${isCurrent ? '<div style="position: absolute; bottom: 2px; width: 4px; height: 4px; border-radius: 50%; background: var(--accent-primary);"></div>' : ''}
        </div>
      `;
    }

    html += `
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-muted); padding: 0 2px;">
          <span>00h</span>
          <span>12h</span>
          <span>24h</span>
        </div>
      </div>
    `;

    this.timelineEl.innerHTML = html;

    // Add click handlers for timeline slots
    const slotEls = this.timelineEl.querySelectorAll('.timeline-slot');
    slotEls.forEach((el) => {
      el.addEventListener('click', () => {
        const slotIdx = parseInt((el as HTMLElement).dataset.slot ?? '0', 10);
        this.selectSlot(slotIdx);
      });
      el.addEventListener('mouseenter', () => {
        (el as HTMLElement).style.opacity = '0.85';
      });
      el.addEventListener('mouseleave', () => {
        (el as HTMLElement).style.opacity = '1';
      });
    });
  }

  /**
   * Select a timeline slot and update display.
   */
  private selectSlot(slotIndex: number): void {
    if (!this.timeline || slotIndex < 0 || slotIndex >= this.timeline.slots.length) return;

    this.selectedSlotIndex = slotIndex;
    this.renderTimeline();

    const displayAlerts = this.getDisplayAlerts();
    this.renderAlerts(displayAlerts);

    // Notify callback
    this.onSlotChange?.(slotIndex, displayAlerts);
  }

  /**
   * Get the maximum alert level from a list of alerts.
   */
  private getMaxAlertLevel(alerts: MeteoAlert[]): string {
    const levels = ['violet', 'red', 'orange', 'yellow', 'green'];
    for (const level of levels) {
      if (alerts.some(a => a.level === level)) return level;
    }
    return 'green';
  }

  /**
   * Get emoji representing the slot's primary risks.
   */
  private getSlotEmoji(slot: VigilanceTimeSlot): string {
    const risks = new Set<string>();
    for (const alert of slot.alerts) {
      for (const risk of alert.risks) {
        risks.add(risk);
      }
    }
    const firstRisk = [...risks][0];
    return firstRisk ? (RISK_EMOJIS[firstRisk] ?? '⚠️') : '';
  }

  /**
   * Format slot date for display.
   */
  private formatSlotDate(slot?: VigilanceTimeSlot): string {
    if (!slot) return '';
    const date = slot.startTime;
    return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /**
   * Render alerts list.
   */
  private renderAlerts(alerts: MeteoAlert[]): void {
    if (!this.contentEl) return;

    if (alerts.length === 0) {
      this.contentEl.innerHTML = `
        <div style="text-align:center; color: var(--text-muted); padding: 20px 0;">
          <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.5;">☀️</div>
          <div>Aucune vigilance particulière pour cette période.</div>
        </div>
      `;
      return;
    }

    // Sort by threat level (red -> orange -> yellow)
    const sorted = [...alerts].sort((a, b) => {
      const levels: Record<string, number> = { violet: 4, red: 3, orange: 2, yellow: 1, green: 0 };
      return (levels[b.level] || 0) - (levels[a.level] || 0);
    });

    // Group by level
    const byLevel: Record<string, MeteoAlert[]> = { violet: [], red: [], orange: [], yellow: [] };
    for (const a of sorted) {
      if (byLevel[a.level]) byLevel[a.level].push(a);
    }

    let html = '';

    for (const [level, items] of Object.entries(byLevel)) {
      if (items.length === 0) continue;

      const color = METEO_COLORS[level];
      const levelNames: Record<string, string> = {
        violet: 'Violet (Crise)',
        red: 'Rouge (Alerte)',
        orange: 'Orange (Vigilance)',
        yellow: 'Jaune (Avertissement)'
      };
      const name = levelNames[level] ?? level;

      html += `
        <div style="margin-bottom: 20px;">
          <div style="display:flex; align-items:center; gap: 8px; margin-bottom: 10px;">
            <div style="width: 12px; height: 12px; border-radius: 6px; background: ${color};"></div>
            <div style="color: ${color}; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
              Vigilance ${name}
            </div>
            <span style="font-size: 11px; color: var(--text-muted); margin-left: auto;">${items.length} dept.</span>
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
      `;

      for (const item of items) {
        const risksHtml = (item.risks || [])
          .map((r) => {
            const emoji = RISK_EMOJIS[r] ?? '';
            return `<span style="display:inline-flex; align-items:center; gap: 3px; padding: 2px 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; font-size: 10px; margin-right: 4px; margin-top: 4px;">
              ${emoji} ${RISK_LABELS[r] || r}
            </span>`;
          })
          .join('');

        html += `
              <div class="weather-alert-item" data-code="${item.departmentCode}" style="background: rgba(0,0,0,0.2); border-left: 3px solid ${color}; padding: 10px 12px; border-radius: 0 6px 6px 0; cursor: pointer; transition: all 0.2s;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <span style="color: var(--text-primary); font-size: 13px; font-weight: 500;">
                    ${item.department}
                  </span>
                  <span style="color: var(--text-muted); font-size: 11px;">
                    ${item.departmentCode}
                  </span>
                </div>
                <div style="display: flex; flex-wrap: wrap;">${risksHtml}</div>
              </div>
            `;
      }

      html += `</div></div>`;
    }

    this.contentEl.innerHTML = html;

    // Add event listeners for hover
    const itemEls = this.contentEl.querySelectorAll('.weather-alert-item');
    itemEls.forEach((el) => {
      el.addEventListener('mouseenter', () => {
        const code = (el as HTMLElement).dataset.code || null;
        if (code && this.onHoverDepartment) this.onHoverDepartment(code);
        (el as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
        (el as HTMLElement).style.transform = 'translateX(2px)';
      });
      el.addEventListener('mouseleave', () => {
        if (this.onHoverDepartment) this.onHoverDepartment(null);
        (el as HTMLElement).style.background = 'rgba(0,0,0,0.2)';
        (el as HTMLElement).style.transform = 'translateX(0)';
      });
    });
  }

  hide(): void {
    if (this.modalEl) this.modalEl.style.display = 'none';
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }

  /**
   * Get the currently selected slot index.
   */
  getSelectedSlotIndex(): number {
    return this.selectedSlotIndex;
  }

  /**
   * Programmatically select a slot.
   */
  setSelectedSlot(index: number): void {
    this.selectSlot(index);
  }
}
