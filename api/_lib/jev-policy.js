/**
 * api/_lib/jev-policy.js — Combinaison pure des réponses Jev + repli mots-clés.
 *
 * Aucun appel réseau ici : c'est un module pur, testable en isolation
 * (tests/jev-policy.test.ts). Correspond à docs/audit-2026-09-chargement-jev-ui.md
 * §4.4. Les réponses brutes de Jev sont toujours stockées telles quelles
 * (`jev_answers` jsonb) : les seuils ci-dessous peuvent donc être ajustés et
 * rejoués SANS ré-inférence.
 */

import { RELEVANCE_LEVELS, SEVERITY_LEVELS } from './jev-questions.js';

/** Sévérités ordonnées, index = niveau Score de la question `severity`. */
export const SEV = ['info', 'low', 'medium', 'high', 'critical'];

/**
 * Catégories Jev → EventCategory de l'app. `defense` n'a pas de catégorie
 * dédiée côté app → repliée sur `security`. `other` n'a pas d'équivalent :
 * absent de cette map, il retombe toujours sur la catégorie mots-clés dans
 * `derive()`. `floods`/`fires` (EventCategory) ne sont jamais produites par
 * Jev — seule la classification mots-clés peut les émettre (cf. audit §4.3).
 */
export const CATEGORY_MAP = {
  security: 'security',
  social: 'social',
  energy: 'energy',
  transport: 'transport',
  weather: 'weather',
  health: 'health',
  cyber: 'cyber',
  infrastructure: 'infrastructure',
  finance: 'finance',
  defense: 'security',
};

const RELEVANCE_MAX_INDEX = RELEVANCE_LEVELS - 1; // 3
const SEVERITY_MAX_INDEX = SEVERITY_LEVELS - 1; // 4

const RELEVANCE_NOISE_THRESHOLD = 0.4;
const IN_FRANCE_NOISE_THRESHOLD = 0.5;
const ISOLATED_FAIT_DIVERS_THRESHOLD = 0.7;
const SEVERITY_CONFIDENCE_THRESHOLD = 0.6;
const CATEGORY_CONFIDENCE_THRESHOLD = 0.5;
const ALERTABLE_ONGOING_THRESHOLD = 0.6;
const ALERTABLE_IN_FRANCE_THRESHOLD = 0.7;
const ALERTABLE_INSTITUTION_THRESHOLD = 0.5;

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @typedef {{ category: string; severity: string; confidence: number }} KeywordFallback
 *   Sortie du classifieur mots-clés existant (api/_lib/server-classifier.js),
 *   utilisée comme repli quand Jev est peu sûr de lui.
 *
 * @typedef {{
 *   relevance: number; noise: boolean; severity: string; category: string;
 *   alertable: boolean; rank: number; scope: string; confidence: number;
 * }} DerivedJudgment
 */

/**
 * Combine les 9 réponses brutes de Jev (`response.answers`, clés =
 * identifiants de api/_lib/jev-questions.js#QUESTIONS) avec la classification
 * mots-clés `kw` déjà en base pour cet article.
 *
 * @param {Record<string, any>} a — `response.answers`
 * @param {KeywordFallback} kw
 * @returns {DerivedJudgment}
 */
export function derive(a, kw) {
  const relevance = clamp(a.relevance.score / RELEVANCE_MAX_INDEX, 0, 1);

  const inFrance = a.in_france.noul;
  const isolated = a.isolated_fait_divers.noul;
  const ongoing = a.ongoing.noul;
  const institution = a.institution_involved.noul;

  const noise =
    inFrance < IN_FRANCE_NOISE_THRESHOLD ||
    relevance < RELEVANCE_NOISE_THRESHOLD ||
    isolated > ISOLATED_FAIT_DIVERS_THRESHOLD;

  const sevIdx = clamp(Math.round(a.severity.score), 0, SEVERITY_MAX_INDEX);
  const severity = a.severity.confidence >= SEVERITY_CONFIDENCE_THRESHOLD ? SEV[sevIdx] : kw.severity;

  const jevCategory = a.category.choice;
  const mappedCategory = CATEGORY_MAP[jevCategory];
  const category =
    a.category.confidence >= CATEGORY_CONFIDENCE_THRESHOLD && mappedCategory ? mappedCategory : kw.category;

  const alertable =
    !noise &&
    sevIdx >= 3 &&
    ongoing >= ALERTABLE_ONGOING_THRESHOLD &&
    inFrance >= ALERTABLE_IN_FRANCE_THRESHOLD &&
    (institution >= ALERTABLE_INSTITUTION_THRESHOLD || sevIdx === SEVERITY_MAX_INDEX);

  const rank = 0.5 * relevance + 0.3 * (sevIdx / SEVERITY_MAX_INDEX) + 0.1 * ongoing + 0.1 * inFrance;

  return {
    relevance,
    noise,
    severity,
    category,
    alertable,
    rank,
    scope: a.scope.choice,
    confidence: a.severity.confidence,
  };
}
