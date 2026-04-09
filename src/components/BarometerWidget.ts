/**
 * BarometerWidget.ts — Baromètre Pannes Réseau France
 *
 * Premier élément de la colonne gauche (sidebar), avant les couches.
 * Affiche un score 0-100 sous forme d'arc SVG + détail développé.
 */

import type { NetworkBarometerResult } from '../services/network-barometer.ts';
import type { ISNRSynthesisResult } from '../services/isnr-synthesis.ts';
import type { NuclearState } from '../types/index.ts';
import type { EolienLive } from '../services/eolien/types.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIUS = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export class BarometerWidget {
  private container: HTMLElement;
  private homeContainer: HTMLElement;
  private el: HTMLElement | null = null;
  private arcEl: SVGCircleElement | null = null;
  private scoreTextEl: SVGTextElement | null = null;
  private dotEl: HTMLElement | null = null;
  private statusLabelEl: HTMLElement | null = null;
  private tooltipEl: HTMLElement | null = null;
  private briefingContainerEl: HTMLElement | null = null;
  private briefingTextEl: HTMLElement | null = null;
  private briefingTimeEl: HTMLElement | null = null;
  private stabilityBarContainerEl: HTMLElement | null = null;
  private stabilityBarFillEl: HTMLElement | null = null;
  private currentDetails: Record<string, number | null> | null = null;
  private currentNuclear: {
    label: string;
    score: number | null;
    color: string;
  } | null = null;
  private currentEolienLive: EolienLive | null = null;
  private readonly homeMarginBottom = '8px';
  private attachedToHome = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.homeContainer = container;
  }

  mount(options?: { attach?: boolean }): void {
    this.el = document.createElement('div');
    this.el.id = 'network-barometer-widget';
    this.el.style.cssText = `
      position: relative;
      width: 100%;
      box-sizing: border-box;
      margin-bottom: ${this.homeMarginBottom};
      display: flex;
      flex-direction: column;
      padding: 10px 14px 10px 10px;
      background: var(--bg-surface);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      cursor: default;
      user-select: none;
      font-family: system-ui, sans-serif;
    `;

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:12px;';
    topRow.appendChild(this._buildArc());
    topRow.appendChild(this._buildLabels());
    this.el.appendChild(topRow);
    this.el.appendChild(this._buildTooltip());
    this.el.appendChild(this._buildBriefing());

    if (options?.attach !== false) {
      this.container.appendChild(this.el);
      this.attachedToHome = true;
    }
  }

  attachTo(container: HTMLElement): void {
    if (!this.el) return;
    this.container = container;
    this.el.style.marginBottom = '0';
    this.container.appendChild(this.el);
  }

  restoreHome(): void {
    if (!this.el || !this.attachedToHome) return;
    this.container = this.homeContainer;
    this.el.style.marginBottom = this.homeMarginBottom;
    this.homeContainer.appendChild(this.el);
  }

  // ── Builder helpers ──────────────────────────────────────────────────────────

  private _buildArc(): SVGSVGElement {
    const SIZE = 60;
    const CX = SIZE / 2;
    const CY = SIZE / 2;

    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('width', String(SIZE));
    svg.setAttribute('height', String(SIZE));
    svg.style.flexShrink = '0';

    // Background track
    const track = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
    track.setAttribute('cx', String(CX));
    track.setAttribute('cy', String(CY));
    track.setAttribute('r', String(RADIUS));
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'rgba(255,255,255,0.08)');
    track.setAttribute('stroke-width', '4');
    svg.appendChild(track);

    // Animated arc
    this.arcEl = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
    this.arcEl.setAttribute('cx', String(CX));
    this.arcEl.setAttribute('cy', String(CY));
    this.arcEl.setAttribute('r', String(RADIUS));
    this.arcEl.setAttribute('fill', 'none');
    this.arcEl.setAttribute('stroke', '#34c759');
    this.arcEl.setAttribute('stroke-width', '4');
    this.arcEl.setAttribute('stroke-linecap', 'round');
    this.arcEl.setAttribute('stroke-dasharray', String(CIRCUMFERENCE));
    this.arcEl.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE)); // starts empty
    this.arcEl.classList.add('barometer-arc');
    svg.appendChild(this.arcEl);

    // Score text centered in arc
    this.scoreTextEl = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
    this.scoreTextEl.setAttribute('x', String(CX));
    this.scoreTextEl.setAttribute('y', String(CY + 1));
    this.scoreTextEl.setAttribute('text-anchor', 'middle');
    this.scoreTextEl.setAttribute('dominant-baseline', 'middle');
    this.scoreTextEl.setAttribute('fill', 'var(--text-primary)');
    this.scoreTextEl.setAttribute('font-size', '11');
    this.scoreTextEl.setAttribute('font-weight', '700');
    this.scoreTextEl.setAttribute('font-family', 'monospace');
    this.scoreTextEl.textContent = '—';
    svg.appendChild(this.scoreTextEl);

    return svg;
  }

  private _buildLabels(): HTMLElement {
    const group = document.createElement('div');
    group.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;';

    const line1 = document.createElement('div');
    line1.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);line-height:1.3;';
    line1.textContent = 'INFRASTRUCTURES';

    const line2 = document.createElement('div');
    line2.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);line-height:1.3;';
    line2.textContent = 'FRANCE';

    const statusRow = document.createElement('div');
    statusRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-top:3px;';

    this.dotEl = document.createElement('div');
    this.dotEl.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#34c759;flex-shrink:0;';

    this.statusLabelEl = document.createElement('div');
    this.statusLabelEl.style.cssText = 'font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;';
    this.statusLabelEl.textContent = '—';

    statusRow.appendChild(this.dotEl);
    statusRow.appendChild(this.statusLabelEl);
    group.appendChild(line1);
    group.appendChild(line2);
    group.appendChild(statusRow);

    return group;
  }

  private _buildTooltip(): HTMLElement {
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.style.cssText = `
      display: block;
      position: static;
      margin-top: 8px;
      background: var(--bg-surface);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      padding: 10px 14px;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      font-size: 11px;
      color: var(--text-secondary);
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;
    return this.tooltipEl;
  }

  private _buildBriefing(): HTMLElement {
    this.briefingContainerEl = document.createElement('div');
    this.briefingContainerEl.style.cssText = `
      margin-top: 6px;
      padding: 8px 10px;
      background: rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 8px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    `;

    const label = document.createElement('div');
    label.style.cssText = `
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 5px;
    `;
    label.textContent = 'AI BRIEFING';

    this.briefingTextEl = document.createElement('div');
    this.briefingTextEl.style.cssText = `
      font-size: 10px;
      color: var(--text-secondary);
      line-height: 1.5;
      font-family: monospace;
      min-height: 28px;
    `;
    this.briefingTextEl.textContent = '—';

    this.briefingTimeEl = document.createElement('div');
    this.briefingTimeEl.style.cssText = `
      font-size: 9px;
      color: var(--text-muted);
      margin-top: 4px;
      opacity: 0.6;
    `;
    this.briefingTimeEl.textContent = '';

    this.briefingContainerEl.appendChild(label);
    this.briefingContainerEl.appendChild(this.briefingTextEl);
    this.briefingContainerEl.appendChild(this.briefingTimeEl);
    this.briefingContainerEl.appendChild(this._buildStabilityBar());
    return this.briefingContainerEl;
  }

  private _buildStabilityBar(): HTMLElement {
    this.stabilityBarContainerEl = document.createElement('div');
    this.stabilityBarContainerEl.style.cssText = `
      display: none;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(255,255,255,0.07);
    `;

    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    `;

    const stabilityLabel = document.createElement('span');
    stabilityLabel.style.cssText = `
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
    `;
    stabilityLabel.textContent = 'STABILITÉ SYSTÉMIQUE';

    const stabilityValue = document.createElement('span');
    stabilityValue.style.cssText = `
      font-size: 8px;
      font-family: monospace;
      color: var(--text-muted);
    `;
    stabilityValue.className = 'stability-value';

    headerRow.appendChild(stabilityLabel);
    headerRow.appendChild(stabilityValue);

    const track = document.createElement('div');
    track.style.cssText = `
      height: 3px;
      background: rgba(255,255,255,0.08);
      border-radius: 2px;
      overflow: hidden;
    `;

    this.stabilityBarFillEl = document.createElement('div');
    this.stabilityBarFillEl.style.cssText = `
      height: 100%;
      width: 0%;
      border-radius: 2px;
      transition: width 0.6s ease;
    `;

    track.appendChild(this.stabilityBarFillEl);
    this.stabilityBarContainerEl.appendChild(headerRow);
    this.stabilityBarContainerEl.appendChild(track);
    return this.stabilityBarContainerEl;
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  update(result: NetworkBarometerResult): void {
    if (!this.el || !this.arcEl || !this.dotEl || !this.statusLabelEl || !this.scoreTextEl) return;

    const { score, status, details } = result;

    const color = status === 'nominal'  ? '#34c759'
                : status === 'degraded' ? '#ffcc00'
                :                         '#ff2d55';

    // Arc dashoffset: 0 = full circle (score=100), CIRCUMFERENCE = empty (score=0)
    const offset = CIRCUMFERENCE * (1 - score / 100);
    this.arcEl.setAttribute('stroke-dashoffset', String(offset));
    this.arcEl.setAttribute('stroke', color);

    this.scoreTextEl.textContent = String(score);

    this.dotEl.style.background = color;
    if (status === 'critical') {
      this.dotEl.classList.add('barometer-pulse');
    } else {
      this.dotEl.classList.remove('barometer-pulse');
    }

    this.statusLabelEl.textContent =
      status === 'nominal'  ? 'Nominal'  :
      status === 'degraded' ? 'Dégradé'  : 'Critique';
    this.statusLabelEl.style.color = color;

    this.currentDetails = details;
    this._refreshTooltip();
  }

  updateNuclear(state: NuclearState | null): void {
    if (!state || !state.stress) {
      this.currentNuclear = null;
      this._refreshTooltip();
      return;
    }

    if (!state.rteAvailable) {
      this.currentNuclear = {
        label: 'Indisponible',
        score: null,
        color: 'var(--text-muted)',
      };
      this._refreshTooltip();
      return;
    }

    const installed = state.stress.installedCapacityMW;
    const available = state.stress.availableCapacityMW;
    const ratio = installed > 0 ? available / installed : 0;
    const score = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    const color = score >= 85 ? '#34c759' : score >= 60 ? '#ffcc00' : '#ff2d55';
    const label =
      state.unconfirmedSignals.length > 0
        ? `${score} / 100 · écart REMIT`
        : state.stress.gridTensionRisk
          ? `${score} / 100 · sous tension`
          : `${score} / 100`;

    this.currentNuclear = { label, score, color };
    this._refreshTooltip();
  }

  updateEolien(live: EolienLive | null): void {
    this.currentEolienLive = live;
    this._refreshTooltip();
  }


  updateBriefing(result: ISNRSynthesisResult | null): void {
    if (!this.briefingTextEl || !this.briefingTimeEl || !this.stabilityBarContainerEl || !this.stabilityBarFillEl) return;

    if (!result || !result.briefing) {
      this.briefingTextEl.textContent = 'IA indisponible';
      this.briefingTextEl.style.color = 'var(--text-muted)';
      this.briefingTextEl.style.fontStyle = 'italic';
      this.briefingTimeEl.textContent = '';
      this.stabilityBarContainerEl.style.display = 'none';
      return;
    }

    this.briefingTextEl.textContent = result.briefing;
    this.briefingTextEl.style.color = 'var(--text-secondary)';
    this.briefingTextEl.style.fontStyle = 'normal';

    const mins = Math.round((Date.now() - result.computedAt.getTime()) / 60_000);
    const cacheLabel = result.fromCache ? ' · CACHE FIGÉ' : '';
    this.briefingTimeEl.textContent = `Llama · il y a ${mins} min${cacheLabel}`;

    // Stability bar
    if (result.stabilityImpact == null) {
      this.stabilityBarContainerEl.style.display = 'none';
      return;
    }

    this.stabilityBarContainerEl.style.display = 'block';

    const impact = result.stabilityImpact;
    const color = impact >= 70 ? '#ff2d55'
                : impact >= 40 ? '#ffcc00'
                :                '#34c759';

    this.stabilityBarFillEl.style.width = `${impact}%`;
    this.stabilityBarFillEl.style.background = color;

    if (impact > 60) {
      this.stabilityBarFillEl.classList.add('stability-shimmer');
    } else {
      this.stabilityBarFillEl.classList.remove('stability-shimmer');
    }

    const valueEl = this.stabilityBarContainerEl.querySelector('.stability-value') as HTMLElement | null;
    if (valueEl) {
      valueEl.textContent = `${impact}/100`;
      valueEl.style.color = color;
    }
  }

  private _renderTooltip(details: Record<string, number | null>): string {
    // Compute wind score directly from live data (avoids barometer cache lag)
    const eolien = this.currentEolienLive;
    const windScore: number | null = eolien
      ? (eolien.alertLevel === 'normal' ? 100 : eolien.alertLevel === 'watch' ? 70 : 40)
      : (details.wind ?? null);
    const windColor = windScore !== null
      ? (windScore >= 85 ? '#34c759' : windScore >= 60 ? '#ffcc00' : '#ff2d55')
      : 'var(--text-muted)';

    const rows: [string, number | null][] = [
      ['BGP / Internet',        details.bgp    ?? null],
      ['Électricité (Ecowatt)', details.elec   ?? null],
      ['Nucléaire (RTE)',       this.currentNuclear?.score ?? null],
      ['Éolien (éCO2mix)',      windScore],
      ['Telecom ARCEP',         details.telecom ?? null],
      ['Cloud / Web',           details.cloud  ?? null],
      ['Météo Spatiale',        details.space  ?? null],
      ['Cyber (CERT-FR)',       details.cyber  ?? null],
    ];

    const rowsHtml = rows.map(([label, val]) => {
      const isNuclear = label === 'Nucléaire (RTE)';
      const isWind    = label === 'Éolien (éCO2mix)';
      const display = isNuclear
        ? (this.currentNuclear?.label ?? '—')
        : val !== null ? `${val} / 100` : '—';
      const color = isNuclear
        ? (this.currentNuclear?.color ?? 'var(--text-muted)')
        : isWind
          ? windColor
          : val === null ? 'var(--text-muted)'
          : val >= 85 ? '#34c759'
          : val >= 60 ? '#ffcc00'
          : '#ff2d55';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:2px 0;">
          <span style="color:var(--text-secondary);">${label}</span>
          <span style="font-weight:600;color:${color};font-family:monospace;font-size:10px;">${display}</span>
        </div>`;
    }).join('');

    return `
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.06);">
        État Infrastructure France
      </div>
      ${rowsHtml}
    `;
  }

  private _refreshTooltip(): void {
    if (!this.tooltipEl || !this.currentDetails) {
      return;
    }

    this.tooltipEl.innerHTML = this._renderTooltip(this.currentDetails);
  }

  destroy(): void {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.arcEl = null;
    this.scoreTextEl = null;
    this.dotEl = null;
    this.statusLabelEl = null;
    this.tooltipEl = null;
    this.briefingContainerEl = null;
    this.briefingTextEl = null;
    this.briefingTimeEl = null;
    this.stabilityBarContainerEl = null;
    this.stabilityBarFillEl = null;
  }
}
