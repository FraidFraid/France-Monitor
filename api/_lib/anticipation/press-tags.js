// api/_lib/anticipation/press-tags.js : étiquettes d'un événement de presse, lues dans son titre (13/11/2026).
// Le bilan de novembre comptait 35 « crises manquées » dont 16 n'étaient pas des faits nouveaux (suites judiciaires, faits divers, un
// dessin de presse) et plusieurs étaient rangées dans un département que le titre contredisait. Ces étiquettes servent au compte des
// crises manquées et aux règles « lycées » et « fausses alertes ». Mots-clés seulement, aucun appel à une IA.
import { DEPT_NAMES } from '../../_shared/departments.js';

/** @typedef {'lycee'|'alerte_bombe'|null} PressTopic */
/** @typedef {'fait'|'suite'|'fait_divers'} PressNature */

/** Minuscules sans accents, apostrophes droites. */
export function plain(/** @type {unknown} */ text) {
  return String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'");
}

const ALERTE_RE = /\b(alertes? a la bombe|fausses? alertes?|menaces? d'attentat|colis suspects?)\b/;
const SCHOOL_RE = /\b(lycees?|lyceens?|lyceennes?|colleges?|collegiens?|cite scolaire|etablissements? scolaires?)\b/;
const INCIDENT_RE = /\b(mortiers?|blocages?|blocus|bloque[es]*|casseurs?|incendie[es]*|confine[es]*|confinement|evacue[es]*|evacuation|feux? de poubelles?|degradations?|affrontements?|heurts|interpelle[es]*|interpellations?)\b/;
/** Suite certaine d'un fait passé : l'emporte même sur un sujet reconnu (le dessin du jour sur les alertes n'est pas une alerte). */
const HARD_SUITE_RE = /\b(dessin du|hommages?|un an apres|proces|assises|non-lieu|interrogatoires?|recit|recueill\w*|temoignages?|message fort|mis en examen|mise en examen|condamne[es]*|juge[es]? (pour|en)|avait dresse|liste[es]* par)\b/;
/** Suite probable : cède devant un sujet reconnu (une plainte annoncée après un tir de mortier dans un lycée reste un incident). */
const SOFT_SUITE_RE = /\b(plaintes?|enquete ouverte|parquet|reactions?|dispositif|en direct|suivez|selon le procureur|que sait-on|ce que l'on sait)\b/;
const FAIT_DIVERS_RE = /\b(retrouvee? (tuee?|morte?|eviscere[es]*|sans vie)|tuee? (par balle|de plusieurs coups|a coups)|coups de (fusil|couteau)|feminicide|meurtre|homicide|corps (retrouve|decouvert)|son (fils|mari|compagnon|conjoint|ex)|domicile d'un\w* \w+ incendie|rixe|noyade|accident de la route)\b/;
const ATTACK_RE = /\b(attentats?|terroris\w*)\b/;

/** Noms trop courts ou trop courants pour contredire un lieu (« le nord de la ville », « parquet de Paris »). */
const AMBIGUOUS = new Set(['nord', 'manche', 'lot', 'var', 'ain', 'eure', 'somme', 'loire', 'paris', 'cher', 'aube', 'orne', 'marne', 'meuse', 'oise', 'vienne', 'gard', 'jura', 'doubs', 'landes', 'rhone', 'aisne', 'indre', 'savoie', 'correze', 'creuse', 'drome', 'isere', 'allier', 'sarthe', 'vosges', 'yonne', 'tarn', 'gers', 'aude', 'corse']);
const DEPT_PLAIN = Object.entries(DEPT_NAMES).map(([code, name]) => ({ code, name: plain(name) }))
  .sort((a, b) => b.name.length - a.name.length);

/**
 * Départements nommés dans un titre (nom complet, le plus long d'abord : « Loire-Atlantique » ne compte pas pour « Loire »).
 * @param {string} title Titre déjà passé par plain().
 * @returns {string[]} Codes.
 */
function namedDepts(title) {
  let rest = title;
  /** @type {string[]} */
  const out = [];
  for (const d of DEPT_PLAIN) {
    const i = rest.indexOf(d.name);
    if (i < 0) continue;
    const before = rest[i - 1], after = rest[i + d.name.length];
    if ((before && /[a-z0-9-]/.test(before)) || (after && /[a-z0-9-]/.test(after))) continue;
    rest = `${rest.slice(0, i)}${' '.repeat(d.name.length)}${rest.slice(i + d.name.length)}`;
    if (!AMBIGUOUS.has(d.name)) out.push(d.code);
  }
  return out;
}

/**
 * @param {unknown} title
 * @param {string|null|undefined} dept Département où l'événement est rangé.
 * @returns {{ topic: PressTopic, nature: PressNature, placeDoubt: boolean }}
 */
export function pressTags(title, dept) {
  const t = plain(title);
  /** @type {PressTopic} */
  let topic = null;
  if (ALERTE_RE.test(t)) topic = 'alerte_bombe';
  else if (SCHOOL_RE.test(t) && INCIDENT_RE.test(t)) topic = 'lycee';
  /** @type {PressNature} */
  let nature = 'fait';
  if (HARD_SUITE_RE.test(t)) nature = 'suite';
  else if (!topic && SOFT_SUITE_RE.test(t)) nature = 'suite';
  else if (!topic && FAIT_DIVERS_RE.test(t) && !ATTACK_RE.test(t)) nature = 'fait_divers';
  if (nature === 'suite') topic = null;
  const named = namedDepts(t);
  const placeDoubt = Boolean(dept) && named.length > 0 && !named.includes(String(dept));
  return { topic, nature, placeDoubt };
}
