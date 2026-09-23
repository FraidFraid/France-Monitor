// api/_lib/groq-models.js — source unique des modèles Groq utilisés par le serveur.
//
// Pourquoi : Groq a retiré `llama-3.3-70b-versatile` (constaté le 23/09/2026 : 404 model_not_found),
// ce qui faisait échouer silencieusement résumés, synthèse ISNR, brief France et reclassification
// du cron (tous retombaient sur leur repli). Le modèle était codé en dur dans 6 fichiers.
//
// Remplacement vérifié le 23/09/2026 sur les invites réelles (JSON strict et résumé en français) :
//   - GROQ_MODEL      (brief, synthèse)              : openai/gpt-oss-120b
//   - GROQ_FAST_MODEL (résumés, classification cron) : openai/gpt-oss-20b
// Surchargeables par variables d'environnement si Groq retire encore un modèle.

/** Modèle « qualité » : textes longs et JSON structuré. */
export const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';

/** Modèle « rapide » : appels nombreux et courts. */
export const GROQ_FAST_MODEL = process.env.GROQ_FAST_MODEL?.trim() || 'openai/gpt-oss-20b';

/**
 * Paramètres propres au modèle. Les gpt-oss raisonnent avant de répondre : on limite l'effort
 * et on n'embarque pas le raisonnement dans la réponse. Les jetons de raisonnement comptent
 * dans `max_tokens`, d'où la marge ajoutée par `withReasoningHeadroom`.
 * @param {string} model
 * @returns {Record<string, unknown>}
 */
export function groqModelParams(model) {
  if (model.startsWith('openai/gpt-oss')) return { reasoning_effort: 'low', include_reasoning: false };
  return {};
}

/**
 * @param {string} model
 * @param {number} maxTokens  budget prévu pour la réponse visible
 * @returns {number}
 */
export function withReasoningHeadroom(model, maxTokens) {
  return model.startsWith('openai/gpt-oss') ? maxTokens + 256 : maxTokens;
}
