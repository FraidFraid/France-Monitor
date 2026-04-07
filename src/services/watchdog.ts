/**
 * watchdog.ts — Registre d'observabilité centralisé (singleton).
 *
 * Chaque service l'importe et appelle Watchdog.report() autour de ses fetches.
 * App.ts s'abonne via Watchdog.on('update') pour pousser les snapshots vers StatusPanel.
 *
 * Usage côté service :
 *   import { Watchdog } from './watchdog.ts';
 *   Watchdog.register('my-source', { label: 'Ma Source', staleAfterMs: 10 * 60_000 });
 *   Watchdog.report('my-source', { type: 'loading' });
 *   Watchdog.report('my-source', { type: 'success', responseTimeMs: 312 });
 *
 * Usage côté App.ts :
 *   Watchdog.on('update', (snapshots) => {
 *     for (const s of snapshots) statusPanel?.updateSource(s.status.name, s.status);
 *   });
 */

import type {
  WatchdogEvent,
  WatchdogSourceConfig,
  WatchdogSnapshot,
  DataSourceStatus,
} from '../types/index.ts';

// ─── Internal state per source ────────────────────────────────────────────────

interface InternalState {
  config: WatchdogSourceConfig;
  status: DataSourceStatus;
  fetchCount: number;
  failureCount: number;
  fallbackCount: number;
  lastSuccessAt: number | null;   // Date.now() timestamp
  lastErrorAt: number | null;
  lastResponseTimeMs: number | null;
}

type UpdateCallback = (snapshots: WatchdogSnapshot[]) => void;

// ─── Registry ─────────────────────────────────────────────────────────────────

class WatchdogRegistry {
  private readonly sources = new Map<string, InternalState>();
  private readonly listeners: UpdateCallback[] = [];
  private staleTimer: ReturnType<typeof setInterval> | null = null;

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Déclare une source de données.
   * Idempotent : un second register() sur le même sourceId est ignoré.
   */
  register(sourceId: string, config: WatchdogSourceConfig): void {
    if (this.sources.has(sourceId)) return;

    this.sources.set(sourceId, {
      config,
      status: {
        name: config.label,
        lastUpdate: null,
        status: 'loading',
        detail: config.detail,
        freshness: config.freshness,
        lastSuccess: null,
        lastError: null,
        cacheAgeMs: null,
        fetchCount: 0,
        failureCount: 0,
        fallbackCount: 0,
        responseTimeMs: null,
      },
      fetchCount: 0,
      failureCount: 0,
      fallbackCount: 0,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastResponseTimeMs: null,
    });

    this.ensureStaleTimer();
  }

  // ── Reporting ────────────────────────────────────────────────────────────────

  /**
   * Reporte un événement pour une source.
   * Si la source n'est pas encore enregistrée, elle est auto-enregistrée
   * (compatibilité avec les services legacy qui n'appellent pas register()).
   */
  report(sourceId: string, event: WatchdogEvent): void {
    // Auto-register pour les services legacy
    if (!this.sources.has(sourceId)) {
      this.register(sourceId, { label: sourceId });
    }

    const state = this.sources.get(sourceId)!;
    const now = Date.now();

    switch (event.type) {
      case 'loading':
        state.fetchCount++;
        state.status.status = 'loading';
        state.status.lastUpdate = null;
        state.status.error = undefined;
        break;

      case 'success':
        state.lastSuccessAt = now;
        state.lastResponseTimeMs = event.responseTimeMs ?? null;
        state.status.status = 'ok';
        state.status.lastUpdate = new Date(now);
        state.status.lastSuccess = new Date(now);
        state.status.cacheAgeMs = 0;
        state.status.responseTimeMs = event.responseTimeMs ?? null;
        state.status.error = undefined;
        if (event.detail !== undefined) state.status.detail = event.detail;
        break;

      case 'failure': {
        state.failureCount++;
        state.lastErrorAt = now;
        // Si la source a déjà eu un succès, on passe en stale (cache figé)
        // sinon en error (jamais eu de données)
        state.status.status = state.lastSuccessAt !== null ? 'stale' : 'error';
        state.status.lastError = new Date(now);
        state.status.error = event.error;
        if (event.isFallback === true) {
          state.fallbackCount++;
        }
        break;
      }

      case 'fallback':
        state.fallbackCount++;
        // On préserve le detail de config, on y ajoute le fallback
        state.status.detail =
          (state.config.detail ? state.config.detail + ' · ' : '') +
          `fallback: ${event.reason}`;
        break;
    }

    // Synchroniser les compteurs dans le status exposé
    state.status.fetchCount = state.fetchCount;
    state.status.failureCount = state.failureCount;
    state.status.fallbackCount = state.fallbackCount;
    state.status.lastSuccess = state.lastSuccessAt ? new Date(state.lastSuccessAt) : null;
    state.status.lastError = state.lastErrorAt ? new Date(state.lastErrorAt) : null;

    this.emit();
  }

  // ── Snapshot export ──────────────────────────────────────────────────────────

  /**
   * Exporte un snapshot de toutes les sources avec cacheAgeMs recalculé en live.
   * Détecte automatiquement les sources qui sont passées en stale.
   */
  getSnapshot(): WatchdogSnapshot[] {
    const now = Date.now();
    const out: WatchdogSnapshot[] = [];

    for (const [sourceId, state] of this.sources) {
      // Recalcul âge cache
      if (state.lastSuccessAt !== null) {
        state.status.cacheAgeMs = now - state.lastSuccessAt;

        // Auto-passage en stale si le cache dépasse le seuil
        const staleAfter = state.config.staleAfterMs ?? 10 * 60_000;
        if (state.status.status === 'ok' && state.status.cacheAgeMs > staleAfter) {
          state.status.status = 'stale';
        }
      }

      // Clone pour l'export (évite les mutations externes)
      out.push({ sourceId, status: { ...state.status } });
    }

    return out;
  }

  // ── Subscriptions ────────────────────────────────────────────────────────────

  /**
   * S'abonne aux mises à jour.
   * Retourne une fonction de désabonnement.
   *
   * @example
   *   const unsub = Watchdog.on('update', (snapshots) => { ... });
   *   // Plus tard :
   *   unsub();
   */
  on(_event: 'update', cb: UpdateCallback): () => void {
    this.listeners.push(cb);
    return () => {
      const idx = this.listeners.indexOf(cb);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Retourne le snapshot d'une source spécifique.
   * Utile pour un polling ponctuel sans abonnement.
   */
  getSourceStatus(sourceId: string): DataSourceStatus | undefined {
    return this.sources.get(sourceId)?.status;
  }

  /**
   * Retourne les IDs de toutes les sources enregistrées.
   */
  getSourceIds(): string[] {
    return Array.from(this.sources.keys());
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private emit(): void {
    const snapshots = this.getSnapshot();
    for (const cb of this.listeners) {
      try { cb(snapshots); } catch (e) { console.error('[Watchdog] listener error', e); }
    }
  }

  /**
   * Timer qui re-émet toutes les 30s pour :
   *  - mettre à jour cacheAgeMs dans l'UI sans attendre un fetch
   *  - détecter les sources passées en stale
   */
  private ensureStaleTimer(): void {
    if (this.staleTimer !== null) return;
    this.staleTimer = setInterval(() => this.emit(), 30_000);
  }
}

// ─── Export singleton ──────────────────────────────────────────────────────────

export const Watchdog = new WatchdogRegistry();
