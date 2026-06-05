/**
 * OutagesPanel.ts — Panneau flottant « Pannes Réseau »
 *
 * Onglet 1 : incidents ORE (pannes Enedis/électricité)
 * Onglet 2 : pannes Internet/BGP (IODA + ISP BGP status)
 */

import { Panel } from './Panel.ts';
import type { PowerOutage, TelecomOutage, NetworkOutageState, InfraNetworkState, OutageZoneCollection, OutageZone } from '../types/index.ts';
import type { RTEIIPState } from '../services/rte-iip.ts';
import type { OutagesMeta } from '../services/outages.ts';
import { getFreshnessState } from '../services/outages.ts';
import { iodaScoreColor, iodaScoreLabel, ispStatusColor, ispStatusLabel } from '../services/internet-outages.ts';
import { dcStatusColor, dcStatusLabel, ixpStatusColor } from '../services/infra-network.ts';
import { getDatacenterVisualMeta } from '../utils/infra-network-visuals.js';

function formatDurationSec(seconds: number): string {
  if (seconds <= 0) return 'En cours';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

type ActiveTab = 'electric' | 'telecom' | 'internet' | 'cloud';

export class OutagesPanel extends Panel {
  private contentEl: HTMLElement | null = null;
  private headerCountEl: HTMLElement | null = null;
  private modalEl!: HTMLElement;
  private activeTab: ActiveTab = 'electric';
  private onCloseCallback?: () => void;
  private onTabChangeCallback?: (tab: ActiveTab | null) => void;

  // latest data
  private lastPower: PowerOutage[] = [];
  private lastTelecom: TelecomOutage[] = [];
  private lastNetwork: NetworkOutageState | null = null;
  private lastInfra: InfraNetworkState | null = null;
  private lastZones: OutageZone[] = [];
  private lastRTEIIP: RTEIIPState | null = null;

  // ARCEP fetch date (J ou J-1) — utilisé pour le badge UI
  private arcepFetchedDate: Date | null = null;

  // Freshness meta for Enedis power outage data
  private _outagesMeta: OutagesMeta | null = null;

  // hover callbacks
  private onDeptHoverCb?: (deptCode: string | null) => void;
  private onZoneHoverCb?: (clusterId: number | null) => void;
  private onIspHoverCb?: (data: { asn: string; coordinates: [number, number] } | null) => void;
  private onIodaHoverCb?: (data: { id: string; coordinates: [number, number] } | null) => void;
  private onDcHoverCb?: (data: { id: string; coordinates: [number, number] } | null) => void;
  private onIxpHoverCb?: (data: { id: string; coordinates: [number, number] } | null) => void;

  // click (fly-to) callbacks
  private onIspClickCb?: (data: { asn: string; coordinates: [number, number] }) => void;
  private onIodaClickCb?: (data: { id: string; coordinates: [number, number] }) => void;
  private onDcClickCb?: (data: { id: string; coordinates: [number, number] }) => void;
  private onIxpClickCb?: (data: { id: string; coordinates: [number, number] }) => void;

  constructor(container: HTMLElement) {
    super(container, { title: 'Pannes Réseau', icon: '⚡', collapsible: false });
  }

  setOnDeptHover(cb: (deptCode: string | null) => void): void {
    this.onDeptHoverCb = cb;
  }

  /** Met à jour les métadonnées de fraîcheur des données Enedis. */
  setOutagesMeta(meta: OutagesMeta): void {
    this._outagesMeta = meta;
    if (this.headerCountEl) this._updateHeaderCount();
  }

  /** Injecte les données IIP RTE (incidents HTB/production) dans le panneau. */
  setRTEIIP(state: RTEIIPState | null): void {
    this.lastRTEIIP = state;
    // Refresh le contenu si l'onglet électrique est actif
    if (this.activeTab === 'electric' && this.modalEl.style.display !== 'none') {
      this._renderContent();
    }
  }

  /** Met à jour la date de fetch ARCEP pour affichage J/J-1 dans l'UI. */
  setArcepFetchedDate(date: Date | null): void {
    this.arcepFetchedDate = date;
  }

  setOnZoneHover(cb: (clusterId: number | null) => void): void {
    this.onZoneHoverCb = cb;
  }

  setOnIspHover(cb: (data: { asn: string; coordinates: [number, number] } | null) => void): void {
    this.onIspHoverCb = cb;
  }

  setOnIodaHover(cb: (data: { id: string; coordinates: [number, number] } | null) => void): void {
    this.onIodaHoverCb = cb;
  }

  setOnDcHover(cb: (data: { id: string; coordinates: [number, number] } | null) => void): void {
    this.onDcHoverCb = cb;
  }

  setOnIxpHover(cb: (data: { id: string; coordinates: [number, number] } | null) => void): void {
    this.onIxpHoverCb = cb;
  }

  setOnIspClick(cb: (data: { asn: string; coordinates: [number, number] }) => void): void {
    this.onIspClickCb = cb;
  }

  setOnIodaClick(cb: (data: { id: string; coordinates: [number, number] }) => void): void {
    this.onIodaClickCb = cb;
  }

  setOnDcClick(cb: (data: { id: string; coordinates: [number, number] }) => void): void {
    this.onDcClickCb = cb;
  }

  setOnIxpClick(cb: (data: { id: string; coordinates: [number, number] }) => void): void {
    this.onIxpClickCb = cb;
  }

  setOnTabChange(cb: (tab: ActiveTab | null) => void): void {
    this.onTabChangeCallback = cb;
  }

  private elevateHoveredCard(el: HTMLElement): void {
    el.style.position = 'relative';
    el.style.zIndex = '3';
  }

  private resetHoveredCard(el: HTMLElement): void {
    el.style.zIndex = '0';
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'outages-panel-modal';
    this.modalEl.style.cssText = `
      position: absolute;
      top: var(--right-panel-top); right: 20px;
      width: 400px;
      max-height: calc(100vh - var(--right-panel-top) - 20px);
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 1000;
      display: none;
      flex-direction: column;
      backdrop-filter: blur(10px);
    `;

    // ─── Bouton fermeture ───
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
      position: absolute; top: 12px; right: 12px;
      background: rgba(255,255,255,0.1); border: none;
      color: var(--text-muted); cursor: pointer;
      font-size: 14px; width: 28px; height: 28px;
      border-radius: 14px; display: flex;
      align-items: center; justify-content: center;
      transition: all 0.2s;
    `;
    closeBtn.onmouseover = () => { closeBtn.style.background = 'rgba(255,255,255,0.2)'; closeBtn.style.color = 'var(--text-primary)'; };
    closeBtn.onmouseout  = () => { closeBtn.style.background = 'rgba(255,255,255,0.1)'; closeBtn.style.color = 'var(--text-muted)'; };
    closeBtn.onclick = () => this.hide();
    this.modalEl.appendChild(closeBtn);

    // ─── Header (aussi handle drag) ───
    const headerEl = document.createElement('div');
    headerEl.style.cssText = `
      padding: 16px 16px 0;
      border-bottom: 1px solid var(--border-color);
      cursor: grab;
      user-select: none;
    `;
    headerEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="width:44px;height:44px;flex-shrink:0;
          background:rgba(99,102,241,0.12);border-radius:12px;
          display:flex;align-items:center;justify-content:center;font-size:20px;pointer-events:none;">
          📡
        </div>
        <div style="flex:1;min-width:0;pointer-events:none;">
          <div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">Infrastructure numérique</div>
          <div style="font-weight:700;font-size:14px;color:var(--text-primary);">Pannes Réseau</div>
          <div id="outages-header-count" style="font-size:12px;color:var(--text-muted);">—</div>
        </div>
      </div>
      <div style="display:flex;gap:0;border-top:1px solid rgba(255,255,255,0.06);">
        <button id="tab-electric" style="flex:1;padding:8px 0;background:none;border:none;
          font-size:10px;font-weight:600;color:var(--text-muted);cursor:pointer;
          border-bottom:2px solid transparent;transition:all 0.2s;">
          ⚡ Élec.
        </button>
        <button id="tab-telecom" style="flex:1;padding:8px 0;background:none;border:none;
          font-size:10px;font-weight:600;color:var(--text-muted);cursor:pointer;
          border-bottom:2px solid transparent;transition:all 0.2s;">
          📡 Télécoms
        </button>
        <button id="tab-internet" style="flex:1;padding:8px 0;background:none;border:none;
          font-size:10px;font-weight:600;color:var(--text-muted);cursor:pointer;
          border-bottom:2px solid transparent;transition:all 0.2s;">
          🌐 Internet
        </button>
        <button id="tab-cloud" style="flex:1;padding:8px 0;background:none;border:none;
          font-size:10px;font-weight:600;color:var(--text-muted);cursor:pointer;
          border-bottom:2px solid transparent;transition:all 0.2s;">
          ☁️ Cloud
        </button>
      </div>
    `;
    this.modalEl.appendChild(headerEl);

    // ─── Contenu scrollable ───
    this.contentEl = document.createElement('div');
    this.contentEl.style.cssText = `padding:14px;overflow-y:auto;flex:1;`;
    this.modalEl.appendChild(this.contentEl);

    this.container.appendChild(this.modalEl);
    this.headerCountEl = this.modalEl.querySelector('#outages-header-count');

    // ─── Tab click handlers ───
    const tabElectric = this.modalEl.querySelector<HTMLButtonElement>('#tab-electric')!;
    const tabTelecom  = this.modalEl.querySelector<HTMLButtonElement>('#tab-telecom')!;
    const tabInternet = this.modalEl.querySelector<HTMLButtonElement>('#tab-internet')!;
    const tabCloud    = this.modalEl.querySelector<HTMLButtonElement>('#tab-cloud')!;
    tabElectric.onclick = (e) => { e.stopPropagation(); this.activeTab = 'electric'; this._applyTabs(); this._renderContent(); this.onTabChangeCallback?.(this.activeTab); };
    tabTelecom.onclick  = (e) => { e.stopPropagation(); this.activeTab = 'telecom';  this._applyTabs(); this._renderContent(); this.onTabChangeCallback?.(this.activeTab); };
    tabInternet.onclick = (e) => { e.stopPropagation(); this.activeTab = 'internet'; this._applyTabs(); this._renderContent(); this.onTabChangeCallback?.(this.activeTab); };
    tabCloud.onclick    = (e) => { e.stopPropagation(); this.activeTab = 'cloud';    this._applyTabs(); this._renderContent(); this.onTabChangeCallback?.(this.activeTab); };

    // ─── Drag logic ───
    let isDragging = false;
    let startX = 0; let startY = 0;
    let initialX = 0; let initialY = 0;

    headerEl.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'BUTTON' || target.closest('button')) return;
      e.preventDefault();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = this.modalEl.offsetLeft;
      initialY = this.modalEl.offsetTop;
      this.modalEl.style.right = 'auto';
      this.modalEl.style.bottom = 'auto';
      this.modalEl.style.left = `${initialX}px`;
      this.modalEl.style.top  = `${initialY}px`;
      headerEl.style.cursor = 'grabbing';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newX = Math.max(0, Math.min(window.innerWidth  - this.modalEl.offsetWidth,  initialX + (e.clientX - startX)));
      const newY = Math.max(0, Math.min(window.innerHeight - this.modalEl.offsetHeight, initialY + (e.clientY - startY)));
      this.modalEl.style.left = `${newX}px`;
      this.modalEl.style.top  = `${newY}px`;
    };

    const onMouseUp = () => {
      isDragging = false;
      headerEl.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    this._applyTabs();
  }

  protected render(): void {}

  show(power: PowerOutage[] = [], telecom: TelecomOutage[] = [], network: NetworkOutageState | null = null, infra: InfraNetworkState | null = null, zones?: OutageZoneCollection, tab?: ActiveTab): void {
    if (!this.contentEl) return;
    if (tab) this.activeTab = tab;
    this.lastPower   = power;
    this.lastTelecom = telecom;
    this.lastNetwork   = network;
    this.lastInfra     = infra;
    if (zones) this.lastZones = zones.features as OutageZone[];
    this.modalEl.style.display = 'flex';
    this._updateHeaderCount();
    this._applyTabs();
    this._renderContent();
    this.onTabChangeCallback?.(this.activeTab);
  }

  setOnClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }

  hide(): void {
    this.modalEl.style.display = 'none';
    this.onTabChangeCallback?.(null);
    this.onCloseCallback?.();
    // Clear highlights on close
    this.onDeptHoverCb?.(null);
    this.onZoneHoverCb?.(null);
  }

  isVisible(): boolean {
    return this.modalEl.style.display !== 'none';
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _applyTabs(): void {
    const tabElectric = this.modalEl.querySelector<HTMLButtonElement>('#tab-electric');
    const tabTelecom  = this.modalEl.querySelector<HTMLButtonElement>('#tab-telecom');
    const tabInternet = this.modalEl.querySelector<HTMLButtonElement>('#tab-internet');
    const tabCloud    = this.modalEl.querySelector<HTMLButtonElement>('#tab-cloud');
    if (!tabElectric || !tabTelecom || !tabInternet || !tabCloud) return;

    // Couleur d'accentuation par onglet pour renforcer la sémio
    const tabAccents: Record<ActiveTab, string> = {
      electric: '#F59E0B',  // ambre — électricité
      telecom:  '#3B82F6',  // bleu — télécom
      internet: '#10B981',  // vert emerald — internet
      cloud:    '#60A5FA',  // bleu acier — cloud / IXP
    };
    const accent = tabAccents[this.activeTab];
    const inactiveStyle = 'color:var(--text-muted);border-bottom:2px solid transparent;';

    tabElectric.style.cssText += this.activeTab === 'electric' ? `color:var(--text-primary);border-bottom:2px solid ${tabAccents.electric};` : inactiveStyle;
    tabTelecom.style.cssText  += this.activeTab === 'telecom'  ? `color:var(--text-primary);border-bottom:2px solid ${tabAccents.telecom};`  : inactiveStyle;
    tabInternet.style.cssText += this.activeTab === 'internet' ? `color:var(--text-primary);border-bottom:2px solid ${tabAccents.internet};` : inactiveStyle;
    tabCloud.style.cssText    += this.activeTab === 'cloud'    ? `color:var(--text-primary);border-bottom:2px solid ${tabAccents.cloud};`    : inactiveStyle;
    // Mettre à jour la couleur de l'icône en header selon l'onglet actif
    const iconEl = this.modalEl.querySelector<HTMLElement>('.outages-panel-header-icon');
    if (iconEl) iconEl.style.background = `${accent}20`;
    void accent; // suppress unused warning
  }

  private _updateHeaderCount(): void {
    if (!this.headerCountEl) return;
    const powerProblems = this.lastPower.filter(p => p.offGridCount >= 1000).length;
    // Count unique affected departments for telecom (not individual antenna sites)
    const telecomDepts  = new Set(this.lastTelecom.filter(t => t.voiceStatus === 'HS' || t.dataStatus === 'HS').map(t => t.department)).size;
    const iodaCount     = this.lastNetwork?.iodaEvents.filter(e => e.isOngoing).length ?? 0;
    const ispProblems   = this.lastNetwork?.ispStatus.filter(i => i.status !== 'normal').length ?? 0;
    const dcProblems    = this.lastInfra?.datacenters.filter(d => d.status !== 'operational' && d.status !== 'unknown').length ?? 0;
    const total = powerProblems + telecomDepts + iodaCount + ispProblems + dcProblems;

    // ── Stale badge ──────────────────────────────────────────────────────────
    const freshness = this._outagesMeta ? getFreshnessState(this._outagesMeta) : null;
    const staleNote = (() => {
      if (!freshness || freshness === 'fresh') return '';
      if (freshness === 'degraded') return ' · ⚠ Enedis indisponible';
      if (freshness === 'stale') {
        const ageMin = this._outagesMeta?.fetchedAt
          ? Math.round((Date.now() - this._outagesMeta.fetchedAt) / 60_000)
          : null;
        return ageMin !== null ? ` · ⚠ données périmées (${ageMin}min)` : ' · ⚠ données périmées';
      }
      return ' · données vieillissantes';
    })();

    const countText = total > 0
      ? `${total} incident${total > 1 ? 's' : ''} détecté${total > 1 ? 's' : ''}`
      : 'Réseau nominal';

    this.headerCountEl.textContent = countText + staleNote;
    this.headerCountEl.style.color = freshness === 'degraded' || freshness === 'stale'
      ? '#F97316'
      : total > 0 ? '#F97316' : 'var(--text-muted)';
  }

  private _renderContent(): void {
    if (!this.contentEl) return;
    if      (this.activeTab === 'electric') this._renderElectric();
    else if (this.activeTab === 'telecom')  this._renderTelecom();
    else if (this.activeTab === 'internet') this._renderInternet();
    else                                    this._renderCloud();
  }

  private _renderElectric(): void {
    const powers = this.lastPower;
    const zones  = this.lastZones;

    // Split into actual outages (measured by Enedis) vs Ecowatt tension risk only
    const actualOutages  = powers.filter(p => p.offGridCount > 0);
    const tensionRisk    = powers.filter(p => p.offGridCount === 0);

    if (powers.length === 0 && zones.length === 0) {
      this.contentEl!.innerHTML = `
        <div style="text-align:center;color:var(--text-muted);padding:24px 0;">
          <div style="font-size:32px;margin-bottom:12px;opacity:0.4;">✅</div>
          <div>Aucune panne électrique détectée.</div>
          <div style="font-size:11px;margin-top:8px;opacity:0.6;">Indicateurs Historiques DataFair · Ecowatt RTE</div>
        </div>`;
      return;
    }

    const frag = document.createDocumentFragment();

    // ── Résumé badges ──
    const mkBadge = (count: number, label: string, color: string) => {
      const d = document.createElement('div');
      d.style.cssText = `flex:1;text-align:center;background:${color}18;border:1px solid ${color}40;border-radius:8px;padding:7px 2px;`;
      d.innerHTML = `<div style="font-size:16px;font-weight:800;color:${color};">${count}</div><div style="font-size:9px;color:var(--text-muted);line-height:1.2;">${label}</div>`;
      return d;
    };
    const summary = document.createElement('div');
    summary.style.cssText = 'display:flex;gap:6px;margin-bottom:14px;';
    summary.appendChild(mkBadge(actualOutages.length, 'PDL hors réseau', '#F59E0B'));
    summary.appendChild(mkBadge(tensionRisk.length,   'Tension réseau',  '#F97316'));
    summary.appendChild(mkBadge(zones.length,          'Zones signalées', '#A855F7'));
    frag.appendChild(summary);

    // ── Accordion : PDL hors réseau (mesurés Enedis) ──
    frag.appendChild(this._buildDeptsAccordion(
      actualOutages,
      '⚡ PDL hors réseau',
      '#F59E0B',
      actualOutages.length === 0 ? 'Aucune panne mesurée' : undefined,
    ));

    // ── Accordion : Tension réseau (signal Ecowatt uniquement) ──
    if (tensionRisk.length > 0) {
      frag.appendChild(this._buildTensionAccordion(tensionRisk));
    }

    // ── Accordion : Zones signalées par les citoyens ──
    if (zones.length > 0) {
      frag.appendChild(this._buildZonesAccordion(zones));
    }

    // ── Incidents HTB / Production RTE (IIP) ──
    if (this.lastRTEIIP && (this.lastRTEIIP.productionCount + this.lastRTEIIP.transmissionCount) > 0) {
      frag.appendChild(this._buildIIPAccordion(this.lastRTEIIP));
    }

    // ── Sources ──
    const footer = document.createElement('div');
    footer.style.cssText = `margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);font-size:10px;color:var(--text-muted);`;
    footer.textContent = '⚡ Indicateurs Historiques DataFair · Ecowatt RTE · Signalements citoyens · IIP RTE (HTB)';
    frag.appendChild(footer);

    this.contentEl!.innerHTML = '';
    this.contentEl!.appendChild(frag);
  }

  private _buildDeptsAccordion(powers: PowerOutage[], title: string, accentColor: string, emptyMsg?: string): HTMLElement {
    let expanded = false;

    const hex = accentColor.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      border:1px solid rgba(${r},${g},${b},0.25);border-radius:10px;
      overflow:hidden;margin-bottom:12px;
    `;

    // Header accordéon
    const header = document.createElement('div');
    header.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      padding:10px 12px;background:rgba(${r},${g},${b},0.08);
      cursor:pointer;user-select:none;
    `;
    const chevron = document.createElement('span');
    chevron.textContent = '▸';
    chevron.style.cssText = 'font-size:10px;color:var(--text-muted);transition:transform 0.2s;flex-shrink:0;';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:12px;font-weight:700;color:${accentColor};">${title}</span>
        <span style="font-size:10px;font-weight:700;color:${accentColor};background:rgba(${r},${g},${b},0.15);
          padding:1px 7px;border-radius:10px;">${powers.length}</span>
      </div>
    `;
    header.appendChild(chevron);
    wrapper.appendChild(header);

    // Body accordéon (initially collapsed)
    const body = document.createElement('div');
    body.style.cssText = `max-height:0;overflow:hidden;transition:max-height 0.3s ease;`;
    const inner = document.createElement('div');
    inner.style.cssText = `padding:8px;display:flex;flex-direction:column;gap:6px;`;

    // Note DataFair — uniquement dans la section PDL hors réseau
    if (title.includes('PDL hors réseau')) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:10px;color:var(--text-muted);background:rgba(255,255,255,0.03);border:1px solid var(--border-color);border-left:2px solid #F59E0B;border-radius:4px;padding:5px 8px;margin-bottom:4px;line-height:1.4;';
      note.textContent = "⚠ Attention : seul l'indicateur 'PDL hors réseau' repose sur des données historiques Enedis (DataFair) — il est affiché à titre d'information (HISTORIQUE). La tension réseau (Ecowatt) et les zones signalées sont bien en TEMPS RÉEL/prévisionnel.";
      inner.appendChild(note);
    }

    if (powers.length === 0 && emptyMsg) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:var(--text-muted);padding:12px 0;font-size:12px;';
      empty.textContent = emptyMsg;
      inner.appendChild(empty);
    }

    for (const p of powers) {
      const count = p.offGridCount;
      const col = count >= 10000 ? '#EF4444' : count >= 5000 ? '#F97316' : count >= 1000 ? '#F59E0B' : '#EAB308';
      const sev = count >= 10000 ? 'Critique' : count >= 5000 ? 'Élevé' : count >= 1000 ? 'Modéré' : 'Faible';
      const trendIcon = p.trend === 'worsening' ? '📈' : p.trend === 'improving' ? '📉' : '➡️';

      const row = document.createElement('div');
      row.style.cssText = `
        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
        border-left:3px solid ${col};border-radius:8px;padding:9px 11px;
        cursor:pointer;transition:background 0.15s;
      `;
      row.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:12px;font-weight:700;color:var(--text-primary);">
            ${p.departmentName}
            <span style="color:var(--text-muted);font-weight:400;font-size:10px;"> (${p.departmentCode})</span>
          </span>
          <span style="font-size:10px;font-weight:700;color:${col};background:${col}20;padding:2px 7px;border-radius:10px;">${sev}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-size:10px;color:var(--text-muted);">⚡ ~${count.toLocaleString('fr-FR')} PDL hors réseau</span>
          <span style="font-size:10px;color:var(--text-muted);">${trendIcon} ${p.trend === 'worsening' ? 'En hausse' : p.trend === 'improving' ? 'En baisse' : 'Stable'}</span>
        </div>
      `;
      row.addEventListener('mouseenter', () => {
        this.elevateHoveredCard(row);
        row.style.background = `rgba(255,255,255,0.08)`;
        this.onDeptHoverCb?.(p.departmentCode);
      });
      row.addEventListener('mouseleave', () => {
        this.resetHoveredCard(row);
        row.style.background = `rgba(255,255,255,0.04)`;
        this.onDeptHoverCb?.(null);
      });
      inner.appendChild(row);
    }
    body.appendChild(inner);
    wrapper.appendChild(body);

    // Toggle
    header.addEventListener('click', () => {
      expanded = !expanded;
      body.style.maxHeight = expanded ? `${inner.scrollHeight + 20}px` : '0';
      chevron.style.transform = expanded ? 'rotate(90deg)' : '';
    });

    return wrapper;
  }

  private _buildTensionAccordion(powers: PowerOutage[]): HTMLElement {
    let expanded = false;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `border:1px solid rgba(249,115,22,0.25);border-radius:10px;overflow:hidden;margin-bottom:12px;`;
    const header = document.createElement('div');
    header.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(249,115,22,0.08);cursor:pointer;user-select:none;`;
    const chevron = document.createElement('span');
    chevron.textContent = '▸';
    chevron.style.cssText = 'font-size:10px;color:var(--text-muted);transition:transform 0.2s;flex-shrink:0;';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:12px;font-weight:700;color:#F97316;">🟠 Tension réseau (Ecowatt)</span>
        <span style="font-size:10px;font-weight:700;color:#F97316;background:rgba(249,115,22,0.15);padding:1px 7px;border-radius:10px;">${powers.length}</span>
      </div>
    `;
    header.appendChild(chevron);
    wrapper.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = `max-height:0;overflow:hidden;transition:max-height 0.3s ease;`;
    const inner = document.createElement('div');
    inner.style.cssText = `padding:8px;display:flex;flex-direction:column;gap:6px;`;

    const note = document.createElement('div');
    note.style.cssText = 'font-size:10px;color:var(--text-muted);background:rgba(249,115,22,0.05);border-left:2px solid #F97316;padding:5px 8px;border-radius:4px;margin-bottom:4px;line-height:1.4;';
    note.textContent = 'Signal Ecowatt RTE — indique une tension sur l\'équilibre offre/demande du réseau électrique national. Orange : consommation élevée, appel à la sobriété. Rouge : risque de coupures tournantes. Aucun PDL mesuré hors réseau dans ces départements.';
    inner.appendChild(note);

    for (const p of powers) {
      // Extract signal from eventCause (e.g. "Signal 🟠 orange")
      const signalMatch = p.eventCause.match(/Signal ([^\s·]+)/);
      const signalStr = signalMatch ? signalMatch[1] : '?';
      const col = p.eventCause.includes('rouge') ? '#EF4444' : '#F97316';

      const row = document.createElement('div');
      row.style.cssText = `background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.15);border-left:3px solid ${col};border-radius:8px;padding:9px 11px;cursor:pointer;transition:background 0.15s;`;
      row.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
          <span style="font-size:12px;font-weight:700;color:var(--text-primary);">
            ${p.departmentName}
            <span style="color:var(--text-muted);font-weight:400;font-size:10px;"> (${p.departmentCode})</span>
          </span>
          <span style="font-size:10px;font-weight:700;color:${col};">${signalStr}</span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);">Signal Ecowatt · pas de PDL mesurés</div>
      `;
      row.addEventListener('mouseenter', () => {
        this.elevateHoveredCard(row);
        row.style.background = 'rgba(249,115,22,0.12)';
        this.onDeptHoverCb?.(p.departmentCode);
      });
      row.addEventListener('mouseleave', () => {
        this.resetHoveredCard(row);
        row.style.background = 'rgba(249,115,22,0.06)';
        this.onDeptHoverCb?.(null);
      });
      inner.appendChild(row);
    }
    body.appendChild(inner);
    wrapper.appendChild(body);
    header.addEventListener('click', () => {
      expanded = !expanded;
      body.style.maxHeight = expanded ? `${inner.scrollHeight + 20}px` : '0';
      chevron.style.transform = expanded ? 'rotate(90deg)' : '';
    });
    return wrapper;
  }

  private _buildZonesAccordion(zones: OutageZone[]): HTMLElement {
    let expanded = false;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      border:1px solid rgba(168,85,247,0.25);border-radius:10px;
      overflow:hidden;margin-bottom:12px;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      padding:10px 12px;background:rgba(168,85,247,0.08);
      cursor:pointer;user-select:none;
    `;
    const chevron = document.createElement('span');
    chevron.textContent = '▸';
    chevron.style.cssText = 'font-size:10px;color:var(--text-muted);transition:transform 0.2s;';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:13px;">📍</span>
        <span style="font-size:12px;font-weight:700;color:#A855F7;">Zones signalées</span>
        <span style="font-size:10px;font-weight:700;color:#A855F7;background:rgba(168,85,247,0.15);
          padding:1px 7px;border-radius:10px;">${zones.length}</span>
      </div>
    `;
    header.appendChild(chevron);
    wrapper.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = `max-height:0;overflow:hidden;transition:max-height 0.3s ease;`;
    const inner = document.createElement('div');
    inner.style.cssText = `padding:8px;display:flex;flex-direction:column;gap:6px;`;

    const note = document.createElement('div');
    note.style.cssText = 'font-size:10px;color:var(--text-muted);background:rgba(168,85,247,0.05);border-left:2px solid #A855F7;padding:5px 8px;border-radius:4px;margin-bottom:4px;line-height:1.4;';
    note.textContent = 'Zones géographiques reconstituées à partir de signalements citoyens (coupure-elec.fr, InfoCoupure.fr). Données participatives — non validées par Enedis. La taille de la zone reflète la densité de signalements, pas le périmètre réel de la coupure.';
    inner.appendChild(note);

    // Palette violet uniquement pour les zones (cohérence avec la légende)
    const sevColor: Record<string, string> = { critical: '#C026D3', high: '#9333EA', medium: '#A855F7', low: '#C084FC' };
    const sevLabel: Record<string, string> = { critical: 'Critique', high: 'Élevé', medium: 'Modéré', low: 'Signalé' };

    for (const zone of zones) {
      const p = zone.properties;
      const col = sevColor[p.severity] ?? '#A855F7';
      const lbl = sevLabel[p.severity] ?? 'Signalé';
      const [lng, lat] = p.center;
      const ts = new Date(p.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const areaKm2 = Math.round(Math.PI * p.radiusKm * p.radiusKm * 10) / 10;

      const row = document.createElement('div');
      row.style.cssText = `
        background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);
        border-left:3px solid ${col};border-radius:8px;padding:9px 11px;
        cursor:pointer;transition:background 0.15s;
      `;

      const locationSpan = document.createElement('span');
      locationSpan.style.cssText = 'font-size:11px;font-weight:700;color:var(--text-primary);';
      locationSpan.textContent = '📍 …';

      const topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;';
      topRow.appendChild(locationSpan);
      const badge = document.createElement('span');
      badge.style.cssText = `font-size:10px;font-weight:700;color:${col};background:${col}20;padding:2px 7px;border-radius:10px;`;
      badge.textContent = lbl;
      topRow.appendChild(badge);

      const metaRow = document.createElement('div');
      metaRow.style.cssText = 'display:flex;gap:10px;font-size:10px;color:var(--text-muted);';
      metaRow.innerHTML = `
        <span>📊 ${p.totalReports} signalement${p.totalReports > 1 ? 's' : ''}</span>
        <span>📐 r=${p.radiusKm.toFixed(1)} km · ${areaKm2} km²</span>
        <span>🕐 ${ts}</span>
      `;

      row.appendChild(topRow);
      row.appendChild(metaRow);

      // Reverse geocoding async — remplace "…" par le nom de la ville
      fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}&limit=1`)
        .then(r => r.json())
        .then((data: { features?: Array<{ properties?: { city?: string; postcode?: string } }> }) => {
          const props = data.features?.[0]?.properties;
          if (props?.city) {
            locationSpan.textContent = `📍 ${props.city}${props.postcode ? ` (${props.postcode.slice(0, 2)})` : ''}`;
          } else {
            locationSpan.textContent = `📍 ${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E`;
          }
        })
        .catch(() => {
          locationSpan.textContent = `📍 ${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E`;
        });

      row.addEventListener('mouseenter', () => {
        this.elevateHoveredCard(row);
        row.style.background = `rgba(168,85,247,0.12)`;
        this.onZoneHoverCb?.(p.clusterId);
      });
      row.addEventListener('mouseleave', () => {
        this.resetHoveredCard(row);
        row.style.background = `rgba(168,85,247,0.06)`;
        this.onZoneHoverCb?.(null);
      });
      inner.appendChild(row);
    }
    body.appendChild(inner);
    wrapper.appendChild(body);

    header.addEventListener('click', () => {
      expanded = !expanded;
      body.style.maxHeight = expanded ? `${inner.scrollHeight + 20}px` : '0';
      chevron.style.transform = expanded ? 'rotate(90deg)' : '';
    });

    return wrapper;
  }

  private _renderTelecom(): void {
    const telecoms = this.lastTelecom;

    if (telecoms.length === 0) {
      this.contentEl!.innerHTML = `
        <div style="text-align:center;color:var(--text-muted);padding:24px 0;">
          <div style="font-size:32px;margin-bottom:12px;opacity:0.4;">📡</div>
          <div>Aucune panne télécom signalée.</div>
          <div style="font-size:11px;margin-top:8px;opacity:0.6;">Source ARCEP — mise à jour quotidienne (J-1)</div>
        </div>`;
      return;
    }

    const hsItems  = telecoms.filter(t => t.voiceStatus === 'HS' || t.dataStatus === 'HS');
    const degItems = telecoms.filter(t => (t.voiceStatus === 'Degraded' || t.dataStatus === 'Degraded') && t.voiceStatus !== 'HS' && t.dataStatus !== 'HS');

    const frag = document.createDocumentFragment();

    // ── Résumé ──
    const summary = document.createElement('div');
    summary.style.cssText = 'display:flex;gap:8px;margin-bottom:14px;';
    const mkBadge = (count: number, label: string, color: string) => {
      const d = document.createElement('div');
      d.style.cssText = `flex:1;text-align:center;background:${color}18;border:1px solid ${color}40;border-radius:8px;padding:8px 4px;`;
      d.innerHTML = `<div style="font-size:18px;font-weight:800;color:${color};">${count}</div><div style="font-size:10px;color:var(--text-muted);">${label}</div>`;
      return d;
    };
    summary.appendChild(mkBadge(hsItems.length,  'Hors service', '#EF4444'));
    summary.appendChild(mkBadge(degItems.length, 'Dégradées',    '#FF8C00'));
    summary.appendChild(mkBadge(new Set(telecoms.map(t => t.operator)).size, 'Opérateurs', '#6B7280'));
    frag.appendChild(summary);

    // ── Accordéons par opérateur ──
    const allProblem = [...hsItems, ...degItems];
    const byOperator = new Map<string, typeof allProblem>();
    for (const t of allProblem) {
      if (!byOperator.has(t.operator)) byOperator.set(t.operator, []);
      byOperator.get(t.operator)!.push(t);
    }
    // Trier par nombre de sites HS desc
    const sorted = [...byOperator.entries()].sort((a, b) => {
      const hsA = a[1].filter(t => t.voiceStatus === 'HS' || t.dataStatus === 'HS').length;
      const hsB = b[1].filter(t => t.voiceStatus === 'HS' || t.dataStatus === 'HS').length;
      return hsB - hsA;
    });

    for (const [operator, sites] of sorted) {
      const opHs  = sites.filter(t => t.voiceStatus === 'HS' || t.dataStatus === 'HS').length;
      const opDeg = sites.length - opHs;
      const accentCol = opHs > 0 ? '#EF4444' : '#FF8C00';
      let expanded = false;

      const acc = document.createElement('div');
      acc.style.cssText = `border:1px solid rgba(239,68,68,0.2);border-radius:10px;overflow:hidden;margin-bottom:8px;`;

      const accHeader = document.createElement('div');
      accHeader.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:rgba(239,68,68,0.07);cursor:pointer;user-select:none;`;
      const chevron = document.createElement('span');
      chevron.textContent = '▸';
      chevron.style.cssText = 'font-size:10px;color:var(--text-muted);transition:transform 0.2s;flex-shrink:0;';

      const hsBadge = opHs > 0  ? `<span style="font-size:10px;font-weight:700;color:#EF4444;background:rgba(239,68,68,0.15);padding:1px 6px;border-radius:8px;">${opHs} HS</span>` : '';
      const dgBadge = opDeg > 0 ? `<span style="font-size:10px;font-weight:700;color:#FF8C00;background:rgba(255,140,0,0.15);padding:1px 6px;border-radius:8px;">${opDeg} dég.</span>` : '';
      accHeader.innerHTML = `
        <div style="display:flex;align-items:center;gap:7px;">
          <span style="font-size:12px;font-weight:700;color:${accentCol};">📡 ${operator}</span>
          ${hsBadge}${dgBadge}
        </div>
      `;
      accHeader.appendChild(chevron);
      acc.appendChild(accHeader);

      const accBody = document.createElement('div');
      accBody.style.cssText = 'max-height:0;overflow:hidden;transition:max-height 0.3s ease;';
      const accInner = document.createElement('div');
      accInner.style.cssText = 'padding:8px;display:flex;flex-direction:column;gap:5px;';

      for (const t of sites) {
        const isHS = t.voiceStatus === 'HS' || t.dataStatus === 'HS';
        const col  = isHS ? '#EF4444' : '#FF8C00';
        const voiceIcon = t.voiceStatus === 'HS' ? '📵' : t.voiceStatus === 'Degraded' ? '📶' : '📞';
        const dataIcon  = t.dataStatus  === 'HS' ? '❌' : t.dataStatus  === 'Degraded' ? '⚠️' : '✅';
        const card = document.createElement('div');
        card.style.cssText = `background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-left:3px solid ${col};border-radius:8px;padding:8px 10px;`;
        card.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
            <span style="font-size:12px;font-weight:600;color:var(--text-primary);">${t.city} <span style="color:var(--text-muted);font-weight:400;font-size:10px;">(${t.department})</span></span>
            <span style="font-size:10px;font-weight:700;color:${col};">${isHS ? 'HS' : 'Dég.'}</span>
          </div>
          <div style="font-size:10px;color:var(--text-muted);display:flex;gap:10px;">
            <span>${voiceIcon} ${t.voiceStatus}</span>
            <span>${dataIcon} ${t.dataStatus}</span>
          </div>
          ${t.reason ? `<div style="font-size:10px;color:#FF8C00;margin-top:2px;">${t.reason}</div>` : ''}
        `;
        accInner.appendChild(card);
      }
      accBody.appendChild(accInner);
      acc.appendChild(accBody);

      accHeader.addEventListener('click', () => {
        expanded = !expanded;
        accBody.style.maxHeight = expanded ? `${accInner.scrollHeight + 20}px` : '0';
        chevron.style.transform = expanded ? 'rotate(90deg)' : '';
      });

      frag.appendChild(acc);
    }

    // ── Sources ──
    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:8px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);font-size:10px;color:var(--text-muted);';

    // Badge J / J-1 selon la date de fetch ARCEP
    const now = new Date();
    let arcepDateLabel = 'J-1';
    if (this.arcepFetchedDate) {
      const d = this.arcepFetchedDate;
      const isToday = d.getFullYear() === now.getFullYear()
        && d.getMonth() === now.getMonth()
        && d.getDate() === now.getDate();
      arcepDateLabel = isToday ? 'J' : 'J-1';
    }
    const arcepDateStr = this.arcepFetchedDate
      ? ` (${this.arcepFetchedDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })})`
      : '';
    footer.innerHTML = `
      🟢 ARCEP — Observatoire qualité mobile
      <span style="display:inline-block;margin-left:4px;padding:1px 6px;background:rgba(59,130,246,0.15);
        border:1px solid rgba(59,130,246,0.3);border-radius:8px;font-size:9px;font-weight:700;
        color:#60A5FA;">${arcepDateLabel}${arcepDateStr}</span>
      <span style="display:block;margin-top:4px;opacity:0.6;font-style:italic;"
        >Données jour J ou J-1 — pas de mise à jour infra-journalière</span>
    `;
    frag.appendChild(footer);

    this.contentEl!.innerHTML = '';
    this.contentEl!.appendChild(frag);
  }

  private _renderInternet(): void {
    const net = this.lastNetwork;

    if (!net) {
      this.contentEl!.innerHTML = `
        <div style="text-align:center;color:var(--text-muted);padding:24px 0;">
          <div style="font-size:28px;margin-bottom:10px;opacity:0.4;">📡</div>
          <div>Chargement des données BGP…</div>
        </div>`;
      return;
    }

    const frag = document.createDocumentFragment();

    // ── Score national ──
    const scoreColor = net.nationalScore >= 90 ? '#10B981' : net.nationalScore >= 70 ? '#F59E0B' : '#EF4444';
    const scoreLabel = net.nationalScore >= 90 ? 'Normal' : net.nationalScore >= 70 ? 'Tension' : 'Critique';
    const scoreEl = document.createElement('div');
    scoreEl.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);
      border-radius:10px;padding:12px 14px;margin-bottom:14px;
    `;
    scoreEl.innerHTML = `
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#10B981;margin-bottom:2px;">Santé Internet France</div>
        <div style="font-size:22px;font-weight:800;color:${scoreColor};">${net.nationalScore}<span style="font-size:14px;font-weight:400;color:var(--text-muted);"> / 100</span></div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:13px;font-weight:700;color:${scoreColor};">${scoreLabel}</div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:3px;">
          ${net.iodaEvents.filter(e => e.isOngoing).length} anomalie${net.iodaEvents.filter(e => e.isOngoing).length !== 1 ? 's' : ''} actives
        </div>
      </div>
    `;
    frag.appendChild(scoreEl);

    // ── ISP BGP Status ──
    const ispHeader = document.createElement('div');
    ispHeader.style.cssText = 'margin-bottom:8px;';
    ispHeader.innerHTML = `
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:3px;">État BGP des opérateurs</div>
      <div style="font-size:10px;color:var(--text-muted);opacity:0.7;line-height:1.4;">
        BGP (Border Gateway Protocol) est le protocole de routage qui relie les réseaux entre eux sur Internet.
        Une chute de préfixes signale qu'un opérateur devient partiellement ou totalement injoignable.
      </div>
    `;
    frag.appendChild(ispHeader);

    const ispGrid = document.createElement('div');
    ispGrid.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:16px;';

    for (const isp of net.ispStatus) {
      const col  = ispStatusColor(isp.status);
      const lbl  = ispStatusLabel(isp.status);
      const row  = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;justify-content:space-between;
        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
        border-left:3px solid ${col};border-radius:8px;padding:8px 11px;
        cursor:pointer;transition:background 0.15s;
      `;
      row.addEventListener('mouseenter', () => {
        this.elevateHoveredCard(row);
        row.style.background = 'rgba(16,185,129,0.08)';
        this.onIspHoverCb?.({ asn: isp.asn, coordinates: isp.coordinates });
      });
      row.addEventListener('mouseleave', () => {
        this.resetHoveredCard(row);
        row.style.background = 'rgba(255,255,255,0.04)';
        this.onIspHoverCb?.(null);
      });
      row.addEventListener('click', () => {
        this.onIspClickCb?.({ asn: isp.asn, coordinates: isp.coordinates });
      });
      // Visibility bar
      const barW = Math.round(isp.visibility);
      row.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">
            ${isp.ispName}
            <span style="font-size:10px;font-weight:400;color:var(--text-muted);">AS${isp.asn}</span>
          </div>
          <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${barW}%;background:${col};border-radius:2px;transition:width 0.4s;"></div>
          </div>
        </div>
        <div style="text-align:right;margin-left:12px;flex-shrink:0;">
          <div style="font-size:11px;font-weight:700;color:${col};">${lbl}</div>
          <div style="font-size:10px;color:var(--text-muted);">${isp.visibility}%</div>
        </div>
      `;
      ispGrid.appendChild(row);
    }

    if (net.ispStatus.length === 0) {
      ispGrid.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:10px 0;">Données BGPView en attente…</div>`;
    }
    frag.appendChild(ispGrid);

    // ── IODA Events ──
    const iodaTitle = document.createElement('div');
    iodaTitle.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px;';
    iodaTitle.textContent = `Anomalies IODA (24h)`;
    frag.appendChild(iodaTitle);

    const events = [...net.iodaEvents].sort((a, b) => b.score - a.score);

    if (events.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.style.cssText = 'text-align:center;color:var(--text-muted);padding:16px 0;font-size:12px;';
      emptyEl.innerHTML = `<div style="font-size:24px;opacity:0.4;margin-bottom:8px;">✅</div>Aucune anomalie BGP détectée`;
      frag.appendChild(emptyEl);
    } else {
      const evList = document.createElement('div');
      evList.style.cssText = 'display:flex;flex-direction:column;gap:7px;';

      for (const ev of events) {
        const col   = iodaScoreColor(ev.score);
        const slbl  = iodaScoreLabel(ev.score);
        const card  = document.createElement('div');
        card.style.cssText = `
          background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
          border-left:3px solid ${col};border-radius:8px;padding:9px 11px;
          cursor:pointer;transition:background 0.15s;
        `;
        card.addEventListener('mouseenter', () => {
          this.elevateHoveredCard(card);
          card.style.background = `rgba(${col === '#EF4444' ? '239,68,68' : col === '#F59E0B' ? '245,158,11' : '16,185,129'},0.08)`;
          this.onIodaHoverCb?.({ id: ev.id, coordinates: ev.coordinates });
        });
        card.addEventListener('mouseleave', () => {
          this.resetHoveredCard(card);
          card.style.background = 'rgba(255,255,255,0.04)';
          this.onIodaHoverCb?.(null);
        });
        card.addEventListener('click', () => {
          this.onIodaClickCb?.({ id: ev.id, coordinates: ev.coordinates });
        });
        const durationStr = ev.isOngoing
          ? `⏳ En cours (début : ${ev.startTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`
          : `Durée : ${formatDurationSec(ev.duration)}`;
        const sources = ev.datasources.join(', ') || 'BGP';

        card.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:700;color:var(--text-primary);">${ev.entityName}</span>
            <span style="font-size:10px;font-weight:700;color:${col};background:${col}20;padding:2px 7px;border-radius:10px;">
              ${slbl} · ${ev.score.toFixed(0)}
            </span>
          </div>
          <div style="font-size:10px;color:var(--text-muted);line-height:1.5;">
            ${durationStr}<br/>
            <span style="color:#10B981;">Signaux : ${sources}</span>
          </div>
        `;
        evList.appendChild(card);
      }
      frag.appendChild(evList);
    }

    // ── Sources footer ──
    const footer = document.createElement('div');
    footer.style.cssText = `
      margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);
      display:flex;gap:8px;align-items:center;flex-wrap:wrap;
    `;
    const iodaSt  = net.sourcesStatus.ioda;
    const bgpSt   = net.sourcesStatus.bgpview;
    const dot = (s: string) => s === 'ok' ? '🟢' : s === 'stale' ? '🟡' : '🔴';
    footer.innerHTML = `
      <span style="font-size:10px;color:var(--text-muted);">${dot(iodaSt)} IODA</span>
      <span style="font-size:10px;color:var(--text-muted);">${dot(bgpSt)} BGPView</span>
      <span style="font-size:10px;color:var(--text-muted);margin-left:auto;">
        ${net.lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
      </span>
    `;
    frag.appendChild(footer);

    this.contentEl!.innerHTML = '';
    this.contentEl!.appendChild(frag);
  }

  private _renderCloud(): void {
    const infra = this.lastInfra;

    if (!infra) {
      this.contentEl!.innerHTML = `
        <div style="text-align:center;color:var(--text-muted);padding:24px 0;">
          <div style="font-size:28px;margin-bottom:10px;opacity:0.4;">☁️</div>
          <div>Chargement des données cloud…</div>
        </div>`;
      return;
    }

    const frag = document.createDocumentFragment();

    // ── Datacenters ──
    const dcTitle = document.createElement('div');
    dcTitle.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px;';
    dcTitle.textContent = 'Datacenters français';
    frag.appendChild(dcTitle);

    const dcGrid = document.createElement('div');
    dcGrid.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-bottom:16px;';

    // Group by provider
    const byProvider: Record<string, typeof infra.datacenters> = {};
    for (const dc of infra.datacenters) {
      if (!byProvider[dc.provider]) byProvider[dc.provider] = [];
      byProvider[dc.provider].push(dc);
    }

    for (const [provider, dcs] of Object.entries(byProvider)) {
      const visualRank = (dc: typeof dcs[number]): number => {
        const state = String(dc.operationalStateKey ?? dc.operationalState ?? '').trim().toLowerCase();
        if (state === 'en construction') return 2;
        if (state === 'en projet') return 1;
        const order: Record<string, number> = { outage: 8, partial: 7, degraded: 6, maintenance: 5, operational: 4, unknown: 3 };
        return order[dc.status] ?? 0;
      };

      const representative = dcs.reduce((best, dc) => (visualRank(dc) > visualRank(best) ? dc : best), dcs[0]!);
      const meta = getDatacenterVisualMeta(representative);
      const col = meta.color ?? dcStatusColor(representative.status as any);
      const lbl = meta.label ?? dcStatusLabel(representative.status as any);

      const row = document.createElement('div');
      row.style.cssText = `
        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
        border-left:3px solid ${col};border-radius:8px;padding:8px 11px;
      `;

      const incidentCount = dcs.reduce((sum, dc) => sum + dc.incidents.length, 0);
      const previewNames = dcs
        .slice(0, 4)
        .map(dc => dc.name.replace(`${provider} `, ''))
        .join(', ');
      const remainingCount = Math.max(0, dcs.length - 4);
      const siteSummary = `${dcs.length} site${dcs.length > 1 ? 's' : ''}${previewNames ? ` · ${previewNames}` : ''}${remainingCount > 0 ? ` +${remainingCount}` : ''}`;

      row.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
          <div style="font-size:12px;font-weight:700;color:var(--text-primary);">${provider}</div>
          <div style="font-size:10px;font-weight:700;color:${col};background:${col}20;padding:2px 7px;border-radius:10px;">${lbl}</div>
        </div>
        <div style="font-size:10px;color:var(--text-muted);">${siteSummary}</div>
        ${incidentCount > 0 ? `<div style="font-size:10px;color:#0EA5E9;margin-top:3px;">⚠ ${incidentCount} incident${incidentCount > 1 ? 's' : ''} actif${incidentCount > 1 ? 's' : ''}</div>` : ''}
      `;
      // Hover → highlight first DC of provider on map
      const firstDc = dcs[0];
      if (firstDc) {
        row.style.cursor = 'pointer';
        row.addEventListener('mouseenter', () => {
          this.elevateHoveredCard(row);
          row.style.background = `${col}14`;
          this.onDcHoverCb?.({ id: firstDc.id, coordinates: firstDc.coordinates });
        });
        row.addEventListener('mouseleave', () => {
          this.resetHoveredCard(row);
          row.style.background = 'rgba(255,255,255,0.04)';
          this.onDcHoverCb?.(null);
        });
        row.addEventListener('click', () => {
          this.onDcClickCb?.({ id: firstDc.id, coordinates: firstDc.coordinates });
        });
      }
      dcGrid.appendChild(row);
    }
    frag.appendChild(dcGrid);

    // ── IXPs ──
    const ixpTitle = document.createElement('div');
    ixpTitle.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px;';
    ixpTitle.textContent = 'Points d\'échange Internet (IXP)';
    frag.appendChild(ixpTitle);

    const ixpGrid = document.createElement('div');
    ixpGrid.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-bottom:16px;';

    for (const ixp of infra.ixps) {
      const col = ixpStatusColor(ixp.status);
      const lbl = dcStatusLabel(ixp.status);
      const row = document.createElement('div');
      row.style.cssText = `
        display:flex;align-items:center;justify-content:space-between;
        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
        border-left:3px solid ${col};border-radius:8px;padding:8px 11px;
      `;
      row.innerHTML = `
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:var(--text-primary);">${ixp.name}</div>
          <div style="font-size:10px;color:var(--text-muted);">
            ${ixp.peersCount > 0 ? `${ixp.peersCount} membres · ` : ''}${ixp.speedGbps} Gbps
          </div>
        </div>
        <div style="font-size:10px;font-weight:700;color:${col};margin-left:10px;">${lbl}</div>
      `;
      row.style.cursor = 'pointer';
      row.addEventListener('mouseenter', () => {
        this.elevateHoveredCard(row);
        row.style.background = `${col}14`;
        this.onIxpHoverCb?.({ id: ixp.id, coordinates: ixp.coordinates });
      });
      row.addEventListener('mouseleave', () => {
        this.resetHoveredCard(row);
        row.style.background = 'rgba(255,255,255,0.04)';
        this.onIxpHoverCb?.(null);
      });
      row.addEventListener('click', () => {
        this.onIxpClickCb?.({ id: ixp.id, coordinates: ixp.coordinates });
      });
      ixpGrid.appendChild(row);
    }
    frag.appendChild(ixpGrid);

    // ── Cloudflare Radar anomalies ──
    // Filter: anomalies without endDate are still active
    const ongoing = infra.cloudflareAnomalies.filter(a => !a.endDate);
    if (ongoing.length > 0) {
      const radTitle = document.createElement('div');
      radTitle.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px;';
      radTitle.textContent = `Cloudflare Radar — Anomalies FR (${ongoing.length})`;
      frag.appendChild(radTitle);

      const radList = document.createElement('div');
      radList.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-bottom:14px;';
      for (const a of ongoing) {
        const card = document.createElement('div');
        card.style.cssText = `
          background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.2);
          border-radius:8px;padding:9px 11px;
        `;
        const locationStr = a.locationDetails?.name ?? '';
        const asnStr = a.asnDetails ? `${a.asnDetails.name || `AS${a.asnDetails.asn}`}` : '';
        const detailStr = locationStr || asnStr;
        card.innerHTML = `
          <div style="font-size:12px;font-weight:700;color:#EF4444;margin-bottom:3px;">⚠ Anomalie trafic en cours</div>
          ${detailStr ? `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:3px;">${detailStr}</div>` : ''}
          ${a.asnDetails?.asn ? `<div style="font-size:10px;color:var(--text-muted);">AS${a.asnDetails.asn}</div>` : ''}
        `;
        radList.appendChild(card);
      }
      frag.appendChild(radList);
    }

    // ── Sources footer ──
    const footer = document.createElement('div');
    footer.style.cssText = `
      margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);
      display:flex;gap:8px;align-items:center;flex-wrap:wrap;
    `;
    const ss = infra.sourcesStatus;
    const dot = (s: string) => s === 'ok' ? '🟢' : s === 'stale' ? '🟡' : '🔴';
    footer.innerHTML = `
      <span style="font-size:10px;color:var(--text-muted);">${dot(ss.ovh)} OVH</span>
      <span style="font-size:10px;color:var(--text-muted);">${dot(ss.scaleway)} Scaleway</span>
      <span style="font-size:10px;color:var(--text-muted);">${dot(ss.aws)} AWS</span>
      <span style="font-size:10px;color:var(--text-muted);">${dot(ss.google)} GCP</span>
      <span style="font-size:10px;color:var(--text-muted);">${dot(ss.cloudflare)} CF</span>
      <span style="font-size:10px;color:var(--text-muted);">${dot(ss.peeringdb)} PeeringDB</span>
      <span style="font-size:10px;color:var(--text-muted);">${dot(ss.radar)} Radar</span>
      <span style="font-size:10px;color:var(--text-muted);margin-left:auto;">
        ${infra.lastUpdate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
      </span>
    `;
    frag.appendChild(footer);

    this.contentEl!.innerHTML = '';
    this.contentEl!.appendChild(frag);
  }

  private _buildIIPAccordion(iip: RTEIIPState): HTMLElement {
    let expanded = false;
    const total = iip.productionCount + iip.transmissionCount;
    const hasCapacity = iip.totalCapacityMW > 0;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `border:1px solid rgba(99,102,241,0.25);border-radius:10px;overflow:hidden;margin-bottom:12px;`;

    const header = document.createElement('div');
    header.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(99,102,241,0.08);cursor:pointer;user-select:none;`;
    const chevron = document.createElement('span');
    chevron.textContent = '▸';
    chevron.style.cssText = 'font-size:10px;color:var(--text-muted);transition:transform 0.2s;flex-shrink:0;';

    const capacityStr = hasCapacity ? ` · ${iip.totalCapacityMW.toLocaleString('fr-FR')} MW` : '';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:12px;font-weight:700;color:#818CF8;">⚡ Incidents HTB RTE (IIP)</span>
        <span style="font-size:10px;font-weight:700;color:#818CF8;background:rgba(99,102,241,0.15);padding:1px 7px;border-radius:10px;">${total}${capacityStr}</span>
        <span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:#10B98122;border:1px solid #10B98133;color:#10B981;font-size:9px;font-weight:700;letter-spacing:0.06em;">TEMPS RÉEL</span>
      </div>
    `;
    header.appendChild(chevron);
    wrapper.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = `max-height:0;overflow:hidden;transition:max-height 0.3s ease;`;
    const inner = document.createElement('div');
    inner.style.cssText = `padding:8px;display:flex;flex-direction:column;gap:6px;`;

    const note = document.createElement('div');
    note.style.cssText = 'font-size:10px;color:var(--text-muted);background:rgba(99,102,241,0.05);border-left:2px solid #818CF8;padding:5px 8px;border-radius:4px;margin-bottom:4px;line-height:1.4;';
    note.textContent = 'Indisponibilités REMIT déclarées sur la plateforme IIP de RTE — publiées au fil des déclarations. Peuvent être des maintenances programmées ou des incidents en cours, pas nécessairement des coupures pour les foyers.';
    inner.appendChild(note);

    const fmtDate = (d: Date | null) => d
      ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
      : '?';

    const buildCard = (inc: import('../services/rte-iip.ts').RTEIIPIncident): HTMLElement => {
      const isProduction = inc.type === 'production';
      const col = isProduction ? '#F59E0B' : '#818CF8';
      const typeLabel = isProduction ? '🏭 Production' : '🔌 Transport HTB';
      const statusBg = inc.status === 'active' ? '#EF444420' : '#6B728020';
      const statusCol = inc.status === 'active' ? '#EF4444' : '#9CA3AF';
      const statusLabel = inc.status === 'active' ? 'Actif' : inc.status === 'inactive' ? 'Terminé' : 'Retiré';
      const mwStr = inc.capacityMW ? `${inc.capacityMW.toLocaleString('fr-FR')} MW` : '';
      const period = `${fmtDate(inc.startDate)} → ${fmtDate(inc.endDate)}`;
      const causeStr = inc.cause ? ` · ${inc.cause}` : '';
      const periodMw = [period, mwStr].filter(Boolean).join(' · ');

      const card = document.createElement('div');
      card.style.cssText = `background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-left:3px solid ${col};border-radius:8px;padding:9px 11px;cursor:default;`;
      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px;">
          <span style="font-size:11px;font-weight:600;color:var(--text-primary);flex:1;min-width:0;line-height:1.3;">${inc.assetLabel}</span>
          <span style="font-size:9px;font-weight:700;background:${statusBg};color:${statusCol};padding:2px 6px;border-radius:8px;flex-shrink:0;">${statusLabel}</span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px;">${periodMw}</div>
        <div style="font-size:10px;color:var(--text-muted);">${typeLabel}${causeStr}</div>
      `;
      return card;
    };

    const PAGE = 10;
    iip.incidents.slice(0, PAGE).forEach(inc => inner.appendChild(buildCard(inc)));

    if (iip.incidents.length > PAGE) {
      const remaining = iip.incidents.slice(PAGE);
      const loadBtn = document.createElement('button');
      loadBtn.style.cssText = `
        width:100%;margin-top:4px;padding:7px;
        background:rgba(129,140,248,0.08);border:1px solid rgba(129,140,248,0.2);
        border-radius:8px;color:#818CF8;font-size:11px;font-weight:600;
        cursor:pointer;transition:background 0.15s;
      `;
      loadBtn.textContent = `Charger ${remaining.length} incident${remaining.length > 1 ? 's' : ''} supplémentaire${remaining.length > 1 ? 's' : ''}`;
      loadBtn.addEventListener('mouseenter', () => { loadBtn.style.background = 'rgba(129,140,248,0.15)'; });
      loadBtn.addEventListener('mouseleave', () => { loadBtn.style.background = 'rgba(129,140,248,0.08)'; });
      loadBtn.addEventListener('click', () => {
        remaining.forEach(inc => inner.insertBefore(buildCard(inc), loadBtn));
        loadBtn.remove();
        body.style.maxHeight = `${inner.scrollHeight + 20}px`;
      });
      inner.appendChild(loadBtn);
    }

    body.appendChild(inner);
    wrapper.appendChild(body);

    header.addEventListener('click', () => {
      expanded = !expanded;
      body.style.maxHeight = expanded ? `${inner.scrollHeight + 20}px` : '0';
      chevron.style.transform = expanded ? 'rotate(90deg)' : '';
    });

    return wrapper;
  }
}
