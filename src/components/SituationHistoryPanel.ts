/**
 * SituationHistoryPanel.ts — Historique multi-jours de la situation nationale.
 *
 * Widget inline toujours visible dans la zone sous-carte (under-map-grid),
 * positionné au-dessus des flux d'actualités.
 * Affiche une timeline en barres (7j ou 30j). Chaque barre = un créneau 6h.
 * Survol = tooltip. Clic = détail inline.
 */

import type {
  HistoryResult,
  SituationSnapshot,
  SituationSeverity,
  HistorySlot,
} from '../types/index.ts';
import { getHistory } from '../services/situation-history.ts';

// ─── Colors ───────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<SituationSeverity, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  watch:    '#3b82f6',
};

const SEV_LABEL: Record<SituationSeverity, string> = {
  critical: 'CRIT',
  high:     'ÉLEVÉ',
  medium:   'MOYEN',
  watch:    'VEILLE',
};

const TYPE_ICON: Record<string, string> = {
  ENERGY_STRESS:           '⚡',
  IMPORT_DEPENDENCY_RISK:  '🔌',
  FLOOD_CRISIS:            '🌊',
  WILDFIRE_ESCALATION:     '🔥',
  CYBER_PRESSURE:          '🛡️',
  SOCIAL_ESCALATION:       '📢',
  TELECOM_DISRUPTION:      '📡',
  MARITIME_ANOMALY:        '⚓',
  DEFENSE_SIGNAL_ELEVATED: '✈️',
  FUEL_SUPPLY_RISK:        '⛽',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function slotKeyToLabel(slotKey: string): string {
  const d = new Date(slotKey + ':00.000Z');
  const months = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,'0')}h`;
}

function dayLabelFromSlotKey(slotKey: string): string {
  const [datePart] = slotKey.split('T');
  const [, m, d] = datePart.split('-');
  return `${d}/${m}`;
}

function groupByDay(slots: HistorySlot[]): HistorySlot[][] {
  const groups: HistorySlot[][] = [];
  let current: HistorySlot[] = [];
  let currentDay = '';
  for (const slot of slots) {
    const day = slot.slotKey.split('T')[0];
    if (day !== currentDay) {
      if (current.length) groups.push(current);
      current = [slot];
      currentDay = day;
    } else {
      current.push(slot);
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function aggregateDay(group: HistorySlot[]): {
  slotKey: string;
  avgScore: number;
  maxSeverity: SituationSeverity | null;
  captured: number;
  total: number;
  hasDegraded: boolean;
} {
  const captured = group.filter(s => !('status' in s)) as SituationSnapshot[];
  const total    = group.length;
  if (captured.length === 0) {
    return { slotKey: group[0].slotKey, avgScore: 0, maxSeverity: null, captured: 0, total, hasDegraded: false };
  }
  const avgScore = captured.reduce((sum, s) => sum + s.score, 0) / captured.length;
  const sevOrder: Record<SituationSeverity, number> = { critical: 4, high: 3, medium: 2, watch: 1 };
  const maxSeverity: SituationSeverity | null = captured.reduce<SituationSeverity | null>((best, s) => {
    const msev = s.meta.maxSeverity;
    if (!msev) return best;
    if (!best) return msev;
    return sevOrder[msev] > sevOrder[best] ? msev : best;
  }, null);
  const hasDegraded = captured.some(s => s.dataStatus.overall === 'degraded');
  return { slotKey: group[0].slotKey, avgScore: Math.round(avgScore), maxSeverity, captured: captured.length, total, hasDegraded };
}

// ─── Component ────────────────────────────────────────────────────────────────

export class SituationHistoryPanel {
  private el: HTMLElement;
  private tooltipEl: HTMLElement;
  private historyResult: HistoryResult | null = null;
  private currentDays: 7 | 30 = 7;
  private selectedSlotKey: string | null = null;

  constructor(_container: HTMLElement) {
    // Panel element — appended to body so it can be moved via mount()
    this.el = document.createElement('div');
    this.el.className = 'sit-hist under-map-card';

    // Global tooltip
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'sit-hist__tooltip';
    document.body.appendChild(this.tooltipEl);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Mount the widget into a given container element and start loading. */
  mount(container: HTMLElement): void {
    container.appendChild(this.el);
    if (!this.historyResult) {
      this.load(false);
    } else {
      this.render();
    }
  }

  /** Refresh data (force = bypass cache). */
  refresh(force = false): void {
    this.load(force);
  }

  destroy(): void {
    this.tooltipEl.remove();
    this.el.remove();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async load(force: boolean): Promise<void> {
    this.renderShell();
    try {
      this.historyResult = await getHistory(this.currentDays, force);
    } catch {
      // getHistory never throws, but be safe
    }
    this.selectedSlotKey = null;
    this.render();
  }

  private renderShell(): void {
    this.el.innerHTML = `
      ${this.renderHeader()}
      <div class="sit-hist__body">
        <div class="sit-hist__loading">Chargement…</div>
      </div>
    `;
    this.attachHeaderListeners();
  }

  private render(): void {
    if (!this.historyResult) { this.renderShell(); return; }
    this.el.innerHTML = `
      ${this.renderHeader()}
      <div class="sit-hist__body">
        ${this.renderLegend()}
        <div class="sit-hist__timeline-wrap">
          ${this.renderTimeline()}
          ${this.renderDayLabels()}
        </div>
        ${this.selectedSlotKey ? this.renderDetail() : ''}
      </div>
      ${this.renderFooter()}
    `;
    this.attachHeaderListeners();
    this.attachBarListeners();
  }

  private renderHeader(): string {
    const subtitle = this.currentDays === 7
      ? '7j · créneaux 6h'
      : '30j · agrégation journalière';
    return `
      <div class="under-map-card__header">
        <div class="under-map-card__header-copy">
          <div class="under-map-card__title">Historique situation</div>
        </div>
        <div class="sit-hist__controls-wrap">
          <span class="sit-hist__meta-label">${subtitle}</span>
          <div class="sit-hist__controls">
            <button class="sit-hist__toggle-btn ${this.currentDays === 7 ? 'is-active' : ''}" data-days="7" type="button">7j</button>
            <button class="sit-hist__toggle-btn ${this.currentDays === 30 ? 'is-active' : ''}" data-days="30" type="button">30j</button>
            <button class="sit-hist__refresh-btn" type="button">Refresh</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderLegend(): string {
    const items: [string, string][] = [
      ['#ef4444', 'Critique'],
      ['#f97316', 'Élevé'],
      ['#eab308', 'Moyen'],
      ['#3b82f6', 'Veille'],
      ['rgba(255,255,255,0.18)', 'Calme'],
    ];
    return `
      <div class="sit-hist__legend">
        ${items.map(([color, label]) => `
          <div class="sit-hist__legend-item">
            <div class="sit-hist__legend-dot" style="background:${color};"></div>
            <span>${label}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  private renderTimeline(): string {
    if (!this.historyResult) return '';
    const slots = this.historyResult.data.slots;
    return this.currentDays === 7
      ? this.renderTimeline7j(slots)
      : this.renderTimeline30j(slots);
  }

  private renderTimeline7j(slots: HistorySlot[]): string {
    const groups = groupByDay(slots);
    const lastGroupIdx = groups.length - 1;
    const dayGroups = groups.map((group, gi) => {
      const bars = group.map((slot, slotIdx) => {
        const globalIdx = slots.indexOf(slot);
        return this.renderBar(slot, globalIdx, slotIdx === group.length - 1 && gi === lastGroupIdx);
      }).join('');
      // On donne flex:1 à chaque groupe (chaque jour) pour qu'ils soient répartis équitablement
      return `<div class="sit-hist__day-group" style="flex:1; display:flex; align-items:flex-end; gap:1px;">${bars}</div>`;
    }).join('');
    return `<div class="sit-hist__timeline" style="width:100%; display:flex; gap:6px;">${dayGroups}</div>`;
  }

  private renderTimeline30j(slots: HistorySlot[]): string {
    const groups = groupByDay(slots);
    // On veut que ça occupe une largeur décente. On utilise flex:1 ou une largeur fixe correcte.
    const bars = groups.map((group, gi) => {
      const agg = aggregateDay(group);
      if (agg.captured === 0) {
        return `<div class="sit-hist__missing" data-slot="${escapeHtml(agg.slotKey)}" data-idx="${gi}" style="flex:1;"><div class="sit-hist__missing-dot"></div></div>`;
      }
      const barH  = Math.max(3, Math.ceil((agg.avgScore / 100) * 76));
      const color = agg.maxSeverity ? SEV_COLOR[agg.maxSeverity] : 'rgba(255,255,255,0.25)';
      const isSel = this.selectedSlotKey === agg.slotKey;
      const deg   = agg.captured < agg.total || agg.hasDegraded ? 'is-degraded' : '';
      return `
        <div class="sit-hist__bar ${deg}"
          style="height:${barH}px;background:${color};color:${color};flex:1;${isSel ? `outline:1px solid ${color};outline-offset:1px;` : ''}"
          data-slot="${escapeHtml(agg.slotKey)}"
          data-idx="${gi}">
        </div>`;
    }).join('');
    return `<div class="sit-hist__timeline" style="gap:4px;display:flex;">${bars}</div>`;
  }

  private renderBar(slot: HistorySlot, idx: number, isCurrent: boolean): string {
    if ('status' in slot) {
      return `<div class="sit-hist__missing" data-slot="${escapeHtml(slot.slotKey)}" data-idx="${idx}" style="flex:1;"><div class="sit-hist__missing-dot"></div></div>`;
    }
    const snap  = slot as SituationSnapshot;
    const barH  = Math.max(3, Math.ceil((snap.score / 100) * 76));
    const color = snap.meta.maxSeverity ? SEV_COLOR[snap.meta.maxSeverity] : 'rgba(255,255,255,0.25)';
    const isSel = this.selectedSlotKey === snap.slotKey;
    const isDeg = snap.dataStatus.overall === 'degraded';
    return `
      <div class="sit-hist__bar ${isCurrent ? 'is-current' : ''} ${isDeg ? 'is-degraded' : ''}"
        style="height:${barH}px;background:${color};color:${color};flex:1;${isSel ? `outline:1px solid ${color};outline-offset:1px;` : ''}"
        data-slot="${escapeHtml(snap.slotKey)}"
        data-idx="${idx}">
      </div>`;
  }

  private renderDayLabels(): string {
    if (!this.historyResult) return '';
    const slots  = this.historyResult.data.slots;
    const groups = groupByDay(slots);
    const labels = groups.map((group, i) => {
      let text = '';
      if (this.currentDays === 7) text = dayLabelFromSlotKey(group[0].slotKey);
      else if (i % 5 === 0) text = dayLabelFromSlotKey(group[0].slotKey);
      
      return `<div class="sit-hist__day-label" style="flex:1;">${escapeHtml(text)}</div>`;
    }).join('');
    return `<div class="sit-hist__day-labels" style="display:flex;">${labels}</div>`;
  }

  private renderDetail(): string {
    if (!this.historyResult || !this.selectedSlotKey) return '';
    const slot = this.historyResult.data.slots.find(s => s.slotKey === this.selectedSlotKey);
    if (!slot || 'status' in slot) return '';
    const snap = slot as SituationSnapshot;

    if (snap.situations.length === 0) {
      return `<div class="sit-hist__detail"><div class="sit-hist__detail-title">${escapeHtml(slotKeyToLabel(snap.slotKey))} — Aucune situation active</div></div>`;
    }

    const items = snap.situations.map(s => {
      const color  = SEV_COLOR[s.severity];
      const icon   = TYPE_ICON[s.type] ?? '⚠️';
      const sevLbl = SEV_LABEL[s.severity];
      const zones  = s.affectedZones.join(', ');
      return `
        <div class="sit-hist__detail-item">
          <span class="sit-hist__detail-sev" style="background:${color}22;color:${color};border:1px solid ${color}44;">${escapeHtml(sevLbl)}</span>
          <span>${icon} ${escapeHtml(s.title)}${zones ? ` — <span style="color:var(--text-muted)">${escapeHtml(zones)}</span>` : ''}</span>
        </div>`;
    }).join('');

    return `
      <div class="sit-hist__detail">
        <div class="sit-hist__detail-title">${escapeHtml(slotKeyToLabel(snap.slotKey))} · CII ${snap.score}/100</div>
        ${items}
      </div>`;
  }

  private renderFooter(): string {
    if (!this.historyResult) return '';
    const r   = this.historyResult;
    const age = Math.round((Date.now() - new Date(r.fetchedAt).getTime()) / 60_000);
    const src = r.source === 'fresh'  ? `Serveur · il y a ${age} min`
              : r.source === 'cached' ? `Cache local · ${age} min`
              : `Réseau indisponible — données locales`;
    const warn = r.isDegraded
      ? `<span class="sit-hist__footer-warn">⚠ ${r.data.slotCount.missing} slots non capturés</span>`
      : '';
    return `
      <div class="sit-hist__footer">
        <span>${escapeHtml(src)}</span>
        ${warn}
      </div>`;
  }

  // ── Event listeners ─────────────────────────────────────────────────────────

  private attachHeaderListeners(): void {
    this.el.querySelector('.sit-hist__refresh-btn')?.addEventListener('click', () => this.load(true));
    this.el.querySelectorAll<HTMLElement>('[data-days]').forEach(btn => {
      btn.addEventListener('click', () => {
        const days = Number(btn.dataset['days']) as 7 | 30;
        if (days === this.currentDays) return;
        this.currentDays = days;
        this.historyResult = null;
        this.selectedSlotKey = null;
        this.load(false);
      });
    });
  }

  private attachBarListeners(): void {
    this.el.querySelectorAll<HTMLElement>('.sit-hist__bar, .sit-hist__missing').forEach(bar => {
      bar.addEventListener('mouseenter', e => this.showTooltip(e, bar));
      bar.addEventListener('mouseleave', () => this.hideTooltip());
      bar.addEventListener('click', () => {
        const slotKey = bar.dataset['slot'] ?? null;
        this.selectedSlotKey = this.selectedSlotKey === slotKey ? null : slotKey;
        this.render();
      });
    });
  }

  private showTooltip(e: MouseEvent, bar: HTMLElement): void {
    const slotKey = bar.dataset['slot'];
    if (!slotKey || !this.historyResult) return;

    const slot = this.historyResult.data.slots.find(s => s.slotKey === slotKey);
    if (!slot) return;

    let content: string;
    if ('status' in slot) {
      content = `<div class="sit-hist__tooltip-date">${escapeHtml(slotKeyToLabel(slotKey))}</div><div style="color:var(--text-muted)">Non capturé</div>`;
    } else {
      const snap      = slot as SituationSnapshot;
      const sevLbl    = snap.meta.maxSeverity ? SEV_LABEL[snap.meta.maxSeverity] : '—';
      const sevColor  = snap.meta.maxSeverity ? SEV_COLOR[snap.meta.maxSeverity] : 'inherit';
      const situations = snap.situations.slice(0, 2).map(s =>
        `<div class="sit-hist__tooltip-situ">${TYPE_ICON[s.type] ?? '⚠️'} ${escapeHtml(s.title)}</div>`
      ).join('');
      const more = snap.situations.length > 2
        ? `<div style="color:var(--text-muted);margin-top:2px;">+${snap.situations.length - 2} autres</div>`
        : '';
      content = `
        <div class="sit-hist__tooltip-date">${escapeHtml(slotKeyToLabel(slotKey))}</div>
        <div class="sit-hist__tooltip-score">CII : ${snap.score}/100 · <span style="color:${sevColor}">${escapeHtml(sevLbl)}</span></div>
        ${situations}${more}`;
    }

    this.tooltipEl.innerHTML = content;
    this.tooltipEl.classList.add('is-visible');
    const x = Math.min(e.clientX + 12, window.innerWidth - 240);
    const y = Math.max(8, Math.min(e.clientY - 10, window.innerHeight - 120));
    this.tooltipEl.style.left = `${x}px`;
    this.tooltipEl.style.top  = `${y}px`;
  }

  private hideTooltip(): void {
    this.tooltipEl.classList.remove('is-visible');
  }
}
