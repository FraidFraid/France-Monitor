// api/_lib/anticipation/bilan.js : bilan mensuel de l'anticipation et règle d'arrêt (04/11/2026, spec § 5 et § 11).
// Effectifs par mot et par règle (« 9 sur 14 »), jamais de pourcentage sous 30 scénarios clos par mot. Déterministe, aucun texte d'IA.
import { WORDS } from './probability.js';

/** @typedef {import('./registry.js').Scenario} Scenario */
/** @typedef {import('./rules/index.js').CrossRule} CrossRule */
/**
 * @typedef {object} AnticipationBilan
 * @property {string} month AAAA-MM.
 * @property {number} emitted Scénarios émis (hors crises manquées).
 * @property {number} arrived
 * @property {number} notArrived
 * @property {number} undecided Indécidables ou expirés.
 * @property {number} missed Crises que le moteur n'avait pas anticipées.
 * @property {Array<{ word: string, closed: number, arrived: number, percent: number|null }>} byWord
 * @property {Array<{ ruleId: string, title: string, emitted: number, arrived: number, useful: number, inReview: boolean, arrivalTest: string }>} byRule
 */

/** Seuil d'effectif clos par mot avant d'afficher un pourcentage. */
export const PERCENT_MIN_CLOSED = 30;
/** Règle d'arrêt : au moins 10 scénarios clos au mot probable ou plus, et plus de la moitié non arrivés. */
export const REVIEW_MIN_CLOSED = 10;
const PROBABLE_UP = new Set(['probable', 'tres_probable', 'quasi_certain']);
const isDecided = (/** @type {Scenario} */ s) => s.status === 'arrive' || s.status === 'pas_arrive';

/**
 * Règles à revoir : closed >= 10 et plus de la moitié de non-arrivés parmi les scénarios de mot probable ou plus.
 * @param {Scenario[]} scenarios
 * @returns {Set<string>} Identifiants de règle.
 */
export function rulesInReview(scenarios) {
  /** @type {Map<string, { closed: number, notArrived: number }>} */
  const by = new Map();
  for (const s of Array.isArray(scenarios) ? scenarios : []) {
    if (!s || !isDecided(s) || !PROBABLE_UP.has(s.word)) continue;
    const e = by.get(s.ruleId) ?? { closed: 0, notArrived: 0 };
    e.closed += 1;
    if (s.status === 'pas_arrive') e.notArrived += 1;
    by.set(s.ruleId, e);
  }
  return new Set([...by].filter(([, e]) => e.closed >= REVIEW_MIN_CLOSED && e.notArrived / e.closed > 0.5).map(([id]) => id));
}

/**
 * @param {string} month AAAA-MM
 * @param {Scenario[]} scenarios Scénarios du mois.
 * @param {CrossRule[]} rules
 * @returns {AnticipationBilan}
 */
export function buildBilan(month, scenarios, rules) {
  const all = (Array.isArray(scenarios) ? scenarios : []).filter(Boolean);
  const emittedList = all.filter((s) => s.status !== 'manque');
  const review = rulesInReview(all);
  return {
    month,
    emitted: emittedList.length,
    arrived: all.filter((s) => s.status === 'arrive').length,
    notArrived: all.filter((s) => s.status === 'pas_arrive').length,
    undecided: all.filter((s) => s.status === 'indecidable' || s.status === 'expire').length,
    missed: all.filter((s) => s.status === 'manque').length,
    byWord: WORDS.map((word) => {
      const closed = all.filter((s) => s.word === word && isDecided(s));
      const arrived = closed.filter((s) => s.status === 'arrive').length;
      return { word, closed: closed.length, arrived, percent: closed.length > PERCENT_MIN_CLOSED ? Math.round((100 * arrived) / closed.length) : null };
    }).filter((w) => w.closed > 0),
    byRule: (Array.isArray(rules) ? rules : []).map((r) => {
      const mine = emittedList.filter((s) => s.ruleId === r.id);
      return {
        ruleId: r.id, title: r.title, emitted: mine.length, arrived: mine.filter((s) => s.status === 'arrive').length,
        useful: mine.reduce((n, s) => n + (s.feedback?.utile ?? 0), 0), inReview: review.has(r.id), arrivalTest: r.arrivalTest,
      };
    }),
  };
}
