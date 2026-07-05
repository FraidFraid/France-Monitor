/**
 * NuclearPanel.ts — Panneau flottant Veille Nucléaire
 *
 * 4 onglets : STATUS · TIMELINE · REMIT · STRESS
 * Affiche clairement la qualité de la donnée (fraîcheur, disponibilité).
 */

import { Panel } from './Panel.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import {
  applyPremiumCloseButtonHover,
  createPremiumIconHeader,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';
import type {
  EcowattResponse,
  NuclearState,
  NuclearUnavailability,
  NuclearUnitReference,
  ReactorAvailabilityStatus,
} from '../types/index.ts';
import { DATA_FRESHNESS_LABELS } from '../types/index.ts';
import { fmIcon, fmStatusDot } from './shared/icons.ts';
import { NUCLEAR_STATUS_COLORS, NUCLEAR_REMIT_UNCONFIRMED_COLOR } from '../services/nuclear-rte.ts';
import {
  NUCLEAR_FLEET_INSTALLED_CAPACITY_MW,
  NUCLEAR_PLANTS,
  NUCLEAR_UNIT_COUNT,
  NUCLEAR_UNITS,
} from '../config/infrastructure.ts';

type ActiveTab = 'status' | 'timeline' | 'remit' | 'stress';
type FleetUnitStatus = {
  ref: NuclearUnitReference;
  nominalPowerMW: number;
  availablePowerMW: number;
  status: ReactorAvailabilityStatus;
  currentSignals: NuclearUnavailability[];
  nextSignal: NuclearUnavailability | null;
};

