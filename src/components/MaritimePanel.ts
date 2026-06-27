/**
 * MaritimePanel.ts — Panel maritime OSINT flottant.
 * 3 tabs : Trafic FR | Marine Nationale | Alertes
 * Clic navire → modal détail complet avec trail SVG, risk analysis, liens externes.
 */

import { getAllLiveTraffic, getMilitaryShips, getAisConnectionState, NAVY_MMSI_SET, type MilitaryShip, type RiskLevel } from '../services/military-ships.ts';
import { FRENCH_MARITIME_TERRITORIES, type FrenchMaritimeTerritoryCode } from '../config/french-ports.ts';
import { BLACK_LIST_FLAGS, GREY_LIST_FLAGS, SANCTIONED_FLAGS } from '../config/risk-flags.ts';
import {
  applyPremiumCloseButtonHover,
  createPremiumIconHeader,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';
import { fmLoaderHTML } from './shared/loader.ts';

const RISK_COLORS: Record<RiskLevel, string> = {
  none: '#34c759', low: '#ffcc00', medium: '#ff9500', high: '#ff3b30', critical: '#ff2d55',
};

const SHIP_TYPE_ICONS: Record<string, string> = {
  'Cargo': '📦', 'Tanker': '🛢', 'Passagers': '🚢', 'Pêche': '🎣',
  'Militaire': '⚔️', 'Remorqueur/Spécial': '🔧', 'Plaisance': '⛵',
};

function shipIcon(type: string): string {
  for (const [k, v] of Object.entries(SHIP_TYPE_ICONS)) {
    if (type.includes(k)) return v;
  }
  return '⚓';
}

const NAV_STATUS_LABELS: Record<number, string> = {
  0: 'En route (moteur)', 1: 'Mouillé', 2: 'Commandement restreint',
  3: 'Manœuvre restreinte', 5: 'Amarré', 6: 'Échoué', 7: 'Pêche en cours',
  8: 'En voilure', 15: 'Indéfini',
};

export class MaritimePanel {
  private containerEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private activeTab: 'traffic' | 'navy' | 'alerts' = 'traffic';
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private onHighlightShipCb: ((mmsi: string | null) => void) | null = null;
  private isVisible = false;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private trafficVisibleCount = 20;
  private readonly trafficBatchSize = 20;
  private _searchQuery = '';
  private _activeFilter: 'all' | 'military' | 'high-risk' | 'suspect-flag' = 'all';
  private _activeTerritory: FrenchMaritimeTerritoryCode | 'all' = 'all';
  private _searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _staleBannerEl: HTMLElement | null = null;
  private _headerEl: HTMLElement | null = null;
  private _searchInputEl: HTMLInputElement | null = null;
  private _searchClearBtnEl: HTMLButtonElement | null = null;

  constructor(_parentEl: HTMLElement) {}

  setOnHighlightShip(cb: (mmsi: string | null) => void): void {
    this.onHighlightShipCb = cb;
  }

  show(): void {
    if (!this.containerEl) this.mount();
    this.isVisible = true;
    this.trafficVisibleCount = this.trafficBatchSize;
    this.containerEl.style.display = '';
    this._renderCurrentTab();
    this._updateAisBadge();
  }

  hide(): void {
    this.isVisible = false;
    this._searchQuery = '';
    this._activeFilter = 'all';
    if (this._searchDebounceTimer) { clearTimeout(this._searchDebounceTimer); this._searchDebounceTimer = null; }
    if (this._searchInputEl) this._searchInputEl.value = '';
    if (this._searchClearBtnEl) this._searchClearBtnEl.style.display = 'none';
    if (this.containerEl) this.containerEl.style.display = 'none';
    this.containerEl?.querySelector('.maritime-modal')?.remove();
    this.onHighlightShipCb?.(null);
  }

  mount(): void {
    if (this.containerEl) return; // idempotent

    this.containerEl = document.createElement('div');
    this.containerEl.style.cssText = `
      ${getPremiumModalStyle({
        width: '400px',
        maxHeight: 'min(640px, calc(100vh - 110px))',
        backgroundStart: 'rgba(7, 18, 31, 0.97)',
        backgroundEnd: 'rgba(8, 15, 27, 0.96)',
        borderColor: 'rgba(56, 189, 248, 0.16)',
        position: 'fixed',
        top: '68px',
        zIndex: 9999,
      })}
      cursor: grab;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = getPremiumCloseButtonStyle();
    applyPremiumCloseButtonHover(closeBtn);
    closeBtn.onclick = () => this.hide();
    this.containerEl.appendChild(closeBtn);

    const header = createPremiumIconHeader({
      icon: '⚓',
      title: 'Maritime',
      subtitle: 'Trafic FR, Marine nationale et alertes',
      gradientStart: 'rgba(8, 145, 178, 0.18)',
      gradientEnd: 'rgba(59, 130, 246, 0.10)',
      iconGradientStart: 'rgba(8, 145, 178, 0.22)',
      iconGradientEnd: 'rgba(59, 130, 246, 0.14)',
      titlePrefix: 'Approches maritimes',
      extraTopRowHtml: '<span id="ais-status-badge" style="display:inline-flex;margin-top:4px;font-size:9px;flex-shrink:0;"></span>',
    });
    this._headerEl = header;
    header.style.flexShrink = '0';
    this.containerEl.appendChild(header);

    const staleBanner = document.createElement('div');
    staleBanner.style.cssText = 'display:none;background:#1a1a2e;border-left:3px solid #F59E0B;padding:6px 12px;font-size:11px;color:#FCD34D;flex-shrink:0;';
    this._staleBannerEl = staleBanner;
    this.containerEl.appendChild(staleBanner);

    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:2px;padding:6px 12px;border-bottom:1px solid var(--border-color);';
    const tabDefs: Array<{ key: 'traffic' | 'navy' | 'alerts'; label: string }> = [
      { key: 'traffic', label: 'Trafic FR' },
      { key: 'navy', label: 'Marine Nat.' },
      { key: 'alerts', label: 'Alertes' },
    ];
    tabDefs.forEach(({ key, label }) => {
      const btn = document.createElement('button');
      btn.id = `mtab-${key}`;
      btn.textContent = label;
      btn.dataset['tab'] = key;
      btn.style.cssText = 'background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:4px 9px;border-radius:4px;font-size:11px;';
      btn.addEventListener('click', () => this._switchTab(key));
      tabBar.appendChild(btn);
    });
    this.containerEl.appendChild(tabBar);

    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'padding:6px 12px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid var(--border-color);flex-shrink:0;';

    // Search input
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.06);border-radius:6px;padding:4px 8px;';
    searchWrap.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">🔍</span>';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Nom, MMSI…';
    searchInput.style.cssText = 'background:transparent;border:none;color:var(--text-primary);font-size:11px;flex:1;outline:none;';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '✕';
    clearBtn.style.cssText = 'background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;display:none;padding:0;';
    clearBtn.onclick = () => {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      this._searchQuery = '';
      this._renderCurrentTab();
    };
    searchInput.addEventListener('input', () => {
      clearBtn.style.display = searchInput.value ? '' : 'none';
      if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
      this._searchDebounceTimer = setTimeout(() => {
        this._searchQuery = searchInput.value.trim();
        this._renderCurrentTab();
      }, 150);
    });
    this._searchInputEl = searchInput;
    this._searchClearBtnEl = clearBtn;
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(clearBtn);
    searchRow.appendChild(searchWrap);

    const territorySelect = document.createElement('select');
    territorySelect.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:var(--text-primary);font-size:10px;border-radius:6px;padding:5px 7px;outline:none;';
    territorySelect.innerHTML = [
      '<option value="all">Tous les territoires français</option>',
      ...FRENCH_MARITIME_TERRITORIES.map((territory) => `<option value="${territory.code}">${territory.name}</option>`),
    ].join('');
    territorySelect.addEventListener('change', () => {
      this._activeTerritory = territorySelect.value as FrenchMaritimeTerritoryCode | 'all';
      this.trafficVisibleCount = this.trafficBatchSize;
      this._renderCurrentTab();
    });
    searchRow.appendChild(territorySelect);

    // Filter chips
    const chipsRow = document.createElement('div');
    chipsRow.style.cssText = 'display:flex;gap:4px;';
    const chipDefs: Array<{ key: 'all' | 'military' | 'high-risk' | 'suspect-flag'; label: string }> = [
      { key: 'all', label: 'Tous' },
      { key: 'military', label: 'Militaire' },
      { key: 'high-risk', label: 'Risque élevé' },
      { key: 'suspect-flag', label: 'Pavillon suspect' },
    ];
    chipDefs.forEach(({ key, label }) => {
      const chip = document.createElement('button');
      chip.textContent = label;
      chip.dataset['filter'] = key;
      chip.style.cssText = `background:${key === 'all' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)'};border:1px solid rgba(255,255,255,${key === 'all' ? '0.15' : '0.08'});color:${key === 'all' ? 'var(--text-primary)' : 'var(--text-muted)'};cursor:pointer;padding:3px 8px;border-radius:12px;font-size:10px;white-space:nowrap;`;
      chip.addEventListener('click', () => {
        const newFilter = this._activeFilter === key ? 'all' : key;
        this._activeFilter = newFilter;
        // Update chip styles
        chipsRow.querySelectorAll('[data-filter]').forEach(c => {
          const cb = c as HTMLButtonElement;
          const isActive = cb.dataset['filter'] === this._activeFilter;
          cb.style.background = isActive ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
          cb.style.borderColor = isActive ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)';
          cb.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
        });
        this._renderCurrentTab();
      });
      chipsRow.appendChild(chip);
    });
    searchRow.appendChild(chipsRow);
    this.containerEl.appendChild(searchRow);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'maritime-panel-content';
    this.bodyEl.style.cssText = 'padding:8px 12px 12px;overflow-y:auto;flex:1;min-height:0;';
    this.containerEl.appendChild(this.bodyEl);

    document.body.appendChild(this.containerEl);
    this._setupDrag();

    this._switchTab('traffic');
    this._updateAisBadge();

    this.refreshInterval = setInterval(() => {
      if (!this.isVisible) return;
      this._renderCurrentTab();
      this._updateAisBadge();
    }, 10000);
  }

  showLoading(): void {
    if (!this.containerEl) this.mount();
    this.isVisible = true;
    this.containerEl.style.display = '';
    if (this.bodyEl) this.bodyEl.innerHTML = fmLoaderHTML({ text: 'Chargement du trafic maritime…' });
  }

  openShipModal(ship: MilitaryShip): void {
    if (!this.isVisible) return;
    this._openModal(ship);
  }

  openAlertsTab(): void {
    this._switchTab('alerts');
  }

  private _setupDrag(): void {
    this.containerEl.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      if ((e.target as HTMLElement).closest('.maritime-panel-content')) return;
      this.isDragging = true;
      const rect = this.containerEl.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
      this.containerEl.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const x = e.clientX - this.dragOffsetX;
      const y = e.clientY - this.dragOffsetY;
      const maxX = window.innerWidth - this.containerEl.offsetWidth;
      const maxY = window.innerHeight - this.containerEl.offsetHeight;
      this.containerEl.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
      this.containerEl.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
      this.containerEl.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.containerEl.style.cursor = 'grab';
    });
  }

  private _switchTab(tab: 'traffic' | 'navy' | 'alerts'): void {
    this.activeTab = tab;
    if (tab === 'traffic' && this.trafficVisibleCount < this.trafficBatchSize) {
      this.trafficVisibleCount = this.trafficBatchSize;
    }
    this.containerEl.querySelectorAll('[data-tab]').forEach(btn => {
      const b = btn as HTMLButtonElement;
      const isActive = b.dataset['tab'] === tab;
      b.style.background = isActive ? 'rgba(255,255,255,0.08)' : 'transparent';
      b.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
    });
    this._renderCurrentTab();
  }

  private _renderCurrentTab(): void {
    if (this.activeTab === 'traffic') this._renderTraffic();
    else if (this.activeTab === 'navy') this._renderNavy();
    else this._renderAlerts();
  }

  private _renderTraffic(): void {
    const isStale = ['stale', 'disconnected'].includes(getAisConnectionState().status);
    const ships = this._applyFilters(
      getAllLiveTraffic(10 * 60 * 1000, true, this._territoryCodeFilter())
        .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
    );
    const homonymCounts = this._getHomonymCounts(ships);

    if (ships.length === 0) {
      this.bodyEl.innerHTML = '<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:24px;">Aucun navire civil détecté sur le territoire sélectionné</div>';
      return;
    }

    const alertShips = ships.filter((s) => s.riskLevel && ['medium', 'high', 'critical'].includes(s.riskLevel));
    const stats = document.createElement('div');
    stats.style.cssText = 'display:flex;gap:12px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border-color);';

    const shipsStat = document.createElement('div');
    shipsStat.style.cssText = 'text-align:center;';
    shipsStat.innerHTML = `<div style="color:var(--text-primary);font-weight:700;font-size:16px;">${ships.length}</div><div style="color:var(--text-muted);font-size:9px;">navires</div>`;

    const alertsStat = document.createElement('button');
    alertsStat.type = 'button';
    alertsStat.style.cssText = `text-align:center;background:${alertShips.length > 0 ? 'rgba(255,59,48,0.08)' : 'transparent'};border:${alertShips.length > 0 ? '1px solid rgba(255,59,48,0.2)' : '1px solid transparent'};border-radius:6px;padding:4px 10px;cursor:${alertShips.length > 0 ? 'pointer' : 'default'};`;
    alertsStat.innerHTML = `<div style="color:${alertShips.length > 0 ? '#ff3b30' : 'var(--text-muted)'};font-weight:700;font-size:16px;">${alertShips.length}</div><div style="color:var(--text-muted);font-size:9px;">alertes</div>`;
    if (alertShips.length > 0) {
      alertsStat.title = 'Afficher les alertes';
      alertsStat.addEventListener('click', () => this._switchTab('alerts'));
    } else {
      alertsStat.disabled = true;
    }

    stats.appendChild(shipsStat);
    stats.appendChild(alertsStat);
    this.bodyEl.innerHTML = '';
    this.bodyEl.appendChild(stats);

    const list = document.createElement('div');
    list.style.cssText = 'max-height:640px;overflow-y:auto;padding-right:4px;';
    const initialCount = Math.min(this.trafficVisibleCount, ships.length);
    this._appendTrafficCards(list, ships, 0, initialCount, isStale, homonymCounts);
    this.trafficVisibleCount = initialCount;
    list.addEventListener('scroll', () => {
      const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 80;
      if (!nearBottom || this.trafficVisibleCount >= ships.length) return;
      const nextCount = Math.min(this.trafficVisibleCount + this.trafficBatchSize, ships.length);
      this._appendTrafficCards(list, ships, this.trafficVisibleCount, nextCount, isStale, homonymCounts);
      this.trafficVisibleCount = nextCount;
    });
    this.bodyEl.appendChild(list);
  }

  private _appendTrafficCards(listEl: HTMLElement, ships: MilitaryShip[], startIndex: number, endIndex: number, isStale = false, homonymCounts?: Map<string, number>): void {
    for (let i = startIndex; i < endIndex; i += 1) {
      const ship = ships[i];
      if (!ship) continue;
      listEl.appendChild(this._shipCard(ship, this._isActionableAlert(ship) ? 'risque' : 'position', false, isStale, homonymCounts));
    }
  }

  private _renderNavy(): void {
    const isStale = ['stale', 'disconnected'].includes(getAisConnectionState().status);
    const ships = this._applyFilters(getMilitaryShips());
    const homonymCounts = this._getHomonymCounts(ships);
    this.bodyEl.innerHTML = '';
    const list = document.createElement('div');
    list.style.cssText = 'max-height:640px;overflow-y:auto;padding-right:4px;';
    ships.forEach(ship => list.appendChild(this._shipCard(ship, this._isActionableAlert(ship) ? 'risque' : 'position', false, isStale, homonymCounts)));
    this.bodyEl.appendChild(list);
  }

  private _renderAlerts(): void {
    const isStale = ['stale', 'disconnected'].includes(getAisConnectionState().status);
    const all = this._applyFilters(getAllLiveTraffic(10 * 60 * 1000, true, this._territoryCodeFilter()));
    const alerts = all.filter(s => s.riskLevel && ['medium', 'high', 'critical'].includes(s.riskLevel));
    const homonymCounts = this._getHomonymCounts(alerts);

    if (alerts.length === 0) {
      this.bodyEl.innerHTML = '<div style="color:#34c759;font-size:11px;text-align:center;padding:24px;">● Aucune alerte active</div>';
      return;
    }
    this.bodyEl.innerHTML = '';
    const list = document.createElement('div');
    list.style.cssText = 'max-height:640px;overflow-y:auto;padding-right:4px;';
    alerts.sort((a, b) => {
      const order: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
      return (order[b.riskLevel ?? 'none'] ?? 0) - (order[a.riskLevel ?? 'none'] ?? 0);
    }).forEach(ship => {
      const card = this._shipCard(ship, 'risque', true, isStale, homonymCounts);
      if (ship.riskReasons?.length) {
        const reasons = document.createElement('div');
        reasons.style.cssText = 'padding:4px 8px;background:rgba(255,59,48,0.05);border-radius:0 0 4px 4px;margin-top:-4px;';
        reasons.addEventListener('mouseenter', () => {
          this.onHighlightShipCb?.(ship.mmsi ?? null);
        });
        reasons.addEventListener('mouseleave', () => {
          this.onHighlightShipCb?.(null);
        });
        ship.riskReasons.forEach(r => {
          const tag = document.createElement('div');
          tag.style.cssText = 'color:#ff6b60;font-size:10px;padding:2px 0;';
          tag.textContent = `⚠ ${r}`;
          reasons.appendChild(tag);
        });
        card.appendChild(reasons);
      }
      list.appendChild(card);
    });
    this.bodyEl.appendChild(list);
  }

  private _isActionableAlert(ship: MilitaryShip): boolean {
    return ['medium', 'high', 'critical'].includes(ship.riskLevel ?? 'none');
  }

  private _normalizeShipNameKey(name?: string): string {
    return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private _getHomonymCounts(ships: MilitaryShip[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const ship of ships) {
      const key = this._normalizeShipNameKey(ship.name);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  private _shipCard(ship: MilitaryShip, initialTab: 'position' | 'risque' = 'position', showFullName = false, isStale = false, homonymCounts?: Map<string, number>): HTMLElement {
    const card = document.createElement('div');
    const riskColor = RISK_COLORS[ship.riskLevel ?? 'none'];
    const isNavy = !!ship.mmsi && NAVY_MMSI_SET.has(ship.mmsi);
    const nameKey = this._normalizeShipNameKey(ship.name);
    const hasHomonym = !!nameKey && (homonymCounts?.get(nameKey) ?? 0) > 1;
    const mmsiSuffix = ship.mmsi ? ship.mmsi.slice(-4) : '';
    card.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;';
    card.addEventListener('mouseenter', () => {
      card.style.background = 'rgba(255,255,255,0.04)';
      this.onHighlightShipCb?.(ship.mmsi ?? null);
    });
    card.addEventListener('mouseleave', () => {
      card.style.background = '';
      this.onHighlightShipCb?.(null);
    });
    card.addEventListener('click', () => this._openModal(ship, initialTab));

    const countryIso = ship.country?.split('|')[0] ?? '';
    const countryName = ship.country?.split('|')[1] ?? '';
    const flagEmoji = countryIso ? String.fromCodePoint(...countryIso.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0))) : '🏳';

    const elapsed = ship.lastSeen ? Math.round((Date.now() - ship.lastSeen) / 60000) : null;

    card.innerHTML = `
      <span style="font-size:18px;flex-shrink:0;">${shipIcon(ship.type)}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="color:var(--text-primary);font-weight:600;font-size:11px;${showFullName ? 'white-space:normal;overflow:visible;text-overflow:clip;max-width:none;line-height:1.25;' : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;'}">${ship.name}</span>
          ${isNavy ? '<span style="font-size:9px;color:#67e8f9;border:1px solid #67e8f944;border-radius:3px;padding:1px 4px;flex-shrink:0;">Marine nat.</span>' : ''}
          ${isNavy && ship.isLive === false ? '<span style="font-size:9px;color:#9ca3af;border:1px solid #9ca3af44;border-radius:3px;padding:1px 4px;flex-shrink:0;">port d’attache</span>' : ''}
          ${hasHomonym && !isNavy && mmsiSuffix ? `<span style="font-size:9px;color:var(--text-muted);border:1px solid rgba(255,255,255,0.12);border-radius:3px;padding:1px 4px;flex-shrink:0;">MMSI …${mmsiSuffix}</span>` : ''}
          ${isStale ? '<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:#F59E0B22;border:1px solid #F59E0B33;color:#F59E0B;font-size:9px;font-weight:700;letter-spacing:0.06em;flex-shrink:0;">CACHE FIGÉ</span>' : ''}
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${riskColor};flex-shrink:0;" title="${ship.riskLevel ?? 'none'}"></span>
        </div>
        <div style="color:var(--text-muted);font-size:10px;margin-top:1px;">${ship.type} · ${flagEmoji} ${countryName || 'Inconnu'}</div>
        <div style="color:var(--text-muted);font-size:10px;">
          ${ship.isLive === false ? 'position de référence' : ship.speed != null ? `${ship.speed.toFixed(1)} kn` : '—'}
          ${ship.maritimeTerritory ? ` · ${ship.maritimeTerritory.name}` : ''}
          ${ship.nearestPort ? ` → ${ship.nearestPort.name} (${ship.nearestPort.distanceKm}km)` : ''}
          ${hasHomonym && ship.mmsi ? ` · MMSI ${ship.mmsi}` : ''}
          ${elapsed != null ? ` · vu il y a ${elapsed}min` : ''}
        </div>
      </div>
      <span style="color:var(--text-muted);font-size:10px;flex-shrink:0;">›</span>`;

    return card;
  }

  private _openModal(ship: MilitaryShip, initialTab: 'position' | 'risque' = 'position'): void {
    const existing = this.containerEl.querySelector('.maritime-modal');
    if (existing) { existing.remove(); return; }

    const modal = document.createElement('div');
    modal.className = 'maritime-modal';
    modal.style.cssText = 'position:absolute;inset:0;background:var(--bg-surface);z-index:30;display:flex;flex-direction:column;overflow:hidden;border-radius:8px;';

    const countryIso = ship.country?.split('|')[0] ?? '';
    const countryName = ship.country?.split('|')[1] ?? '';
    const flagEmoji = countryIso ? String.fromCodePoint(...countryIso.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0))) : '🏳';
    const riskColor = RISK_COLORS[ship.riskLevel ?? 'none'];
    const riskLabel = { none: 'Nominal', low: 'Faible', medium: 'Modéré', high: 'Élevé', critical: 'Critique' }[ship.riskLevel ?? 'none'];

    const hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border-color);flex-shrink:0;';
    hdr.innerHTML = `
      <button id="maritime-back" style="background:rgba(255,255,255,0.1);border:none;color:var(--text-muted);cursor:pointer;width:26px;height:26px;border-radius:13px;font-size:13px;flex-shrink:0;">←</button>
      <span style="color:var(--text-primary);font-weight:600;font-size:13px;flex:1;">${ship.name}</span>
      <span style="background:${riskColor}22;border:1px solid ${riskColor}66;color:${riskColor};font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;">${riskLabel}</span>`;
    hdr.querySelector('#maritime-back')!.addEventListener('click', () => modal.remove());
    modal.appendChild(hdr);

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:14px;';

    body.innerHTML = `
      <div style="display:flex;gap:12px;margin-bottom:14px;">
        <div style="font-size:36px;">${shipIcon(ship.type)}</div>
        <div>
          <div style="color:var(--text-primary);font-weight:700;font-size:14px;">${ship.name}</div>
          <div style="color:var(--text-muted);font-size:11px;margin-top:2px;">${ship.type} · ${flagEmoji} ${countryName}</div>
          ${ship.mmsi ? `<div style="color:var(--text-muted);font-size:10px;margin-top:3px;font-family:monospace;">MMSI: ${ship.mmsi}</div>` : ''}
          ${ship.imoNumber ? `<div style="color:var(--text-muted);font-size:10px;font-family:monospace;">IMO: ${ship.imoNumber}</div>` : ''}
          ${ship.callSign ? `<div style="color:var(--text-muted);font-size:10px;font-family:monospace;">Call Sign: ${ship.callSign}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:2px;margin-bottom:10px;border-bottom:1px solid var(--border-color);padding-bottom:6px;" id="mship-tabs">
        <button data-tab="position" class="mstab" style="background:rgba(255,255,255,0.08);border:none;color:var(--text-primary);cursor:pointer;padding:4px 9px;border-radius:4px;font-size:11px;">Position</button>
        <button data-tab="specs" class="mstab" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:4px 9px;border-radius:4px;font-size:11px;">Specs</button>
        <button data-tab="risque" class="mstab" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:4px 9px;border-radius:4px;font-size:11px;">Risque</button>
        <button data-tab="liens" class="mstab" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:4px 9px;border-radius:4px;font-size:11px;">Liens</button>
      </div>
      <div id="mship-tab-content"></div>`;

    modal.appendChild(body);

    this.containerEl.appendChild(modal);

    this._setupShipTabs(modal, ship, flagEmoji, riskColor, initialTab);
  }

  private _setupShipTabs(modal: HTMLElement, ship: MilitaryShip, flagEmoji: string, riskColor: string, initialTab: 'position' | 'risque' = 'position'): void {
    const tabs = modal.querySelectorAll('.mstab');
    const contentEl = modal.querySelector('#mship-tab-content') as HTMLElement;

    const renderTab = (tabName: string) => {
      tabs.forEach(t => {
        const btn = t as HTMLButtonElement;
        const isActive = btn.dataset['tab'] === tabName;
        btn.style.background = isActive ? 'rgba(255,255,255,0.08)' : 'transparent';
        btn.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
      });

      if (tabName === 'position') {
        const navStatusLabel = ship.navStatus != null ? (NAV_STATUS_LABELS[ship.navStatus] ?? `Statut ${ship.navStatus}`) : '—';
        const destStr = ship.destination ?? (ship.nearestPort ? `~ ${ship.nearestPort.name}` : '—');
        const etaStr = ship.eta ? `${String(ship.eta.day).padStart(2, '0')}/${String(ship.eta.month).padStart(2, '0')} ${String(ship.eta.hour).padStart(2, '0')}:${String(ship.eta.minute).padStart(2, '0')} UTC` : '—';

        contentEl.innerHTML = `
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:11px;margin-bottom:12px;">
            <span style="color:var(--text-muted);">Statut</span><span style="color:var(--text-primary);">${navStatusLabel}</span>
            <span style="color:var(--text-muted);">Vitesse</span><span style="color:var(--text-primary);">${ship.speed != null ? ship.speed.toFixed(1) + ' nœuds' : '—'}</span>
            <span style="color:var(--text-muted);">Cap (COG)</span><span style="color:var(--text-primary);">${ship.cog != null ? ship.cog.toFixed(0) + '°' : '—'}</span>
            <span style="color:var(--text-muted);">Heading</span><span style="color:var(--text-primary);">${ship.heading != null ? ship.heading.toFixed(0) + '°' : '—'}</span>
            <span style="color:var(--text-muted);">Destination</span><span style="color:var(--text-primary);">${destStr}</span>
            <span style="color:var(--text-muted);">ETA</span><span style="color:var(--text-primary);">${etaStr}</span>
            <span style="color:var(--text-muted);">Port proche</span><span style="color:var(--text-primary);">${ship.nearestPort ? `${ship.nearestPort.name} (${ship.nearestPort.distanceKm} km)` : '—'}</span>
            <span style="color:var(--text-muted);">Territoire maritime</span><span style="color:var(--text-primary);">${ship.maritimeTerritory?.name ?? '—'}</span>
            <span style="color:var(--text-muted);">Coord.</span><span style="color:var(--text-primary);font-family:monospace;">${ship.lat.toFixed(4)}, ${ship.lon.toFixed(4)}</span>
          </div>
          ${ship.trail && ship.trail.length > 2 ? this._renderTrailSvg(ship.trail) : '<div style="color:var(--text-muted);font-size:10px;">Trail insuffisant</div>'}`;

      } else if (tabName === 'specs') {
        const dims = ship.dimensions;
        contentEl.innerHTML = `
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:11px;">
            <span style="color:var(--text-muted);">Type AIS</span><span style="color:var(--text-primary);">${ship.shipType != null ? `${ship.type} (code ${ship.shipType})` : ship.type}</span>
            <span style="color:var(--text-muted);">Pavillon</span><span style="color:var(--text-primary);">${flagEmoji} ${ship.country?.split('|')[1] ?? '—'}${ship.flagRisk && ship.flagRisk !== 'none' ? ` ⚠ (${ship.flagRisk})` : ''}</span>
            ${dims?.length ? `<span style="color:var(--text-muted);">Longueur</span><span style="color:var(--text-primary);">${dims.length} m</span>` : ''}
            ${dims?.width ? `<span style="color:var(--text-muted);">Largeur</span><span style="color:var(--text-primary);">${dims.width} m</span>` : ''}
            ${ship.draught ? `<span style="color:var(--text-muted);">Tirant d'eau</span><span style="color:var(--text-primary);">${ship.draught} m</span>` : ''}
            ${ship.port ? `<span style="color:var(--text-muted);">Port attache</span><span style="color:var(--text-primary);">${ship.port}</span>` : ''}
          </div>`;

      } else if (tabName === 'risque') {
        const riskLabel2 = { none: 'Nominal', low: 'Faible', medium: 'Modéré', high: 'Élevé', critical: 'Critique' }[ship.riskLevel ?? 'none'];
        contentEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px;background:${riskColor}11;border:1px solid ${riskColor}33;border-radius:6px;">
            <div style="width:10px;height:10px;border-radius:50%;background:${riskColor};flex-shrink:0;"></div>
            <span style="color:${riskColor};font-weight:700;font-size:13px;">Risque ${riskLabel2}</span>
          </div>
          ${ship.riskReasons?.length ? `
            <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Critères déclencheurs</div>
            ${ship.riskReasons.map(r => `<div style="padding:5px 8px;background:rgba(255,59,48,0.06);border-left:2px solid #ff3b30;margin-bottom:4px;font-size:11px;color:var(--text-primary);">${r}</div>`).join('')}
          ` : '<div style="color:var(--text-muted);font-size:11px;">Aucun critère de risque détecté</div>'}
          <div style="margin-top:12px;font-size:10px;color:var(--text-muted);line-height:1.5;">Sources : Paris MOU 2024, OFAC sanctions list, analyse comportementale AIS</div>`;

      } else if (tabName === 'liens') {
        contentEl.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${ship.mmsi ? `<a href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${ship.mmsi}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:5px;text-decoration:none;color:var(--text-primary);font-size:11px;">MarineTraffic <span style="color:var(--text-muted);">↗</span></a>` : ''}
            ${ship.mmsi ? `<a href="https://www.vesseltracker.com/en/Ships/mmsi/${ship.mmsi}.html" target="_blank" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:5px;text-decoration:none;color:var(--text-primary);font-size:11px;">VesselTracker <span style="color:var(--text-muted);">↗</span></a>` : ''}
            ${ship.mmsi ? `<a href="https://www.vesselfinderimage.com/?mmsi=${ship.mmsi}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:5px;text-decoration:none;color:var(--text-primary);font-size:11px;">VesselFinder <span style="color:var(--text-muted);">↗</span></a>` : ''}
            ${ship.imoNumber ? `<a href="https://www.equasis.org/EquasisWeb/public/HomePage" target="_blank" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:5px;text-decoration:none;color:var(--text-primary);font-size:11px;">Equasis (IMO) <span style="color:var(--text-muted);">↗</span></a>` : ''}
            ${ship.imoNumber ? `<a href="https://www.shipinfo.net/pages/default.aspx?shimsid=${ship.imoNumber}" target="_blank" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border-color);border-radius:5px;text-decoration:none;color:var(--text-primary);font-size:11px;">ShipInfo (propriétaire) <span style="color:var(--text-muted);">↗</span></a>` : ''}
          </div>
          <div style="margin-top:10px;font-size:10px;color:var(--text-muted);">Equasis donne accès aux données IMO : propriétaire, classe, certifications, inspections PSC.</div>`;
      }
    };

    tabs.forEach(t => t.addEventListener('click', () => renderTab((t as HTMLButtonElement).dataset['tab'] ?? '')));
    renderTab(initialTab);
  }

  private _renderTrailSvg(trail: Array<[number, number]>): string {
    if (trail.length < 2) return '';
    const lons = trail.map(p => p[0]);
    const lats = trail.map(p => p[1]);
    const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
    const W = 280; const H = 100; const PAD = 10;
    const scaleX = (lon: number) => PAD + (lon - minLon) / (maxLon - minLon || 1) * (W - 2 * PAD);
    const scaleY = (lat: number) => H - PAD - (lat - minLat) / (maxLat - minLat || 1) * (H - 2 * PAD);
    const points = trail.map(([lon, lat]) => `${scaleX(lon)},${scaleY(lat)}`).join(' ');
    const last = trail[trail.length - 1];
    return `
      <div style="margin-top:10px;">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;">Route récente (${trail.length} points)</div>
        <svg width="${W}" height="${H}" style="background:rgba(255,255,255,0.03);border-radius:4px;display:block;">
          <polyline points="${points}" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-opacity="0.7"/>
          <circle cx="${scaleX(last[0])}" cy="${scaleY(last[1])}" r="4" fill="#3b82f6"/>
        </svg>
      </div>`;
  }

  private _applyFilters(ships: MilitaryShip[]): MilitaryShip[] {
    let result = ships;

    // Filter chip
    if (this._activeFilter === 'military') {
      result = result.filter(s => s.mmsi && NAVY_MMSI_SET.has(s.mmsi));
    } else if (this._activeFilter === 'high-risk') {
      result = result.filter(s => s.riskLevel === 'high' || s.riskLevel === 'critical');
    } else if (this._activeFilter === 'suspect-flag') {
      result = result.filter(s => {
        if (!s.country || !s.country.includes('|')) return false;
        const iso = s.country.split('|')[0];
        return BLACK_LIST_FLAGS.has(iso) || GREY_LIST_FLAGS.has(iso) || SANCTIONED_FLAGS.has(iso);
      });
    }

    // Search
    const q = this._searchQuery.toLowerCase();
    if (q) {
      result = result.filter(s =>
        (s.name?.toLowerCase().includes(q)) ||
        (s.mmsi?.startsWith(q))
      );
    }

    return result;
  }

  private _territoryCodeFilter(): FrenchMaritimeTerritoryCode | undefined {
    return this._activeTerritory === 'all' ? undefined : this._activeTerritory;
  }

  private _updateAisBadge(): void {
    const badge = this.containerEl?.querySelector('#ais-status-badge') as HTMLElement | null;
    const state = getAisConnectionState();
    const isStale = state.status === 'stale' || state.status === 'disconnected';

    // Update header opacity
    if (this._headerEl) {
      this._headerEl.style.opacity = isStale ? '0.6' : '';
    }

    // Update stale banner
    if (this._staleBannerEl) {
      if (isStale) {
        const lastMs = state.lastMessageAt;
        const elapsedMin = lastMs ? Math.round((Date.now() - lastMs) / 60000) : null;
        const elapsedStr = elapsedMin != null ? `dernier contact il y a ${elapsedMin} min` : 'aucun contact';
        this._staleBannerEl.textContent = `⚠ AIS indisponible · ${elapsedStr}`;
        this._staleBannerEl.style.display = '';
      } else {
        this._staleBannerEl.style.display = 'none';
      }
    }

    // Update AIS status badge
    if (!badge) return;
    if (state.status === 'connected') {
      badge.style.cssText = 'color:#34c759;font-size:9px;';
      badge.textContent = `● ${state.franceShipCount} navires FR`;
    } else if (state.status === 'stale') {
      badge.style.cssText = 'color:#F59E0B;font-size:9px;';
      badge.textContent = `⚠ CACHE FIGÉ`;
    } else if (state.status === 'connecting' || state.status === 'disconnected') {
      badge.style.cssText = 'color:#ff9500;font-size:9px;';
      badge.textContent = `○ reconnexion…`;
    } else {
      badge.style.cssText = 'color:#ff3b30;font-size:9px;';
      badge.textContent = `✗ hors ligne`;
    }
  }

  destroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    if (this._searchDebounceTimer) { clearTimeout(this._searchDebounceTimer); this._searchDebounceTimer = null; }
    this.containerEl?.remove();
  }
}
