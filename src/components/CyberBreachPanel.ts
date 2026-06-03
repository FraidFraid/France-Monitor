/**
 * CyberBreachPanel.ts — Panneau latéral Cartographie des Menaces Cyber
 * Style FrenchBreaches : liste scrollable, filtres, stats en-tête.
 */

import type { ThreatEvent } from '../types/index.ts';

type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type TypeFilter     = 'all' | 'ransomware' | 'leak' | 'exposure' | 'vulnerability';

export type BreachClickHandler = (event: ThreatEvent) => void;

const SEV_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#f59e0b',
  low:      '#3b82f6',
};
const SEV_LABELS: Record<string, string> = {
  critical: 'CRITIQUE',
  high:     'ÉLEVÉ',
  medium:   'MOYEN',
  low:      'FAIBLE',
};
const TYPE_ICONS: Record<string, string> = {
  ransomware:    '🏴‍☠️',
  leak:          '💧',
  exposure:      '🔓',
  vulnerability: '⚠️',
};
const TYPE_LABELS: Record<string, string> = {
  ransomware:    'Ransomware',
  leak:          'Fuite',
  exposure:      'Exposition',
  vulnerability: 'Vulnérabilité',
};

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function daysAgo(dateStr: string): string {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (d === 0) return "Aujourd'hui";
  if (d === 1) return 'Hier';
  return `il y a ${d}j`;
}

export class CyberBreachPanel {
  private el: HTMLElement | null = null;
  private events: ThreatEvent[] = [];
  private filteredEvents: ThreatEvent[] = [];
  private sevFilter: SeverityFilter = 'all';
  private typeFilter: TypeFilter = 'all';
  private searchQuery = '';
  private onBreachClick: BreachClickHandler | null = null;
  private visible = false;

  private container: HTMLElement;
  constructor(container: HTMLElement) { this.container = container; }

  setOnBreachClick(h: BreachClickHandler): void { this.onBreachClick = h; }

  mount(): void {
    this.el = document.createElement('div');
    this.el.className = 'breach-panel';
    this.el.style.cssText = `
      position: fixed; left: 380px; top: 0; width: 280px; height: 100vh;
      background: rgba(8, 14, 26, 0.97); backdrop-filter: blur(16px);
      border-right: 1px solid rgba(255,255,255,0.08);
      display: flex; flex-direction: column; z-index: 200;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transform: translateX(-110%); transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
    `;
    this.container.appendChild(this.el);
    this.render();
  }

  show(events: ThreatEvent[]): void {
    this.events = events;
    this.applyFilter();
    this.render();
    this.visible = true;
    if (this.el) this.el.style.transform = 'translateX(0)';
  }

  hide(): void {
    this.visible = false;
    if (this.el) this.el.style.transform = 'translateX(-100%)';
  }

