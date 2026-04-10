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

function renderDimBadge(label: string, value: number) {
  const height = Math.max(2, (value / 100) * 14); // max 14px height bar
  if (value === 0) {
    return `
      <div style="display: flex; align-items: flex-end; gap: 4px; padding: 2px 4px; background: rgba(255,255,255,0.02); border-radius: 4px;">
        <div style="width: 4px; height: 2px; background: rgba(255,255,255,0.1); border-radius: 1px;"></div>
        <span style="font-size: 10px; color: rgba(255,255,255,0.2); line-height: 1; padding-bottom: 1px;">${label}:0</span>
      </div>`;
  }
  const bubbleColor = scoreToColor(value);
  return `
    <div style="display: flex; align-items: flex-end; gap: 4px; padding: 2px 4px; background: ${bubbleColor}15; border: 1px solid ${bubbleColor}33; border-radius: 4px;">
      <div style="width: 4px; height: ${height}px; background: ${bubbleColor}; border-radius: 1px; box-shadow: 0 0 4px ${bubbleColor}55;"></div>
      <span style="font-size: 10px; color: ${bubbleColor}; font-weight: 600; line-height: 1; padding-bottom: 1px;">${label}:${value}</span>
    </div>`;
}

function renderSparkline(history: number[]): string {
  const bars = history.map((val, i) => {
    const color = scoreToColor(val);
    const h = Math.max(1, Math.round((val / 100) * 14));
    const isLast = i === history.length - 1;
    return `<div title="Tick ${i + 1}: ${val}" style="` +
      `width:${isLast ? 3 : 2}px;` +
      `height:${h}px;` +
      `background:${color};` +
      `border-radius:1px;` +
      `opacity:${isLast ? 1 : 0.7};` +
      `${isLast ? `box-shadow:0 0 3px ${color};` : ''}` +
      `flex-shrink:0;` +
      `"></div>`;
  }).join('');
  return `<div title="Historique ISNR (${history.length} ticks)" ` +
    `style="display:flex;align-items:flex-end;gap:1px;height:14px;padding:3px 0;margin-top:4px;">` +
    `${bars}</div>`;
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
            <div style="color: var(--text-muted); font-size: 11px;">Indice de Stabilité Nationale & Régionale</div>
            <div style="margin-top:4px;">${renderTruthBadge('RECONSTRUIT / ESTIMÉ', '#F97316')}</div>
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

    // ── Bloc explication du score ────────────────────────────────────────────
    html += `
      <div style="
        padding: 10px 16px 11px;
        border-bottom: 1px solid var(--border-color);
        flex-shrink: 0;
        background: rgba(255,255,255,0.015);
      ">
        <!-- Barre de pondération -->
        <div style="display:flex; height:3px; border-radius:2px; overflow:hidden; gap:1px; margin-bottom:7px;">
          <div style="flex:30; background:#F59E0B; opacity:0.75;" title="Social · 30%"></div>
          <div style="flex:30; background:#EF4444; opacity:0.75;" title="Sécurité · 30%"></div>
          <div style="flex:30; background:#3B82F6; opacity:0.75;" title="Infrastructure · 30%"></div>
          <div style="flex:10; background:#8B5CF6; opacity:0.75;" title="Vélocité médiatique · 10%"></div>
        </div>
        <!-- Légendes -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:2px;">
          <div style="display:flex; flex-direction:column; align-items:flex-start; gap:1px;">
            <span style="font-size:9px; font-family:monospace; letter-spacing:0.04em; color:#F59E0B; opacity:0.9;">SOC</span>
            <span style="font-size:9px; color:var(--text-muted); opacity:0.7;">30%</span>
          </div>
          <div style="display:flex; flex-direction:column; align-items:center; gap:1px;">
            <span style="font-size:9px; font-family:monospace; letter-spacing:0.04em; color:#EF4444; opacity:0.9;">SÉC</span>
            <span style="font-size:9px; color:var(--text-muted); opacity:0.7;">30%</span>
          </div>
          <div style="display:flex; flex-direction:column; align-items:center; gap:1px;">
            <span style="font-size:9px; font-family:monospace; letter-spacing:0.04em; color:#3B82F6; opacity:0.9;">INF</span>
            <span style="font-size:9px; color:var(--text-muted); opacity:0.7;">30%</span>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:1px;">
            <span style="font-size:9px; font-family:monospace; letter-spacing:0.04em; color:#8B5CF6; opacity:0.9;">VEL</span>
            <span style="font-size:9px; color:var(--text-muted); opacity:0.7;">10%</span>
          </div>
        </div>
        <!-- Caption -->
        <div style="margin-top:7px; font-size:9px; color:var(--text-muted); opacity:0.65; line-height:1.5; letter-spacing:0.01em;">
          Moyenne pondérée 0–100 · remplacée par le max si une dimension dépasse 60.
          Pannes Enedis / ARCEP intégrées à l'Infra. Rafraîchi à chaque tick RSS (~5 min).
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
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
              ${renderDimBadge('Soc', dept.dimensions.social)}
              ${renderDimBadge('Sec', dept.dimensions.security)}
              ${renderDimBadge('Inf', dept.dimensions.infra)}
              ${renderDimBadge('Vel', dept.dimensions.velocity)}
            </div>
            ${dept.history != null && dept.history.length >= 2 ? renderSparkline(dept.history) : ''}
            ${dept.topDriver ? `
              <div style="font-size: 11px; margin-top: 6px; display: flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.03); padding: 4px 6px; border-radius: 4px; border-left: 2px solid ${scoreToColor(dept.topDriver.score)}">
                <span style="color: var(--text-primary); font-weight: 500;">⚠️ ${dept.topDriver.label}</span>
                <span style="color: var(--text-muted); font-size: 9px; margin-left: auto;">${dept.topDriver.source}</span>
              </div>
            ` : ''}
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