export class NuclearPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private activeTab: ActiveTab = 'status';
  private currentState: NuclearState | null = null;
  private currentEcowatt: EcowattResponse | null = null;
  private onCloseCallback?: () => void;
  private onPlantHoverCallback?: (plantName: string | null) => void;
  private hoveredPlantName: string | null = null;

  constructor(container: HTMLElement) {
    super(container, { title: 'Veille Nucléaire', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'nuclear-panel-modal';
    this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
        width: '400px',
        maxHeight: 'calc(100vh - var(--right-panel-top, 70px) - 20px)',
        backgroundStart: 'rgba(12, 18, 32, 0.97)',
        backgroundEnd: 'rgba(12, 15, 25, 0.96)',
        borderColor: 'rgba(143, 200, 232, 0.18)',
        top: 'var(--right-panel-top, 70px)',
      })}
    `;

    const closeBtn = this.createCloseButton(() => {
      this.hide();
      this.onCloseCallback?.();
    });
    closeBtn.classList.add('nuclear-panel-close');
    closeBtn.style.cssText = getPremiumCloseButtonStyle();
    applyPremiumCloseButtonHover(closeBtn);
    this.modalEl.appendChild(closeBtn);

    const header = createPremiumIconHeader({
      icon: fmIcon('atom', { size: 30 }),
      title: 'Veille Nucléaire',
      subtitle: 'Parc EDF · disponibilité · stress système',
      gradientStart: 'rgba(143, 200, 232, 0.16)',
      gradientEnd: 'rgba(59, 130, 246, 0.10)',
      iconGradientStart: 'rgba(143, 200, 232, 0.22)',
      iconGradientEnd: 'rgba(59, 130, 246, 0.14)',
      titlePrefix: 'Backbone énergétique',
    });
    header.className = 'nuclear-panel-header';
    header.style.flexShrink = '0';
    this.modalEl.appendChild(header);

    const tabs = document.createElement('div');
    tabs.className = 'nuclear-panel-tabs';
    tabs.style.cssText = `
      display:flex;gap:4px;padding:10px 16px 0;flex-shrink:0;border-bottom:1px solid var(--border-color);
    `;
    tabs.innerHTML = `
        ${(['status','timeline','remit','stress'] as ActiveTab[]).map(tab => `
          <button data-tab="${tab}" class="nuclear-tab-btn" style="
            background:none;border:none;cursor:pointer;
            padding:6px 10px;font-size:11px;font-weight:600;
            letter-spacing:0.06em;text-transform:uppercase;
            color:var(--text-muted);border-bottom:2px solid transparent;
            transition:color 0.15s,border-color 0.15s;
          ">${tab === 'status' ? 'STATUS' : tab === 'timeline' ? 'TIMELINE' : tab === 'remit' ? `REMIT ${fmIcon('flag', { size: 10 })}` : 'STRESS'}</button>
        `).join('')}
    `;
    this.modalEl.appendChild(tabs);

    const content = document.createElement('div');
    content.className = 'nuclear-panel-content';
    content.style.cssText = `
      flex:1;overflow-y:auto;padding:12px 16px;min-height:0;
    `;
    this.modalEl.appendChild(content);

    this.contentEl = this.modalEl.querySelector('.nuclear-panel-content')!;

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

  setOnPlantHover(cb: (plantName: string | null) => void): void {
    this.onPlantHoverCallback = cb;
  }

  show(state: NuclearState | null = null, ecowatt: EcowattResponse | null = null): void {
    if (state) this.currentState = state;
    if (ecowatt !== null) this.currentEcowatt = ecowatt;
    if (this.modalEl) {
      this.modalEl.style.display = 'flex';
      this._renderContent();
    }
  }

  update(state: NuclearState, ecowatt: EcowattResponse | null = this.currentEcowatt): void {
    this.currentState = state;
    this.currentEcowatt = ecowatt;
    if (this.modalEl?.style.display !== 'none') {
      this._renderContent();
    }
  }

  hide(): void {
    if (this.modalEl) this.modalEl.style.display = 'none';
    this._emitPlantHover(null);
    this.onCloseCallback?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }

  destroy(): void {
    this._emitPlantHover(null);
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

    if (this.activeTab === 'status') {
      this._bindStatusHover();
    } else {
      this._emitPlantHover(null);
    }
  }

  // ── STATUS tab ──────────────────────────────────────────────────────────────

  private _renderStatus(state: NuclearState): string {
    if (!state.rteAvailable) {
      return this._renderUnavailable('API RTE indisponible — données non chargées.');
    }

    const freshnessBadge = this._freshnessBadge(state.stress?.freshness ?? 'unavailable');
    const fleet = buildFleetSnapshot(state.unavailabilities);
    const availabilityRatio = NUCLEAR_FLEET_INSTALLED_CAPACITY_MW > 0
      ? fleet.totalAvailableMW / NUCLEAR_FLEET_INSTALLED_CAPACITY_MW
      : 0;
    const donutColor =
      availabilityRatio >= 0.85 ? '#2ECC71'
      : availabilityRatio >= 0.70 ? '#F59E0B'
      : '#E74C3C';
    const donutDeg = Math.max(0, Math.min(360, availabilityRatio * 360));
    const currentProductionMW = this.currentEcowatt?.national?.nuclear ?? null;
    const productionUpdatedAt = this.currentEcowatt?.national?.timestamp ?? null;

    const plantCards = NUCLEAR_PLANTS
      .filter((plant) => plant.status !== 'shutdown')
      .map((plant) => {
        const units = fleet.units
          .filter((unit) => normalizePlantKey(unit.ref.plantName) === normalizePlantKey(plant.name))
          .sort((a, b) => a.ref.unitName.localeCompare(b.ref.unitName, 'fr-FR'));

        const plantSummary = summarizePlantUnits(units);
        const siteColor = NUCLEAR_STATUS_COLORS[plantSummary.worstStatus];

        const unitsHtml = units.length > 0
          ? units.map((unit) => {
            const unitColor = NUCLEAR_STATUS_COLORS[unit.status] ?? '#6B7280';
            const nextInfo = unit.nextSignal
              ? `<div style="font-size:9px;color:var(--text-muted);margin-top:4px;">
                  Prochaine fenêtre ${fmtShortDate(unit.nextSignal.startDate)}
                </div>`
              : '';
            return `
              <div style="
                padding:9px 10px;border-radius:10px;
                background:${unitColor}12;border:1px solid ${unitColor}35;
              ">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                  <div style="min-width:0;">
                    <div style="
                      font-size:10px;font-weight:700;color:var(--text-primary);letter-spacing:0.04em;
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                    ">
                      ${unit.ref.unitName}
                    </div>
                    <div style="font-size:15px;font-weight:700;color:${unitColor};margin-top:4px;">
                      ${fmtGW(unit.availablePowerMW)}
                    </div>
                    <div style="font-size:9px;color:var(--text-muted);margin-top:2px;">
                      / ${fmtGW(unit.nominalPowerMW)} installés
                    </div>
                  </div>
                  <span style="
                    font-size:8px;padding:2px 6px;border-radius:999px;
                    background:${unitColor}22;color:${unitColor};font-weight:700;white-space:nowrap;
                    flex-shrink:0;
                  ">${compactUnitStatusLabel(unit.status)}</span>
                </div>
                ${unit.currentSignals.length > 0 ? `
                  <div style="font-size:9px;color:var(--text-muted);margin-top:6px;">
                    ${unit.currentSignals[0].type} · ${fmtDate(unit.currentSignals[0].startDate)}
                  </div>` : ''}
                ${unit.currentSignals.length === 0 ? nextInfo : ''}
              </div>`;
          }).join('')
          : `
            <div style="
              margin-top:8px;padding:8px 10px;border-radius:8px;
              background:rgba(46,204,113,0.08);color:var(--text-muted);font-size:10px;
            ">
              Aucune tranche signalée par RTE pour ce site.
            </div>`;

        return `
          <div style="
            background:rgba(255,255,255,0.04);border-radius:10px;
            padding:10px 12px;margin-bottom:10px;border-left:3px solid ${siteColor};
          " data-nuclear-plant="${escapeHtmlAttr(plant.name)}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
              <div>
                <div style="font-size:12px;font-weight:700;color:var(--text-primary);">${plant.name}</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:3px;">
                  ${fmtGW(plantSummary.availableMW)} / ${fmtGW(plantSummary.installedMW)} disponibles
                  · ${plantSummary.currentlyImpactedCount} tranche${plantSummary.currentlyImpactedCount > 1 ? 's' : ''} impactée${plantSummary.currentlyImpactedCount > 1 ? 's' : ''}
                </div>
              </div>
              <span style="
                font-size:10px;padding:2px 7px;border-radius:10px;
                background:${siteColor}22;color:${siteColor};font-weight:700;white-space:nowrap;
              ">${compactStatusLabel(plantSummary.worstStatus)}</span>
            </div>
            <div style="font-size:10px;font-weight:700;color:#9CA3AF;letter-spacing:0.08em;text-transform:uppercase;margin-top:10px;">
              Indicateurs par tranche
            </div>
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px;">
              ${unitsHtml}
            </div>
          </div>`;
      });

    return `
      ${freshnessBadge}
      <div style="
        margin-top:10px;padding:14px 12px;border-radius:12px;
        background:linear-gradient(135deg, rgba(255,255,255,0.05), rgba(143,200,232,0.08));
        border:1px solid rgba(143,200,232,0.16);
      ">
        <div style="font-size:10px;font-weight:700;color:#9CA3AF;letter-spacing:0.1em;text-transform:uppercase;">
          France Nuclear Now
        </div>
        <div style="display:grid;grid-template-columns:118px 1fr;gap:14px;align-items:center;margin-top:10px;">
          <div style="
            width:118px;height:118px;border-radius:50%;
            background:conic-gradient(${donutColor} 0deg ${donutDeg}deg, rgba(255,255,255,0.08) ${donutDeg}deg 360deg);
            display:flex;align-items:center;justify-content:center;
            margin:0 auto;
          ">
            <div style="
              width:82px;height:82px;border-radius:50%;
              background:var(--bg-surface);border:1px solid rgba(255,255,255,0.06);
              display:flex;flex-direction:column;align-items:center;justify-content:center;
            ">
              <div style="font-size:19px;font-weight:800;color:var(--text-primary);line-height:1;">${fmtGW(fleet.totalAvailableMW)}</div>
              <div style="font-size:8px;color:var(--text-muted);letter-spacing:0.08em;text-transform:uppercase;margin-top:4px;">sur ${fmtGW(NUCLEAR_FLEET_INSTALLED_CAPACITY_MW)}</div>
            </div>
          </div>
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--text-primary);">
              ${fleet.availableCount}/${NUCLEAR_UNIT_COUNT} tranches nominales
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:5px;line-height:1.5;">
              Disponibilité estimée par tranche à partir des indisponibilités RTE actives.
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
              ${this._renderMiniStat('Vert', fleet.availableCount, '#2ECC71')}
              ${this._renderMiniStat('Orange', fleet.reducedCount, '#F59E0B')}
              ${this._renderMiniStat('Rouge', fleet.outageCount, '#E74C3C')}
              ${this._renderMiniStat('Gris', fleet.unknownCount, '#6B7280')}
            </div>
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px;">
        <div style="
          padding:10px 12px;border-radius:10px;
          background:rgba(143,200,232,0.10);border:1px solid rgba(143,200,232,0.18);
        ">
          <div style="font-size:10px;font-weight:700;color:#9CA3AF;letter-spacing:0.08em;text-transform:uppercase;">
            Production
          </div>
          <div style="font-size:18px;font-weight:800;color:#8FC8E8;margin-top:6px;">
            ${currentProductionMW != null ? fmtGW(currentProductionMW) : 'n/d'}
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">
            Nucléaire FR instantané Écowatt
          </div>
        </div>
        <div style="
          padding:10px 12px;border-radius:10px;
          background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
        ">
          <div style="font-size:10px;font-weight:700;color:#9CA3AF;letter-spacing:0.08em;text-transform:uppercase;">
            Disponibilité
          </div>
          <div style="font-size:18px;font-weight:800;color:var(--text-primary);margin-top:6px;">
            ${Math.round(availabilityRatio * 100)}%
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">
            Capacité RTE disponible
          </div>
        </div>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:10px;line-height:1.5;">
        Vue instantanée des ${NUCLEAR_UNIT_COUNT} tranches de référence du parc suivi par France Monitor.
        ${productionUpdatedAt ? ` Production Écowatt mise à jour à ${fmtTime(productionUpdatedAt)}.` : ''}
      </div>
      <div style="margin-top:8px;">${plantCards.join('')}</div>`;
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
    if (state.remitStatus === 'html') {
      return this._renderUnavailable('Flux IIP joignable mais non exploitable : HTML / SPA reçu au lieu du RSS.');
    }
    if (state.remitStatus === 'loading') {
      return this._renderLoading('Récupération IIP RTE… (peut prendre jusqu’à 50 s)');
    }
    if (state.remitStatus === 'unavailable') {
      return this._renderUnavailable('Flux IIP RTE indisponible après tentatives.');
    }

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
            ${s.plantName} · ${s.classifiedAs.replace('_', ' ')} · <span style="color:#6EE7B7;">${fmStatusDot('stable')} confirmé RTE</span>
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
          <div style="font-size:11px;font-weight:700;color:#EF4444;">${fmIcon('zap', { size: 11 })} GRID_TENSION_RISK</div>
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
        <span style="opacity:0.4;">${fmIcon('atom', { size: 20 })}</span>
        <span style="font-size:12px;color:var(--text-muted);text-align:center;">${msg}</span>
        <span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:#EF444422;border:1px solid #EF444433;color:#EF4444;font-size:9px;font-weight:700;letter-spacing:0.06em;">INDISPONIBLE</span>
      </div>`;
  }

  private _renderLoading(msg: string): string {
    return fmLoaderHTML({ text: msg });
  }

  private _freshnessBadge(freshness: string): string {
    const label =
      freshness === 'quasi-realtime' ? DATA_FRESHNESS_LABELS.TEMPS_REEL
      : freshness === 'stale' ? DATA_FRESHNESS_LABELS.RECONSTRUIT
      : DATA_FRESHNESS_LABELS.INDISPONIBLE;
    const color =
      freshness === 'quasi-realtime' ? '#34D399'
      : freshness === 'stale' ? '#F97316'
      : '#EF4444';
    return `<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:${color}22;border:1px solid ${color}33;color:${color};font-size:9px;font-weight:700;letter-spacing:0.06em;">${label}</span>`;
  }

  private _renderMiniStat(label: string, value: number, color: string): string {
    return `<span style="
      font-size:9px;padding:4px 7px;border-radius:999px;
      background:${color}18;border:1px solid ${color}35;color:${color};font-weight:700;
    ">${label} ${value}</span>`;
  }

  private _bindStatusHover(): void {
    this.contentEl.querySelectorAll<HTMLElement>('[data-nuclear-plant]').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        this._emitPlantHover(el.dataset['nuclearPlant'] ?? null);
      });
      el.addEventListener('mouseleave', () => {
        this._emitPlantHover(null);
      });
    });
  }

  private _emitPlantHover(plantName: string | null): void {
    if (this.hoveredPlantName === plantName) return;
    this.hoveredPlantName = plantName;
    this.onPlantHoverCallback?.(plantName);
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtShortDate(d: Date): string {
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtGW(mw: number): string {
  return `${(mw / 1000).toLocaleString('fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} GW`;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizePlantKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function isCurrentUnavailability(u: NuclearUnavailability): boolean {
  const now = Date.now();
  return u.startDate.getTime() <= now && (u.endDate === null || u.endDate.getTime() >= now);
}

function summarizePlantUnits(
  units: FleetUnitStatus[],
): {
  availableMW: number;
  installedMW: number;
  worstStatus: ReactorAvailabilityStatus;
  currentlyImpactedCount: number;
} {
  const availableMW = units.reduce((sum, unit) => sum + unit.availablePowerMW, 0);
  const installedMW = units.reduce((sum, unit) => sum + unit.nominalPowerMW, 0);

  const priority: ReactorAvailabilityStatus[] = [
    'OUTAGE_UNPLANNED',
    'OUTAGE_PLANNED',
    'REDUCED',
    'AVAILABLE',
    'UNKNOWN',
  ];

  const activeStatuses = units
    .filter((unit) => unit.currentSignals.length > 0)
    .map((unit) => unit.status);
  const worstStatus = priority.find((status) => activeStatuses.includes(status)) ?? 'AVAILABLE';

  return {
    availableMW,
    installedMW,
    worstStatus,
    currentlyImpactedCount: units.filter((unit) => unit.currentSignals.length > 0).length,
  };
}

function buildFleetSnapshot(unavailabilities: NuclearUnavailability[]) {
  const units = NUCLEAR_UNITS.map((ref) => buildUnitStatus(ref, unavailabilities));
  return {
    units,
    totalAvailableMW: units.reduce((sum, unit) => sum + unit.availablePowerMW, 0),
    availableCount: units.filter((unit) => unit.status === 'AVAILABLE').length,
    reducedCount: units.filter((unit) => unit.status === 'REDUCED').length,
    outageCount: units.filter((unit) => unit.status === 'OUTAGE_PLANNED' || unit.status === 'OUTAGE_UNPLANNED').length,
    unknownCount: units.filter((unit) => unit.status === 'UNKNOWN').length,
  };
}

function buildUnitStatus(
  ref: NuclearUnitReference,
  unavailabilities: NuclearUnavailability[],
): FleetUnitStatus {
  const matching = unavailabilities.filter((unit) => matchesUnitReference(ref, unit.unitName));
  const currentSignals = matching.filter((unit) => isCurrentUnavailability(unit));
  const nextSignal = matching
    .filter((unit) => unit.startDate.getTime() > Date.now())
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0] ?? null;

  if (currentSignals.length === 0) {
    return {
      ref,
      nominalPowerMW: ref.nominalPowerMW,
      availablePowerMW: ref.nominalPowerMW,
      status: 'AVAILABLE',
      currentSignals,
      nextSignal,
    };
  }

  const worstStatus = pickWorstStatus(currentSignals.map((unit) => unit.status));
  const availablePowerMW = Math.max(0, Math.min(
    ...currentSignals.map((unit) => unit.availablePowerMW),
  ));
  const nominalPowerMW = Math.max(
    ref.nominalPowerMW,
    ...currentSignals.map((unit) => unit.nominalPowerMW),
  );

  return {
    ref,
    nominalPowerMW,
    availablePowerMW,
    status: worstStatus,
    currentSignals,
    nextSignal,
  };
}

function matchesUnitReference(ref: NuclearUnitReference, unitName: string): boolean {
  const norm = normalizePlantKey(unitName);
  if (normalizePlantKey(ref.unitName) === norm) return true;
  return (ref.aliases ?? []).some((alias) => normalizePlantKey(alias) === norm);
}

function pickWorstStatus(statuses: ReactorAvailabilityStatus[]): ReactorAvailabilityStatus {
  const priority: ReactorAvailabilityStatus[] = [
    'OUTAGE_UNPLANNED',
    'OUTAGE_PLANNED',
    'REDUCED',
    'AVAILABLE',
    'UNKNOWN',
  ];
  return priority.find((status) => statuses.includes(status)) ?? 'UNKNOWN';
}

function compactStatusLabel(status: ReactorAvailabilityStatus): string {
  switch (status) {
    case 'AVAILABLE': return 'OK';
    case 'REDUCED': return 'RÉDUIT';
    case 'OUTAGE_PLANNED': return 'ARRÊT PLANIFIÉ';
    case 'OUTAGE_UNPLANNED': return 'ARRÊT FORTUIT';
    default: return 'INCONNU';
  }
}

function compactUnitStatusLabel(status: ReactorAvailabilityStatus): string {
  switch (status) {
    case 'AVAILABLE': return 'OK';
    case 'REDUCED': return 'RÉDUIT';
    case 'OUTAGE_PLANNED': return 'PLANIFIÉ';
    case 'OUTAGE_UNPLANNED': return 'FORTUIT';
    default: return 'INCONNU';
  }
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
