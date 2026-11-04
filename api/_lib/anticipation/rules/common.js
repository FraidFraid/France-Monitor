// api/_lib/anticipation/rules/common.js : briques communes aux règles (lecture tolérante des signaux, preuves, intervalles).
import { countOrigins } from '../probability.js';

/** @typedef {import('../probability.js').Signal} Signal */
/** @typedef {import('../probability.js').Evidence} Evidence */

/** Liste de signaux exploitables : tolère null, valeurs absentes et éléments mal formés. */
export function cleanSignals(/** @type {unknown} */ signals) {
  return (Array.isArray(signals) ? signals : []).filter((s) => s && typeof s === 'object' && typeof s.id === 'string' && typeof s.kind === 'string');
}

/** Intervalle [from, to] en ms d'un signal, ou null si sa fenêtre manque ou est illisible. */
export function span(/** @type {Signal} */ s) {
  const from = Date.parse(s?.window?.from ?? '');
  const to = Date.parse(s?.window?.to ?? '');
  return Number.isFinite(from) && Number.isFinite(to) && to >= from ? { from, to } : null;
}

/** Département principal d'un signal, ou null. */
export const firstDept = (/** @type {Signal} */ s) => (Array.isArray(s.dept) && typeof s.dept[0] === 'string' ? s.dept[0] : null);
export const inDept = (/** @type {Signal} */ s, /** @type {string} */ dept) => Array.isArray(s.dept) && s.dept.includes(dept);

const LEVEL_RANK = { jaune: 1, orange: 2, rouge: 3 };

/**
 * Preuves d'un scénario, tirées des seuls signaux cités.
 * @param {Signal[]} cited
 * @param {{ basculeHit: boolean, precedentDay: string|null, nowMs: number }} extra
 * @returns {Evidence}
 */
export function evidenceOf(cited, extra) {
  const official = cited.filter((s) => s.official === true);
  let officialLevel = null;
  for (const s of official) {
    const r = /** @type {Record<string, number>} */ (LEVEL_RANK)[String(s.level)] ?? 0;
    if (r > (officialLevel ? /** @type {Record<string, number>} */ (LEVEL_RANK)[officialLevel] : 0)) officialLevel = /** @type {'jaune'|'orange'|'rouge'} */ (s.level);
  }
  const hasPublishedDeadline = official.some((s) => {
    const w = span(s);
    return w !== null && w.to > extra.nowMs && (s.kind === 'vigilance' || s.kind === 'ecowatt');
  });
  return { origins: countOrigins(cited), hasOfficial: official.length > 0, hasPublishedDeadline, officialLevel, basculeHit: extra.basculeHit, precedentDay: extra.precedentDay };
}
