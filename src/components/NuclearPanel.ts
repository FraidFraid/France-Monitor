/**
 * NuclearPanel.ts — Panneau flottant Veille Nucléaire
 *
 * 4 onglets : STATUS · TIMELINE · REMIT · STRESS
 * Affiche clairement la qualité de la donnée (fraîcheur, disponibilité).
 */

import { Panel } from './Panel.ts';
import type { NuclearState, NuclearUnavailability } from '../types/index.ts';
import { NUCLEAR_STATUS_COLORS, NUCLEAR_REMIT_UNCONFIRMED_COLOR } from '../services/nuclear-rte.ts';

type ActiveTab = 'status' | 'timeline' | 'remit' | 'stress';

export class NuclearPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private activeTab: ActiveTab = 'status';
  private currentState: NuclearState | null = null;
  private onCloseCallback?: () => void;

  constructor(container: HTMLElement) {
    super(container, { title: 'Veille Nucléaire', icon: '⚛', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'nuclear-panel-modal';
    this.modalEl.style.cssText = `
      position: absolute;
      top: var(--right-panel-top, 70px);
      right: 20px;
      width: 400px;
      max-height: calc(100vh - var(--right-panel-top, 70px) - 20px);
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

    this.modalEl.innerHTML = `
      <div class="nuclear-panel-header" style="
        padding: 14px 16px 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      ">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">⚛</span>
          <span style="font-size:13px;font-weight:600;color:var(--text-primary);letter-spacing:0.05em;">
            VEILLE NUCLÉAIRE
          </span>
        </div>
        <button class="nuclear-panel-close" style="
          background:rgba(255,255,255,0.1);border:none;color:var(--text-muted);
          cursor:pointer;font-size:14px;width:28px;height:28px;border-radius:14px;
          display:flex;align-items:center;justify-content:center;
        ">✕</button>
      </div>
      <div class="nuclear-panel-tabs" style="
        display:flex;gap:4px;padding:10px 16px 0;flex-shrink:0;border-bottom:1px solid var(--border-color);
      ">
        ${(['status','timeline','remit','stress'] as ActiveTab[]).map(tab => `
          <button data-tab="${tab}" class="nuclear-tab-btn" style="
            background:none;border:none;cursor:pointer;
            padding:6px 10px;font-size:11px;font-weight:600;
            letter-spacing:0.06em;text-transform:uppercase;
            color:var(--text-muted);border-bottom:2px solid transparent;
            transition:color 0.15s,border-color 0.15s;
          ">${tab === 'status' ? 'STATUS' : tab === 'timeline' ? 'TIMELINE' : tab === 'remit' ? 'REMIT ⚑' : 'STRESS'}</button>
        `).join('')}
      </div>
      <div class="nuclear-panel-content" style="
        flex:1;overflow-y:auto;padding:12px 16px;min-height:0;
      "></div>
    `;

    this.contentEl = this.modalEl.querySelector('.nuclear-panel-content')!;

    // Close button
    this.modalEl.querySelector('.nuclear-panel-close')!.addEventListener('click', () => {
      this.hide();
      this.onCloseCallback?.();
    });

    // Tab buttons
    this.modalEl.querySelectorAll<HTMLButtonElement>('.nuclear-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset['tab'] as ActiveTab;
        this._syncTabStyles();
        this._renderContent();
      });
    });

    this.container.appendChild(this.modalEl);
    this._syncTabStyles();
  }

  setOnClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }

  show(state: NuclearState | null = null): void {
    if (state) this.currentState = state;
    if (this.modalEl) {
      this.modalEl.style.display = 'flex';
      this._renderContent();
    }
  }

  update(state: NuclearState): void {
    this.currentState = state;
    if (this.modalEl?.style.display !== 'none') {
      this._renderContent();
    }
  }

  hide(): void {
    if (this.modalEl) this.modalEl.style.display = 'none';
  }

  isVisible(): boolean {
    return this.modalEl?.style.display !== 'none';
  }

  destroy(): void {
    this.modalEl?.remove();
  }

  /** Required by abstract base — modal is built in mount(), nothing to do here. */
  protected render(): void { }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _syncTabStyles(): void {
    this.modalEl.querySelectorAll<HTMLButtonElement>('.nuclear-tab-btn').forEach((btn) => {
      const isActive = btn.dataset['tab'] === this.activeTab;
      btn.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
      btn.style.borderBottomColor = isActive ? '#8FC8E8' : 'transparent';
    });
  }

  private _renderContent(): void {
    if (!this.contentEl) return;
    const state = this.currentState;

    if (!state) {
      this.contentEl.innerHTML = this._renderUnavailable('Chargement…');
      return;
    }

    switch (this.activeTab) {
      case 'status':   this.contentEl.innerHTML = this._renderStatus(state);   break;
      case 'timeline': this.contentEl.innerHTML = this._renderTimeline(state); break;
      case 'remit':    this.contentEl.innerHTML = this._renderRemit(state);    break;
      case 'stress':   this.contentEl.innerHTML = this._renderStress(state);   break;
    }
  }

  // ── STATUS tab ──────────────────────────────────────────────────────────────

  private _renderStatus(state: NuclearState): string {
    if (!state.rteAvailable) {
      return this._renderUnavailable('API RTE indisponible — données non chargées.');
    }

    const freshnessBadge = this._freshnessBadge(state.stress?.freshness ?? 'unavailable');

    const byPlant = new Map<string, NuclearUnavailability[]>();
    for (const u of state.unavailabilities) {
      if (!byPlant.has(u.plantName)) byPlant.set(u.plantName, []);
      byPlant.get(u.plantName)!.push(u);
    }

    if (byPlant.size === 0) {
      return `
        ${freshnessBadge}
        <div style="color:var(--text-muted);font-size:12px;margin-top:8px;">
          Aucune indisponibilité active. Toutes les centrales disponibles.
        </div>`;
    }

    const cards = Array.from(byPlant.entries()).map(([plant, units]) => {
      const order = ['OUTAGE_UNPLANNED','OUTAGE_PLANNED','REDUCED','AVAILABLE','UNKNOWN'];
      const worstStatus = units.reduce<string>((worst, u) => {
        return order.indexOf(u.status) < order.indexOf(worst) ? u.status : worst;
      }, 'AVAILABLE');
      const color = (NUCLEAR_STATUS_COLORS as Record<string, string>)[worstStatus] ?? '#6B7280';
      const totalNominal   = units.reduce((s, u) => s + u.nominalPowerMW, 0);
      const totalAvailable = units.reduce((s, u) => s + u.availablePowerMW, 0);
      return `
        <div style="
          background:rgba(255,255,255,0.04);border-radius:8px;
          padding:10px 12px;margin-bottom:8px;border-left:3px solid ${color};
        ">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;font-weight:600;color:var(--text-primary);">${plant}</span>
            <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${color}22;color:${color};font-weight:700;">
              ${worstStatus.replace('_', ' ')}
            </span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
            ${totalAvailable.toLocaleString('fr-FR')} / ${totalNominal.toLocaleString('fr-FR')} MW disponibles
            · ${units.length} tranche${units.length > 1 ? 's' : ''} en indisponibilité
          </div>
        </div>`;
    });

    return `${freshnessBadge}<div style="margin-top:8px;">${cards.join('')}</div>`;
  }

  // ── TIMELINE tab ────────────────────────────────────────────────────────────

  private _renderTimeline(state: NuclearState): string {
    if (!state.rteAvailable) return this._renderUnavailable('API RTE indisponible.');

    const now = new Date();
    const sorted = [...state.unavailabilities].sort(
      (a, b) => a.startDate.getTime() - b.startDate.getTime(),
    );

    if (sorted.length === 0) {
      return `
        ${this._freshnessBadge(state.stress?.freshness ?? 'unavailable')}
        <div style="color:var(--text-muted);font-size:12px;margin-top:8px;">
          Aucune indisponibilité planifiée.
        </div>`;
    }

    const rows = sorted.map((u) => {
      const isActive = u.startDate <= now && (u.endDate === null || u.endDate >= now);
      const color = (NUCLEAR_STATUS_COLORS as Record<string, string>)[u.status] ?? '#6B7280';
      const endStr = u.endDate ? fmtDate(u.endDate) : 'Indéterminée';
      return `
        <div style="
          display:grid;grid-template-columns:1fr auto;gap:4px;
          padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);
          opacity:${isActive ? 1 : 0.7};
        ">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text-primary);">${u.unitName}</div>
            <div style="font-size:10px;color:var(--text-muted);">
              ${fmtDate(u.startDate)} → ${endStr}
            </div>
            <div style="font-size:10px;color:var(--text-muted);">
              ${u.availablePowerMW} / ${u.nominalPowerMW} MW · ${u.type}
            </div>
          </div>
          <span style="
            font-size:9px;padding:2px 6px;border-radius:8px;height:fit-content;
            background:${color}22;color:${color};font-weight:700;white-space:nowrap;align-self:start;
          ">${isActive ? '● EN COURS' : '◌ PLANIFIÉ'}</span>
        </div>`;
    });

    return `${this._freshnessBadge(state.stress?.freshness ?? 'unavailable')}
      <div style="margin-top:8px;">${rows.join('')}</div>`;
  }

  // ── REMIT tab ───────────────────────────────────────────────────────────────

  private _renderRemit(state: NuclearState): string {
    if (!state.remitAvailable) return this._renderUnavailable('Flux IIP RTE indisponible.');

    const freshnessBadge = this._freshnessBadge('quasi-realtime');

    if (state.unconfirmedSignals.length === 0 && state.remitSignals.length === 0) {
      return `${freshnessBadge}
        <div style="color:var(--text-muted);font-size:12px;margin-top:8px;">
          Aucun signal REMIT nucléaire détecté.
        </div>`;
    }

    const unconfirmed = state.unconfirmedSignals.map(({ remitSignal: s, confidence }) => `
      <div style="
        background:rgba(17,24,39,0.8);border-radius:8px;padding:10px 12px;
        margin-bottom:8px;border-left:3px solid ${NUCLEAR_REMIT_UNCONFIRMED_COLOR};
      ">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <span style="font-size:11px;font-weight:600;color:var(--text-primary);line-height:1.4;">${s.title.slice(0, 80)}${s.title.length > 80 ? '…' : ''}</span>
          <span style="font-size:9px;padding:2px 6px;border-radius:8px;background:#11182722;
            color:#9CA3AF;font-weight:700;white-space:nowrap;flex-shrink:0;">NON CONFIRMÉ RTE</span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">
          ${s.plantName} · ${s.classifiedAs.replace('_', ' ')}
          ${s.capacityMW ? ` · ${s.capacityMW} MW` : ''}
          · confiance ${Math.round(confidence * 100)}%
        </div>
        <div style="font-size:10px;color:var(--text-muted);">${fmtDate(s.publishedAt)}</div>
      </div>`);

    const confirmed = state.remitSignals
      .filter((s) => s.confirmedByRTE)
      .map((s) => `
        <div style="
          background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 12px;
          margin-bottom:6px;border-left:3px solid #374151;
        ">
          <div style="font-size:11px;color:var(--text-primary);">${s.title.slice(0, 80)}${s.title.length > 80 ? '…' : ''}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
            ${s.plantName} · ${s.classifiedAs.replace('_', ' ')} · <span style="color:#6EE7B7;">✓ confirmé RTE</span>
          </div>
        </div>`);

    return `
      ${freshnessBadge}
      ${unconfirmed.length > 0 ? `
        <div style="font-size:10px;font-weight:700;color:#9CA3AF;letter-spacing:0.08em;
          text-transform:uppercase;margin:10px 0 6px;">
          Signal REMIT détecté · Non reflété RTE (${unconfirmed.length})
        </div>
        ${unconfirmed.join('')}` : ''}
      ${confirmed.length > 0 ? `
        <div style="font-size:10px;font-weight:700;color:#9CA3AF;letter-spacing:0.08em;
          text-transform:uppercase;margin:10px 0 6px;">
          Confirmés dans RTE (${confirmed.length})
        </div>
        ${confirmed.join('')}` : ''}`;
  }

  // ── STRESS tab ──────────────────────────────────────────────────────────────

  private _renderStress(state: NuclearState): string {
    const stress = state.stress;
    if (!stress) return this._renderUnavailable('Score de tension non calculé.');

    const levelColor =
      stress.level === 'CRITIQUE' ? '#E74C3C'
      : stress.level === 'TENSION' ? '#F59E0B'
      : '#2ECC71';

    const pct = Math.round(stress.stressRatio * 100);
    const gaugeWidth = Math.min(100, pct);

    return `
      ${this._freshnessBadge(stress.freshness)}
      <div style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:12px;font-weight:600;color:var(--text-primary);">Score tension nucléaire</span>
          <span style="font-size:13px;font-weight:700;color:${levelColor};">${pct}%</span>
        </div>
        <div style="background:rgba(255,255,255,0.1);border-radius:4px;height:8px;overflow:hidden;">
          <div style="
            width:${gaugeWidth}%;height:100%;
            background:${levelColor};border-radius:4px;
            transition:width 0.4s ease;
          "></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;">
          <span style="font-size:10px;color:var(--text-muted);">Normal</span>
          <span style="font-size:10px;color:var(--text-muted);">Tension (10%)</span>
          <span style="font-size:10px;color:var(--text-muted);">Critique (25%)</span>
        </div>
      </div>

      <div style="
        margin-top:12px;padding:10px 12px;border-radius:8px;
        background:${levelColor}15;border:1px solid ${levelColor}40;
      ">
        <div style="font-size:13px;font-weight:700;color:${levelColor};">NIVEAU : ${stress.level}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
          ${stress.availableCapacityMW.toLocaleString('fr-FR')} MW disponibles
          / ${stress.installedCapacityMW.toLocaleString('fr-FR')} MW installés
        </div>
      </div>

      ${stress.gridTensionRisk ? `
        <div style="
          margin-top:10px;padding:8px 12px;border-radius:8px;
          background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);
        ">
          <div style="font-size:11px;font-weight:700;color:#EF4444;">⚡ GRID_TENSION_RISK</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
            Production nucléaire &lt; 35% du mix national · heuristique produit v1
          </div>
        </div>` : ''}

      <div style="margin-top:12px;font-size:10px;color:var(--text-muted);">
        Mise à jour : ${fmtDate(stress.updatedAt)}
      </div>`;
  }

  // ── Shared helpers ───────────────────────────────────────────────────────────

  private _renderUnavailable(msg: string): string {
    return `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        min-height:80px;gap:6px;
      ">
        <span style="font-size:20px;opacity:0.4;">⚛</span>
        <span style="font-size:12px;color:var(--text-muted);text-align:center;">${msg}</span>
        <span style="
          font-size:9px;padding:2px 8px;border-radius:8px;
          background:rgba(107,114,128,0.2);color:#6B7280;font-weight:700;
        ">INDISPONIBLE</span>
      </div>`;
  }

  private _freshnessBadge(freshness: string): string {
    const label =
      freshness === 'quasi-realtime' ? 'QUASI TEMPS RÉEL'
      : freshness === 'stale' ? 'HISTORIQUE'
      : 'INDISPONIBLE';
    const color =
      freshness === 'quasi-realtime' ? '#2ECC71'
      : freshness === 'stale' ? '#F59E0B'
      : '#6B7280';
    return `<span style="
      font-size:9px;padding:2px 8px;border-radius:8px;
      background:${color}22;color:${color};font-weight:700;
    ">${label}</span>`;
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
