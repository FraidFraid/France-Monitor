/**
 * BarometerWidget.ts — Baromètre Pannes Réseau France
 *
 * Premier élément de la colonne gauche (sidebar), avant les couches.
 * Affiche un score 0-100 sous forme d'arc SVG + détail au survol.
 */

import type { NetworkBarometerResult } from '../services/network-barometer.ts';
import type { ISNRSynthesisResult } from '../services/isnr-synthesis.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIUS = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export class BarometerWidget {
  private container: HTMLElement;
  private el: HTMLElement | null = null;
  private arcEl: SVGCircleElement | null = null;
  private scoreTextEl: SVGTextElement | null = null;
  private dotEl: HTMLElement | null = null;
  private statusLabelEl: HTMLElement | null = null;
  private tooltipEl: HTMLElement | null = null;
  private briefingContainerEl: HTMLElement | null = null;
  private briefingTextEl: HTMLElement | null = null;
  private briefingTimeEl: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.el = document.createElement('div');
    this.el.id = 'network-barometer-widget';
    this.el.style.cssText = `
      position: relative;
      width: 100%;
      box-sizing: border-box;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px 10px 10px;
      background: var(--bg-surface);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      cursor: default;
      user-select: none;
      font-family: system-ui, sans-serif;
    `;

    this.el.appendChild(this._buildArc());
    this.el.appendChild(this._buildLabels());
    this.el.appendChild(this._buildTooltip());
    this.el.appendChild(this._buildBriefing());

    this.el.addEventListener('mouseenter', this._onMouseEnter);
    this.el.addEventListener('mouseleave', this._onMouseLeave);

    this.container.appendChild(this.el);
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
      display: none;
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      background: var(--bg-surface);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      padding: 10px 14px;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      z-index: 901;
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
    return this.briefingContainerEl;
  }

  // ── Event handlers (stored as fields for removeEventListener) ────────────────

  private _onMouseEnter = (): void => {
    if (this.tooltipEl) this.tooltipEl.style.display = 'block';
  };

  private _onMouseLeave = (): void => {
    if (this.tooltipEl) this.tooltipEl.style.display = 'none';
  };

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

    if (this.tooltipEl) {
      this.tooltipEl.innerHTML = this._renderTooltip(details);
    }
  }

  updateBriefing(result: ISNRSynthesisResult | null): void {
    if (!this.briefingTextEl || !this.briefingTimeEl) return;

    if (!result || !result.briefing) {
      this.briefingTextEl.textContent = 'IA indisponible';
      this.briefingTextEl.style.color = 'var(--text-muted)';
      this.briefingTextEl.style.fontStyle = 'italic';
      this.briefingTimeEl.textContent = '';
      return;
    }

    this.briefingTextEl.textContent = result.briefing;
    this.briefingTextEl.style.color = 'var(--text-secondary)';
    this.briefingTextEl.style.fontStyle = 'normal';

    const mins = Math.round((Date.now() - result.computedAt.getTime()) / 60_000);
    const cacheLabel = result.fromCache ? ' · cache' : '';
    this.briefingTimeEl.textContent = `Llama · il y a ${mins} min${cacheLabel}`;
  }

  private _renderTooltip(details: Record<string, number | null>): string {
    const rows: [string, number | null][] = [
      ['BGP / Internet',   details.bgp    ?? null],
      ['Électricité',      details.elec   ?? null],
      ['Telecom ARCEP',    details.telecom ?? null],
      ['Météo Spatiale',   details.space  ?? null],
      ['Cyber (CERT-FR)',  details.cyber  ?? null],
    ];

    const rowsHtml = rows.map(([label, val]) => {
      const display = val !== null ? `${val} / 100` : '—';
      const color = val === null ? 'var(--text-muted)'
        : val >= 85 ? '#34c759'
        : val >= 60 ? '#ffcc00'
        : '#ff2d55';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:2px 0;">
          <span style="color:var(--text-secondary);">${label}</span>
          <span style="font-weight:600;color:${color};font-family:monospace;">${display}</span>
        </div>`;
    }).join('');

    return `
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.06);">
        État Infrastructure France
      </div>
      ${rowsHtml}
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);opacity:0.4;display:flex;justify-content:space-between;gap:8px;">
        <span>Cloud / Web</span>
        <span style="font-style:italic;">N/A (intégration en cours)</span>
      </div>
    `;
  }

  destroy(): void {
    if (!this.el) return;
    this.el.removeEventListener('mouseenter', this._onMouseEnter);
    this.el.removeEventListener('mouseleave', this._onMouseLeave);
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
  }
}
