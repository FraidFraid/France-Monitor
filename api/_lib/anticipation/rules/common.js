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

/** Adresse d'un document officiel affichable : https sur un site en .gouv.fr seulement, sinon null. */
export function officialDocUrl(/** @type {unknown} */ ref) {
  if (typeof ref !== 'string' || !ref) return null;
  try {
    const u = new URL(ref);
    return u.protocol === 'https:' && (u.hostname === 'gouv.fr' || u.hostname.endsWith('.gouv.fr')) ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Bascule « Arrêté préfectoral publié » : atteinte si un arrêté couvre la demi-journée, avec le document (PDF du recueil ouvert à la
 * page de l'arrêté, numéro, titre, extrait, préfecture) pour l'ouvrir en un clic depuis la fiche.
 * @param {Signal|undefined} arrete
 */
export function arreteBascule(arrete) {
  const base = { id: 'arrete', label: 'Arrêté préfectoral publié' };
  if (!arrete) return { ...base, state: /** @type {const} */ ('surveille'), at: null };
  const url = officialDocUrl(arrete.ref);
  const d = /** @type {Record<string, unknown>} */ ((arrete.meta && typeof arrete.meta === 'object' && /** @type {any} */ (arrete.meta).doc) || {});
  const str = (/** @type {unknown} */ v) => (typeof v === 'string' && v ? v : null);
  const doc = url ? {
    url, act: str(d.act), title: str(d.title), excerpt: str(d.excerpt), issuer: str(d.issuer), publishedOn: str(d.publishedOn),
    hours: Array.isArray(d.hours) ? d.hours.filter((h) => typeof h === 'string').slice(0, 2) : null,
  } : null;
  return { ...base, state: /** @type {const} */ ('atteint'), at: arrete.publishedAt ?? arrete.observedAt, ...(doc ? { doc } : {}) };
}

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

/** Locutions de lieu qui ne suivent pas « dans le <nom> ». */
const PLACE_PHRASE = Object.freeze({
  '01': "dans l'Ain", '02': "dans l'Aisne", '03': "dans l'Allier", '04': 'dans les Alpes-de-Haute-Provence', '05': 'dans les Hautes-Alpes',
  '06': 'dans les Alpes-Maritimes', '07': 'en Ardèche', '08': 'dans les Ardennes', '09': 'en Ariège', '10': "dans l'Aube", '11': "dans l'Aude",
  '12': "dans l'Aveyron", '13': 'dans les Bouches-du-Rhône', '16': 'en Charente', '17': 'en Charente-Maritime', '19': 'en Corrèze',
  '21': "en Côte-d'Or", '22': "dans les Côtes-d'Armor", '23': 'dans la Creuse', '24': 'en Dordogne', '26': 'dans la Drôme', '27': "dans l'Eure",
  '28': 'en Eure-et-Loir', '31': 'en Haute-Garonne', '33': 'en Gironde', '34': "dans l'Hérault", '35': 'en Ille-et-Vilaine', '36': "dans l'Indre",
  '37': 'en Indre-et-Loire', '38': "dans l'Isère", '40': 'dans les Landes', '42': 'dans la Loire', '43': 'en Haute-Loire', '44': 'en Loire-Atlantique',
  '45': 'dans le Loiret', '48': 'en Lozère', '50': 'dans la Manche', '51': 'dans la Marne', '52': 'en Haute-Marne', '53': 'en Mayenne',
  '54': 'en Meurthe-et-Moselle', '55': 'dans la Meuse', '57': 'en Moselle', '58': 'dans la Nièvre', '60': "dans l'Oise", '61': "dans l'Orne",
  '64': 'dans les Pyrénées-Atlantiques', '65': 'dans les Hautes-Pyrénées', '66': 'dans les Pyrénées-Orientales', '70': 'en Haute-Saône',
  '71': 'en Saône-et-Loire', '72': 'dans la Sarthe', '73': 'en Savoie', '74': 'en Haute-Savoie', '75': 'à Paris', '76': 'en Seine-Maritime',
  '77': 'en Seine-et-Marne', '78': 'dans les Yvelines', '79': 'dans les Deux-Sèvres', '80': 'dans la Somme', '85': 'en Vendée', '86': 'dans la Vienne',
  '87': 'en Haute-Vienne', '88': 'dans les Vosges', '89': "dans l'Yonne", '91': "dans l'Essonne", '92': 'dans les Hauts-de-Seine',
  '93': 'en Seine-Saint-Denis', '95': "dans le Val-d'Oise", '2A': 'en Corse-du-Sud', '2B': 'en Haute-Corse', '971': 'en Guadeloupe',
  '972': 'en Martinique', '973': 'en Guyane', '974': 'à La Réunion', '976': 'à Mayotte',
});

/**
 * Locution de lieu d'un département : « dans le Rhône », « en Gironde », « dans les Bouches-du-Rhône », « à Paris ».
 * @param {string} code
 * @param {Record<string, string>} names DEPT_NAMES
 */
export function inPlace(code, names) {
  const fixed = /** @type {Record<string, string>} */ (PLACE_PHRASE)[code];
  if (fixed) return fixed;
  return `dans le ${names[code] ?? code}`;
}
