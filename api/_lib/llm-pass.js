// api/_lib/llm-pass.js — Passe LLM de l'ingestion (spec 2026-09-28 § 4.3).
// Parmi les articles insérés au passage : candidats high/critical des mots-clés, puis ambigus
// (confiance < 0,60) ; lots de 10, 2 lots au plus (~165 000 jetons/j sur 200 000 gratuits chez
// Groq) ; qualification écrite (gravité retenue et signalée, zone, temporalité, motifs). Une erreur
// HTTP arrête la passe ; un lot illisible est ignoré (ses articles gardent leur note mots-clés).
import { classifyBatch, qualifyJudgment, selectCandidates, LLM_BATCH_SIZE } from './llm-classifier.js';
import { titleQualification } from './server-classifier.js';
import { encodeReasons } from './classification-columns.js';

export const LLM_BATCHES_PER_TICK = 2;
export const LLM_CONFIDENCE = 0.75;

/** @param {Record<string, unknown>} r */
function toCandidate(r) {
  return {
    id: Number(r.id),
    title: String(r.title),
    description: r.description == null ? null : String(r.description),
    severity: String(r.severity),
    confidence: Number(r.confidence),
    tier: r.tier == null ? null : Number(r.tier),
    publishedAt: r.published_at == null ? null : new Date(/** @type {string} */ (r.published_at)).getTime(),
  };
}

/**
 * @param {(strings: TemplateStringsArray, ...params: unknown[]) => Promise<Record<string, unknown>[]>} sql
 * @param {{ llm: import('./llm-classifier.js').LlmConfig, insertedIds: number[], keywordVersion: string,
 *   deadline: number, classify?: typeof classifyBatch }} options
 * @returns {Promise<number>} nombre d'articles reclassés
 */
export async function runLlmPass(sql, { llm, insertedIds, keywordVersion, deadline, classify = classifyBatch }) {
  if (insertedIds.length === 0) return 0;
  const rows = await sql`
    SELECT n.id, n.title, n.description, n.severity, n.confidence, n.published_at, f.tier
    FROM news_items n LEFT JOIN feeds f ON f.id = n.feed_id
    WHERE n.id = ANY(${insertedIds}::bigint[])
      AND n.classifier_version = ${keywordVersion}
      AND (n.severity IN ('high', 'critical') OR n.confidence < 0.60)
  `;
  const candidates = selectCandidates(rows.map(toCandidate), LLM_BATCH_SIZE * LLM_BATCHES_PER_TICK);
  let classified = 0;
  for (let start = 0; start < candidates.length; start += LLM_BATCH_SIZE) {
    if (Date.now() >= deadline) break;
    const batch = candidates.slice(start, start + LLM_BATCH_SIZE);
    let judgments;
    try {
      judgments = await classify(llm, batch);
    } catch (err) {
      console.warn('[llm-pass] passe arrêtée :', err instanceof Error ? err.message : err);
      break;
    }
    if (!judgments) continue;
    for (let k = 0; k < batch.length; k++) {
      const judgment = judgments[k];
      if (!judgment) continue;
      const q = qualifyJudgment(judgment, titleQualification(batch[k].title));
      await sql`
        UPDATE news_items
        SET category = ${judgment.category}, severity = ${q.severity}, confidence = ${LLM_CONFIDENCE},
            classifier_version = ${llm.version}, reported_severity = ${q.reportedSeverity},
            temporality = ${q.temporality}, zone = ${q.zone}, reasons = ${encodeReasons(q.reasons)}
        WHERE id = ${batch[k].id}
      `;
      classified += 1;
    }
  }
  return classified;
}
