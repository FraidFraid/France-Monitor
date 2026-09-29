// api/_lib/llm-classifier.js — Classement LLM par lots avec grille de gravité (spec 2026-09-28 § 4.3).
// Point d'accès compatible OpenAI (chat/completions + response_format json_object), configuré par
// CLASSIFIER_LLM_URL / _MODEL / _KEY : Groq par défaut (palier gratuit), Albert (API de l'État,
// réservée aux administrations) ou Ollama sans changer le code. Le modèle note ; le SERVEUR
// qualifie et plafonne (qualifyJudgment) : il ne peut pas contourner les gardes du titre.
import { GROQ_FAST_MODEL, groqModelParams, withReasoningHeadroom } from './groq-models.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const BATCH_TIMEOUT_MS = 20_000;
/** Jetons de réponse visibles par article (≈ 25 utiles, marge comprise). */
const TOKENS_PER_ITEM = 60;
const DESCRIPTION_MAX = 200;

export const LLM_BATCH_SIZE = 10;

const VALID_CATEGORIES = new Set([
  'social', 'security', 'energy', 'weather', 'transport',
  'infrastructure', 'health', 'finance', 'floods', 'fires', 'cyber', 'general',
]);
const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
const RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/**
 * @typedef {{ url: string, model: string, apiKey: string, version: 'groq-2' | 'llm-2' }} LlmConfig
 * @param {Record<string, string | undefined>} [env]
 * @returns {LlmConfig | null}  null : passe désactivée
 */
export function classifierLlmConfig(env = process.env) {
  const url = env.CLASSIFIER_LLM_URL?.trim() || GROQ_URL;
  if (url === GROQ_URL) {
    const apiKey = (env.CLASSIFIER_LLM_KEY || env.GROQ_API_KEY || '').trim();
    if (!apiKey) return null;
    return { url, model: env.CLASSIFIER_LLM_MODEL?.trim() || GROQ_FAST_MODEL, apiKey, version: 'groq-2' };
  }
  const model = env.CLASSIFIER_LLM_MODEL?.trim() || '';
  if (!model) return null;
  return { url, model, apiKey: (env.CLASSIFIER_LLM_KEY || '').trim(), version: 'llm-2' };
}

export const BATCH_SYSTEM_PROMPT = `Tu es analyste de veille pour un tableau de bord de situation en France (infrastructures critiques, sécurité et ordre publics, santé publique, stabilité sociale). Tu reçois une liste numérotée d'articles de presse. Pour CHACUN, réponds selon la grille ci-dessous.

Gravité (entier de 0 à 4) — ce que décrit l'article pour des personnes, des services ou des infrastructures :
0 : aucun impact opérationnel — information, annonce, analyse, statistiques, culture, sport, portrait, nécrologie.
1 : localisé et maîtrisé — quelques personnes ou un seul site touchés, situation réglée ou en voie de l'être ; un fait divers isolé vaut 1 au plus.
2 : perturbation significative en cours d'un service, d'un réseau ou d'un territoire (un département, une ville).
3 : menace sérieuse pour des vies, une infrastructure critique ou l'ordre public à l'échelle régionale ; un projet terroriste déjoué, l'arrestation de suspects de terrorisme ou une menace crédible contre une infrastructure ou l'ordre public vaut 3, même sans victime.
4 : crise nationale, attentat majeur, catastrophe ou panne majeure en cours.
Dans le doute entre deux niveaux, choisis le plus bas.

in_france : true si l'événement a lieu en France (métropole ou outre-mer) ou a un effet déclaré sur le territoire, la population, les institutions ou les infrastructures françaises ; false s'il se déroule à l'étranger sans effet déclaré sur la France.
ongoing : true si la situation est actuelle et peut encore évoluer ; false pour un récit rétrospectif, un anniversaire, une analyse, un procès ou une enquête sur un fait passé.
category : une valeur parmi social, security, energy, weather, transport, infrastructure, health, finance, floods, fires, cyber, general.

Réponds UNIQUEMENT en JSON valide, un élément par article, avec son numéro i :
{"items":[{"i":1,"category":"general","severity":0,"in_france":true,"ongoing":true}]}`;

/** @param {string} value */
function oneLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/** @param {Array<{ title: string, description: string | null }>} articles */
export function buildBatchUserPrompt(articles) {
  return articles
    .map((a, idx) => `${idx + 1}. Titre : ${oneLine(a.title)}\n   Description : ${oneLine(a.description ?? '').slice(0, DESCRIPTION_MAX)}\n`)
    .join('');
}

/**
 * @typedef {{ category: string, severity: number, inFrance: boolean, ongoing: boolean }} LlmJudgment
 * @param {string} content  réponse brute du modèle
 * @param {number} count    nombre d'articles envoyés
 * @returns {Array<LlmJudgment | null> | null}  appariement par `i` ; null si la réponse est illisible
 */
