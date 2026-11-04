// api/_lib/anticipation/rail-hubs.js : gares et villes principales → département, pour situer une situation SNCF (04/11/2026).
// Le flux ferroviaire ne donne qu'un libellé de périmètre (« Lyon-Grenoble ») : table fermée, sans devinette.

/** Clés en minuscules sans accents ; valeur : code département. */
export const RAIL_HUBS = Object.freeze({
  paris: '75', 'gare du nord': '75', 'gare de lyon': '75', 'gare de l est': '75', montparnasse: '75', 'saint lazare': '75', 'gare d austerlitz': '75', 'gare de bercy': '75',
  lyon: '69', 'part dieu': '69', perrache: '69', villeurbanne: '69',
  marseille: '13', 'saint charles': '13', aix: '13', 'aix en provence': '13', arles: '13',
  lille: '59', 'lille flandres': '59', 'lille europe': '59', dunkerque: '59', valenciennes: '59',
  bordeaux: '33', 'saint jean': '33', arcachon: '33',
  toulouse: '31', matabiau: '31',
  nantes: '44', 'saint nazaire': '44',
  rennes: '35', 'saint malo': '35',
  strasbourg: '67', mulhouse: '68', colmar: '68',
  nice: '06', cannes: '06', antibes: '06',
  montpellier: '34', beziers: '34', sete: '34',
  grenoble: '38', vienne: '38',
  dijon: '21', 'saint etienne': '42', clermont: '63', 'clermont ferrand': '63',
  rouen: '76', 'le havre': '76', caen: '14', cherbourg: '50',
  tours: '37', 'saint pierre des corps': '37', angers: '49', 'le mans': '72', poitiers: '86', 'la rochelle': '17',
  limoges: '87', brest: '29', quimper: '29', lorient: '56', vannes: '56',
  metz: '57', nancy: '54', reims: '51', amiens: '80', orleans: '45', 'les aubrais': '45',
  avignon: '84', nimes: '30', toulon: '83', perpignan: '66', narbonne: '11', carcassonne: '11',
  pau: '64', bayonne: '64', hendaye: '64', tarbes: '65', lourdes: '65',
  annecy: '74', chambery: '73', valence: '26', besancon: '25', belfort: '90',
  ajaccio: '2A', bastia: '2B',
});

const norm = (/** @type {string} */ s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Clés triées de la plus longue à la plus courte : « saint etienne » l'emporte sur « etienne ». */
const KEYS = Object.keys(RAIL_HUBS).sort((a, b) => b.length - a.length);

/**
 * Départements cités dans un libellé de périmètre, dans l'ordre d'apparition, sans doublon.
 * « Lyon-Grenoble » → ['69', '38'] ; « Paris-Lyon » → ['75', '69'] ; libellé inconnu → [].
 * @param {string} scope
 * @returns {string[]}
 */
export function deptsOfRailScope(scope) {
  if (typeof scope !== 'string' || !scope.trim()) return [];
  const text = ` ${norm(scope)} `;
  /** @type {Array<{at: number, dept: string}>} */
  const hits = [];
  let rest = text;
  for (const key of KEYS) {
    const needle = ` ${key} `;
    const at = rest.indexOf(needle);
    if (at < 0) continue;
    hits.push({ at, dept: RAIL_HUBS[key] });
    // Efface la partie reconnue (même longueur) pour qu'une clé plus courte ne la retrouve pas.
    rest = rest.slice(0, at + 1) + '#'.repeat(key.length) + rest.slice(at + 1 + key.length);
  }
  const out = [];
  for (const h of hits.sort((a, b) => a.at - b.at)) if (!out.includes(h.dept)) out.push(h.dept);
  return out;
}
