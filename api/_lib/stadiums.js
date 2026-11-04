// api/_lib/stadiums.js : stades des clubs français suivis par le calendrier sportif (04/11/2026).
// Clés : nom normalisé du club et code à trois lettres (TLA) de football-data.org, jamais l'identifiant numérique (invérifiable hors ligne).
// Un club absent de la table, ou hors de France (Monaco), n'a pas de département : la règle le nomme « Stade non reconnu », elle ne devine pas.

/** @typedef {{ names: string[], tla?: string, commune: string, dept: string|null }} Stadium */

/** @type {Stadium[]} */
export const STADIUMS = [
  { names: ['Paris Saint-Germain FC', 'Paris Saint-Germain', 'PSG'], tla: 'PSG', commune: 'Paris', dept: '75' },
  { names: ['Paris FC'], tla: 'PFC', commune: 'Paris', dept: '75' },
  { names: ['Olympique de Marseille', 'Marseille', 'OM'], tla: 'OLM', commune: 'Marseille', dept: '13' },
  { names: ['Olympique Lyonnais', 'Lyon', 'OL'], tla: 'LYO', commune: 'Décines-Charpieu', dept: '69' },
  { names: ['Lille OSC', 'LOSC Lille', 'Lille'], tla: 'LIL', commune: 'Villeneuve-d\'Ascq', dept: '59' },
  { names: ['AS Monaco FC', 'AS Monaco', 'Monaco'], tla: 'ASM', commune: 'Monaco', dept: null },
  { names: ['OGC Nice', 'Nice'], tla: 'NIC', commune: 'Nice', dept: '06' },
  { names: ['Stade Rennais FC 1901', 'Stade Rennais FC', 'Rennes'], tla: 'REN', commune: 'Rennes', dept: '35' },
  { names: ['RC Lens', 'Racing Club de Lens', 'Lens'], tla: 'RCL', commune: 'Lens', dept: '62' },
  { names: ['FC Nantes', 'Nantes'], tla: 'NAN', commune: 'Nantes', dept: '44' },
  { names: ['RC Strasbourg Alsace', 'RC Strasbourg', 'Strasbourg'], tla: 'STR', commune: 'Strasbourg', dept: '67' },
  { names: ['Toulouse FC', 'Toulouse'], tla: 'TFC', commune: 'Toulouse', dept: '31' },
  { names: ['Montpellier HSC', 'Montpellier'], tla: 'MON', commune: 'Montpellier', dept: '34' },
  { names: ['Stade de Reims', 'Reims'], tla: 'REI', commune: 'Reims', dept: '51' },
  { names: ['Stade Brestois 29', 'Brest'], tla: 'BRE', commune: 'Brest', dept: '29' },
  { names: ['Le Havre AC', 'Le Havre'], tla: 'HAC', commune: 'Le Havre', dept: '76' },
  { names: ['Angers SCO', 'Angers'], tla: 'ANG', commune: 'Angers', dept: '49' },
  { names: ['AJ Auxerre', 'Auxerre'], tla: 'AUX', commune: 'Auxerre', dept: '89' },
  { names: ['AS Saint-Étienne', 'AS Saint-Etienne', 'Saint-Étienne'], tla: 'STE', commune: 'Saint-Étienne', dept: '42' },
  { names: ['FC Lorient', 'Lorient'], tla: 'LOR', commune: 'Lorient', dept: '56' },
  { names: ['FC Metz', 'Metz'], tla: 'MET', commune: 'Metz', dept: '57' },
  { names: ['FC Girondins de Bordeaux', 'Girondins de Bordeaux', 'Bordeaux'], tla: 'BOR', commune: 'Bordeaux', dept: '33' },
  { names: ['SM Caen', 'Stade Malherbe Caen', 'Caen'], tla: 'CAE', commune: 'Caen', dept: '14' },
  { names: ['EA Guingamp', 'En Avant Guingamp', 'Guingamp'], tla: 'EAG', commune: 'Guingamp', dept: '22' },
  { names: ['Grenoble Foot 38', 'Grenoble'], tla: 'GRE', commune: 'Grenoble', dept: '38' },
  { names: ['Clermont Foot 63', 'Clermont Foot', 'Clermont'], tla: 'CLE', commune: 'Clermont-Ferrand', dept: '63' },
];

/** Nom comparable : minuscules, sans accents ni ponctuation. */
export function normalizeTeamName(/** @type {unknown} */ name) {
  return String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const BY_NAME = new Map(STADIUMS.flatMap((s) => s.names.map((n) => [normalizeTeamName(n), s])));
const BY_TLA = new Map(STADIUMS.filter((s) => s.tla).map((s) => [String(s.tla).toUpperCase(), s]));

/**
 * Stade d'un club de football-data (`{ name, shortName, tla }`), ou null si le club n'est pas dans la table.
 * Le sigle (TLA) n'est un repli que pour la Ligue 1 (`useTla`) : un club étranger de Ligue des champions peut porter le même sigle.
 * @param {{ name?: unknown, shortName?: unknown, tla?: unknown }|null|undefined} team
 * @param {{ useTla?: boolean }} [opts]
 * @returns {Stadium|null}
 */
export function stadiumOf(team, { useTla = false } = {}) {
  if (!team || typeof team !== 'object') return null;
  return BY_NAME.get(normalizeTeamName(team.name)) ?? BY_NAME.get(normalizeTeamName(team.shortName))
    ?? (useTla && typeof team.tla === 'string' ? BY_TLA.get(team.tla.toUpperCase()) : undefined) ?? null;
}
