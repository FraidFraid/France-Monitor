/**
 * ISNRPanel.ts — Panel affichant l'Indice de Stabilité Nationale & Régionale
 *
 * Floating modal style, affiche le top des départements les plus instables
 * avec score global, détail des 4 dimensions, et tendance.
 */

import { Panel } from './Panel.ts';
import type { ISNRData } from '../types/index.ts';
import { scoreToEmoji, trendToArrow } from '../services/stability-index.ts';

const SCORE_COLORS: Record<string, string> = {
  critical: 'var(--threat-critical)',
  high: 'var(--threat-high)',
  medium: 'var(--threat-medium)',
  low: 'var(--threat-low)',
  stable: 'var(--text-muted)',
};

function renderTruthBadge(label: string, color: string): string {
  return `<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:${color}22;border:1px solid ${color}33;color:${color};font-size:9px;font-weight:700;letter-spacing:0.06em;">${label}</span>`;
}

function scoreToColor(score: number): string {
  if (score >= 80) return SCORE_COLORS.critical;
  if (score >= 60) return SCORE_COLORS.high;
  if (score >= 40) return SCORE_COLORS.medium;
  if (score >= 20) return SCORE_COLORS.low;
  return SCORE_COLORS.stable;
}

export class ISNRPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;
  private onHoverDepartment?: (code: string | null) => void;
  private onClickDepartment?: (code: string) => void;

  constructor(container: HTMLElement) {
    super(container, { title: 'ISNR', icon: '📊', collapsible: false });
  }

  setOnHoverDepartment(handler: (code: string | null) => void): void {
    this.onHoverDepartment = handler;
  }

  setOnClickDepartment(handler: (code: string) => void): void {
    this.onClickDepartment = handler;
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.style.cssText = `
      position: absolute;
      top: var(--right-panel-top);
      right: 20px;
      width: 340px;
      max-height: calc(100vh - var(--right-panel-top) - 20px);
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 1000;
      display: none;
      flex-direction: column;
      backdrop-filter: blur(10px);
      overflow: hidden;
    `;

    // Close button
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

    // Content area (header + list will be rendered in show())
    this.contentEl = document.createElement('div');
    this.contentEl.style.cssText = `
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    `;
    this.modalEl.appendChild(this.contentEl);

    this.container.appendChild(this.modalEl);
    this.render();
  }

  protected render(): void { }

  show(data: ISNRData): void {
    if (!this.contentEl) return;
    this.modalEl.style.display = 'flex';

    const nationalEmoji = scoreToEmoji(data.nationalScore);
    const nationalColor = scoreToColor(data.nationalScore);

    // Header with national score
    let html = `
      <div style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="font-size: 24px;">📊</div>
          <div>
            <div style="color: var(--text-primary); font-weight: 600; font-size: 14px;">ISNR</div>
            <div style="color: var(--text-muted); font-size: 11px;">Indice de Stabilité</div>
            <div style="margin-top:3px;">${renderTruthBadge('RECONSTRUIT / ESTIMÉ', '#F97316')}</div>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 2px;">National</div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 18px; font-weight: 700; color: ${nationalColor};">${data.nationalScore}</span>
            <span style="font-size: 16px;">${nationalEmoji}</span>
          </div>
        </div>
      </div>
    `;

    // Filter to show only top 15 with score > 0
    const topDepts = data.scores.filter(s => s.score > 0).slice(0, 15);

    if (topDepts.length === 0) {
      html += `
        <div style="padding: 30px 16px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.5;">⚪</div>
          <div>Tous les départements sont stables.</div>
        </div>
      `;
    } else {
      html += `
        <div style="padding: 12px 16px 8px 16px; flex-shrink: 0;">
          <div style="color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">
            Départements les plus instables
          </div>
        </div>
        <div style="overflow-y: auto; flex: 1; min-height: 0; padding: 0 16px 16px 16px;">
      `;

      for (const dept of topDepts) {
        const emoji = scoreToEmoji(dept.score);
        const color = scoreToColor(dept.score);
        const arrow = trendToArrow(dept.trend);
        const trendColor = dept.trend === 'up' ? 'var(--threat-high)' :
                          dept.trend === 'down' ? 'var(--threat-low)' : 'var(--text-muted)';

        html += `
          <div class="isnr-dept-item" data-code="${dept.code}" style="
            background: rgba(0,0,0,0.2);
            border-left: 3px solid ${color};
            padding: 12px;
            border-radius: 0 8px 8px 0;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s;
          ">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">${emoji}</span>
                <div>
                  <span style="color: var(--text-muted); font-size: 11px;">${dept.code}</span>
                  <span style="color: var(--text-primary); font-size: 13px; font-weight: 500; margin-left: 6px;">${dept.name}</span>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 16px; font-weight: 700; color: ${color};">${dept.score}</span>
                <span style="color: ${trendColor}; font-size: 14px;">${arrow}</span>
              </div>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <span style="font-size: 10px; color: var(--text-muted); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">
                Soc:${dept.dimensions.social}
              </span>
              <span style="font-size: 10px; color: var(--text-muted); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">
                Sec:${dept.dimensions.security}
              </span>
              <span style="font-size: 10px; color: var(--text-muted); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">
                Inf:${dept.dimensions.infra}
              </span>
              <span style="font-size: 10px; color: var(--text-muted); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">
                Vel:${dept.dimensions.velocity}
              </span>
            </div>
          </div>
        `;
      }

      html += `</div>`;
    }

    // Footer with timestamp
    const timeStr = data.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    html += `
      <div style="padding: 12px 16px; border-top: 1px solid var(--border-color); font-size: 10px; color: var(--text-muted); text-align: center; flex-shrink: 0;">
        Mis à jour à ${timeStr}
      </div>
    `;

    this.contentEl.innerHTML = html;

    // Event listeners for hover and click
    const items = this.contentEl.querySelectorAll('.isnr-dept-item');
    items.forEach((el) => {
      el.addEventListener('mouseenter', () => {
        const code = (el as HTMLElement).dataset.code || null;
        if (code && this.onHoverDepartment) this.onHoverDepartment(code);
        (el as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
      });
      el.addEventListener('mouseleave', () => {
        if (this.onHoverDepartment) this.onHoverDepartment(null);
        (el as HTMLElement).style.background = 'rgba(0,0,0,0.2)';
      });
      el.addEventListener('click', () => {
        const code = (el as HTMLElement).dataset.code;
        if (code && this.onClickDepartment) this.onClickDepartment(code);
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
}