export function parseBatchResponse(content, count) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const items = parsed?.items;
  if (!Array.isArray(items)) return null;
  /** @type {Array<LlmJudgment | null>} */
  const out = Array.from({ length: count }, () => null);
  for (const item of items) {
    const i = item?.i;
    if (!Number.isInteger(i) || i < 1 || i > count || out[i - 1] !== null) continue;
    const category = String(item.category ?? '').toLowerCase();
    if (!VALID_CATEGORIES.has(category)) continue;
    if (!Number.isInteger(item.severity) || item.severity < 0 || item.severity > 4) continue;
    if (typeof item.in_france !== 'boolean' || typeof item.ongoing !== 'boolean') continue;
    out[i - 1] = { category, severity: item.severity, inFrance: item.in_france, ongoing: item.ongoing };
  }
  return out;
}

/**
 * Qualification serveur d'un jugement : le titre l'emporte (étranger, passé, hypothèse), le modèle
 * complète ; gravité retenue = min(modèle, plafond du titre, étranger → medium, passé → low).
 * @param {LlmJudgment} judgment
 * Terrorisme au titre : gravité signalée 3 au moins — la clause « menace » de la grille ne suffit pas,
 * le modèle note 1 un projet déjoué ou une arrestation (vérifié le 29/09) ; les plafonds s'appliquent ensuite.
 * @param {{ maxSeverity: string, temporality: string, zone: string, reasons: string[], terrorism?: boolean }} title  titleQualification(title)
 */
export function qualifyJudgment(judgment, title) {
  const zone = title.zone === 'etranger' || !judgment.inFrance ? 'etranger' : 'france';
  const temporality = title.temporality === 'passe' || !judgment.ongoing ? 'passe' : title.temporality === 'a_venir' ? 'a_venir' : 'en_cours';
  let cap = RANK[/** @type {keyof typeof RANK} */ (title.maxSeverity)] ?? RANK.critical;
  if (zone === 'etranger') cap = Math.min(cap, RANK.medium);
  if (temporality === 'passe') cap = Math.min(cap, RANK.low);
  const reported = title.terrorism ? Math.max(judgment.severity, RANK.high) : judgment.severity;
  /** @type {string[]} */
  const reasons = [];
  if (temporality === 'passe' && reported > RANK.low) reasons.push('passe');
  if (title.reasons.includes('hypothetique') && reported > RANK.low) reasons.push('hypothetique');
  if (zone === 'etranger' && reported > RANK.medium) reasons.push('etranger');
  return { severity: SEVERITIES[Math.min(reported, cap)], reportedSeverity: SEVERITIES[reported], temporality, zone, reasons };
}

/**
 * Ordre de passage : candidats high/critical des mots-clés d'abord (le modèle confirme ou abaisse),
 * puis les ambigus par rang de flux (tier le plus bas) et du plus récent au plus ancien.
 * @typedef {{ id: number, title: string, description: string | null, severity: string, confidence: number, tier: number | null, publishedAt: number | null }} Candidate
 * @param {Candidate[]} rows
 * @param {number} limit
 */
export function selectCandidates(rows, limit) {
  const serious = (/** @type {Candidate} */ r) => (r.severity === 'high' || r.severity === 'critical' ? 0 : 1);
  return [...rows]
    .sort((a, b) =>
      serious(a) - serious(b) ||
      (a.tier ?? 9) - (b.tier ?? 9) ||
      (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity) ||
      a.id - b.id)
    .slice(0, limit);
}

/**
 * @param {LlmConfig} llm
 * @param {Array<{ title: string, description: string | null }>} articles  au plus LLM_BATCH_SIZE
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<Array<LlmJudgment | null> | null>}
 */
export async function classifyBatch(llm, articles, { fetchImpl = fetch, timeoutMs = BATCH_TIMEOUT_MS } = {}) {
  if (articles.length === 0) return [];
  /** @type {Response} */
  let res;
  try {
    res = await fetchImpl(llm.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FranceMonitor/1.0',
        ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: llm.model,
        ...groqModelParams(llm.model),
        messages: [
          { role: 'system', content: BATCH_SYSTEM_PROMPT },
          { role: 'user', content: buildBatchUserPrompt(articles) },
        ],
        temperature: 0.1,
        max_tokens: withReasoningHeadroom(llm.model, TOKENS_PER_ITEM * articles.length),
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    console.warn('[llm-classifier] délai dépassé ou erreur réseau (lot ignoré)');
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`LLM HTTP ${res.status}`);
    /** @type {any} */ (err).status = res.status;
    /** @type {any} */ (err).body = body.slice(0, 200);
    throw err;
  }

  let content = '';
  try {
    const body = await res.json();
    content = body?.choices?.[0]?.message?.content ?? '';
  } catch {
    content = '';
  }
  const judgments = parseBatchResponse(content, articles.length);
  if (!judgments) console.warn('[llm-classifier] réponse JSON illisible (lot ignoré)');
  return judgments;
}
