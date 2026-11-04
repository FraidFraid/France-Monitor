// api/_lib/anticipation/bilan.js : bilan mensuel de l'anticipation et règle d'arrêt (04/11/2026, spec § 5 et § 11).
// Effectifs par mot et par règle (« 9 sur 14 »), jamais de pourcentage sous 30 scénarios clos par mot. Déterministe, aucun texte d'IA.
import { WORDS, peakWordOf } from './probability.js';

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

/** Effectif clos par mot à partir duquel (inclus) un pourcentage s'affiche. */
export const PERCENT_MIN_CLOSED = 30;
/** Règle d'arrêt : au moins 10 scénarios clos au mot probable ou plus, et plus de la moitié non arrivés. */
export const REVIEW_MIN_CLOSED = 10;
const PROBABLE_UP = new Set(['probable', 'tres_probable', 'quasi_certain']);
const isDecided = (/** @type {Scenario} */ s) => s.status === 'arrive' || s.status === 'pas_arrive';

/**
 * Règles à revoir (une seule définition, pour le bilan et pour le filtre des scénarios servis) : parmi les scénarios clos (arrivés ou pas
 * arrivés) de la version COURANTE de la règle dont le mot le plus haut atteint est probable ou plus, au moins 10 et plus de la moitié non
 * arrivés. Indécidables et expirés ne comptent pas. Une règle corrigée (version relevée) sort aussitôt de la revue.
 * @param {Scenario[]} scenarios Normalement registry.state() (fenêtre de relecture courante).
 * @param {CrossRule[]} rules
 * @returns {Set<string>} Identifiants de règle.
 */
export function rulesInReview(scenarios, rules) {
  const list = (Array.isArray(scenarios) ? scenarios : []).filter(Boolean);
  const out = new Set();
  for (const r of Array.isArray(rules) ? rules : []) {
    const closed = list.filter((s) => s.ruleId === r.id && s.ruleVersion === r.version && isDecided(s) && PROBABLE_UP.has(peakWordOf(s)));
    const notArrived = closed.filter((s) => s.status === 'pas_arrive').length;
    if (closed.length >= REVIEW_MIN_CLOSED && notArrived / closed.length > 0.5) out.add(r.id);
  }
  return out;
}

/**
 * @param {string} month AAAA-MM
 * @param {Scenario[]} scenarios Scénarios du mois.
 * @param {CrossRule[]} rules
 * @param {Set<string>} [review] Règles en revue, calculées sur registry.state() (état courant de la règle, pas du mois) ; à défaut, sur ces seuls scénarios.
 * @returns {AnticipationBilan}
 */
export function buildBilan(month, scenarios, rules, review = undefined) {
  const all = (Array.isArray(scenarios) ? scenarios : []).filter(Boolean);
  const emittedList = all.filter((s) => s.status !== 'manque');
  const inReview = review ?? rulesInReview(all, rules);
  return {
    month,
    emitted: emittedList.length,
    arrived: all.filter((s) => s.status === 'arrive').length,
    notArrived: all.filter((s) => s.status === 'pas_arrive').length,
    undecided: all.filter((s) => s.status === 'indecidable' || s.status === 'expire').length,
    missed: all.filter((s) => s.status === 'manque').length,
    byWord: WORDS.map((word) => {
      const closed = all.filter((s) => peakWordOf(s) === word && isDecided(s));
      const arrived = closed.filter((s) => s.status === 'arrive').length;
      return { word, closed: closed.length, arrived, percent: closed.length >= PERCENT_MIN_CLOSED ? Math.round((100 * arrived) / closed.length) : null };
    }).filter((w) => w.closed > 0),
    byRule: (Array.isArray(rules) ? rules : []).map((r) => {
      const mine = emittedList.filter((s) => s.ruleId === r.id);
      return {
        ruleId: r.id, title: r.title, emitted: mine.length, arrived: mine.filter((s) => s.status === 'arrive').length,
        useful: mine.reduce((n, s) => n + (s.feedback?.utile ?? 0), 0), inReview: inReview.has(r.id), arrivalTest: r.arrivalTest,
      };
    }),
  };
}
