/**
 * ISNRPanel.ts — Panel affichant l'Indice de Stabilité Nationale & Régionale
 *
 * Floating modal style, affiche le top des départements les plus instables
 * avec score global, détail des 4 dimensions, et tendance.
 */

import { Panel } from './Panel.ts';
import {
  applyPremiumCloseButtonHover,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';
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
      ${getPremiumModalStyle({
        width: '400px',
        maxHeight: 'calc(100vh - var(--right-panel-top) - 20px)',
        backgroundStart: 'rgba(12, 18, 32, 0.97)',
        backgroundEnd: 'rgba(13, 16, 28, 0.96)',
        borderColor: 'rgba(59, 130, 246, 0.18)',
      })}
    `;

    // Close button
    this.closeBtn = document.createElement('button');
    this.closeBtn.innerHTML = '✕';
    this.closeBtn.style.cssText = getPremiumCloseButtonStyle();
    applyPremiumCloseButtonHover(this.closeBtn);
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

    // ─── Drag Logic ───
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    this.modalEl.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.isnr-drag-handle')) {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = this.modalEl.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        this.modalEl.style.right = 'auto'; // Disable CSS right property so left works
        this.modalEl.style.left = `${initialLeft}px`;
        this.modalEl.style.top = `${initialTop}px`;
        document.body.style.userSelect = 'none';
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      this.modalEl.style.left = `${initialLeft + dx}px`;
      this.modalEl.style.top = `${initialTop + dy}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = '';
      }
    });

    this.container.appendChild(this.modalEl);
    this.render();
  }

  protected render(): void { }

  show(data: ISNRData): void {
    if (!this.contentEl) return;
    this.modalEl.style.display = 'flex';

    const nationalEmoji = scoreToEmoji(data.nationalScore);
    const nationalColor = scoreToColor(data.nationalScore);

    let nationalStatusText = '';
    if (data.nationalScore >= 80) nationalStatusText = 'CRITIQUE';
    else if (data.nationalScore >= 60) nationalStatusText = 'ÉLEVÉ';
    else if (data.nationalScore >= 40) nationalStatusText = 'TENSION';
    else if (data.nationalScore >= 20) nationalStatusText = 'VEILLE';
    else nationalStatusText = 'STABLE';

    const radius = 18;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (data.nationalScore / 100) * circumference;

    // Header with national score (Circular UI style)
    let html = `
      <div class="isnr-drag-handle" style="padding: 18px 16px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; cursor: grab; background: linear-gradient(135deg, rgba(59, 130, 246, 0.16), rgba(14, 165, 233, 0.10));">
        <div style="display: flex; align-items: center; gap: 14px; pointer-events: none;">
          <!-- Circular Score indicator -->
          <div style="position: relative; width: 68px; height: 68px;">
            <svg width="68" height="68" viewBox="0 0 48 48" style="width:68px;height:68px;transform: rotate(-90deg);">
              <circle cx="24" cy="24" r="${radius}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4"></circle>
              <circle cx="24" cy="24" r="${radius}" fill="none" stroke="${nationalColor}" stroke-width="4" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" style="transition: stroke-dashoffset 0.4s ease, stroke 0.3s ease;"></circle>
            </svg>
            <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; font-size: 20px;">
              ${data.nationalScore}
            </div>
          </div>
          <!-- Title & Status -->
          <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 0; min-width:0;">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Stabilité nationale</div>
            <div style="color: var(--text-primary); font-weight: 700; font-size: 14px;">ISNR France</div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 11px; font-weight: 600; color: ${nationalColor}; text-transform: uppercase; letter-spacing: 0.05em;">${nationalStatusText}</span>
            </div>
            <div style="margin-top: 5px;">${renderTruthBadge('TEMPS RÉEL', '#10B981')}</div>
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
        <!-- Scale -->
        <div style="display:flex; justify-content:space-between; margin-top:10px; padding:6px; background:rgba(0,0,0,0.15); border-radius:4px; border: 1px solid rgba(255,255,255,0.02);">
          <div style="display:flex; align-items:center; gap:3px;"><div style="width:6px;height:6px;border-radius:50%;background:var(--text-muted);"></div><span style="font-size:8px;color:var(--text-muted);font-weight:600;">0-19 STABLE</span></div>
          <div style="display:flex; align-items:center; gap:3px;"><div style="width:6px;height:6px;border-radius:50%;background:var(--threat-low);"></div><span style="font-size:8px;color:var(--text-muted);font-weight:600;">20-39 VEILLE</span></div>
          <div style="display:flex; align-items:center; gap:3px;"><div style="width:6px;height:6px;border-radius:50%;background:var(--threat-medium);"></div><span style="font-size:8px;color:var(--text-muted);font-weight:600;">40-59 TENSION</span></div>
          <div style="display:flex; align-items:center; gap:3px;"><div style="width:6px;height:6px;border-radius:50%;background:var(--threat-high);"></div><span style="font-size:8px;color:var(--text-muted);font-weight:600;">60-79 ÉLEVÉ</span></div>
          <div style="display:flex; align-items:center; gap:3px;"><div style="width:6px;height:6px;border-radius:50%;background:var(--threat-critical);"></div><span style="font-size:8px;color:var(--text-muted);font-weight:600;">80+ CRITIQUE</span></div>
        </div>
        <!-- Caption -->
        <div style="margin-top:7px; font-size:9px; color:var(--text-muted); opacity:0.65; line-height:1.5; letter-spacing:0.01em;">
          <b>Interprétation :</b> Score hybride 0-100 en temps réel. Fonctionne par moyenne pondérée, mais <u>bascule automatiquement sur la valeur maximale</u> d'une dimension dès qu'elle atteint 60 (Règle d'escalade OSINT) pour ne jamais lisser une urgence. Pannes réseau (IODA/ARCEP) intégrées à l'Infra.
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
