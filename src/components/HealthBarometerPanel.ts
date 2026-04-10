/**
 * HealthBarometerPanel.ts — Panneau baromètre national de santé
 *
 * Affiche un score global 0–100 + 4 sous-indices avec jauge et mini-barres.
 * Les données sont calculées via health-barometer.ts à partir des stores
 * déjà présents dans le module Santé (ISS, APL, OSCOUR, ANSM).
 */

import type { HealthBarometerMetrics, HealthBarometerSubIndex } from '../services/health-barometer.ts';
import { BAROMETER_WEIGHTS } from '../services/health-barometer.ts';
import {
  applyPremiumCloseButtonHover,
  createPremiumIconHeader,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';

export class HealthBarometerPanel {
  private container: HTMLElement;
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private onClose?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.id = 'health-barometer-panel';
    this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
        width: '480px',
        maxHeight: 'calc(100vh - 40px)',
        backgroundStart: 'rgba(16, 20, 32, 0.97)',
        backgroundEnd: 'rgba(14, 16, 28, 0.96)',
        borderColor: 'rgba(46, 204, 113, 0.18)',
        top: '20px',
        right: 'auto',
        zIndex: 1010,
        extra: 'left: 20px; max-width: calc(100vw - 40px);',
      })}
      font-family: system-ui, sans-serif;
    `;

    // Header
    const header = createPremiumIconHeader({
      icon: '🩺',
      title: 'Baromètre national Santé',
      subtitle: 'ISS · OSCOUR · APL · ANSM — France entière',
      gradientStart: 'rgba(46, 204, 113, 0.16)',
      gradientEnd: 'rgba(59, 130, 246, 0.10)',
      iconGradientStart: 'rgba(46, 204, 113, 0.22)',
      iconGradientEnd: 'rgba(59, 130, 246, 0.14)',
      titlePrefix: 'Santé publique',
      textColor: '#fff',
      mutedColor: '#9898a8',
    });
    header.style.padding = '18px 20px 14px';
    header.style.flexShrink = '0';

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `${getPremiumCloseButtonStyle('#9898a8')} position:absolute;top:12px;right:12px;`;
    applyPremiumCloseButtonHover(closeBtn, '#9898a8', '#fff');
    closeBtn.onclick = () => this.hide();
    this.modalEl.appendChild(closeBtn);

    // Make it draggable
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;

    header.style.cursor = 'move';
    header.addEventListener('mousedown', (e) => {
      if (e.target === closeBtn || closeBtn.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = this.modalEl.offsetLeft;
      initialY = this.modalEl.offsetTop;

      this.modalEl.style.right = 'auto';
      this.modalEl.style.bottom = 'auto';
      this.modalEl.style.left = `${initialX}px`;
      this.modalEl.style.top = `${initialY}px`;
      this.modalEl.style.transform = 'none';

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newX = initialX + dx;
      let newY = initialY + dy;

      // Clamp bounds to prevent panel going off screen
      const maxX = window.innerWidth - this.modalEl.offsetWidth;
      const maxY = window.innerHeight - this.modalEl.offsetHeight;

      // Don't limit the bottom as much so we can hide part of it if small screen, but keep top bar visible
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY + this.modalEl.offsetHeight - 60));

      this.modalEl.style.left = `${newX}px`;
      this.modalEl.style.top = `${newY}px`;
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    this.contentEl = document.createElement('div');
    this.contentEl.style.cssText = `
      overflow-y: auto;
      flex: 1;
      padding: 20px;
    `;

    this.modalEl.appendChild(header);
    this.modalEl.appendChild(this.contentEl);
    this.container.appendChild(this.modalEl);
  }

  show(metrics: HealthBarometerMetrics): void {
    if (!this.contentEl) return;
    this.modalEl.style.display = 'flex';

    // Safety check: if panel was dragged off screen or window resized
    const rect = this.modalEl.getBoundingClientRect();
    if (rect.right < 50 || rect.bottom < 50 || rect.left > window.innerWidth - 50 || rect.top > window.innerHeight - 50) {
      this.modalEl.style.left = '20px';
      this.modalEl.style.top = '20px';
    }

    this.contentEl.innerHTML = this.renderContent(metrics);
  }

  hide(): void {
    this.modalEl.style.display = 'none';
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  private renderContent(m: HealthBarometerMetrics): string {
    const timeStr = m.computedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    return `
      <div style="margin-bottom:16px; display:flex; justify-content:center;">
        <div style="font-size:11px; color:#9898a8; border:1px solid rgba(255,255,255,0.12); border-radius:999px; padding:6px 10px; background:rgba(255,255,255,0.04);">
          Provenance des données : <span style="color:#fff; font-weight:600;">${m.dataTruthLabel}</span>
        </div>
      </div>
      ${this.renderGlobalGauge(m)}
      ${this.renderSubIndicesGrid(m)}
      ${this.renderWeightsInfo()}
      <div style="margin-top:16px; text-align:center; font-size:10px; color:#5a5a72;">
        Calculé à ${timeStr} · ${m.departmentsUsed} département(s) utilisé(s)
      </div>
    `;
  }

  private renderGlobalGauge(m: HealthBarometerMetrics): string {
    const score = m.globalScore;
    const color = m.levelColor;
    // 4-zone gradient background on the gauge bar
    const gaugeGrad = 'linear-gradient(to right, #2ECC71 0%, #F1C40F 25%, #E67E22 50%, #E74C3C 75%)';

    return `
      <div style="margin-bottom:22px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:8px;">
          <div>
            <div style="color:#9898a8; font-size:11px; text-transform:uppercase; letter-spacing:0.6px; margin-bottom:4px;">Score Santé France</div>
            <div style="display:flex; align-items:baseline; gap:8px;">
              <span style="font-size:40px; font-weight:800; color:${color}; line-height:1;">${score}</span>
              <span style="color:#9898a8; font-size:16px;">/100</span>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:18px; font-weight:700; padding: 5px 12px; border-radius:6px; background:${color}22; color:${color}; border:1px solid ${color}55;">
              ${m.levelLabel}
            </div>
          </div>
        </div>

        <!-- Gauge bar -->
        <div style="position:relative; height:10px; border-radius:5px; background:${gaugeGrad}; overflow:visible; margin-bottom:6px;">
          <!-- Marker at score position -->
          <div style="
            position:absolute;
            left:${score}%;
            top:50%;
            transform:translate(-50%, -50%);
            width:16px; height:16px;
            border-radius:50%;
            background:#fff;
            border:3px solid ${color};
            box-shadow: 0 0 8px ${color}88;
            transition: left 0.5s ease;
          "></div>
        </div>

        <!-- Zone labels -->
        <div style="display:flex; justify-content:space-between; font-size:9px; color:#5a5a72; padding:0 2px;">
          <span style="color:#2ECC71;">0 Sérénité</span>
          <span style="color:#F1C40F;">25 Vigilance</span>
          <span style="color:#E67E22;">50 Alerte</span>
          <span style="color:#E74C3C;">75 Crise</span>
          <span>100</span>
        </div>
      </div>
    `;
  }

  private renderSubIndex(sub: HealthBarometerSubIndex): string {
    const pct = Math.round(sub.value);
    const color = sub.value < 25 ? '#2ECC71' : sub.value < 50 ? '#F1C40F' : sub.value < 75 ? '#E67E22' : '#E74C3C';
    const deltaHtml = sub.delta != null
      ? `<span style="color:${sub.delta > 0 ? '#E74C3C' : sub.delta < 0 ? '#2ECC71' : '#9898a8'}; margin-left:6px; font-size:11px;">${sub.delta > 0 ? '↑' : sub.delta < 0 ? '↓' : '→'} ${Math.abs(sub.delta).toFixed(1)}</span>`
      : '';

    return `
      <div style="
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 10px;
        padding: 12px;
        min-width: 0;
      ">
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
          <span style="font-size:16px;">${sub.icon}</span>
          <span style="color:#d8d8df; font-size:12px; font-weight:600; truncate; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${sub.label}</span>
        </div>
        <div style="display:flex; align-items:baseline; gap:4px; margin-bottom:8px;">
          <span style="font-size:24px; font-weight:800; color:${color};">${pct}</span>
          <span style="color:#9898a8; font-size:12px;">/100</span>
          ${deltaHtml}
        </div>
        <!-- Mini bar -->
        <div style="height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;">
          <div style="width:${pct}%; height:100%; background:${color}; border-radius:2px; transition: width 0.6s ease;"></div>
        </div>
        <div style="color:#5a5a72; font-size:9px; margin-top:6px;">${sub.description}</div>
      </div>
    `;
  }

  private renderSubIndicesGrid(m: HealthBarometerMetrics): string {
    const subs = m.subIndices;
    return `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:18px;">
        ${this.renderSubIndex(subs.stressHospitalier)}
        ${this.renderSubIndex(subs.pressureUrgences)}
        ${this.renderSubIndex(subs.fragiliteMedicale)}
        ${this.renderSubIndex(subs.tensionMedicaments)}
        ${this.renderSubIndex(subs.reseauSentinelles)}
      </div>
    `;
  }

  private renderWeightsInfo(): string {
    const w = BAROMETER_WEIGHTS;
    const entries = [
      { label: 'Stress hospitalier', pct: Math.round(w.stressHospitalier * 100) },
      { label: 'Pression urgences', pct: Math.round(w.pressureUrgences * 100) },
      { label: 'Déserts médicaux', pct: Math.round(w.fragiliteMedicale * 100) },
      { label: 'Tension médicaments', pct: Math.round(w.tensionMedicaments * 100) },
      { label: 'Sentinelles', pct: Math.round(w.reseauSentinelles * 100) },
    ];
    return `
      <div style="padding:10px 12px; background:rgba(255,255,255,0.03); border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
        <div style="color:#7a7a92; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">Pondérations du score global</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${entries.map(e => `<span style="font-size:10px; color:#9898a8; background:rgba(255,255,255,0.06); padding:3px 8px; border-radius:4px;">${e.label} <strong style="color:#d8d8df;">${e.pct}%</strong></span>`).join('')}
        </div>
      </div>
    `;
  }
}