  toggle(events: ThreatEvent[]): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show(events);
    }
  }

  isVisible(): boolean { return this.visible; }

  updateEvents(events: ThreatEvent[]): void {
    this.events = events;
    this.applyFilter();
    this.render();
  }

  private applyFilter(): void {
    this.filteredEvents = this.events.filter(e => {
      if (this.sevFilter  !== 'all' && e.severity !== this.sevFilter)  return false;
      if (this.typeFilter !== 'all' && e.type     !== this.typeFilter)  return false;
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        if (!e.organizationName.toLowerCase().includes(q) &&
            !(e.domain || '').toLowerCase().includes(q) &&
            !(e.sector || '').toLowerCase().includes(q)) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private render(): void {
    if (!this.el) return;

    const totalRecords = this.events.reduce((s, e) => s + (e.metrics?.records || 0), 0);
    const ransomCount  = this.events.filter(e => e.type === 'ransomware').length;

    this.el.innerHTML = `
      <!-- Header -->
      <div style="padding:16px 14px 10px; border-bottom:1px solid rgba(255,255,255,0.07); flex-shrink:0;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">🛡️</span>
            <div>
              <div style="font-size:13px; font-weight:700; color:#fff; letter-spacing:0.3px;">Menaces Cyber</div>
              <div style="font-size:10px; color:rgba(255,255,255,0.4); text-transform:uppercase; letter-spacing:0.5px;">France — Temps réel</div>
            </div>
          </div>
          <button id="breach-panel-close" style="background:transparent;border:none;color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;padding:4px 6px;border-radius:6px;">×</button>
        </div>

        <!-- Stats bar -->
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:12px;">
          ${this.statBox(String(this.events.length), 'INCIDENTS', '🎯')}
          ${this.statBox(fmt(totalRecords), 'RECORDS', '📊')}
          ${this.statBox(String(ransomCount), 'RANSOMWARES', '🏴‍☠️')}
        </div>

        <!-- Search -->
        <div style="position:relative; margin-bottom:10px;">
          <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:12px;color:rgba(255,255,255,0.3);">🔍</span>
          <input id="breach-search" type="text" placeholder="Entreprise, domaine, secteur..." value="${esc(this.searchQuery)}"
            style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;
                   padding:7px 10px 7px 28px;color:#fff;font-size:11px;outline:none;box-sizing:border-box;"/>
        </div>

        <!-- Severity filters -->
        <div style="display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px;">
          ${this.sevChip('all', 'TOUT', '#6b7280')}
          ${this.sevChip('critical', 'CRITIQUE', SEV_COLORS.critical)}
          ${this.sevChip('high', 'ÉLEVÉ', SEV_COLORS.high)}
          ${this.sevChip('medium', 'MOYEN', SEV_COLORS.medium)}
          ${this.sevChip('low', 'FAIBLE', SEV_COLORS.low)}
        </div>

        <!-- Type filters -->
        <div style="display:flex; gap:4px; flex-wrap:wrap;">
          ${this.typeChip('all',           '📋 Tout')}
          ${this.typeChip('ransomware',    '🏴‍☠️ Ransomware')}
          ${this.typeChip('leak',          '💧 Fuite')}
          ${this.typeChip('exposure',      '🔓 Exposition')}
          ${this.typeChip('vulnerability', '⚠️ Vuln.')}
        </div>
      </div>

      <!-- Count -->
      <div style="padding:8px 14px; border-bottom:1px solid rgba(255,255,255,0.05); flex-shrink:0;">
        <span style="font-size:11px; color:rgba(255,255,255,0.4);">
          ${this.filteredEvents.length} résultat${this.filteredEvents.length !== 1 ? 's' : ''}
          ${this.filteredEvents.length !== this.events.length ? ` sur ${this.events.length}` : ''}
        </span>
      </div>

      <!-- List -->
      <div id="breach-list" style="flex:1; overflow-y:auto; padding:8px 0;">
        ${this.filteredEvents.length === 0
          ? `<div style="padding:32px 16px; text-align:center; color:rgba(255,255,255,0.3); font-size:12px;">Aucun incident trouvé</div>`
          : this.filteredEvents.map(e => this.renderItem(e)).join('')
        }
      </div>

      <!-- Footer -->
      <div style="padding:10px 14px; border-top:1px solid rgba(255,255,255,0.07); flex-shrink:0;">
        <div style="font-size:9px; color:rgba(255,255,255,0.25); text-align:center; text-transform:uppercase; letter-spacing:0.5px;">
          Sources: FrenchBreaches · RansomwareLive · CERT-FR · Shodan · Censys
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private statBox(value: string, label: string, icon: string): string {
    return `
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:8px;text-align:center;">
        <div style="font-size:14px;">${icon}</div>
        <div style="font-size:14px;font-weight:700;color:#fff;margin:2px 0;">${value}</div>
        <div style="font-size:8px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
      </div>
    `;
  }

  private sevChip(val: SeverityFilter, label: string, color: string): string {
    const active = this.sevFilter === val;
    return `
      <button data-sev="${val}" style="
        background:${active ? color + '30' : 'rgba(255,255,255,0.04)'};
        color:${active ? color : 'rgba(255,255,255,0.5)'};
        border:1px solid ${active ? color + '60' : 'rgba(255,255,255,0.08)'};
        border-radius:6px; padding:3px 7px; font-size:9px; font-weight:700;
        cursor:pointer; letter-spacing:0.5px; transition:all 0.15s;">
        ${label}
      </button>`;
  }

  private typeChip(val: TypeFilter, label: string): string {
    const active = this.typeFilter === val;
    return `
      <button data-type="${val}" style="
        background:${active ? 'rgba(96,165,250,0.2)' : 'rgba(255,255,255,0.04)'};
        color:${active ? '#60a5fa' : 'rgba(255,255,255,0.45)'};
        border:1px solid ${active ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.08)'};
        border-radius:6px; padding:3px 7px; font-size:9px; cursor:pointer; transition:all 0.15s;">
        ${label}
      </button>`;
  }

  private renderItem(e: ThreatEvent): string {
    const color   = SEV_COLORS[e.severity] || '#6b7280';
    const records = e.metrics?.records;
    const assets  = e.metrics?.affectedAssets;

    return `
      <div class="breach-item" data-id="${esc(e.id)}" style="
        padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.04);
        cursor:pointer; transition:background 0.15s; display:flex; align-items:flex-start; gap:10px;">

        <!-- Severity dot + type icon -->
        <div style="flex-shrink:0; padding-top:3px;">
          <div style="width:8px;height:8px;border-radius:50%;background:${color};box-shadow:0 0 6px ${color}60;"></div>
        </div>

        <div style="flex:1; min-width:0;">
          <!-- Org + flag -->
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">
            <span style="font-size:11px;">🇫🇷</span>
            <span style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(e.organizationName)}</span>
          </div>

          <!-- Date + type badge -->
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
            <span style="font-size:9px; color:rgba(255,255,255,0.35);">${daysAgo(e.date)}</span>
            <span style="font-size:9px; background:rgba(255,255,255,0.07); border-radius:4px; padding:1px 5px; color:rgba(255,255,255,0.45);">
              ${TYPE_ICONS[e.type] || ''} ${TYPE_LABELS[e.type] || e.type}
            </span>
            ${e.sector ? `<span style="font-size:9px;color:rgba(255,255,255,0.3);">${esc(e.sector)}</span>` : ''}
          </div>

          <!-- Records / severity -->
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <span style="font-size:10px; color:rgba(255,255,255,0.4);">
              ${records ? `${fmt(records)} records` : assets ? `${fmt(assets)} assets` : 'N/A records'}
            </span>
            <span style="font-size:9px;font-weight:700;color:${color};letter-spacing:0.5px;">${SEV_LABELS[e.severity] || e.severity.toUpperCase()}</span>
          </div>
        </div>
      </div>`;
  }

  private bindEvents(): void {
    if (!this.el) return;

    // Close
    this.el.querySelector('#breach-panel-close')?.addEventListener('click', () => this.hide());

    // Search
    const searchEl = this.el.querySelector<HTMLInputElement>('#breach-search');
    let debounce: ReturnType<typeof setTimeout>;
    searchEl?.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.searchQuery = searchEl.value.trim();
        this.applyFilter();
        this.render();
      }, 200);
    });

    // Severity chips
    this.el.querySelectorAll<HTMLElement>('[data-sev]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sevFilter = btn.dataset.sev as SeverityFilter;
        this.applyFilter();
        this.render();
      });
    });

    // Type chips
    this.el.querySelectorAll<HTMLElement>('[data-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.typeFilter = btn.dataset.type as TypeFilter;
        this.applyFilter();
        this.render();
      });
    });

    // Item click
    this.el.querySelectorAll<HTMLElement>('.breach-item').forEach(item => {
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.04)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        const evt = this.events.find(e => e.id === id);
        if (evt) this.onBreachClick?.(evt);
      });
    });
  }
}
