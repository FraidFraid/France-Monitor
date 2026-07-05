/**
 * SituationBrief.ts — Bandeau de synthèse d'ouverture.
 *
 * Répond au repositionnement produit : dès l'arrivée sur le dashboard, l'utilisateur
 * voit LA synthèse — les convergences critiques des dernières 24 h — sans rien activer.
 *
 * Positionné en haut au centre de la carte (sous le header), au-dessus des monitors
 * existants. Complémentaire de SituationMonitor (liste détaillée en bas à gauche), il
 * ne le remplace pas : il donne le verdict d'ouverture en ≤ 3 lignes.
 *
 * Source de données : le MÊME flux que SituationMonitor (aucun re-fetch du moteur).
 * L'historique 24 h (situations résolues) est injecté une fois via setRecent24h().
 */

import type { DetectedSituation, SituationSeverity, SituationType } from '../types/index.ts';
import {
  selectBriefItems,
  type BriefItem,
  type BriefSourceSituation,
} from '../services/situation-brief.ts';

// ─── Affichage sévérité ──────────────────────────────────────────────────────────

/** Couleurs par sévérité — variables CSS (dark mode par défaut, cohérent app). */
const SEV_VAR: Record<SituationSeverity, string> = {
  critical: 'var(--threat-critical, #ff2d55)',
  high: 'var(--threat-high, #ff6b35)',
  medium: 'var(--threat-medium, #ffcc00)',
  watch: 'var(--threat-info, #5ac8fa)',
};

