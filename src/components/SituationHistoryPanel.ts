/**
 * SituationHistoryPanel.ts — Multi-day history of France's national situation.
 *
 * Floating panel, opened on demand. Renders a bar timeline (7j or 30j).
 * Each bar = one 6h slot. Missing slots shown as dashed markers.
 * Hover = tooltip. Click bar = inline detail.
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
  // "2026-04-10T12:00" → "10 avr. 12h"
  const d = new Date(slotKey + ':00.000Z');
  const months = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,'0')}h`;
}

function dayLabelFromSlotKey(slotKey: string): string {
  // "2026-04-10T00:00" → "10/04"
  const [datePart] = slotKey.split('T');
  const [, m, d] = datePart.split('-');
  return `${d}/${m}`;
}

/** Group contiguous slots by UTC day for rendering. */
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

/** Aggregate a day group for 30d view. */
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

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'sit-hist';
    container.appendChild(this.el);

    // Global tooltip element
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'sit-hist__tooltip';
    document.body.appendChild(this.tooltipEl);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  open(): void {
    this.el.classList.add('is-open');
    if (!this.historyResult) {
      this.load(false);
    }
  }

  close(): void {
    this.el.classList.remove('is-open');
    this.hideTooltip();
  }

  isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  destroy(): void {
    this.tooltipEl.remove();
    this.el.remove();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async load(force: boolean): Promise<void> {
    this.renderShell(); // show loading state immediately
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
      <div style="padding: 12px 0; text-align: center; color: var(--text-muted, #94a3b8); font-size: 10px;">
        Chargement…
      </div>
    `;
    this.attachHeaderListeners();
  }

  private render(): void {
    if (!this.historyResult) { this.renderShell(); return; }
    this.el.innerHTML = `
      ${this.renderHeader()}
      ${this.renderTimeline()}
      ${this.renderDayLabels()}
      ${this.selectedSlotKey ? this.renderDetail() : ''}
      ${this.renderFooter()}
    `;
    this.attachHeaderListeners();
    this.attachBarListeners();
  }

  private renderHeader(): string {
    return `
      <div class="sit-hist__header">
        <span class="sit-hist__title">Historique situation</span>
        <button class="sit-hist__toggle-btn ${this.currentDays === 7 ? 'is-active' : ''}" data-days="7" type="button">7j</button>
        <button class="sit-hist__toggle-btn ${this.currentDays === 30 ? 'is-active' : ''}" data-days="30" type="button">30j</button>
        <button class="sit-hist__refresh-btn" type="button" title="Actualiser">↺</button>
        <button class="sit-hist__close-btn" type="button" title="Fermer">✕</button>
      </div>
    `;
  }

  private renderTimeline(): string {
    if (!this.historyResult) return '';
    const slots = this.historyResult.data.slots;

    if (this.currentDays === 7) {
      return this.renderTimeline7j(slots);
    } else {
      return this.renderTimeline30j(slots);
    }
  }

  private renderTimeline7j(slots: HistorySlot[]): string {
    const groups = groupByDay(slots);
    const lastGroupIdx = groups.length - 1;
    const dayGroups = groups.map((group, gi) => {
      const bars = group.map((slot, slotIdx) => {
        const globalIdx = slots.indexOf(slot);
        return this.renderBar(slot, globalIdx, slotIdx === group.length - 1 && gi === lastGroupIdx);
      }).join('');
      return `<div class="sit-hist__day-group">${bars}</div>`;
    }).join('');
    return `<div class="sit-hist__timeline">${dayGroups}</div>`;
  }

  private renderTimeline30j(slots: HistorySlot[]): string {
    const groups = groupByDay(slots);
    const bars = groups.map((group, gi) => {
      const agg = aggregateDay(group);
      if (agg.captured === 0) {
        return `<div class="sit-hist__missing" data-slot="${escapeHtml(agg.slotKey)}" data-idx="${gi}"><div class="sit-hist__missing-dot"></div></div>`;
      }
      const barH    = Math.max(3, Math.round((agg.avgScore / 100) * 56));
      const color   = agg.maxSeverity ? SEV_COLOR[agg.maxSeverity] : 'rgba(255,255,255,0.15)';
      const partial = agg.captured < agg.total;
      const isSel   = this.selectedSlotKey === agg.slotKey;
      return `
        <div class="sit-hist__bar ${partial ? 'is-degraded' : ''} ${agg.hasDegraded ? 'is-degraded' : ''}"
          style="height:${barH}px;background:${color};${isSel ? `outline:1px solid ${color};` : ''}"
          data-slot="${escapeHtml(agg.slotKey)}"
          data-idx="${gi}"
          data-score="${agg.avgScore}"
          data-sev="${agg.maxSeverity ?? ''}"
          data-partial="${agg.captured}/${agg.total}">
        </div>`;
    }).join('');
    return `<div class="sit-hist__timeline" style="gap:2px;">${bars}</div>`;
  }

  private renderBar(slot: HistorySlot, idx: number, isCurrent: boolean): string {
    if ('status' in slot) {
      return `<div class="sit-hist__missing" data-slot="${escapeHtml(slot.slotKey)}" data-idx="${idx}"><div class="sit-hist__missing-dot"></div></div>`;
    }
    const snap   = slot as SituationSnapshot;
    const barH   = Math.max(3, Math.round((snap.score / 100) * 56));
    const color  = snap.meta.maxSeverity ? SEV_COLOR[snap.meta.maxSeverity] : 'rgba(255,255,255,0.2)';
    const isSel  = this.selectedSlotKey === snap.slotKey;
    const isDeg  = snap.dataStatus.overall === 'degraded';
    return `
      <div class="sit-hist__bar ${isCurrent ? 'is-current' : ''} ${isDeg ? 'is-degraded' : ''}"
        style="height:${barH}px;background:${color};color:${color};${isSel ? `outline:1px solid ${color};` : ''}"
        data-slot="${escapeHtml(snap.slotKey)}"
        data-idx="${idx}">
      </div>`;
  }

  private renderDayLabels(): string {
    if (!this.historyResult) return '';
    const slots = this.historyResult.data.slots;
    const groups = groupByDay(slots);

    // Show label for every Nth day to avoid crowding
    const showEvery = this.currentDays === 7 ? 1 : 5;
    const labels = groups.map((group, i) => {
      const text = i % showEvery === 0 ? dayLabelFromSlotKey(group[0].slotKey) : '';
      return `<div class="sit-hist__day-label">${escapeHtml(text)}</div>`;
    }).join('');
    return `<div class="sit-hist__day-labels">${labels}</div>`;
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
      const color   = SEV_COLOR[s.severity];
      const icon    = TYPE_ICON[s.type] ?? '⚠️';
      const sevLbl  = SEV_LABEL[s.severity];
      const zones   = s.affectedZones.join(', ');
      return `
        <div class="sit-hist__detail-item">
          <span class="sit-hist__detail-sev" style="background:${color}22;color:${color};border:1px solid ${color}44;">${escapeHtml(sevLbl)}</span>
          <span>${icon} ${escapeHtml(s.title)}${zones ? ` — <span style="color:var(--text-muted)">${escapeHtml(zones)}</span>` : ''}</span>
        </div>`;
    }).join('');

    return `
      <div class="sit-hist__detail">
        <div class="sit-hist__detail-title">${escapeHtml(slotKeyToLabel(snap.slotKey))} — CII ${snap.score}/100</div>
        ${items}
      </div>`;
  }

  private renderFooter(): string {
    if (!this.historyResult) return '';
    const r = this.historyResult;
    const age  = Math.round((Date.now() - new Date(r.fetchedAt).getTime()) / 60_000);
    const src  = r.source === 'fresh' ? `Serveur · il y a ${age} min`
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
    this.el.querySelector('.sit-hist__close-btn')?.addEventListener('click', () => this.close());
    this.el.querySelector('.sit-hist__refresh-btn')?.addEventListener('click', () => this.load(true));
    this.el.querySelectorAll<HTMLElement>('[data-days]').forEach(btn => {
      btn.addEventListener('click', () => {
        const days = Number(btn.dataset.days) as 7 | 30;
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
        const slotKey = bar.dataset.slot ?? null;
        this.selectedSlotKey = this.selectedSlotKey === slotKey ? null : slotKey;
        this.render();
      });
    });
  }

  private showTooltip(e: MouseEvent, bar: HTMLElement): void {
    const slotKey = bar.dataset.slot;
    if (!slotKey || !this.historyResult) return;

    const slot = this.historyResult.data.slots.find(s => s.slotKey === slotKey);
    if (!slot) return;

    let content: string;
    if ('status' in slot) {
      content = `<div class="sit-hist__tooltip-date">${escapeHtml(slotKeyToLabel(slotKey))}</div><div style="color:var(--text-muted)">Non capturé</div>`;
    } else {
      const snap     = slot as SituationSnapshot;
      const sevLbl   = snap.meta.maxSeverity ? SEV_LABEL[snap.meta.maxSeverity] : '—';
      const sevColor = snap.meta.maxSeverity ? SEV_COLOR[snap.meta.maxSeverity] : 'inherit';
      const situations = snap.situations.slice(0, 2).map(s =>
        `<div class="sit-hist__tooltip-situ">${TYPE_ICON[s.type] ?? '⚠️'} ${escapeHtml(s.title)}</div>`
      ).join('');
      const more = snap.situations.length > 2 ? `<div style="color:var(--text-muted);margin-top:2px;">+${snap.situations.length - 2} autres</div>` : '';
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
