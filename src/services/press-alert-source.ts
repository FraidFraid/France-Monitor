// src/services/press-alert-source.ts — source des alertes presse d'« À traiter » et de l'AlertMonitor
// (spec 2026-09-28 § 4.7, revue finale C2). Garde le dernier état des événements et le sélecteur du
// module chargé à la demande (news-events.ts) ; la sélection est refaite à CHAQUE lecture pour que
// la limite de fraîcheur s'applique : des événements périmés rendent la main aux alertes par article.

import type { IntelEventsState, PressAlertEvent } from '../types/index.ts';

export type PressAlertSelector = (state: IntelEventsState, limit: number, now: number) => PressAlertEvent[] | null;

export class PressAlertSource {
  private state: IntelEventsState | null = null;
  private select: PressAlertSelector | null = null;

  update(state: IntelEventsState, select: PressAlertSelector): void {
    this.state = state;
    this.select = select;
  }

  /** Alertes issues des événements, ou null : repli sur le calcul par article. */
  current(limit: number, now: number): PressAlertEvent[] | null {
    return this.state && this.select ? this.select(this.state, limit, now) : null;
  }
}

/**
 * Retire du cache d'alertes les alertes presse de l'autre origine : par article (`news-alert-*`)
 * quand les événements prennent le relais, par événement (`news-event-*`) au retour du repli.
 */
export function pruneStalePressAlerts<T>(cache: Map<string, T>, fromEvents: boolean): void {
  const stale = fromEvents ? 'news-alert-' : 'news-event-';
  for (const key of [...cache.keys()]) {
    if (key.startsWith(stale)) cache.delete(key);
  }
}