const TYPE_ICON: Record<SituationType, string> = {
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

function escapeHtml(str: string): string {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Composant ───────────────────────────────────────────────────────────────────

export class SituationBrief {
  /** sessionStorage (PAS localStorage) : masquage limité à la session en cours. */
  private static readonly DISMISS_KEY = 'france-monitor.situation-brief-dismissed';

  private readonly el: HTMLElement;
  private readonly container: HTMLElement;

  /** Situations résolues des dernières 24 h (injectées une fois via setRecent24h). */
  private recent24h: BriefSourceSituation[] = [];
  /** Dernières situations actives reçues (flux moteur). */
  private activeSituations: DetectedSituation[] = [];
  /** Première observation en session, par id — sert de base au "depuis". */
  private readonly firstSeen = new Map<string, number>();
  /** Passe à true dès la première mise à jour du moteur (évite un flash "RAS"). */
  private ready = false;
  private dismissed = false;
  /** Signature du dernier rendu — évite les reconstructions inutiles. */
  private lastRenderKey: string | null = null;

  private onFlyTo: ((lon: number, lat: number, zoom?: number) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.dismissed = this.readDismissed();
    this.el = document.createElement('div');
    this.el.className = 'situation-brief';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.style.display = 'none';
    this.container.appendChild(this.el);
  }

  // ── API publique ─────────────────────────────────────────────────────────────

  setOnFlyTo(handler: (lon: number, lat: number, zoom?: number) => void): void {
    this.onFlyTo = handler;
  }

  /** Injecte l'historique 24 h (situations résolues). Appelé une fois au montage. */
  setRecent24h(items: BriefSourceSituation[]): void {
    this.recent24h = [...items];
    if (this.ready) this.recompute();
  }

  /** Branché sur le MÊME flux que SituationMonitor : appelé à chaque tick moteur. */
  update(active: DetectedSituation[]): void {
    this.activeSituations = [...active];
    this.ready = true;
    this.recompute();
  }

  destroy(): void {
    this.el.remove();
  }

  // ── Recalcul ─────────────────────────────────────────────────────────────────

  private recompute(): void {
    const now = Date.now();
    const activeIds = new Set(this.activeSituations.map((s) => s.id));

    // Ancrer le "depuis" à la première observation en session.
    for (const s of this.activeSituations) {
      if (!this.firstSeen.has(s.id)) this.firstSeen.set(s.id, now);
    }
    // Purger les situations disparues : une réapparition repart de zéro.
    for (const id of [...this.firstSeen.keys()]) {
      if (!activeIds.has(id)) this.firstSeen.delete(id);
    }

    const activeSources: BriefSourceSituation[] = this.activeSituations.map((s) => {
      const source: BriefSourceSituation = {
        id: s.id,
        type: s.type,
        severity: s.severity,
        title: s.title,
        affectedZones: s.affectedZones,
        since: this.firstSeen.get(s.id) ?? now,
      };
      if (s.lat != null) source.lat = s.lat;
      if (s.lon != null) source.lon = s.lon;
      return source;
    });

    this.render(selectBriefItems(activeSources, this.recent24h, now));
  }

  // ── Rendu ────────────────────────────────────────────────────────────────────

  private render(items: BriefItem[]): void {
    if (this.dismissed) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = '';

    const renderKey = JSON.stringify(items);
    if (renderKey === this.lastRenderKey) return;
    this.lastRenderKey = renderKey;

    const closeBtn =
      '<button type="button" class="sit-brief__close" aria-label="Masquer la synthèse">✕</button>';

    if (items.length === 0) {
      // État nominal ultra-compact : une ligne verte discrète.
      this.el.classList.add('sit-brief--nominal');
      this.el.innerHTML = `
        <div class="sit-brief__nominal">
          <span class="sit-brief__nominal-check">✓</span>
          <span class="sit-brief__nominal-text">Aucune convergence critique — situation nominale</span>
          ${closeBtn}
        </div>`;
      this.bindClose();
      return;
    }

    this.el.classList.remove('sit-brief--nominal');
    const hiddenOnMobile = items.length - 1;
    this.el.innerHTML = `
      <header class="sit-brief__header">
        <span class="sit-brief__title">Convergences — 24 h</span>
        <span class="sit-brief__badge">${items.length}</span>
        ${hiddenOnMobile > 0 ? `<span class="sit-brief__more">+${hiddenOnMobile}</span>` : ''}
        ${closeBtn}
      </header>
      <div class="sit-brief__list">
        ${items.map((item, i) => this.renderItem(item, i)).join('')}
      </div>`;

    this.bindClose();
    this.el.querySelectorAll<HTMLElement>('.sit-brief__item').forEach((itemEl, i) => {
      const item = items[i];
      const canFly = item.lat != null && item.lon != null;
      if (!canFly) return;
      itemEl.classList.add('sit-brief__item--clickable');
      itemEl.addEventListener('click', () => {
        if (item.lon != null && item.lat != null) this.onFlyTo?.(item.lon, item.lat, 8);
      });
    });
  }

  private renderItem(item: BriefItem, index: number): string {
    const color = SEV_VAR[item.severity];
    const icon = TYPE_ICON[item.type] ?? '⚠️';
    const zone = item.zone ? `<span class="sit-brief__item-zone">${escapeHtml(item.zone)}</span>` : '';
    const resolvedTag = item.resolved
      ? '<span class="sit-brief__item-resolved">résolu</span>'
      : '';
    const mobileHide = index > 0 ? ' sit-brief__item--secondary' : '';

    return `
      <div class="sit-brief__item${item.resolved ? ' sit-brief__item--resolved' : ''}${mobileHide}"
           role="listitem"
           title="${escapeHtml(`${item.severityLabel} · ${item.title}`)}">
        <span class="sit-brief__dot" style="background:${color};"></span>
        <span class="sit-brief__item-icon">${icon}</span>
        <span class="sit-brief__item-title">${escapeHtml(item.title)}</span>
        ${zone}
        ${resolvedTag}
        <span class="sit-brief__item-since">${escapeHtml(item.sinceLabel)}</span>
      </div>`;
  }

  private bindClose(): void {
    this.el.querySelector<HTMLElement>('.sit-brief__close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissed = true;
      this.writeDismissed();
      this.el.style.display = 'none';
    });
  }

  // ── Persistance session ────────────────────────────────────────────────────────

  private readDismissed(): boolean {
    try {
      return sessionStorage.getItem(SituationBrief.DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  }

  private writeDismissed(): void {
    try {
      sessionStorage.setItem(SituationBrief.DISMISS_KEY, '1');
    } catch {
      // sessionStorage indisponible — masquage limité au rendu courant.
    }
  }
}
