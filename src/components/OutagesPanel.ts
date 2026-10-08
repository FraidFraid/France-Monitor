/**
 * OutagesPanel.ts — Panneau flottant « Pannes Réseau »
 *
 * Onglet 1 : pannes Internet/BGP (IODA + ISP BGP status)
 * Onglet 2 : datacenters et points d'échange (Cloud)
 * Électricité et Télécoms ont leurs panneaux (OutagesPowerPanel, OutagesTelecomPanel) ; celui-ci disparaît à la tâche B10.
 */

import { Panel } from './Panel.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import { fmIcon, fmStatusDot } from './shared/icons.ts';
import type { NetworkOutageState, InfraNetworkState } from '../types/index.ts';
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

type ActiveTab = 'internet' | 'cloud';

export class OutagesPanel extends Panel {
  private contentEl: HTMLElement | null = null;
  private headerCountEl: HTMLElement | null = null;
  private modalEl!: HTMLElement;
  private activeTab: ActiveTab = 'internet';
  private onCloseCallback?: () => void;
  private onTabChangeCallback?: (tab: ActiveTab | null) => void;

  // latest data
  private lastNetwork: NetworkOutageState | null = null;
  private lastInfra: InfraNetworkState | null = null;

  // hover callbacks
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
    super(container, { title: 'Pannes Réseau', collapsible: false });
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
    const closeBtn = this.createCloseButton(() => this.hide());
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
          display:flex;align-items:center;justify-content:center;pointer-events:none;">
          ${fmIcon('satellite-dish', { size: 20 })}
        </div>
        <div style="flex:1;min-width:0;pointer-events:none;">
          <div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">Infrastructure numérique</div>
          <div style="font-weight:700;font-size:14px;color:var(--text-primary);">Pannes Réseau</div>
          <div id="outages-header-count" style="font-size:12px;color:var(--text-muted);">…</div>
        </div>
      </div>
      <div style="display:flex;gap:0;border-top:1px solid rgba(255,255,255,0.06);">
        <button id="tab-internet" style="flex:1;padding:8px 0;background:none;border:none;
          font-size:10px;font-weight:600;color:var(--text-muted);cursor:pointer;
          border-bottom:2px solid transparent;transition:all 0.2s;">
          ${fmIcon('globe', { size: 12 })} Internet
        </button>
        <button id="tab-cloud" style="flex:1;padding:8px 0;background:none;border:none;
          font-size:10px;font-weight:600;color:var(--text-muted);cursor:pointer;
          border-bottom:2px solid transparent;transition:all 0.2s;">
          ${fmIcon('cloud', { size: 12 })} Cloud
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
    const tabInternet = this.modalEl.querySelector<HTMLButtonElement>('#tab-internet')!;
    const tabCloud    = this.modalEl.querySelector<HTMLButtonElement>('#tab-cloud')!;
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

  showLoading(): void {
    if (!this.contentEl) return;
    this.modalEl.style.display = 'flex';
    this.contentEl.innerHTML = fmLoaderHTML({ text: 'Chargement des incidents réseau…' });
  }

  protected render(): void {}

  show(network: NetworkOutageState | null = null, infra: InfraNetworkState | null = null, tab?: ActiveTab): void {
    if (!this.contentEl) return;
    if (tab) this.activeTab = tab;
    this.lastNetwork   = network;
    this.lastInfra     = infra;
    this.modalEl.style.display = 'flex';
    this._updateHeaderCount();
    this._applyTabs();
    this._renderContent();
    this.onTabChangeCallback?.(this.activeTab);
  }

  setOnClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.modalEl.style.display = 'none';
    this.onTabChangeCallback?.(null);
    // Masquage « silencieux » (bascule entre panneaux) : ne désactive pas la couche.
    if (!opts.silent) this.onCloseCallback?.();
  }

  isVisible(): boolean {
    return this.modalEl.style.display !== 'none';
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _applyTabs(): void {
    const tabInternet = this.modalEl.querySelector<HTMLButtonElement>('#tab-internet');
    const tabCloud    = this.modalEl.querySelector<HTMLButtonElement>('#tab-cloud');
    if (!tabInternet || !tabCloud) return;

    // Couleur d'accentuation par onglet pour renforcer la sémio
    const tabAccents: Record<ActiveTab, string> = {
      internet: '#10B981',  // vert emerald — internet
      cloud:    '#60A5FA',  // bleu acier — cloud / IXP
    };
    const accent = tabAccents[this.activeTab];
    const inactiveStyle = 'color:var(--text-muted);border-bottom:2px solid transparent;';

    tabInternet.style.cssText += this.activeTab === 'internet' ? `color:var(--text-primary);border-bottom:2px solid ${tabAccents.internet};` : inactiveStyle;
    tabCloud.style.cssText    += this.activeTab === 'cloud'    ? `color:var(--text-primary);border-bottom:2px solid ${tabAccents.cloud};`    : inactiveStyle;
    // Mettre à jour la couleur de l'icône en header selon l'onglet actif
    const iconEl = this.modalEl.querySelector<HTMLElement>('.outages-panel-header-icon');
    if (iconEl) iconEl.style.background = `${accent}20`;
    void accent; // suppress unused warning
  }

  private _updateHeaderCount(): void {
    if (!this.headerCountEl) return;
    const iodaCount     = this.lastNetwork?.iodaEvents.filter(e => e.isOngoing).length ?? 0;
    const ispProblems   = this.lastNetwork?.ispStatus.filter(i => i.status !== 'normal').length ?? 0;
    const dcProblems    = this.lastInfra?.datacenters.filter(d => d.status !== 'operational' && d.status !== 'unknown').length ?? 0;
    const total = iodaCount + ispProblems + dcProblems;

    const countText = total > 0
      ? `${total} incident${total > 1 ? 's' : ''} détecté${total > 1 ? 's' : ''}`
      : 'Réseau nominal';

    this.headerCountEl.textContent = countText;
    this.headerCountEl.style.color = total > 0 ? '#F97316' : 'var(--text-muted)';
  }

  private _renderContent(): void {
    if (!this.contentEl) return;
    if (this.activeTab === 'internet') this._renderInternet();
    else                               this._renderCloud();
  }

  private _renderInternet(): void {
    const net = this.lastNetwork;

    if (!net) {
      this.contentEl!.innerHTML = `
        <div style="text-align:center;color:var(--text-muted);padding:24px 0;">
          <div style="margin-bottom:10px;opacity:0.4;">${fmIcon('satellite-dish', { size: 28 })}</div>
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
      emptyEl.innerHTML = `<div style="opacity:0.4;margin-bottom:8px;">${fmIcon('check', { size: 24 })}</div>Aucune anomalie BGP détectée`;
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
          ? `${fmIcon('hourglass', { size: 10 })} En cours (début : ${ev.startTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`
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
    const dot = (s: string) => fmStatusDot(s === 'ok' ? 'stable' : s === 'stale' ? 'medium' : 'critical');
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
          <div style="margin-bottom:10px;opacity:0.4;">${fmIcon('cloud', { size: 28 })}</div>
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
        if (state === 'fast-track') return 3;
        if (state === 'en construction') return 2;
        if (state === 'en projet') return 1;
        const order: Record<string, number> = { outage: 8, partial: 7, degraded: 6, maintenance: 5, operational: 4, unknown: 3 };
        return order[dc.status] ?? 0;
      };

      const representative = dcs.reduce((best, dc) => (visualRank(dc) > visualRank(best) ? dc : best), dcs[0]!);
      const meta = getDatacenterVisualMeta(representative);
      const col = meta.color ?? dcStatusColor(representative.status);
      const lbl = meta.label ?? dcStatusLabel(representative.status);

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
        ${incidentCount > 0 ? `<div style="font-size:10px;color:#0EA5E9;margin-top:3px;">${fmIcon('triangle-alert', { size: 10 })} ${incidentCount} incident${incidentCount > 1 ? 's' : ''} actif${incidentCount > 1 ? 's' : ''}</div>` : ''}
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
      radTitle.textContent = `Cloudflare Radar : Anomalies FR (${ongoing.length})`;
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
          <div style="font-size:12px;font-weight:700;color:#EF4444;margin-bottom:3px;">${fmIcon('triangle-alert', { size: 12 })} Anomalie trafic en cours</div>
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
    const dot = (s: string) => fmStatusDot(s === 'ok' ? 'stable' : s === 'stale' ? 'medium' : 'critical');
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
}
