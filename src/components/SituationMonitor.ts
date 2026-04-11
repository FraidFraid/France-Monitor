/**
 * SituationMonitor.ts — Overlay flottant sur la carte.
 *
 * Affiche les situations opérationnelles détectées par le situation-engine.
 * Positionné en bas à gauche de la carte (au-dessus de l'attribution MapLibre).
 * Max 3 situations visibles dans l'overlay compact. Une vue détaillée expose la liste complète.
 * Indépendant du panneau France Intelligence (toujours visible).
 */

import type { DetectedSituation, SituationAction, SituationSeverity } from '../types/index.ts';

// ─── i18n minimal ─────────────────────────────────────────────────────────────

function t(lang: 'fr' | 'en', fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

function escapeHtml(str: string): string {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function actionTypeLabel(lang: 'fr' | 'en', actionType: SituationAction['actionType']): string {
  const labels: Record<SituationAction['actionType'], [string, string]> = {
    investigate: ['Enquête', 'Investigate'],
    monitor: ['Surveillance', 'Monitor'],
    'cross-check': ['Recoupement', 'Cross-check'],
    escalate: ['Escalade', 'Escalate'],
  };
  const [fr, en] = labels[actionType];
  return lang === 'fr' ? fr : en;
}

// ─── Severity display ──────────────────────────────────────────────────────────

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
  ENERGY_STRESS: '⚡',
  IMPORT_DEPENDENCY_RISK: '🔌',
  FLOOD_CRISIS: '🌊',
  WILDFIRE_ESCALATION: '🔥',
  CYBER_PRESSURE: '🛡️',
  SOCIAL_ESCALATION: '📢',
  TELECOM_DISRUPTION: '📡',
  MARITIME_ANOMALY: '⚓',
  DEFENSE_SIGNAL_ELEVATED: '✈️',
  FUEL_SUPPLY_RISK: '⛽',
  NEWS_ALERT: '📰',
  MILITARY_SURGE_ALERT: '✈️',
  WEATHER_ALERT: '🌩️',
  AIS_ANOMALY_ALERT: '⚓',
  DEFENSE_ALERT: '🛡️',
  GPS_JAMMING_ALERT: '📡',
};

// ─── Component ────────────────────────────────────────────────────────────────


export class SituationMonitor {
  private static readonly COMPACT_LIMIT = 3;
  private readonly el: HTMLElement;
  private readonly container: HTMLElement;
  private collapsed = false;
  private expandedAll = false;
  private allSituations: DetectedSituation[] = [];
  private lang: 'fr' | 'en' = 'fr';

  private onLayerActivate: ((layerKeys: string[]) => void) | null = null;
  private onFlyTo: ((lon: number, lat: number, zoom?: number) => void) | null = null;
  constructor(container: HTMLElement) {
    this.container = container;
    this.el = document.createElement('div');
    this.el.className = 'situation-monitor';
    this.el.setAttribute('aria-live', 'polite');
    this.el.style.display = 'none';
    this.container.appendChild(this.el);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setOnLayerActivate(handler: (layerKeys: string[]) => void): void {
    this.onLayerActivate = handler;
  }

  setOnFlyTo(handler: (lon: number, lat: number, zoom?: number) => void): void {
    this.onFlyTo = handler;
  }

  update(situations: DetectedSituation[], lang: 'fr' | 'en' = 'fr'): void {
    this.allSituations = [...situations];
    if (this.allSituations.length <= SituationMonitor.COMPACT_LIMIT) {
      this.expandedAll = false;
    }
    this.lang = lang;
    this.render();
  }

  destroy(): void {
    this.el.remove();
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  private render(): void {
    this.el.style.display = '';

    const visibleSituations = this.expandedAll
      ? this.allSituations
      : this.allSituations.slice(0, SituationMonitor.COMPACT_LIMIT);

    const critCount = this.allSituations.filter(s => s.severity === 'critical').length;
    const highCount = this.allSituations.filter(s => s.severity === 'high').length;
    const total = this.allSituations.length;
    const hiddenCount = Math.max(0, total - visibleSituations.length);

    const headerLabel = t(this.lang, 'Situations', 'Situations');
    const collapseTitle = this.collapsed
      ? t(this.lang, 'Afficher', 'Expand')
      : t(this.lang, 'Réduire', 'Collapse');
    const toggleAllLabel = this.expandedAll
      ? t(this.lang, 'Réduire la liste', 'Show less')
      : t(this.lang, 'Voir toutes', 'View all');

    // Dot indicator — grey when no active situations
    const worstColor = critCount > 0 ? SEV_COLOR.critical
      : highCount > 0 ? SEV_COLOR.high
        : total > 0 ? SEV_COLOR.medium
          : 'rgba(255,255,255,0.15)';

    // When no situations: show header only (hist. button remains accessible)
    const bodyHtml = total === 0 ? '' : `
      ${this.collapsed ? '' : `
        <div class="sit-mon__list">${visibleSituations.map(s => this.renderItem(s)).join('')}</div>
        ${total > SituationMonitor.COMPACT_LIMIT ? `
          <div class="sit-mon__footer">
            <button class="sit-mon__show-all" type="button">${toggleAllLabel}${!this.expandedAll && hiddenCount > 0 ? ` (+${hiddenCount})` : ''}</button>
          </div>
        ` : ''}
      `}`;

    this.el.innerHTML = `
      <header class="sit-mon__header">
        <span class="sit-mon__dot" style="background:${worstColor};"></span>
        <span class="sit-mon__title">${headerLabel}</span>
        ${total > 0 ? `<span class="sit-mon__count">${total}</span>` : ''}
        ${total > 0 ? `<button class="sit-mon__toggle" type="button" title="${collapseTitle}" aria-label="${collapseTitle}">${this.collapsed ? '▲' : '▼'}</button>` : ''}
      </header>
      ${bodyHtml}
    `;

    this.el.querySelector('.sit-mon__header')!.addEventListener('click', () => {
      if (total === 0) return; // nothing to collapse
      this.collapsed = !this.collapsed;
      this.expandedAll = false;
      this.render();
    });

    this.el.querySelectorAll<HTMLElement>('.sit-mon__item').forEach((itemEl, i) => {
      itemEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showDetail(visibleSituations[i]);
      });
    });

    this.el.querySelector<HTMLElement>('.sit-mon__show-all')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.expandedAll = !this.expandedAll;
      this.render();
    });
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

  // ── Detail popup ────────────────────────────────────────────────────────────

  private showDetail(s: DetectedSituation): void {
    // Remove any existing detail popup
    document.querySelector('.sit-mon__detail')?.remove();

    const color = SEV_COLOR[s.severity];
    const icon = TYPE_ICON[s.type] ?? '⚠️';
    const sevLabel = this.lang === 'fr' ? SEV_LABEL_FR[s.severity] : SEV_LABEL_EN[s.severity];
    const pct = Math.round(s.confidence * 100);

    const drivers = s.drivers.map(d => `<li>${escapeHtml(d)}</li>`).join('');
    const actions = s.recommendedActions.map((a) => this.renderAction(a)).join('');
    const zones = s.affectedZones.map(z => escapeHtml(z)).join(' · ');

    const sourcesHtml = s.sourceRefs.map(r =>
      `<span class="sit-mon__detail-source">${escapeHtml(r)}</span>`
    ).join('');

    // Bouton "Voir sur la carte" — affiché uniquement si la situation a des layers à activer
    const hasMapAction = (s.activateLayers && s.activateLayers.length > 0) || (s.lon != null && s.lat != null);
    const mapActionHtml = hasMapAction
      ? `<button type="button" class="sit-mon__detail-map-btn">Voir sur la carte \u2197</button>`
      : '';

    const detail = document.createElement('div');
    detail.className = 'sit-mon__detail';
    detail.innerHTML = `
      <div class="sit-mon__detail-inner">
        <header class="sit-mon__detail-header" style="border-left-color:${color};">
          <span>${icon}</span>
          <span class="sit-mon__detail-title">${escapeHtml(s.title)}</span>
          <span class="sit-mon__detail-badge" style="background:${color};">${sevLabel} · ${pct}%</span>
          <button class="sit-mon__detail-close" type="button" aria-label="Fermer">&#x2715;</button>
        </header>
        <p class="sit-mon__detail-summary">${escapeHtml(s.summary)}</p>
        ${zones ? `<div class="sit-mon__detail-zones">\uD83D\uDCCD ${zones}</div>` : ''}
        <div class="sit-mon__detail-cols">
          <div>
            <div class="sit-mon__detail-col-title">${t(this.lang, 'Facteurs', 'Drivers')}</div>
            <ul class="sit-mon__detail-list">${drivers}</ul>
          </div>
          <div>
            <div class="sit-mon__detail-col-title">${t(this.lang, 'Actions', 'Actions')}</div>
            <ul class="sit-mon__detail-list">${actions}</ul>
          </div>
        </div>
        <div class="sit-mon__detail-footer">
          <div class="sit-mon__detail-sources">${sourcesHtml}</div>
          ${mapActionHtml}
        </div>
      </div>
    `;

    // Fermeture : bouton ✕
    detail.querySelector<HTMLElement>('.sit-mon__detail-close')?.addEventListener('click', () => detail.remove());
    // Fermeture : clic sur le backdrop (hors inner)
    detail.addEventListener('click', (e) => { if (e.target === detail) detail.remove(); });

    // Bouton "Voir sur la carte" → active layers + fly-to + ferme la modal
    detail.querySelector<HTMLElement>('.sit-mon__detail-map-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (s.activateLayers && s.activateLayers.length > 0 && this.onLayerActivate) {
        this.onLayerActivate(s.activateLayers);
      }
      if (s.lon != null && s.lat != null && this.onFlyTo) {
        this.onFlyTo(s.lon, s.lat, 10);
      }
      detail.remove();
    });

    document.body.appendChild(detail);
  }

  private renderAction(actionItem: SituationAction): string {
    const label = actionTypeLabel(this.lang, actionItem.actionType);
    const automation = actionItem.automatable
      ? `<span class="sit-mon__action-auto">${t(this.lang, 'IA possible', 'AI possible')}</span>`
      : '';

    return `
      <li>
        <div class="sit-mon__action-text">${escapeHtml(actionItem.label)}</div>
        <div class="sit-mon__action-meta">
          <span class="sit-mon__action-owner">${escapeHtml(actionItem.ownerHint)}</span>
          <span class="sit-mon__action-type">${label}</span>
          ${automation}
        </div>
      </li>
    `;
  }
}
