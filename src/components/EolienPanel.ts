import { Panel } from './Panel.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import type { EolienLive, EolienParkSummary } from '../services/eolien/types.ts';
import { DATA_FRESHNESS_LABELS } from '../types/index.ts';
import { renderTruthBadge } from './shared/truthBadge.ts';

const EOLIEN_PANEL_COLORS = {
  cyan: '#38BDF8',
  cyanSoft: 'rgba(56, 189, 248, 0.16)',
  teal: '#14B8A6',
  tealSoft: 'rgba(20, 184, 166, 0.15)',
  slate: '#94A3B8',
  slateSoft: 'rgba(148, 163, 184, 0.14)',
  amber: '#F59E0B',
  amberSoft: 'rgba(245, 158, 11, 0.15)',
  red: '#EF4444',
  redSoft: 'rgba(239, 68, 68, 0.15)',
  text: '#E8EEF9',
  muted: '#94A3B8',
} as const;

function fmtGw(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/d';
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: value < 10 ? 1 : 0, maximumFractionDigits: value < 10 ? 1 : 0 })} GW`;
}

function fmtMw(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return 'n/d';
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: value < 100 ? 1 : 0 })} MW`;
}

function statusLabel(live: EolienLive): string {
  if (live.alertLevel === 'low-production') return 'Production faible';
  if (live.alertLevel === 'watch') return 'Vent modéré';
  return 'Régime nominal';
}

function statusColor(live: EolienLive): string {
  if (live.alertLevel === 'low-production') return EOLIEN_PANEL_COLORS.red;
  if (live.alertLevel === 'watch') return EOLIEN_PANEL_COLORS.amber;
  return EOLIEN_PANEL_COLORS.cyan;
}

function parkKindLabel(kind: EolienParkSummary['kind']): string {
  if (kind === 'offshore') return 'mer';
  if (kind === 'onshore') return 'terre';
  return 'mixte';
}

