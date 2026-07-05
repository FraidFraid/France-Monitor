/**
 * fetch-with-breaker.ts — Helper `fetch` résilient et réutilisable.
 *
 * Encapsule un appel réseau avec :
 *  - timeout via AbortSignal (défaut 10 s, configurable),
 *  - retry avec backoff exponentiel + jitter (défaut 2 tentatives),
 *  - circuit breaker PAR clé de source (cooldown après N échecs consécutifs,
 *    défaut 3 échecs → 5 min), état conservé dans une Map module-level,
 *  - intégration Watchdog optionnelle (report loading/success/failure automatique).
 *
 * Modèle de référence : le circuit breaker de src/services/hubeau-hydrometry.ts,
 * ici généralisé pour être partagé par tous les services.
 *
 * Contrat de retour :
 *  - Renvoie la `Response` dès qu'une réponse HTTP existe (y compris 4xx/5xx
 *    après épuisement des retries) → l'appelant DOIT vérifier `response.ok`.
 *  - Lève une erreur uniquement quand aucune réponse n'a pu être obtenue :
 *    échec réseau/timeout après épuisement des retries, ou circuit ouvert.
 *
 * Pattern d'appel recommandé (dégradation sans throw non capturé) :
 *   try {
 *     const res = await fetchWithBreaker(url, { breakerKey: 'ma-source', watchdogId: 'ma-source' });
 *     if (!res.ok) return fallbackVide;
 *     return await res.json();
 *   } catch {
 *     return fallbackVide;
 *   }
 */

import { Watchdog } from '../services/watchdog.ts';

// ─── Valeurs par défaut ───

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_RETRY_DELAY_MS = 800;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;

// ─── Options ───

export interface FetchWithBreakerOptions {
  /** Options natives passées à `fetch` (méthode, headers, body, signal…). */
  init?: RequestInit;
  /** Timeout par tentative en ms (défaut : 10 000). */
  timeoutMs?: number;
  /** Nombre de retries après la tentative initiale (défaut : 2 → 3 essais max). */
  retries?: number;
  /** Clé identifiant la source pour l'état du circuit breaker (obligatoire). */
  breakerKey: string;
  /** Id Watchdog optionnel : reporte loading/success/failure automatiquement. */
  watchdogId?: string;
  /** Nombre d'échecs consécutifs avant ouverture du circuit (défaut : 3). */
  failureThreshold?: number;
  /** Durée d'ouverture du circuit en ms (défaut : 5 min). */
  cooldownMs?: number;
  /** Délai de base entre retries en ms (défaut : 800). */
  retryDelayMs?: number;
  /** Délai maximal entre retries en ms (défaut : 10 000). */
  maxRetryDelayMs?: number;
}

// ─── État des breakers (module-level) ───

interface BreakerState {
  failureCount: number;
  openUntil: number; // timestamp ms ; 0 = fermé
}

const breakers = new Map<string, BreakerState>();

function getBreaker(key: string): BreakerState {
  let breaker = breakers.get(key);
  if (!breaker) {
    breaker = { failureCount: 0, openUntil: 0 };
    breakers.set(key, breaker);
  }
  return breaker;
}

function resetBreaker(breaker: BreakerState): void {
  breaker.failureCount = 0;
  breaker.openUntil = 0;
}

function recordFailure(breaker: BreakerState, threshold: number, cooldownMs: number): void {
  breaker.failureCount += 1;
  if (breaker.failureCount >= threshold) {
    breaker.openUntil = Date.now() + cooldownMs;
  }
}

/**
 * Réinitialise l'état d'un breaker (ou de tous si `key` omise).
 * Utile pour les tests et pour forcer une reprise manuelle.
 */
export function resetBreakerState(key?: string): void {
  if (key === undefined) {
    breakers.clear();
  } else {
    breakers.delete(key);
  }
}

// ─── Helpers ───

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function computeBackoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const delay = Math.min(baseMs * 2 ** attempt, maxMs);
  // Jitter 0-25 % pour éviter les tempêtes de retries synchronisées.
  return delay + Math.random() * delay * 0.25;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `fetch` avec timeout via AbortController, en respectant un éventuel
 * `init.signal` externe (le premier abort — timeout ou externe — l'emporte).
 */
async function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);

  const external = init?.signal ?? undefined;
  const onExternalAbort = (): void => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    if (external) external.removeEventListener('abort', onExternalAbort);
  }
}

// ─── API principale ───

/**
 * Effectue un `fetch` protégé par timeout, retry et circuit breaker.
 *
 * @throws quand aucune réponse HTTP n'est obtenue (réseau/timeout épuisés) ou
 *         quand le circuit est ouvert. Sinon renvoie la `Response` (vérifier `.ok`).
 */
export async function fetchWithBreaker(url: string, options: FetchWithBreakerOptions): Promise<Response> {
  const {
    init,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    breakerKey,
    watchdogId,
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
  } = options;

  const breaker = getBreaker(breakerKey);

  // Circuit ouvert : court-circuit immédiat.
  if (breaker.openUntil > Date.now()) {
    const message = `circuit breaker ouvert pour "${breakerKey}" (cooldown)`;
    if (watchdogId) Watchdog.report(watchdogId, { type: 'failure', error: message, isFallback: true });
    throw new Error(message);
  }

  if (watchdogId) Watchdog.report(watchdogId, { type: 'loading' });
  const startedAt = Date.now();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);

      // Réponse HTTP obtenue : le serveur est joignable → on referme le breaker.
      if (response.ok) {
        resetBreaker(breaker);
        if (watchdogId) Watchdog.report(watchdogId, { type: 'success', responseTimeMs: Date.now() - startedAt });
        return response;
      }

      // 4xx (hors 429) : réponse définitive, pas de retry, pas d'échec breaker.
      if (!isRetryableStatus(response.status)) {
        resetBreaker(breaker);
        if (watchdogId) Watchdog.report(watchdogId, { type: 'failure', error: `HTTP ${response.status}` });
        return response;
      }

      // 5xx / 429 : erreur transitoire, on retente si possible.
      lastError = new Error(`HTTP ${response.status}`);
      if (attempt < retries) {
        await sleep(computeBackoffDelay(attempt, retryDelayMs, maxRetryDelayMs));
        continue;
      }
      // Retries épuisés mais on a une Response 5xx à rendre à l'appelant.
      recordFailure(breaker, failureThreshold, cooldownMs);
      if (watchdogId) Watchdog.report(watchdogId, { type: 'failure', error: lastError.message });
      return response;
    } catch (error) {
      // Échec réseau / timeout / abort : aucune Response disponible.
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await sleep(computeBackoffDelay(attempt, retryDelayMs, maxRetryDelayMs));
        continue;
      }
    }
  }

  // Toutes les tentatives réseau ont échoué : on compte l'échec et on lève.
  recordFailure(breaker, failureThreshold, cooldownMs);
  const message = lastError?.message ?? `échec réseau pour ${url}`;
  if (watchdogId) Watchdog.report(watchdogId, { type: 'failure', error: message });
  throw lastError ?? new Error(message);
}
