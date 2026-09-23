/**
 * api/_lib/jev-client.js — Client HTTP minimal pour l'API TypeSafe System One (Jev).
 *
 * Un seul `fetch`, aucune dépendance SDK (cf. contrainte "no new npm
 * dependencies" du chantier audit). Contrat vérifié auprès de
 * https://docs.typesafe.ai/api.md le 22/09/2026 :
 *
 *   POST https://api.typesafe.ai/v1/systemone
 *   Authorization: Bearer <clé>
 *   { state, model, questions } → { model, answers, usage: {input_tokens, output_tokens} }
 *   Erreurs : 401/403 clé invalide, 422 requête malformée, 429 quota dépassé,
 *   5xx (dont 529 "temporarily overloaded") erreur serveur.
 *
 * Modèle épinglé (JEV_MODEL) pour figer la calibration des probabilités : ne
 * pas passer à "jev-latest" sans revalider via scripts/eval-jev.mjs.
 */

import { QUESTIONS } from './jev-questions.js';

const SYSTEMONE_URL = 'https://api.typesafe.ai/v1/systemone';

/** Modèle épinglé — voir le commentaire d'en-tête. */
export const JEV_MODEL = 'jev-1.13.0';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Clé invalide ou absente (HTTP 401/403) — la passe appelante doit s'arrêter. */
export class JevAuthError extends Error {
  constructor(status, body) {
    super(`TypeSafe auth error (HTTP ${status})`);
    this.name = 'JevAuthError';
    this.status = status;
    this.body = body;
  }
}

/** Quota dépassé (HTTP 429) — la passe appelante doit s'arrêter. */
export class JevRateLimitError extends Error {
  constructor(status, body) {
    super(`TypeSafe rate limit (HTTP ${status})`);
    this.name = 'JevRateLimitError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Requête malformée (HTTP 422). La forme de la requête est identique pour
 * chaque article (mêmes questions) : une 422 est donc un bug de code, pas un
 * incident ponctuel — la passe appelante doit s'arrêter plutôt que de la
 * répéter à l'identique sur chaque article restant.
 */
export class JevValidationError extends Error {
  constructor(status, body) {
    super(`TypeSafe validation error (HTTP ${status})`);
    this.name = 'JevValidationError';
    this.status = status;
    this.body = body;
  }
}

/** Erreur serveur TypeSafe (HTTP 5xx, dont 529 "temporarily overloaded"). */
export class JevServerError extends Error {
  constructor(status, body) {
    super(`TypeSafe server error (HTTP ${status})`);
    this.name = 'JevServerError';
    this.status = status;
    this.body = body;
  }
}

/** Timeout ou erreur réseau — l'appelant doit passer à l'article suivant. */
export class JevTimeoutError extends Error {
  constructor(cause) {
    super('TypeSafe request timed out or network error');
    this.name = 'JevTimeoutError';
    this.cause = cause;
  }
}

/**
 * Score un article via l'API System One (Jev) : une requête, 9 questions en
 * parallèle sur le même état (fan-out spéculatif — cf. docs TypeSafe).
 *
 * @param {Record<string, unknown>} state — état construit par `buildState()` (jev-questions.js)
 * @param {{
 *   apiKey: string;
 *   fetchImpl?: typeof fetch;
 *   timeoutMs?: number;
 *   model?: string;
 *   questions?: Record<string, unknown>;
 * }} options
 * @returns {Promise<{
 *   model: string;
 *   answers: Record<string, { type: string; noul?: number; choice?: string; score?: number; probabilities?: Record<string, number>; confidence?: number }>;
 *   usage: { input_tokens: number; output_tokens: number };
 * }>}
 * @throws {JevAuthError} 401/403
 * @throws {JevRateLimitError} 429
 * @throws {JevValidationError} 422
 * @throws {JevServerError} 5xx
 * @throws {JevTimeoutError} timeout ou erreur réseau
 */
export async function scoreArticle(state, options = {}) {
  const {
    apiKey,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    model = JEV_MODEL,
    questions = QUESTIONS,
  } = options;

  /** @type {Response} */
  let res;
  try {
    res = await fetchImpl(SYSTEMONE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ state, model, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new JevTimeoutError(err);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const snippet = body.slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new JevAuthError(res.status, snippet);
    if (res.status === 429) throw new JevRateLimitError(res.status, snippet);
    if (res.status === 422) throw new JevValidationError(res.status, snippet);
    if (res.status >= 500) throw new JevServerError(res.status, snippet);
    const err = new Error(`TypeSafe HTTP ${res.status}: ${snippet}`);
    /** @type {any} */ (err).status = res.status;
    throw err;
  }

  return res.json();
}
