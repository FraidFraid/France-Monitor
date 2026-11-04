// api/_lib/anticipation/probability.js : échelle de probabilité du moteur d'anticipation (spec 2026-11-04 § 5 et § 11 bis, 04/11/2026).
// Échelle à sept mots (PHIA / OTAN), comptage des origines indépendantes et plancher des grilles, qui s'impose à toutes les règles.
// Déterministe : aucun mot, chiffre ou texte n'est produit par une IA.

/**
 * @typedef {'chance_infime'|'tres_peu_probable'|'peu_probable'|'possibilite_reelle'|'probable'|'tres_probable'|'quasi_certain'} Word
 * @typedef {'social'|'transport'|'energy'|'telecom'|'weather'|'cyber'|'health'|'fuel'|'press'|'event'} SignalDomain
 * @typedef {object} Signal Relevé normalisé entrant dans une règle (spec § 6).
 * @property {string} id
 * @property {SignalDomain} domain
 * @property {string} kind
 * @property {string} source
 * @property {string} origin Clé de dédoublonnage : un événement de presse consolidé = une origine, un émetteur officiel = une origine.
 * @property {boolean} official
 * @property {string[]} dept
 * @property {string[]} communes
 * @property {string|null} level
 * @property {number|null} value
 * @property {{from: string, to: string}|null} window
 * @property {string|null} publishedAt
 * @property {string} observedAt
 * @property {string} checkedAt
 * @property {string} ref
 * @typedef {object} Evidence Preuves réunies pour un scénario, entrée du plancher.
 * @property {number} origins Origines indépendantes.
 * @property {boolean} hasOfficial Au moins une origine officielle.
 * @property {boolean} hasPublishedDeadline Une échéance publiée existe.
 * @property {'jaune'|'orange'|'rouge'|null} officialLevel Niveau de l'échéance officielle.
 * @property {boolean} basculeHit Une bascule de la règle est atteinte.
 * @property {string|null} precedentDay Jour (AAAA-MM-JJ) d'un précédent arrivé dans le même département.
 */

/** @type {readonly Word[]} Du moins au plus probable. */
export const WORDS = Object.freeze(['chance_infime', 'tres_peu_probable', 'peu_probable', 'possibilite_reelle', 'probable', 'tres_probable', 'quasi_certain']);

/** @type {readonly Word[]} Seuls mots attribuables en v1, tant que le bilan n'a pas d'effectifs. */
export const V1_WORDS = Object.freeze(['peu_probable', 'possibilite_reelle', 'probable', 'tres_probable']);

/** @type {Readonly<Record<Word, string>>} */
export const WORD_LABEL = Object.freeze({
  chance_infime: 'chance infime',
  tres_peu_probable: 'très peu probable',
  peu_probable: 'peu probable',
  possibilite_reelle: 'possibilité réelle',
  probable: 'probable',
  tres_probable: 'très probable',
  quasi_certain: 'quasi certain',
});

/** @type {Readonly<Record<Word, string>>} Espaces insécables : une valeur et son unité tiennent sur une ligne. */
export const WORD_RANGE = Object.freeze({
  chance_infime: '≤\u00a05\u00a0%',
  tres_peu_probable: '10\u00a0à\u00a020\u00a0%',
  peu_probable: '25\u00a0à\u00a035\u00a0%',
  possibilite_reelle: '40\u00a0à\u00a050\u00a0%',
  probable: '55\u00a0à\u00a075\u00a0%',
  tres_probable: '80\u00a0à\u00a090\u00a0%',
  quasi_certain: '≥\u00a095\u00a0%',
});

const rank = (/** @type {Word} */ w) => WORDS.indexOf(w);

/**
 * Nombre d'origines indépendantes : valeurs distinctes de `origin` (une dépêche reprise par dix titres = une origine).
 * @param {Signal[]} signals
 * @returns {number}
 */
export function countOrigins(signals) {
  const seen = new Set();
  for (const s of Array.isArray(signals) ? signals : []) {
    if (s && typeof s.origin === 'string' && s.origin) seen.add(s.origin);
  }
  return seen.size;
}

/**
 * Plafond imposé par les preuves (quasi_certain = aucun plafond). Le plus bas des plafonds applicables l'emporte.
 * @param {Evidence} ev
 * @returns {Word}
 */
function floorCap(ev) {
  /** @type {Word} */
  let cap = 'quasi_certain';
  const lower = (/** @type {Word} */ w) => { if (rank(w) < rank(cap)) cap = w; };
  if (ev.origins <= 1 && !ev.precedentDay) lower('peu_probable');
  if (!(ev.origins >= 2 && (ev.hasOfficial || ev.hasPublishedDeadline))) lower('possibilite_reelle');
  const strong = ev.officialLevel === 'orange' || ev.officialLevel === 'rouge' || ev.basculeHit || Boolean(ev.precedentDay);
  if (!strong) lower('probable');
  return cap;
}

/**
 * Applique le plancher des grilles (il ne peut que baisser un mot), puis la restriction v1 aux quatre mots centraux.
 * @param {Word} word
 * @param {Evidence} ev
 * @returns {Word}
 */
export function applyFloor(word, ev) {
  const cap = floorCap(ev);
  /** @type {Word} */
  let out = rank(word) > rank(cap) ? cap : word;
  if (rank(out) < rank('peu_probable')) out = 'peu_probable';
  if (rank(out) > rank('tres_probable')) out = 'tres_probable';
  return out;
}

/**
 * Phrase qui dit pourquoi ce mot, à partir des seules preuves : « 3 sources indépendantes, précédent du 12/10 ».
 * @param {Evidence} ev
 * @returns {string}
 */
export function wordWhy(ev) {
  const n = ev.origins;
  const parts = [n <= 0 ? 'aucune source indépendante' : n === 1 ? '1 source' : `${n} sources indépendantes`];
  if (ev.hasPublishedDeadline) parts.push('échéance publiée');
  if (ev.officialLevel === 'orange' || ev.officialLevel === 'rouge') parts.push(`niveau officiel ${ev.officialLevel}`);
  if (ev.basculeHit) parts.push('bascule atteinte');
  const m = ev.precedentDay ? /^\d{4}-(\d{2})-(\d{2})/.exec(ev.precedentDay) : null;
  if (m) parts.push(`précédent du ${m[2]}/${m[1]}`);
  return parts.join(', ');
}