export class EolienPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private onClose?: () => void;
  private onSelectPark?: (park: EolienParkSummary) => void;

  constructor(container: HTMLElement) {
    super(container, { title: 'Veille Éolienne', icon: '🌬️', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'eolien-panel-modal';
    this.modalEl.style.cssText = `
      position: absolute;
      top: var(--right-panel-top);
      right: 20px;
      width: 400px;
      max-height: calc(100vh - var(--right-panel-top) - 20px);
      background: linear-gradient(180deg, rgba(7, 18, 31, 0.97), rgba(7, 15, 26, 0.96));
      border: 1px solid rgba(56, 189, 248, 0.22);
      border-radius: 14px;
      box-shadow: 0 12px 34px rgba(2, 6, 23, 0.52);
      z-index: 1000;
      display: none;
      flex-direction: column;
      backdrop-filter: blur(12px);
      overflow: hidden;
    `;

    this.modalEl.innerHTML = `
      <button class="eolien-panel-close" style="
        position:absolute;top:12px;right:12px;background:rgba(255,255,255,0.08);
        border:none;color:${EOLIEN_PANEL_COLORS.muted};cursor:pointer;font-size:14px;width:28px;height:28px;
        border-radius:14px;display:flex;align-items:center;justify-content:center;z-index:10;
      ">✕</button>
      <div style="
        padding:18px 16px 14px;border-bottom:1px solid rgba(255,255,255,0.06);
        display:flex;align-items:center;gap:14px;
        background:linear-gradient(135deg, rgba(8,145,178,0.22), rgba(20,184,166,0.10));
      ">
        <div style="position:relative;width:68px;height:68px;">
          <svg viewBox="0 0 36 36" style="width:68px;height:68px;transform:rotate(-90deg);">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"></circle>
            <circle id="eolien-ring-progress" cx="18" cy="18" r="15.9" fill="none" stroke="${EOLIEN_PANEL_COLORS.cyan}" stroke-width="3"
              stroke-dasharray="0 100" stroke-linecap="round" style="transition:stroke-dasharray 0.5s ease,stroke 0.3s ease;"></circle>
          </svg>
          <div id="eolien-ring-score" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:${EOLIEN_PANEL_COLORS.text};">--</div>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:700;color:${EOLIEN_PANEL_COLORS.text};">Backbone énergétique - Éolien</div>
          <div id="eolien-status-label" style="margin-top:2px;font-size:11px;color:${EOLIEN_PANEL_COLORS.cyan};">Production live France</div>
          <div id="eolien-update-time" style="margin-top:5px;font-size:10px;color:${EOLIEN_PANEL_COLORS.muted};"></div>
          <div id="eolien-truth-badge" style="margin-top:4px;"></div>
        </div>
      </div>
    `;

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'eolien-panel-content';
    this.contentEl.style.cssText = `
      padding: 12px;
      overflow-y: auto;
      flex: 1;
      color: ${EOLIEN_PANEL_COLORS.text};
    `;
    this.modalEl.appendChild(this.contentEl);
    this.container.appendChild(this.modalEl);

    this.modalEl.querySelector('.eolien-panel-close')?.addEventListener('click', () => this.hide());
    this.render();
  }

  protected render(): void {}

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  setOnSelectPark(handler: (park: EolienParkSummary) => void): void {
    this.onSelectPark = handler;
  }

  show(live: EolienLive | null, parks: EolienParkSummary[]): void {
    this.modalEl.style.display = 'flex';
    this.update(live, parks);
  }

  update(live: EolienLive | null, parks: EolienParkSummary[]): void {
    if (!this.isVisible()) return;
    if (!live) {
      this.showLoadingState();
      const truthBadge = this.modalEl.querySelector('#eolien-truth-badge') as HTMLElement | null;
      if (truthBadge) truthBadge.innerHTML = renderTruthBadge('INDISPONIBLE', '#EF4444');
      return;
    }
    this.updateHeader(live);
    this.renderContent(live, parks);
  }

  hide(): void {
    this.modalEl.style.display = 'none';
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }

  private showLoadingState(): void {
    if (!this.contentEl) return;
    this.contentEl.innerHTML = fmLoaderHTML({ text: 'Chargement du suivi éolien France…' });
  }

  showErrorState(message: string): void {
    if (!this.contentEl) return;
    this.contentEl.innerHTML = `
      <div style="text-align:center;padding:24px 16px;">
        <div style="font-size:24px;margin-bottom:10px;">⚠️</div>
        <div style="font-size:12px;color:${EOLIEN_PANEL_COLORS.red};font-weight:700;">Échec du chargement éolien</div>
        <div style="margin-top:8px;font-size:11px;color:${EOLIEN_PANEL_COLORS.muted};">${message}</div>
      </div>
    `;
  }

  private updateHeader(live: EolienLive): void {
    const ring = this.modalEl.querySelector('#eolien-ring-progress') as SVGCircleElement | null;
    const scoreEl = this.modalEl.querySelector('#eolien-ring-score') as HTMLElement | null;
    const statusEl = this.modalEl.querySelector('#eolien-status-label') as HTMLElement | null;
    const updateEl = this.modalEl.querySelector('#eolien-update-time') as HTMLElement | null;

    const ratio = Math.round(live.facteur_charge * 100);
    const color = statusColor(live);

    if (ring) {
      ring.style.strokeDasharray = `${ratio} 100`;
      ring.style.stroke = color;
    }
    if (scoreEl) scoreEl.textContent = `${ratio}%`;
    if (statusEl) {
      const split = live.terre_mer_split
        ? ` · terre ${fmtGw(live.terre_mer_split.terre)} · mer ${fmtGw(live.terre_mer_split.mer)}`
        : '';
      statusEl.textContent = `${statusLabel(live)}${split}`;
      statusEl.style.color = color;
    }
    if (updateEl) {
      updateEl.textContent = `Mise à jour: ${live.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    }

    const truthBadge = this.modalEl.querySelector('#eolien-truth-badge') as HTMLElement | null;
    if (truthBadge) {
      const ageMs = Date.now() - live.timestamp.getTime();
      if (ageMs < 30 * 60 * 1000) {
        truthBadge.innerHTML = renderTruthBadge(DATA_FRESHNESS_LABELS.TEMPS_REEL, '#34D399');
      } else if (ageMs < 2 * 3600 * 1000) {
        truthBadge.innerHTML = renderTruthBadge('CACHE FIGÉ', '#F59E0B');
      } else {
        truthBadge.innerHTML = renderTruthBadge('INDISPONIBLE', '#EF4444');
      }
    }
  }

  private renderContent(live: EolienLive, parks: EolienParkSummary[]): void {
    if (!this.contentEl) return;

    const watchlist = parks
      .slice()
      .sort((a, b) => (b.estimatedProductionMw ?? 0) - (a.estimatedProductionMw ?? 0) || (b.capacityMw ?? 0) - (a.capacityMw ?? 0))
      .slice(0, 12);

    const onshoreCount = parks.filter((park) => park.kind === 'onshore').length;
    const offshoreCount = parks.filter((park) => park.kind === 'offshore').length;

    this.contentEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px;">
        ${this.renderMetricCard('Live', fmtGw(live.production), 'prod. nationale', EOLIEN_PANEL_COLORS.cyanSoft, EOLIEN_PANEL_COLORS.cyan)}
        ${this.renderMetricCard('Installé', fmtGw(live.puissance_installee), 'capacité', EOLIEN_PANEL_COLORS.tealSoft, EOLIEN_PANEL_COLORS.teal)}
        ${this.renderMetricCard('Facteur', `${Math.round(live.facteur_charge * 100)}%`, 'charge vent', EOLIEN_PANEL_COLORS.slateSoft, EOLIEN_PANEL_COLORS.text)}
        ${this.renderMetricCard('Parcs', `${live.parcs_actifs}`, 'actifs', live.alertLevel === 'low-production' ? EOLIEN_PANEL_COLORS.redSoft : EOLIEN_PANEL_COLORS.amberSoft, live.alertLevel === 'low-production' ? EOLIEN_PANEL_COLORS.red : EOLIEN_PANEL_COLORS.amber)}
      </div>

      <div style="background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div>
            <div style="font-size:12px;font-weight:700;color:${EOLIEN_PANEL_COLORS.text};">Signal live</div>
            <div style="margin-top:6px;font-size:11px;line-height:1.5;color:${EOLIEN_PANEL_COLORS.muted};">
              Éco2mix temps réel pour la production nationale. Les parcs restent un référentiel cartographique.
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px;font-weight:700;color:${statusColor(live)};">${statusLabel(live)}</div>
            <div style="font-size:10px;color:${EOLIEN_PANEL_COLORS.muted};">alerte &lt; 3 GW national</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px;">
          ${this.renderMiniStat('Terrestre', `${onshoreCount}`, EOLIEN_PANEL_COLORS.cyan)}
          ${this.renderMiniStat('En mer', `${offshoreCount}`, EOLIEN_PANEL_COLORS.teal)}
          ${this.renderMiniStat('Actifs', `${live.parcs_actifs}`, EOLIEN_PANEL_COLORS.text)}
        </div>
        ${live.terre_mer_split ? `
          <div style="margin-top:10px;display:flex;justify-content:space-between;font-size:11px;color:${EOLIEN_PANEL_COLORS.muted};">
            <span>Répartition estimée</span>
            <strong style="color:${EOLIEN_PANEL_COLORS.text};">${fmtGw(live.terre_mer_split.terre)} terre · ${fmtGw(live.terre_mer_split.mer)} mer</strong>
          </div>
        ` : ''}
      </div>

      <div style="background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div style="font-size:12px;font-weight:700;color:${EOLIEN_PANEL_COLORS.text};">Watchlist éolien</div>
          <div style="font-size:10px;color:${EOLIEN_PANEL_COLORS.muted};">clic = recentrer carte</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${watchlist.map((park) => this.renderParkRow(park)).join('') || `<div style="font-size:11px;color:${EOLIEN_PANEL_COLORS.muted};">Référentiel cartographique non chargé.</div>`}
        </div>
      </div>
    `;

    this.bindParkHandlers(parks);
  }

  private renderMetricCard(label: string, value: string, detail: string, bg: string, color: string): string {
    return `
      <div style="background:${bg};border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px 8px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:${EOLIEN_PANEL_COLORS.muted};">${label}</div>
        <div style="margin-top:4px;font-size:17px;font-weight:700;color:${color};">${value}</div>
        <div style="margin-top:2px;font-size:10px;color:${EOLIEN_PANEL_COLORS.muted};">${detail}</div>
      </div>
    `;
  }

  private renderMiniStat(label: string, value: string, color: string): string {
    return `
      <div style="padding:8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:10px;color:${EOLIEN_PANEL_COLORS.muted};">${label}</div>
        <div style="margin-top:4px;font-size:15px;font-weight:700;color:${color};">${value}</div>
      </div>
    `;
  }

  private renderParkRow(park: EolienParkSummary): string {
    const accent = park.kind === 'offshore' ? EOLIEN_PANEL_COLORS.teal : EOLIEN_PANEL_COLORS.cyan;
    return `
      <button type="button" data-eolien-park="${park.id}" style="all:unset;cursor:pointer;display:block;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px;transition:background 0.2s ease,border-color 0.2s ease;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
          <div style="min-width:0;">
            <div style="font-size:12px;font-weight:700;color:${EOLIEN_PANEL_COLORS.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${park.name}</div>
            <div style="margin-top:2px;font-size:10px;color:${EOLIEN_PANEL_COLORS.muted};">
              ${park.region ?? 'France'}${park.commune ? ` · ${park.commune}` : ''} · ${parkKindLabel(park.kind)}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px;font-weight:700;color:${accent};">${fmtMw(park.estimatedProductionMw)}</div>
            <div style="font-size:10px;color:${EOLIEN_PANEL_COLORS.muted};">estimé</div>
          </div>
        </div>
        <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="font-size:10px;color:${EOLIEN_PANEL_COLORS.muted};">${fmtMw(park.capacityMw)} installés</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <span style="padding:2px 6px;border-radius:999px;background:${accent}22;color:${accent};font-size:9px;font-weight:700;text-transform:uppercase;">${parkKindLabel(park.kind)}</span>
            <span style="padding:2px 6px;border-radius:999px;background:rgba(255,255,255,0.05);color:${EOLIEN_PANEL_COLORS.slate};font-size:9px;text-transform:uppercase;">${park.status}</span>
          </div>
        </div>
      </button>
    `;
  }

  private bindParkHandlers(parks: EolienParkSummary[]): void {
    if (!this.contentEl || !this.onSelectPark) return;
    const parkMap = new Map(parks.map((park) => [park.id, park]));
    this.contentEl.querySelectorAll<HTMLElement>('[data-eolien-park]').forEach((element) => {
      element.addEventListener('click', () => {
        const parkId = element.dataset.eolienPark;
        if (!parkId) return;
        const park = parkMap.get(parkId);
        if (park) this.onSelectPark?.(park);
      });
      element.addEventListener('mouseenter', () => {
        element.style.background = 'rgba(56,189,248,0.10)';
        element.style.borderColor = 'rgba(56,189,248,0.28)';
      });
      element.addEventListener('mouseleave', () => {
        element.style.background = 'rgba(255,255,255,0.03)';
        element.style.borderColor = 'rgba(255,255,255,0.06)';
      });
    });
  }
}
