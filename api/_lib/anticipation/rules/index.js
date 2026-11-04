// api/_lib/anticipation/rules/index.js : registre des règles de croisement actives.
import mobilisationTransports from './mobilisation-transports.js';
import tempeteReseaux from './tempete-reseaux.js';

/** @typedef {import('../probability.js').Signal} Signal */
/** @typedef {import('../probability.js').Evidence} Evidence */
/** @typedef {import('../registry.js').Scenario} Scenario */
/** @typedef {Omit<Scenario, 'id'|'openedAt'|'revisedAt'|'status'|'closedAt'|'outcomeNote'|'feedback'> & { evidence: Evidence }} Candidate */
/**
 * @typedef {object} CrossRule
 * @property {string} id
 * @property {number} version
 * @property {string} title
 * @property {string[]} domains
 * @property {(signals: Signal[], ctx: { now: number, precedent(ruleId: string, dept: string): string|null }) => Candidate[]} evaluate
 * @property {(scenario: Scenario, signals: Signal[], now?: number) => 'arrive'|'pas_arrive'|'indecidable'|null} arrived
 * @property {string} arrivalTest Phrase publique de la méthode.
 */

/** @type {CrossRule[]} */
export const RULES = [mobilisationTransports, tempeteReseaux];
