// scripts/llm-budget.mjs — appels LLM comptés pour les scripts de rejeu et de rattrapage.
//
// Le quota Groq gratuit (200 000 jetons par jour glissants, par modèle) est partagé avec la passe
// LLM de l'ingestion, qui ne réessaie pas un article refusé : un script qui l'épuise prive la
// production de LLM jusqu'à ce que ses jetons sortent de la fenêtre (vécu le 30/09 avec le rejeu
// complet, arrêté au 23e appel sur 26 par le plafond journalier).
import { classifyBatch } from '../api/_lib/llm-classifier.js';

/**
 * Estimation par appel, pour refuser un appel avant de dépasser le budget. Mesuré le 28/09 :
 * ~2 000 jetons par lot de 10 ; les lots aux résumés longs coûtent davantage.
 */
export const TOKENS_PER_CALL = 2_000;

/**
 * Appel LLM de production, espacé et compté ; au-delà du budget, lève une erreur qui arrête la passe.
 * @param {{ budget: number, pauseMs: number }} options
 */
export function meteredClassify({ budget, pauseMs }) {
  const state = { tokens: 0, calls: 0 };
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init) => {
    const res = await fetch(input, init);
    const body = /** @type {{ usage?: { total_tokens?: number } } | null} */ (await res.clone().json().catch(() => null));
    state.tokens += body?.usage?.total_tokens ?? 0;
    return res;
  };
  /** @type {typeof classifyBatch} */
  const classify = async (llm, articles) => {
    if (state.tokens + TOKENS_PER_CALL > budget) throw new Error(`budget de ${budget} jetons atteint (${state.tokens} dépensés)`);
    if (state.calls > 0) await new Promise((r) => setTimeout(r, pauseMs));
    state.calls += 1;
    return classifyBatch(llm, articles, { fetchImpl });
  };
  return { classify, state };
}
