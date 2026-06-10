/**
 * AlertMonitor.ts — Overlay flottant dédié aux alertes live ex-toast.
 *
 * Visuellement aligné sur SituationMonitor, mais séparé pour ne pas
 * mélanger alertes temps réel et situations agrégées.
 */

import type { DetectedSituation, SituationSeverity } from '../types/index.ts';

function t(lang: 'fr' | 'en', fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

function escapeHtml(str: string): string {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

const SEV_COLOR: Record<SituationSeverity, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  watch: '#3b82f6',
};

const SEV_LABEL_FR: Record<SituationSeverity, string> = {
  critical: 'CRIT',
  high: 'ÉLEVÉ',
  medium: 'MOYEN',
  watch: 'VEILLE',
};

const SEV_LABEL_EN: Record<SituationSeverity, string> = {
  critical: 'CRIT',
  high: 'HIGH',
  medium: 'MEDIUM',
  watch: 'WATCH',
};

const TYPE_ICON: Record<string, string> = {
  NEWS_ALERT: '📰',
  MILITARY_SURGE_ALERT: '✈️',
  WEATHER_ALERT: '🌩️',
  AIS_ANOMALY_ALERT: '⚓',
  DEFENSE_ALERT: '🛡️',
  GPS_JAMMING_ALERT: '📡',
};

export class AlertMonitor {
  private static readonly COMPACT_LIMIT = 3;
  private static readonly STORAGE_KEY = 'france-monitor.alert-monitor-position';
  private static readonly DRAG_THRESHOLD_PX = 4;
  private readonly el: HTMLElement;
  private readonly container: HTMLElement;
  private collapsed = false;
  private expandedAll = false;
  private allAlerts: DetectedSituation[] = [];
  private lang: 'fr' | 'en' = 'fr';
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private dragging = false;
  private suppressNextHeaderClick = false;
  private hasCustomPosition = false;
  /** Re-render guard: signature of the last rendered content. */
  private lastRenderKey: string | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.el = document.createElement('div');
    this.el.className = 'alert-monitor';
    this.el.setAttribute('aria-live', 'polite');
    this.el.style.display = 'none';
    this.container.appendChild(this.el);
    this.restorePosition();
  }

  update(alerts: DetectedSituation[], lang: 'fr' | 'en' = 'fr'): void {
    this.allAlerts = [...alerts];
    if (this.allAlerts.length <= AlertMonitor.COMPACT_LIMIT) {
      this.expandedAll = false;
    }
    this.lang = lang;
    this.render();
  }

  destroy(): void {
    window.removeEventListener('resize', this.handleWindowResize);
    this.el.remove();
  }

  private render(): void {
    if (this.allAlerts.length === 0) {
      this.el.style.display = 'none';
      return;
    }

    this.el.style.display = '';

    // Skip the full innerHTML rebuild (and listener re-binding) when neither
    // the data nor the UI state (lang, collapsed, expanded) changed.
    const renderKey = [
      this.lang,
      String(this.collapsed),
      String(this.expandedAll),
      JSON.stringify(this.allAlerts),
    ].join('\u2225');
    if (renderKey === this.lastRenderKey) return;
    this.lastRenderKey = renderKey;

    const visibleAlerts = this.expandedAll
      ? this.allAlerts
      : this.allAlerts.slice(0, AlertMonitor.COMPACT_LIMIT);

    const critCount = this.allAlerts.filter((s) => s.severity === 'critical').length;
    const highCount = this.allAlerts.filter((s) => s.severity === 'high').length;
    const total = this.allAlerts.length;
    const hiddenCount = Math.max(0, total - visibleAlerts.length);
    const worstColor = critCount > 0 ? SEV_COLOR.critical : highCount > 0 ? SEV_COLOR.high : SEV_COLOR.medium;
    const collapseTitle = this.collapsed ? t(this.lang, 'Afficher', 'Expand') : t(this.lang, 'Réduire', 'Collapse');
    const toggleAllLabel = this.expandedAll ? t(this.lang, 'Réduire la liste', 'Show less') : t(this.lang, 'Voir toutes', 'View all');

    this.el.innerHTML = `
      <header class="sit-mon__header">
        <span class="sit-mon__dot" style="background:${worstColor};"></span>
        <span class="sit-mon__title">${t(this.lang, 'Alertes', 'Alerts')}</span>
        <span class="sit-mon__count">${total}</span>
        <button class="sit-mon__toggle" type="button" title="${collapseTitle}" aria-label="${collapseTitle}">
          ${this.collapsed ? '▲' : '▼'}
        </button>
      </header>
      ${this.collapsed ? '' : `
        <div class="sit-mon__list">${visibleAlerts.map((alert) => this.renderItem(alert)).join('')}</div>
        ${total > AlertMonitor.COMPACT_LIMIT ? `
          <div class="sit-mon__footer">
            <button class="sit-mon__show-all" type="button">${toggleAllLabel}${!this.expandedAll && hiddenCount > 0 ? ` (+${hiddenCount})` : ''}</button>
          </div>
        ` : ''}
      `}
    `;

    const headerEl = this.el.querySelector<HTMLElement>('.sit-mon__header');
    headerEl?.classList.add('sit-mon__header--draggable');
    this.bindDragHandle(headerEl);

    headerEl?.addEventListener('click', () => {
      if (this.suppressNextHeaderClick) {
        this.suppressNextHeaderClick = false;
        return;
      }
      this.collapsed = !this.collapsed;
      this.expandedAll = false;
      this.render();
    });

    this.el.querySelectorAll<HTMLElement>('.sit-mon__item').forEach((itemEl, i) => {
      itemEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showDetail(visibleAlerts[i]);
      });
    });

    this.el.querySelector<HTMLElement>('.sit-mon__show-all')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.expandedAll = !this.expandedAll;
      this.render();
    });
  }

  private bindDragHandle(headerEl: HTMLElement | null): void {
    headerEl?.addEventListener('pointerdown', this.handleHeaderPointerDown);
  }

  private readonly handleHeaderPointerDown = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button, a')) {
      return;
    }

    const rect = this.el.getBoundingClientRect();
    this.dragPointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragOffsetX = event.clientX - rect.left;
    this.dragOffsetY = event.clientY - rect.top;
    this.dragging = false;

    this.el.setPointerCapture(event.pointerId);
    this.el.addEventListener('pointermove', this.handlePointerMove);
    this.el.addEventListener('pointerup', this.handlePointerUp);
    this.el.addEventListener('pointercancel', this.handlePointerUp);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - this.dragStartX;
    const deltaY = event.clientY - this.dragStartY;
    if (!this.dragging && Math.hypot(deltaX, deltaY) < AlertMonitor.DRAG_THRESHOLD_PX) {
      return;
    }

    if (!this.dragging) {
      this.dragging = true;
      this.el.classList.add('is-dragging');
    }

    event.preventDefault();
    this.applyPointerPosition(event.clientX, event.clientY);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) {
      return;
    }

    if (this.el.hasPointerCapture(event.pointerId)) {
      this.el.releasePointerCapture(event.pointerId);
    }

    this.el.removeEventListener('pointermove', this.handlePointerMove);
    this.el.removeEventListener('pointerup', this.handlePointerUp);
    this.el.removeEventListener('pointercancel', this.handlePointerUp);

    if (this.dragging) {
      this.suppressNextHeaderClick = true;
      this.hasCustomPosition = true;
      this.persistPosition();
    }

    this.dragPointerId = null;
    this.dragging = false;
    this.el.classList.remove('is-dragging');
  };

  private readonly handleWindowResize = (): void => {
    if (!this.hasCustomPosition) {
      return;
    }

    const left = Number.parseFloat(this.el.style.left || '0');
    const top = Number.parseFloat(this.el.style.top || '0');
    this.applyPosition(left, top);
    this.persistPosition();
  };

  private applyPointerPosition(clientX: number, clientY: number): void {
    const containerRect = this.container.getBoundingClientRect();
    const left = clientX - containerRect.left - this.dragOffsetX + this.container.scrollLeft;
    const top = clientY - containerRect.top - this.dragOffsetY + this.container.scrollTop;
    this.applyPosition(left, top);
  }

  private applyPosition(left: number, top: number): void {
    const maxLeft = Math.max(12, this.container.scrollWidth - this.el.offsetWidth - 12);
    const maxTop = Math.max(12, this.container.scrollHeight - this.el.offsetHeight - 12);
    const nextLeft = Math.min(Math.max(12, left), maxLeft);
    const nextTop = Math.min(Math.max(12, top), maxTop);

    this.el.style.left = `${nextLeft}px`;
    this.el.style.top = `${nextTop}px`;
    this.el.style.right = 'auto';
    this.el.style.bottom = 'auto';
  }

  private persistPosition(): void {
    localStorage.setItem(AlertMonitor.STORAGE_KEY, JSON.stringify({
      left: this.el.style.left,
      top: this.el.style.top,
    }));
  }

  private restorePosition(): void {
    const raw = localStorage.getItem(AlertMonitor.STORAGE_KEY);
    if (!raw) {
      window.addEventListener('resize', this.handleWindowResize);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { left?: string; top?: string };
      if (parsed.left && parsed.top) {
        this.el.style.left = parsed.left;
        this.el.style.top = parsed.top;
        this.el.style.right = 'auto';
        this.el.style.bottom = 'auto';
        this.hasCustomPosition = true;
      }
    } catch {
      localStorage.removeItem(AlertMonitor.STORAGE_KEY);
    }

    window.addEventListener('resize', this.handleWindowResize);
  }

  private renderItem(s: DetectedSituation): string {
    const color = SEV_COLOR[s.severity];
    const sevLabel = this.lang === 'fr' ? SEV_LABEL_FR[s.severity] : SEV_LABEL_EN[s.severity];
    const icon = TYPE_ICON[s.type] ?? '⚠️';
    const pct = Math.round(s.confidence * 100);
    const zone = s.affectedZones[0] ? escapeHtml(s.affectedZones[0]) : '';
    const extraZones = s.affectedZones.length > 1 ? `+${s.affectedZones.length - 1}` : '';

    return `
      <div class="sit-mon__item" role="button" tabindex="0" title="${escapeHtml(s.summary)}">
        <span class="sit-mon__item-bar" style="background:${color};"></span>
        <div class="sit-mon__item-body">
          <div class="sit-mon__item-top">
            <span class="sit-mon__item-icon">${icon}</span>
            <span class="sit-mon__item-title">${escapeHtml(s.title)}</span>
            <span class="sit-mon__item-badge" style="color:${color};">${sevLabel}</span>
            <span class="sit-mon__item-conf">${pct}%</span>
          </div>
          ${zone ? `<div class="sit-mon__item-zone">📍 ${zone}${extraZones ? ` <span class="sit-mon__item-zone-extra">${extraZones}</span>` : ''}</div>` : ''}
        </div>
      </div>`;
  }

  private showDetail(s: DetectedSituation): void {
    document.querySelector('.sit-mon__detail')?.remove();

    const color = SEV_COLOR[s.severity];
    const icon = TYPE_ICON[s.type] ?? '⚠️';
    const sevLabel = this.lang === 'fr' ? SEV_LABEL_FR[s.severity] : SEV_LABEL_EN[s.severity];
    const pct = Math.round(s.confidence * 100);
    const zones = s.affectedZones.map((z) => escapeHtml(z)).join(' · ');

    const detail = document.createElement('div');
    detail.className = 'sit-mon__detail';
    detail.innerHTML = `
      <div class="sit-mon__detail-inner">
        <header class="sit-mon__detail-header" style="border-left-color:${color};">
          <span>${icon}</span>
          <span class="sit-mon__detail-title">${escapeHtml(s.title)}</span>
          <span class="sit-mon__detail-badge" style="background:${color};">${sevLabel} · ${pct}%</span>
          <button class="sit-mon__detail-close" type="button" aria-label="Fermer">✕</button>
        </header>
        <p class="sit-mon__detail-summary">${escapeHtml(s.summary)}</p>
        ${zones ? `<div class="sit-mon__detail-zones">📍 ${zones}</div>` : ''}
        ${s.linkUrl ? `
          <div class="alert-mon__detail-actions">
            <a
              class="alert-mon__detail-link"
              href="${escapeHtml(s.linkUrl)}"
              target="_blank"
              rel="noopener noreferrer"
            >${escapeHtml(s.linkLabel ?? t(this.lang, 'Ouvrir la source', 'Open source'))}</a>
          </div>
        ` : ''}
        <div class="sit-mon__detail-sources">${s.sourceRefs.map((r) => `<span class="sit-mon__detail-source" title="${escapeHtml(r)}">${escapeHtml(r)}</span>`).join('')}</div>
      </div>
    `;

    detail.querySelector('.sit-mon__detail-close')!.addEventListener('click', () => detail.remove());
    detail.addEventListener('click', (e) => { if (e.target === detail) detail.remove(); });
    document.body.appendChild(detail);
  }
}
