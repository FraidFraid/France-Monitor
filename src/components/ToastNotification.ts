/**
 * ToastNotification.ts — Système de notifications toast pour alertes critiques.
 * Affiche des notifications temporaires en bas de l'écran quand des articles
 * critiques arrivent ou quand des surges militaires sont détectés.
 */

import type { NewsItem } from '../types/index.ts';
import type { MilitarySurge } from '../config/military.ts';
import type { DefenseAlert } from '../services/cable-threats.ts';

/** Escape HTML to prevent XSS */
function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export type ToastClickHandler = (item: NewsItem) => void;
export type MilitarySurgeClickHandler = (surge: MilitarySurge) => void;
export type DefenseAlertClickHandler = (alert: DefenseAlert) => void;

export class ToastNotification {
  private container: HTMLElement;
  private onItemClick: ToastClickHandler | null = null;
  private onSurgeClick: MilitarySurgeClickHandler | null = null;
  private onDefenseAlertClick: DefenseAlertClickHandler | null = null;
  private activeToasts: Map<string, HTMLElement> = new Map();
  private seenSurges: Set<string> = new Set(); // Dedup surges by type+flightCount
  private seenDefenseAlerts: Set<string> = new Set(); // Dedup defense alerts by ship+cable
  private maxToasts = 3; // Maximum simultaneous toasts
  private autoHideMs = 8000; // Auto-dismiss after 8 seconds
  private surgeCooldownMs = 60_000; // 1 minute cooldown for same surge type
  private defenseAlertCooldownMs = 5 * 60_000; // 5 min cooldown for same cable threat

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  }

  /** Register a click handler for toast action button */
  setOnItemClick(handler: ToastClickHandler): void {
    this.onItemClick = handler;
  }

  /** Register a click handler for military surge toasts */
  setOnSurgeClick(handler: MilitarySurgeClickHandler): void {
    this.onSurgeClick = handler;
  }

  /** Register a click handler for defense alert toasts */
  setOnDefenseAlertClick(handler: DefenseAlertClickHandler): void {
    this.onDefenseAlertClick = handler;
  }

  /**
   * Show a toast notification for a news item.
   * Only shows for critical/high level threats.
   */
  show(item: NewsItem): void {
    // Only show toasts for critical/high alerts
    const level = item.threat?.level;
    if (level !== 'critical' && level !== 'high') return;

    // Don't show duplicate toasts
    if (this.activeToasts.has(item.id)) return;

    // Limit max toasts (remove oldest if needed)
    if (this.activeToasts.size >= this.maxToasts) {
      const firstKey = this.activeToasts.keys().next().value;
      if (firstKey) this.dismissToast(firstKey, false);
    }

    const toast = this.createToastElement(item);
    this.container.appendChild(toast);
    this.activeToasts.set(item.id, toast);

    // Auto-dismiss after delay
    setTimeout(() => {
      this.dismissToast(item.id, true);
    }, this.autoHideMs);
  }

  /**
   * Show toasts for multiple new critical items.
   * @param newItems Items that were just added (not previously seen)
   */
  showForNewCriticalItems(newItems: NewsItem[]): void {
    const criticalItems = newItems.filter(
      (item) =>
        item.threat?.level === 'critical' || item.threat?.level === 'high'
    );

    // Only show the most recent 2 to avoid spam
    for (const item of criticalItems.slice(0, 2)) {
      this.show(item);
    }
  }

  /**
   * Show toast notifications for military surge alerts.
   * Deduplicates by surge type to avoid spam.
   */
  showMilitarySurges(surges: MilitarySurge[]): void {
    for (const surge of surges) {
      this.showMilitarySurge(surge);
    }
  }

  /**
   * Show a single military surge toast.
   */
  showMilitarySurge(surge: MilitarySurge): void {
    // Create unique key for this surge type
    const surgeKey = `surge-${surge.type}-${surge.severity}`;

    // Skip if we've seen this recently
    if (this.seenSurges.has(surgeKey)) return;

    // Don't show duplicate toasts
    if (this.activeToasts.has(surgeKey)) return;

    // Limit max toasts (remove oldest if needed)
    if (this.activeToasts.size >= this.maxToasts) {
      const firstKey = this.activeToasts.keys().next().value;
      if (firstKey) this.dismissToast(firstKey, false);
    }

    const toast = this.createSurgeToastElement(surge, surgeKey);
    this.container.appendChild(toast);
    this.activeToasts.set(surgeKey, toast);
    this.seenSurges.add(surgeKey);

    // Auto-dismiss after delay
    const dismissTime = surge.severity === 'alert' ? 12000 : this.autoHideMs;
    setTimeout(() => {
      this.dismissToast(surgeKey, true);
    }, dismissTime);

    // Clear from seen list after cooldown
    setTimeout(() => {
      this.seenSurges.delete(surgeKey);
    }, this.surgeCooldownMs);
  }

  /**
   * Show toast notifications for defense alerts (cable threats).
   * Only shows high and medium severity alerts. Deduplicates by ship+cable.
   */
  showDefenseAlerts(alerts: DefenseAlert[]): void {
    // Filter to only show high and medium severity
    const significantAlerts = alerts.filter(a => a.severity === 'high' || a.severity === 'medium');
    // Show max 2 alerts to avoid spam
    for (const alert of significantAlerts.slice(0, 2)) {
      this.showDefenseAlert(alert);
    }
  }

  /**
   * Show a single defense alert toast.
   */
  showDefenseAlert(alert: DefenseAlert): void {
    // Create unique key for this alert (ship + cable)
    const alertKey = `defense-${alert.shipId}-${alert.cableId}`;

    // Skip if we've seen this recently
    if (this.seenDefenseAlerts.has(alertKey)) return;

    // Don't show duplicate toasts
    if (this.activeToasts.has(alertKey)) return;

    // Limit max toasts (remove oldest if needed)
    if (this.activeToasts.size >= this.maxToasts) {
      const firstKey = this.activeToasts.keys().next().value;
      if (firstKey) this.dismissToast(firstKey, false);
    }

    const toast = this.createDefenseAlertToastElement(alert, alertKey);
    this.container.appendChild(toast);
    this.activeToasts.set(alertKey, toast);
    this.seenDefenseAlerts.add(alertKey);

    // Auto-dismiss: longer for high severity
    const dismissTime = alert.severity === 'high' ? 12000 : this.autoHideMs;
    setTimeout(() => {
      this.dismissToast(alertKey, true);
    }, dismissTime);

    // Clear from seen list after cooldown
    setTimeout(() => {
      this.seenDefenseAlerts.delete(alertKey);
    }, this.defenseAlertCooldownMs);
  }

  /**
   * Create DOM element for a defense alert toast.
   */
  private createDefenseAlertToastElement(alert: DefenseAlert, alertKey: string): HTMLElement {
    const icons: Record<DefenseAlert['severity'], string> = {
      high: '🔴',
      medium: '🟠',
      low: '🟡',
    };
    const icon = icons[alert.severity];

    // Map severity to toast class
    const levelClass = alert.severity === 'high' ? 'critical' : alert.severity === 'medium' ? 'high' : 'medium';

    const distanceStr = alert.distanceMeters < 1000
      ? `${Math.round(alert.distanceMeters)}m`
      : `${(alert.distanceMeters / 1000).toFixed(1)}km`;

    const title = `${alert.shipName} près du câble ${alert.cableName} (${distanceStr})`;
    const truncatedTitle = title.length > 70 ? title.slice(0, 67) + '...' : title;

    const toast = document.createElement('div');
    toast.className = `toast toast--${levelClass} toast--defense`;
    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-title">${escapeHtml(truncatedTitle)}</span>
      <button class="toast-action">Voir</button>
      <button class="toast-close" title="Fermer">&times;</button>
    `;

    // Handle "Voir" button click
    const actionBtn = toast.querySelector('.toast-action') as HTMLButtonElement;
    actionBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissToast(alertKey, true);
      if (this.onDefenseAlertClick) {
        this.onDefenseAlertClick(alert);
      }
    });

    // Handle close button
    const closeBtn = toast.querySelector('.toast-close') as HTMLButtonElement;
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissToast(alertKey, true);
    });

    // Handle click on toast body
    toast.addEventListener('click', () => {
      this.dismissToast(alertKey, true);
      if (this.onDefenseAlertClick) {
        this.onDefenseAlertClick(alert);
      }
    });

    return toast;
  }

  /**
   * Create DOM element for a military surge toast.
   */
  private createSurgeToastElement(surge: MilitarySurge, surgeKey: string): HTMLElement {
    const icons: Record<MilitarySurge['type'], string> = {
      emergency: '🚨',
      high_value: '⚠️',
      concentration: '✈️',
    };
    const icon = icons[surge.type];

    // Map surge severity to toast class
    const levelClass = surge.severity === 'alert' ? 'critical' :
                       surge.severity === 'warning' ? 'high' : 'medium';

    const toast = document.createElement('div');
    toast.className = `toast toast--${levelClass} toast--military`;
    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-title">${escapeHtml(surge.description)}</span>
      <button class="toast-action">Voir</button>
      <button class="toast-close" title="Fermer">&times;</button>
    `;

    // Handle "Voir" button click
    const actionBtn = toast.querySelector('.toast-action') as HTMLButtonElement;
    actionBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissToast(surgeKey, true);
      if (this.onSurgeClick) {
        this.onSurgeClick(surge);
      }
    });

    // Handle close button
    const closeBtn = toast.querySelector('.toast-close') as HTMLButtonElement;
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissToast(surgeKey, true);
    });

    // Handle click on toast body
    toast.addEventListener('click', () => {
      this.dismissToast(surgeKey, true);
      if (this.onSurgeClick) {
        this.onSurgeClick(surge);
      }
    });

    return toast;
  }

  /**
   * Dismiss a toast by item ID.
   */
  private dismissToast(itemId: string, animate: boolean): void {
    const toast = this.activeToasts.get(itemId);
    if (!toast) return;

    if (animate) {
      toast.classList.add('toast--exiting');
      setTimeout(() => {
        toast.remove();
        this.activeToasts.delete(itemId);
      }, 250); // Match animation duration
    } else {
      toast.remove();
      this.activeToasts.delete(itemId);
    }
  }

  /**
   * Create the DOM element for a toast.
   */
  private createToastElement(item: NewsItem): HTMLElement {
    const level = item.threat?.level ?? 'high';
    const icon = level === 'critical' ? '🚨' : '⚠️';
    const truncatedTitle =
      item.title.length > 80 ? item.title.slice(0, 77) + '...' : item.title;

    const toast = document.createElement('div');
    toast.className = `toast toast--${level}`;
    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-title">${escapeHtml(truncatedTitle)}</span>
      <button class="toast-action">Voir</button>
      <button class="toast-close" title="Fermer">&times;</button>
    `;

    // Handle "Voir" button click
    const actionBtn = toast.querySelector('.toast-action') as HTMLButtonElement;
    actionBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissToast(item.id, true);
      if (this.onItemClick) {
        this.onItemClick(item);
      }
    });

    // Handle close button
    const closeBtn = toast.querySelector('.toast-close') as HTMLButtonElement;
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissToast(item.id, true);
    });

    // Handle click on toast body
    toast.addEventListener('click', () => {
      this.dismissToast(item.id, true);
      if (this.onItemClick) {
        this.onItemClick(item);
      }
    });

    return toast;
  }

  /**
   * Clear all active toasts.
   */
  clearAll(): void {
    for (const [id] of this.activeToasts) {
      this.dismissToast(id, false);
    }
    this.seenSurges.clear();
    this.seenDefenseAlerts.clear();
  }

  /**
   * Remove from DOM.
   */
  destroy(): void {
    this.clearAll();
    this.container.remove();
  }
}
