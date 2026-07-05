/**
 * MapPopup.ts — Tooltip/popup HTML affiché au hover/click sur la carte.
 * Pattern identique à WorldMonitor MapPopup.ts.
 *
 * State machine pour éviter les conflits item/cluster:
 * - mode 'none': popup masqué
 * - mode 'item': affiche un seul article (interactif, cliquable)
 * - mode 'cluster': affiche une liste d'articles (interactif)
 *
 * Les deux modes sont interactifs : le popup reste visible quand on le survole.
 */

import type { NewsItem, MilitaryFlight, MilitaryBase, NuclearSiteStats, ThreatEvent } from '../types/index.ts';
import { FRENCH_OPERATOR_LABELS, FRENCH_OPERATOR_COLORS } from '../config/military.ts';
import { fmIcon } from './shared/icons.ts';
import type Hls from 'hls.js';

/** Popup display mode */
type PopupMode = 'none' | 'item' | 'cluster' | 'militaryFlight' | 'militaryBase' | 'militaryShip' | 'nuclearSite' | 'threatEvent';

/** Escape HTML to prevent XSS */
function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Format relative time in French */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'a l\'instant';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days}j`;
}

export class MapPopup {
  private element: HTMLElement;
  private parentEl: HTMLElement;
  private visible: boolean = false;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private mode: PopupMode = 'none';
  private isHoveringPopup: boolean = false;

  // Current data
  private currentItem: NewsItem | null = null;
  private clusterItems: NewsItem[] = [];
  private hlsInstance: Hls | null = null;

  // ESC key handler for military popups
  private escKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

  // Callbacks
  private onItemClick: ((item: NewsItem) => void) | null = null;
  private onClusterItemClick: ((item: NewsItem) => void) | null = null;
  private onClusterExpand: ((items: NewsItem[]) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.parentEl = parent;
    this.element = document.createElement('div');
    this.element.className = 'map-popup';
    this.element.style.display = 'none';
    this.element.style.pointerEvents = 'auto'; // Always interactive
    parent.appendChild(this.element);

    // Track when mouse enters popup - cancel any pending hide
    this.element.addEventListener('mouseenter', () => {
      this.isHoveringPopup = true;
      this.cancelHideTimeout();
    });

    // Track when mouse leaves popup - start hide timer
    this.element.addEventListener('mouseleave', () => {
      this.isHoveringPopup = false;
      if (this.mode === 'cluster') {
        this.hideCluster();
      } else if (this.mode === 'item') {
        this.hide();
      }
    });

    // Handle clicks
    this.element.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      if (this.mode === 'item') {
        // EO Browser link — stop event from also triggering article open
        if (target.closest('[data-action="satellite"]')) {
          e.stopPropagation();
          return;
        }
        // Default: click anywhere else → open article
        if (this.currentItem && this.onItemClick) {
          this.onItemClick(this.currentItem);
          this.hideNow();
        }
        return;
      }

      if (this.mode === 'cluster') {
        // Click on "Cliquez pour voir tout"
        const hint = target.closest('.cluster-popup-hint');
        if (hint && this.onClusterExpand && this.clusterItems.length > 0) {
          this.onClusterExpand(this.clusterItems);
          this.hideNow();
          return;
        }

        // Click on individual item in list
        const itemEl = target.closest('.cluster-popup-item') as HTMLElement | null;
        if (itemEl && this.onClusterItemClick) {
          const itemId = itemEl.dataset.itemId;
          const item = this.clusterItems.find(i => i.id === itemId);
          if (item) {
            this.onClusterItemClick(item);
            this.hideNow();
          }
        }
      }
    });
  }

  /** Set callback for when user clicks on a single item popup */
  setOnItemClick(handler: (item: NewsItem) => void): void {
    this.onItemClick = handler;
  }

  /** Set callback for when user clicks on an item in the cluster popup */
  setOnClusterItemClick(handler: (item: NewsItem) => void): void {
    this.onClusterItemClick = handler;
  }

  /** Set callback for when user clicks "Cliquez pour voir tout" */
  setOnClusterExpand(handler: (items: NewsItem[]) => void): void {
    this.onClusterExpand = handler;
  }

  /** Ensure element is attached to the DOM */
  private ensureAttached(): void {
    if (!this.element.parentElement) {
      this.parentEl.appendChild(this.element);
    }
  }

  /** Cancel any pending hide timeout */
  private cancelHideTimeout(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  /** Show popup for a news item at screen coordinates */
  show(item: NewsItem, x: number, y: number): void {
    // Don't override cluster mode - cluster has priority
    if (this.mode === 'cluster') {
      return;
    }

    this.cleanupHls();

    this.cancelHideTimeout();
    this.ensureAttached();
    this.mode = 'item';
    this.currentItem = item;

    const levelClass = item.threat?.level ?? 'info';
    const categoryLabel = item.threat?.category ?? 'general';
    const confidence = item.threat?.confidence
      ? `${Math.round(item.threat.confidence * 100)}%`
      : '';

    // Build summary section with loading state
    let summaryHtml = '';
    if (item.aiSummary) {
      summaryHtml = `<div class="map-popup-summary">${escapeHtml(item.aiSummary)}</div>`;
    } else if (item.aiSummaryStatus === 'pending') {
      summaryHtml = `<div class="map-popup-summary"><span class="loading-dots">Résumé en cours</span></div>`;
    } else if (item.summary) {
      summaryHtml = `<div class="map-popup-summary">${escapeHtml(item.summary.slice(0, 150))}${item.summary.length > 150 ? '...' : ''}</div>`;
    }

    this.element.innerHTML = `
      <div class="map-popup-inner map-popup-inner--item">
        <div class="map-popup-title">${escapeHtml(item.title)}</div>
        ${summaryHtml}
        <div class="map-popup-meta">
          <div class="map-popup-badges">
            <span class="threat-badge threat-badge--${levelClass}">${escapeHtml(levelClass)}</span>
            <span class="category-badge">${escapeHtml(categoryLabel)}</span>
            ${confidence ? `<span class="map-popup-confidence">${escapeHtml(confidence)}</span>` : ''}
            ${item.threat?.source === 'ml' ? `<span class="map-popup-ai" title="IA">${fmIcon('bot')}</span>` : ''}
          </div>
          <div class="map-popup-source">
            <span>${escapeHtml(item.source)}</span>
            <span>${escapeHtml(timeAgo(item.pubDate))}</span>
          </div>
          ${item.locationName ? `<div class="map-popup-location">${fmIcon('map-pin')} ${escapeHtml(item.locationName)}</div>` : ''}
        </div>
        <div class="map-popup-action">
          Cliquez pour ouvrir
        </div>
      </div>
    `;

    this.positionPopup(x, y, 300, 160);
    this.element.style.display = 'block';
    this.visible = true;
  }

  /**
   * Show popup for a cluster of news items at screen coordinates.
   * Displays a scrollable list of items with their threat levels.
   * This mode has priority over single item mode.
   */
  showCluster(items: NewsItem[], x: number, y: number, totalCount: number): void {
    if (items.length === 0) {
      // Only hide if we were showing a cluster and not hovering the popup
      if (this.mode === 'cluster' && !this.isHoveringPopup) {
        this.hideCluster();
      }
      return;
    }

    this.cancelHideTimeout();
    this.ensureAttached();
    this.cleanupHls();
    this.mode = 'cluster';
    this.clusterItems = items;
    this.currentItem = null;

    // Count items by threat level
    const levelCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const item of items) {
      const level = item.threat?.level ?? 'info';
      levelCounts[level] = (levelCounts[level] || 0) + 1;
    }

    // Build level summary badges
    const levelSummary = Object.entries(levelCounts)
      .filter(([, count]) => count > 0)
      .map(([level, count]) => `<span class="threat-badge threat-badge--${level}" style="font-size:10px;">${count}</span>`)
      .join(' ');

    // Build item list HTML (scrollable)
    const itemsHtml = items.slice(0, 10).map(item => {
      const level = item.threat?.level ?? 'info';
      return `
        <div class="cluster-popup-item" data-item-id="${escapeHtml(item.id)}">
          <span class="threat-dot threat-dot--${level}"></span>
          <span class="cluster-popup-item-title">${escapeHtml(item.title.slice(0, 60))}${item.title.length > 60 ? '…' : ''}</span>
          <span class="cluster-popup-item-time">${escapeHtml(timeAgo(item.pubDate))}</span>
        </div>
      `;
    }).join('');

    const moreCount = totalCount - items.length;
    const moreText = moreCount > 0 ? `<div class="cluster-popup-more">+${moreCount} autres articles</div>` : '';

    this.element.innerHTML = `
      <div class="cluster-popup-header">
        <span class="cluster-popup-count">${totalCount} articles</span>
        <div class="cluster-popup-levels">${levelSummary}</div>
      </div>
      <div class="cluster-popup-list">
        ${itemsHtml}
        ${moreText}
      </div>
      <div class="cluster-popup-hint">Cliquez pour voir tout</div>
    `;

    const popupHeight = Math.min(300, 80 + items.length * 32);
    this.positionPopup(x, y, 320, popupHeight);
    this.element.style.display = 'block';
    this.visible = true;
  }

  /**
   * Show popup for a military flight at screen coordinates.
   * Uses a fixed panel with ESC / outside-click to close.
   */
  showMilitaryFlight(flight: MilitaryFlight, x: number, y: number): void {
    this.hideNow();  // close any existing popup
    this.cancelHideTimeout();
    this.ensureAttached();
    this.mode = 'militaryFlight';

    this.element.innerHTML = this.renderMilitaryFlightPopup(flight);
    this.element.classList.add('wm-style');
    this.element.style.cursor = 'default';
    this.positionPopup(x, y, 340, 320);
    this.element.style.display = 'block';
    this.visible = true;

    // Close button
    this.element.querySelector('.wm-popup-close')?.addEventListener('click', () => this.hideNow());

    // ESC key
    this.removeEscAndOutside();
    this.escKeyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') this.hideNow(); };
    this.outsideClickHandler = (e: MouseEvent) => {
      if (!this.element.contains(e.target as Node)) this.hideNow();
    };
    setTimeout(() => {
      document.addEventListener('keydown', this.escKeyHandler!);
      document.addEventListener('mousedown', this.outsideClickHandler!);
    }, 0);
  }

  /**
   * Show popup for a military base at screen coordinates.
   */
  showMilitaryBase(base: MilitaryBase, x: number, y: number): void {
    this.hideNow();
    this.cancelHideTimeout();
    this.ensureAttached();
    this.mode = 'militaryBase';

    this.element.innerHTML = this.renderMilitaryBasePopup(base);
    this.element.classList.add('wm-style');
    this.element.style.cursor = 'default';
    this.positionPopup(x, y, 320, 220);
    this.element.style.display = 'block';
    this.visible = true;

    this.element.querySelector('.wm-popup-close')?.addEventListener('click', () => this.hideNow());

    this.removeEscAndOutside();
    this.escKeyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') this.hideNow(); };
    this.outsideClickHandler = (e: MouseEvent) => {
      if (!this.element.contains(e.target as Node)) this.hideNow();
    };
    setTimeout(() => {
      document.addEventListener('keydown', this.escKeyHandler!);
      document.addEventListener('mousedown', this.outsideClickHandler!);
    }, 0);
  }

  private removeEscAndOutside(): void {
    if (this.escKeyHandler) {
      document.removeEventListener('keydown', this.escKeyHandler);
      this.escKeyHandler = null;
    }
    if (this.outsideClickHandler) {
      document.removeEventListener('mousedown', this.outsideClickHandler);
      this.outsideClickHandler = null;
    }
  }

  private renderMilitaryFlightPopup(flight: MilitaryFlight): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const callsign = esc(flight.callsign || 'INCONNU');
    const operator = flight.operator ?? 'unknown';
    const operatorLabel = esc(flight.operatorLabel ?? FRENCH_OPERATOR_LABELS[operator] ?? 'INCONNU');
    const operatorColor = FRENCH_OPERATOR_COLORS[operator] ?? '#9898a8';

    const typeShortLabels: Record<string, string> = {
      fighter: 'CHASSE', transport: 'TRANSPORT', tanker: 'RAVITAILLEUR',
      awacs: 'AWACS', patrol: 'PATROUILLE MAR.', helicopter: 'HÉLICOPTÈRE',
      trainer: 'ENTRAÎNEMENT', drone: 'DRONE', liaison: 'LIAISON', unknown: 'MILITAIRE',
    };
    const aircraftType = flight.aircraftType ?? 'unknown';
    const typeLabel = typeShortLabels[aircraftType] ?? 'MILITAIRE';
    const aircraftModel = flight.aircraftModel ? esc(flight.aircraftModel) : '—';
    const hexCode = esc(flight.hexCode ?? flight.id.toUpperCase());
    const registration = flight.registration ? esc(flight.registration) : '—';
    const altFt = flight.altitude > 0
      ? `FL${Math.round(flight.altitude / 100)}`
      : 'SOL';
    const altDetail = flight.altitude > 0 ? `${flight.altitude.toLocaleString()} ft` : '';
    const speedKts = flight.speed > 0 ? `${flight.speed} kts`
      : (flight.velocity > 0 ? `${Math.round(flight.velocity * 1.94384)} kts` : '—');
    const heading = `${Math.round(flight.heading)}°`;
    const squawk = flight.squawk ? esc(flight.squawk) : '—';
    const confidence = flight.confidence ?? 'low';
    const confidenceLabel = confidence === 'high' ? 'IDENTIFIÉ' : confidence === 'medium' ? 'PROBABLE' : 'INCONNU';

    return `
      <div class="wm-popup-header">
        <div class="wm-popup-callsign">${callsign}</div>
        <div class="wm-popup-badges">
          <span class="wm-badge" style="background:${operatorColor}20;color:${operatorColor};border-color:${operatorColor}60">${operatorLabel}</span>
          <span class="wm-badge wm-badge-type">${typeLabel}</span>
        </div>
        <button class="wm-popup-close">×</button>
      </div>
      <div class="wm-popup-subtitle">${aircraftModel}</div>
      <div class="wm-popup-grid">
        <div class="wm-field">
          <span class="wm-field-label">ALTITUDE</span>
          <span class="wm-field-value">${altFt}${altDetail ? `<small> ${altDetail}</small>` : ''}</span>
        </div>
        <div class="wm-field">
          <span class="wm-field-label">VITESSE</span>
          <span class="wm-field-value">${speedKts}</span>
        </div>
        <div class="wm-field">
          <span class="wm-field-label">CAP</span>
          <span class="wm-field-value">${heading}</span>
        </div>
        <div class="wm-field">
          <span class="wm-field-label">CONFIANCE</span>
          <span class="wm-field-value">${confidenceLabel}</span>
        </div>
        <div class="wm-field">
          <span class="wm-field-label">ICAO HEX</span>
          <span class="wm-field-value wm-mono">${hexCode}</span>
        </div>
        <div class="wm-field">
          <span class="wm-field-label">IMMATRIC.</span>
          <span class="wm-field-value wm-mono">${registration}</span>
        </div>
        <div class="wm-field">
          <span class="wm-field-label">SQUAWK</span>
          <span class="wm-field-value wm-mono">${squawk}</span>
        </div>
      </div>
      <div class="wm-popup-footer">adsb.fi · airplanes.live · hexdb.io</div>
    `;
  }

  private renderMilitaryBasePopup(base: MilitaryBase): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const typeColors: Record<string, string> = {
      air: '#4a9eff', navy: '#00d4c8', army: '#22c55e', joint: '#a855f7',
    };
    const typeShortLabels: Record<string, string> = {
      air: 'ARM\u00c9E DE L\'AIR', navy: 'MARINE NATIONALE', army: 'ARM\u00c9E DE TERRE', joint: 'INTERARM\u00c9ES',
    };
    const typeColor = typeColors[base.type] ?? '#9898a8';
    const typeLabel = typeShortLabels[base.type] ?? base.type.toUpperCase();

    // Extended fields from MilitaryInstallation (cast, may be undefined)
    const ext = base as unknown as Record<string, unknown>;

    const icao = ext['icao'] as string | undefined;
    const units = ext['units'] as string[] | undefined;
    const aircraft = ext['aircraft'] as string[] | undefined;
    const region = ext['region'] as string | undefined;
    const status = ext['status'] as string | undefined;
    const osmType = ext['osmType'] as string | undefined;
    const isOsm = (base.id ?? '').startsWith('osm-');

    const statusBadge = (status && status !== 'active')
      ? `<span class="wm-badge" style="background:#ff390020;color:#ff3900;border-color:#ff390060">${status === 'closed' ? '&#9940; FERM\u00c9E' : '&#9888; R\u00c9DUITE'}</span>`
      : '';

    return `
      <div class="wm-popup-header">
        <div class="wm-popup-callsign">${esc(base.name)}</div>
        <div class="wm-popup-badges">
          <span class="wm-badge" style="background:${typeColor}20;color:${typeColor};border-color:${typeColor}60">&#9650; ${typeLabel}</span>
          <span class="wm-badge" style="background:#ffffff15;color:#ccc;border-color:#ffffff30">FRANCE</span>
          ${statusBadge}
        </div>
        <button class="wm-popup-close">&times;</button>
      </div>
      ${base.description ? `<div class="wm-popup-subtitle">${esc(base.description)}</div>` : ''}
      <div class="wm-popup-grid">
        ${region ? `<div class="wm-field"><span class="wm-field-label">R\u00c9GION</span><span class="wm-field-value">${esc(region)}</span></div>` : ''}
        ${icao ? `<div class="wm-field"><span class="wm-field-label">CODE ICAO</span><span class="wm-field-value wm-mono">${esc(icao)}</span></div>` : ''}
        <div class="wm-field">
          <span class="wm-field-label">COORDONN\u00c9ES</span>
          <span class="wm-field-value wm-mono">${base.coordinates[1].toFixed(4)}\u00b0, ${base.coordinates[0].toFixed(4)}\u00b0</span>
        </div>
        ${(units && units.length > 0) ? `<div class="wm-field" style="grid-column:span 2"><span class="wm-field-label">UNIT\u00c9S STATION\u00c9ES</span><span class="wm-field-value">${units.map(u => esc(u)).join(' &#183; ')}</span></div>` : ''}
        ${(aircraft && aircraft.length > 0) ? `<div class="wm-field" style="grid-column:span 2"><span class="wm-field-label">A\u00c9RONEFS</span><span class="wm-field-value">${aircraft.map(a => esc(a)).join(' &#183; ')}</span></div>` : ''}
      </div>
      <div class="wm-popup-footer">${isOsm ? 'OpenStreetMap &#183; military=' + esc(osmType ?? 'base') : 'Minist\u00e8re des Arm\u00e9es &#183; data.gouv.fr'}</div>
    `;
  }

  /** Show popup for a naval military vessel */
  showMilitaryShip(ship: { id: string; name: string; type: string; role: string; mmsi?: string; lat: number; lon: number; speed?: number; heading?: number; port?: string; isLive?: boolean }, x: number, y: number): void {
    this.hideNow();
    this.cancelHideTimeout();
    this.ensureAttached();
    this.mode = 'militaryShip';
    this.element.innerHTML = this.renderMilitaryShipPopup(ship);
    this.element.classList.add('wm-style');
    this.element.style.cursor = 'default';
    this.positionPopup(x, y, 340, 280);
    this.element.style.display = 'block';
    this.visible = true;
    this.element.querySelector('.wm-popup-close')?.addEventListener('click', () => this.hideNow());
    this.removeEscAndOutside();
    this.escKeyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') this.hideNow(); };
    this.outsideClickHandler = (e: MouseEvent) => {
      if (!this.element.contains(e.target as Node)) this.hideNow();
    };
    setTimeout(() => {
      document.addEventListener('keydown', this.escKeyHandler!);
      document.addEventListener('mousedown', this.outsideClickHandler!);
    }, 0);
  }

  private renderMilitaryShipPopup(ship: { id: string; name: string; type: string; role: string; mmsi?: string; lat: number; lon: number; speed?: number; heading?: number; port?: string; isLive?: boolean }): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const speed = ship.speed != null && ship.speed > 0 ? `${ship.speed} nœuds` : 'À quai';
    const heading = ship.heading != null && ship.heading > 0 ? `${Math.round(ship.heading)}°` : '—';
    const mmsi = ship.mmsi ? esc(ship.mmsi) : '—';
    const port = ship.port ? esc(ship.port) : '—';
    const liveTag = ship.isLive
      ? `<span class="wm-badge" style="background:#22c55e20;color:#22c55e;border-color:#22c55e40">● AIS LIVE</span>`
      : `<span class="wm-badge" style="background:#9898a820;color:#9898a8;border-color:#9898a840">PORT D'ATTACHE</span>`;

    return `
      <div class="wm-popup-header">
        <div class="wm-popup-callsign">${esc(ship.name)}</div>
        <div class="wm-popup-badges">
          <span class="wm-badge" style="background:#00d4c820;color:#00d4c8;border-color:#00d4c840">${fmIcon('anchor')} ${esc(ship.type)}</span>
          ${liveTag}
        </div>
        <button class="wm-popup-close">×</button>
      </div>
      <div class="wm-popup-subtitle">${esc(ship.role)}</div>
      <div class="wm-popup-grid">
        <div class="wm-field">
          <span class="wm-field-label">VITESSE</span>
          <span class="wm-field-value">${speed}</span>
        </div>
        <div class="wm-field">
          <span class="wm-field-label">CAP</span>
          <span class="wm-field-value">${heading}</span>
        </div>
        <div class="wm-field">
          <span class="wm-field-label">MMSI</span>
          <span class="wm-field-value wm-mono">${mmsi}</span>
        </div>
        <div class="wm-field">
          <span class="wm-field-label">PORT</span>
          <span class="wm-field-value">${port}</span>
        </div>
        <div class="wm-field" style="grid-column: span 2">
          <span class="wm-field-label">POSITION</span>
          <span class="wm-field-value wm-mono">${ship.lat.toFixed(4)}°N, ${ship.lon.toFixed(4)}°E</span>
        </div>
      </div>
      <div class="wm-popup-footer">Marine Nationale · AISstream.io</div>
    `;
  }


  /** Show popup for a nuclear site at screen coordinates (click/hover on infra layer). */
  showNuclearSite(stats: NuclearSiteStats, x: number, y: number): void {
    this.hideNow();
    this.cancelHideTimeout();
    this.ensureAttached();
    this.mode = 'nuclearSite';

    this.element.innerHTML = this.renderNuclearSitePopup(stats);
    this.element.classList.add('wm-style');
    this.element.style.cursor = 'default';
    this.positionPopup(x, y, 340, 360);
    this.element.style.display = 'block';
    this.visible = true;

    this.element.querySelector('.wm-popup-close')?.addEventListener('click', () => this.hideNow());

    this.removeEscAndOutside();
    this.escKeyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') this.hideNow(); };
    this.outsideClickHandler = (e: MouseEvent) => {
      if (!this.element.contains(e.target as Node)) this.hideNow();
    };
    setTimeout(() => {
      document.addEventListener('keydown', this.escKeyHandler!);
      document.addEventListener('mousedown', this.outsideClickHandler!);
    }, 0);
  }

  private renderNuclearSitePopup(stats: NuclearSiteStats): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // ── Status badge ──────────────────────────────────────────────────────────
    const STATUS_META: Record<string, { label: string; color: string }> = {
      operational:    { label: 'EN SERVICE',      color: '#6ea8d4' },
      planned_outage: { label: 'ARRÊT PROGRAMMÉ', color: '#c9a84c' },
      forced_outage:  { label: 'ARRÊT FORCÉ',     color: '#c0605a' },
      decommissioning:{ label: 'DÉMANTÈLEMENT',   color: '#9898a8' },
    };
    const { label: statusLabel, color: statusColor } = STATUS_META[stats.status] ?? { label: stats.status.toUpperCase(), color: '#9898a8' };

    // ── Timestamps ────────────────────────────────────────────────────────────
    let updatedStr = '';
    if (stats.updatedAt) {
      try {
        const d = new Date(stats.updatedAt);
        updatedStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) +
                     ' · ' + d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      } catch { /* ignore */ }
    }

    // ── Average reactor age ───────────────────────────────────────────────────
    const currentYear = new Date().getFullYear();
    let avgAgeStr = '';
    if (stats.commissioningYears.length > 0) {
      const ages = stats.commissioningYears.map(y => currentYear - y);
      const avgAge = Math.round(ages.reduce((a, b) => a + b, 0) / ages.length);
      const minYear = Math.min(...stats.commissioningYears);
      const maxYear = Math.max(...stats.commissioningYears);
      const yearRange = minYear === maxYear ? `${minYear}` : `${minYear}–${maxYear}`;
      avgAgeStr = `${yearRange} <span class="wm-field-muted">(moy. ${avgAge} ans)</span>`;
    }

    // ── Load factor bar ───────────────────────────────────────────────────────
    let loadBarHtml = '';
    if (stats.loadFactorPct != null) {
      const pct = Math.max(0, Math.min(100, Math.round(stats.loadFactorPct)));
      const barColor = pct >= 70 ? '#6ea8d4' : pct >= 30 ? '#c9a84c' : '#c0605a';
      loadBarHtml = `
        <div class="wm-load-bar-wrap">
          <div class="wm-load-bar-track">
            <div class="wm-load-bar-fill" style="width:${pct}%;background:${barColor}"></div>
          </div>
          <span class="wm-load-bar-label">${pct}%</span>
        </div>`;
    }

    // ── Reactor types ─────────────────────────────────────────────────────────
    const reactorTypesHtml = stats.reactorTypes.length > 0
      ? stats.reactorTypes.map(t => esc(t)).join(' · ')
      : '—';

    // ── Optional fields ───────────────────────────────────────────────────────
    const outputHtml = stats.currentOutputMW != null
      ? `<div class="wm-field"><span class="wm-field-label">ACTUEL</span><span class="wm-field-value">${stats.currentOutputMW.toLocaleString('fr-FR')} MW</span></div>`
      : '';

    const loadHtml = stats.loadFactorPct != null
      ? `<div class="wm-field wm-field--full"><span class="wm-field-label">UTILISATION</span>${loadBarHtml}</div>`
      : '';

    const genHtml = stats.annualGenerationTWh != null
      ? `<div class="wm-field"><span class="wm-field-label">PROD. ANNUELLE</span><span class="wm-field-value">${stats.annualGenerationTWh.toFixed(1)} TWh</span></div>`
      : '';

    const lifeHtml = stats.lifetimeExtension
      ? `<div class="wm-field wm-field--full"><span class="wm-field-label">DURÉE DE VIE</span><span class="wm-field-value">${esc(stats.lifetimeExtension)}</span></div>`
      : '';

    const asnHtml = stats.asnLink
      ? `<div class="wm-popup-footer"><a href="${esc(stats.asnLink)}" target="_blank" rel="noopener noreferrer" class="wm-footer-link">Fiche sûreté ASN ${fmIcon('external-link')}</a></div>`
      : '<div class="wm-popup-footer">RTE éCO2mix · ASN</div>';

    return `
      <div class="wm-popup-header">
        <div class="wm-popup-callsign">${fmIcon('atom')} ${esc(stats.name)}</div>
        <div class="wm-popup-badges">
          <span class="wm-badge" style="background:${statusColor}20;color:${statusColor};border-color:${statusColor}60">${statusLabel}</span>
          <span class="wm-badge" style="background:#ffffff10;color:#aaa;border-color:#ffffff25">${esc(stats.region)}</span>
        </div>
        <button class="wm-popup-close">×</button>
      </div>
      ${updatedStr ? `<div class="wm-popup-subtitle">Données à ${esc(updatedStr)}</div>` : ''}
      <div class="wm-nuclear-section-label">PUISSANCE</div>
      <div class="wm-popup-grid">
        <div class="wm-field wm-field--full">
          <span class="wm-field-label">INSTALLÉE</span>
          <span class="wm-field-value">${stats.totalNetCapacityMW.toLocaleString('fr-FR')} MW <span class="wm-field-muted">(${stats.reactorCount} réacteurs)</span></span>
        </div>
        <div class="wm-field wm-field--full">
          <span class="wm-field-label">TYPES</span>
          <span class="wm-field-value">${reactorTypesHtml}</span>
        </div>
      </div>
      <div class="wm-nuclear-section-label">PRODUCTION ACTUELLE</div>
      <div class="wm-popup-grid">
        ${outputHtml}
        ${loadHtml}
      </div>
      <div class="wm-nuclear-section-label">PROFIL</div>
      <div class="wm-popup-grid">
        ${avgAgeStr ? `<div class="wm-field wm-field--full"><span class="wm-field-label">MISE EN SERVICE</span><span class="wm-field-value">${avgAgeStr}</span></div>` : ''}
        ${genHtml}
        ${lifeHtml}
      </div>
      ${asnHtml}
    `;
  }

  /** Position popup within parent bounds */
  private positionPopup(x: number, y: number, width: number, height: number): void {
    const parentRect = this.parentEl.getBoundingClientRect();

    let left = x + 15;
    let top = y - 10;

    if (left + width > parentRect.width) {
      left = x - width - 15;
    }
    if (top + height > parentRect.height) {
      top = parentRect.height - height - 10;
    }
    if (top < 10) top = 10;
    if (left < 10) left = 10;

    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
  }

  private positionPopupMeasured(x: number, y: number): void {
    const parentRect = this.parentEl.getBoundingClientRect();
    const margin = 12;
    const legend = this.parentEl.querySelector<HTMLElement>('.legend-banner-container');
    const legendHeight = legend && getComputedStyle(legend).display !== 'none'
      ? legend.getBoundingClientRect().height + 24
      : 18;

    const sidePanel = document.querySelector<HTMLElement>('.cyber-panel-modal');
    let usableRight = parentRect.width - margin;
    if (sidePanel && getComputedStyle(sidePanel).display !== 'none') {
      const panelRect = sidePanel.getBoundingClientRect();
      const panelLeft = panelRect.left - parentRect.left;
      if (panelLeft > parentRect.width * 0.45) {
        usableRight = Math.min(usableRight, panelLeft - 14);
      }
    }

    const usableBottom = parentRect.height - legendHeight;
    const width = Math.min(this.element.offsetWidth || 360, Math.max(280, usableRight - margin));
    const height = Math.min(this.element.offsetHeight || 430, Math.max(260, usableBottom - margin));
    const maxHeight = Math.max(260, usableBottom - margin * 2);

    this.element.style.maxHeight = `${maxHeight}px`;
    this.element.style.overflowY = 'auto';

    const candidates = [
      { left: x + 18, top: y - 18 },
      { left: x - width - 18, top: y - 18 },
      { left: x - width / 2, top: y - height - 22 },
      { left: x - width / 2, top: y + 22 },
    ];

    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
    const scored = candidates.map((candidate) => {
      const left = clamp(candidate.left, margin, Math.max(margin, usableRight - width));
      const top = clamp(candidate.top, margin, Math.max(margin, usableBottom - height));
      return {
        left,
        top,
        score: Math.abs(left - candidate.left) + Math.abs(top - candidate.top),
      };
    }).sort((a, b) => a.score - b.score)[0];

    this.element.style.left = `${scored.left}px`;
    this.element.style.top = `${scored.top}px`;
  }

  /**
   * Hide the popup with a small delay (prevents flicker).
   * Only works for item mode - cluster mode must use hideCluster().
   */
  hide(): void {
    // Don't hide cluster or military popups via this method
    if (this.mode === 'cluster' || this.mode === 'militaryFlight' || this.mode === 'militaryBase' || this.mode === 'militaryShip' || this.mode === 'threatEvent') {
      return;
    }

    // Don't hide if hovering the popup
    if (this.isHoveringPopup) {
      return;
    }

    if (this.hideTimeout) return;
    this.hideTimeout = setTimeout(() => {
      if (this.isHoveringPopup) {
        this.hideTimeout = null;
        return;
      }
      this.element.style.display = 'none';
      this.visible = false;
      this.mode = 'none';
      this.currentItem = null;
      this.cleanupHls();
      this.hideTimeout = null;
    }, 150);
  }

  private cleanupHls() {
    if (this.hlsInstance) {
      this.hlsInstance.destroy();
      this.hlsInstance = null;
    }
  }

  /**
   * Hide the cluster popup with delay.
   * Must be called explicitly when leaving cluster hover.
   * Will not hide if user is hovering the popup itself.
   */
  hideCluster(): void {
    if (this.mode !== 'cluster') return;

    // Don't hide if user is interacting with the popup
    if (this.isHoveringPopup) {
      return;
    }

    if (this.hideTimeout) return;
    this.hideTimeout = setTimeout(() => {
      // Double-check we're still not hovering
      if (this.isHoveringPopup) {
        this.hideTimeout = null;
        return;
      }
      this.element.style.display = 'none';
      this.visible = false;
      this.mode = 'none';
      this.clusterItems = [];
      this.currentItem = null;
      this.cleanupHls();
      this.hideTimeout = null;
    }, 200);
  }

  /** Is the popup currently visible? */
  isVisible(): boolean {
    return this.visible;
  }

  /** Get current popup mode */
  getMode(): PopupMode {
    return this.mode;
  }

  /** Is user currently hovering over the popup? */
  isHovering(): boolean {
    return this.isHoveringPopup;
  }

  /** Immediately hide (no delay) - works for any mode */
  hideNow(): void {
    this.cancelHideTimeout();
    this.removeEscAndOutside();
    this.element.style.display = 'none';
    this.element.style.cursor = 'pointer'; // restore default
    this.element.style.visibility = '';
    this.element.style.width = '';
    this.element.style.maxWidth = '';
    this.element.style.maxHeight = '';
    this.element.style.overflowY = '';
    this.element.style.zIndex = '';
    this.element.classList.remove('wm-style', 'map-popup--threat');
    this.visible = false;
    this.mode = 'none';
    this.clusterItems = [];
    this.currentItem = null;
    this.cleanupHls();
    this.isHoveringPopup = false;
  }

  /** Remove from DOM */
  destroy(): void {
    this.cleanupHls();
    this.cancelHideTimeout();
    this.element.remove();
  }

  /**
   * Show popup for a ThreatEvent
   */
  showThreatEvent(event: ThreatEvent, x: number, y: number): void {
    this.hideNow();
    this.cancelHideTimeout();
    this.ensureAttached();
    this.mode = 'threatEvent';

    this.element.innerHTML = this.renderThreatEventPopup(event);
    this.element.classList.add('wm-style', 'map-popup--threat');
    this.element.style.cursor = 'default';
    this.element.style.width = '360px';
    this.element.style.maxWidth = 'min(360px, calc(100vw - 28px))';
    this.element.style.zIndex = '1200';
    this.element.style.visibility = 'hidden';
    this.element.style.display = 'block';
    this.positionPopupMeasured(x, y);
    this.element.style.visibility = 'visible';
    this.visible = true;

    this.element.querySelector('.wm-popup-close')?.addEventListener('click', () => this.hideNow());

    this.removeEscAndOutside();
    this.escKeyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') this.hideNow(); };
    this.outsideClickHandler = (e: MouseEvent) => {
      if (!this.element.contains(e.target as Node)) this.hideNow();
    };
    setTimeout(() => {
      document.addEventListener('keydown', this.escKeyHandler!);
      document.addEventListener('mousedown', this.outsideClickHandler!);
    }, 0);
  }

  private renderThreatEventPopup(event: ThreatEvent): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const severityColors = {
      critical: '#ef4444',
      high: '#f97316',
      medium: '#f59e0b',
      low: '#3b82f6'
    };
    const severityLabels = {
      critical: 'CRITIQUE',
      high: 'ÉLEVÉ',
      medium: 'MOYEN',
      low: 'FAIBLE'
    };
    const sColor = severityColors[event.severity];
    const sLabel = severityLabels[event.severity];

    const typeIcons = {
      leak: `${fmIcon('droplet')} LEAK`,
      ransomware: `${fmIcon('skull')} RANSOMWARE`,
      exposure: `${fmIcon('lock-keyhole')} EXPOSITION`,
      vulnerability: `${fmIcon('triangle-alert')} VULNÉRABILITÉ`
    };
    const typeLabel = typeIcons[event.type] || event.type.toUpperCase();
    const precisionLabels: Record<ThreatEvent['location']['precision'], string> = {
      hq: 'HQ / siège',
      city: 'Ville',
      region: 'Région',
      country: 'Pays',
      unknown: 'Non précisée',
    };
    const [lng, lat] = event.location.coordinates;
    const addressHtml = event.location.address
      ? `<div style="font-size:10px;color:rgba(224,242,254,0.72);margin-top:3px;line-height:1.35;">${esc(event.location.address)}</div>`
      : '';
    const locationHtml = `
      <div style="background:rgba(14,165,233,0.08); border:1px solid rgba(14,165,233,0.22); border-radius:8px; padding:10px 12px; margin:12px 0; display:grid; grid-template-columns:1fr auto; gap:8px; align-items:center;">
        <div>
          <div style="font-size:9px;color:rgba(186,230,253,0.68);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:3px;">Localisation</div>
          <div style="font-size:12px;color:#e0f2fe;font-weight:700;">${fmIcon('map-pin')} ${esc(event.location.label)}</div>
          ${addressHtml}
          <div style="font-size:10px;color:rgba(255,255,255,0.45);margin-top:2px;">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
        </div>
        <span style="background:rgba(14,165,233,0.18);border:1px solid rgba(14,165,233,0.32);border-radius:999px;padding:3px 8px;color:#bae6fd;font-size:9px;font-weight:800;text-transform:uppercase;">${esc(precisionLabels[event.location.precision])}</span>
      </div>
    `;

    const initials = event.organizationName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'FR';
    const logoHtml = event.logoUrl
      ? `<img src="${esc(event.logoUrl)}" alt="" style="width:36px;height:36px;border-radius:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.14);object-fit:contain;padding:3px;box-sizing:border-box;" />`
      : `<div style="width:36px;height:36px;border-radius:6px;background:rgba(16,185,129,0.14);border:1px solid rgba(16,185,129,0.25);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#10b981;">${esc(initials)}</div>`;

    const formatMetric = (value: number): string => {
      if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
      if (value >= 1000) return `${Math.round(value / 1000)}K`;
      return String(value);
    };
    const attackNatureLabels: Record<ThreatEvent['type'], string> = {
      leak: 'Fuite de données',
      ransomware: 'Ransomware',
      exposure: 'Exposition',
      vulnerability: 'Vulnérabilité',
    };

    const factRows: Array<[string, string]> = [];
    factRows.push(['Attaque', attackNatureLabels[event.type]]);
    if (event.ransomwareGroup) factRows.push(['Groupe', event.ransomwareGroup]);
    factRows.push(['Date', new Date(event.date).toLocaleDateString('fr-FR')]);
    if (event.metrics?.records) factRows.push(['Volume', `${formatMetric(event.metrics.records)} comptes`]);
    if (event.metrics?.affectedAssets) factRows.push(['Surface exposee', `${formatMetric(event.metrics.affectedAssets)} actif${event.metrics.affectedAssets > 1 ? 's' : ''}`]);
    if (event.organizationProfile?.category) factRows.push(['Profil', event.organizationProfile.category]);
    if (event.organizationProfile?.employeeRange) factRows.push(['Effectif', event.organizationProfile.employeeRange]);
    if (event.organizationProfile?.activityCode) factRows.push(['NAF', event.organizationProfile.activityCode]);

    const factsHtml = factRows.length > 0
      ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:12px 0 10px;">
          ${factRows.slice(0, 6).map(([label, value]) => `
            <div style="background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.07);border-radius:7px;padding:8px 9px;min-width:0;">
              <div style="font-size:8px;color:rgba(255,255,255,0.38);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">${esc(label)}</div>
              <div style="font-size:10px;color:rgba(255,255,255,0.82);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(value)}">${esc(value)}</div>
            </div>
          `).join('')}
        </div>`
      : '';

    // Data compromised tags
    let tagsHtml = '';
    if (event.compromisedData && event.compromisedData.length > 0) {
      tagsHtml = `
        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:12px;">
          ${event.compromisedData.map(d => `<span style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:2px 8px;font-size:10px;color:var(--text-secondary);">${esc(d)}</span>`).join('')}
        </div>
      `;
    }

    // Sources footer
    const sourcesHtml = event.sources.map(s => s.name).join(' · ');

    return `
      <div style="background: rgba(10, 17, 30, 0.95); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 16px; color: var(--text-primary); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; min-width: 320px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
          <div style="display:flex; gap:12px; align-items:center;">
            ${logoHtml}
            <div>
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:14px;">🇫🇷</span>
                <strong style="font-size:16px; color:#fff;">${esc(event.organizationName)}</strong>
              </div>
              <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                ${esc([event.ransomwareGroup, event.domain, event.sector].filter(Boolean).join(' · ') || 'Secteur inconnu')}
              </div>
              <div style="font-size:10px; color:#7dd3fc; margin-top:3px;">
                ${fmIcon('map-pin')} ${esc(event.location.label)} · ${esc(precisionLabels[event.location.precision])}
              </div>
            </div>
          </div>
          <button class="wm-popup-close" style="background:transparent; border:none; color:var(--text-muted); font-size:20px; cursor:pointer; padding:0 4px; line-height:1;">&times;</button>
        </div>

        <div style="display:flex; gap:8px; margin-bottom:16px;">
          <span style="background:${sColor}20; color:${sColor}; border:1px solid ${sColor}40; border-radius:12px; padding:2px 8px; font-size:10px; font-weight:700; letter-spacing:0.5px;">${sLabel}</span>
          <span style="background:rgba(59, 130, 246, 0.2); color:#60a5fa; border:1px solid rgba(59, 130, 246, 0.4); border-radius:12px; padding:2px 8px; font-size:10px; font-weight:600;">${typeLabel}</span>
          ${event.sourceLabel ? `<span style="background:rgba(16,185,129,0.16); color:#34d399; border:1px solid rgba(16,185,129,0.32); border-radius:12px; padding:2px 8px; font-size:10px; font-weight:600;">${esc(event.sourceLabel)}</span>` : ''}
        </div>

        ${factsHtml}
        ${locationHtml}

        <div style="background:rgba(255,255,255,0.03); border-radius:8px; padding:11px 12px; font-size:12px; line-height:1.45; color:var(--text-secondary);">
          ${esc(event.summary)}
        </div>

        ${tagsHtml}

        <div style="margin-top:16px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center;">
          <span style="color:#059669; font-size:10px; font-weight:600;">${esc(sourcesHtml)}</span>
          <span style="color:var(--text-muted); font-size:9px; text-transform:uppercase;">Confiance : ${esc(event.confidence)}</span>
        </div>
      </div>
    `;
  }
}
