/**
 * departements.ts — Noms des 101 départements, ancres françaises du classifieur
 * (src/services/classification-guards.ts). Les noms qui sont aussi des mots courants
 * (Nord, Cher, Somme…) sont écartés côté gardes, pas ici.
 */
export const DEPARTEMENT_NAMES: readonly string[] = [
  'Ain', 'Aisne', 'Allier', 'Alpes-de-Haute-Provence', 'Hautes-Alpes', 'Alpes-Maritimes', 'Ardèche', 'Ardennes',
  'Ariège', 'Aube', 'Aude', 'Aveyron', 'Bouches-du-Rhône', 'Calvados', 'Cantal', 'Charente', 'Charente-Maritime',
  'Cher', 'Corrèze', 'Corse-du-Sud', 'Haute-Corse', 'Côte-d’Or', 'Côtes-d’Armor', 'Creuse', 'Dordogne', 'Doubs',
  'Drôme', 'Eure', 'Eure-et-Loir', 'Finistère', 'Gard', 'Haute-Garonne', 'Gers', 'Gironde', 'Hérault',
  'Ille-et-Vilaine', 'Indre', 'Indre-et-Loire', 'Isère', 'Jura', 'Landes', 'Loir-et-Cher', 'Loire', 'Haute-Loire',
  'Loire-Atlantique', 'Loiret', 'Lot', 'Lot-et-Garonne', 'Lozère', 'Maine-et-Loire', 'Manche', 'Marne',
  'Haute-Marne', 'Mayenne', 'Meurthe-et-Moselle', 'Meuse', 'Morbihan', 'Moselle', 'Nièvre', 'Nord', 'Oise',
  'Orne', 'Pas-de-Calais', 'Puy-de-Dôme', 'Pyrénées-Atlantiques', 'Hautes-Pyrénées', 'Pyrénées-Orientales',
  'Bas-Rhin', 'Haut-Rhin', 'Rhône', 'Haute-Saône', 'Saône-et-Loire', 'Sarthe', 'Savoie', 'Haute-Savoie', 'Paris',
  'Seine-Maritime', 'Seine-et-Marne', 'Yvelines', 'Deux-Sèvres', 'Somme', 'Tarn', 'Tarn-et-Garonne', 'Var',
  'Vaucluse', 'Vendée', 'Vienne', 'Haute-Vienne', 'Vosges', 'Yonne', 'Territoire de Belfort', 'Essonne',
  'Hauts-de-Seine', 'Seine-Saint-Denis', 'Val-de-Marne', 'Val-d’Oise', 'Guadeloupe', 'Martinique', 'Guyane',
  'La Réunion', 'Mayotte',
];

/**
 * Centroïdes des départements [lng, lat] (2 décimales), 96 de métropole (2A et 2B compris) et 5 DROM : source unique, les deux
 * copies de l'ancien service de vigilance et des constantes de la carte sont retirées (spec 2026-10-04 environnement, contrats § 3.5).
 */
export const DEPARTEMENT_CENTROIDS: Readonly<Record<string, readonly [number, number]>> = {
  '01': [5.22, 46.00], '02': [3.62, 49.47], '03': [3.19, 46.39], '04': [6.24, 44.08],
  '05': [6.26, 44.66], '06': [7.12, 43.94], '07': [4.42, 44.75], '08': [4.62, 49.62],
  '09': [1.60, 42.92], '10': [4.08, 48.30], '11': [2.42, 43.11], '12': [2.67, 44.28],
  '13': [5.05, 43.54], '14': [-0.37, 49.09], '15': [2.67, 45.05], '16': [0.19, 45.72],
  '17': [-0.83, 45.75], '18': [2.50, 47.07], '19': [1.87, 45.35], '21': [4.90, 47.42],
  '22': [-2.97, 48.44], '23': [2.07, 46.08], '24': [0.75, 45.14], '25': [6.36, 47.17],
  '26': [5.17, 44.68], '27': [0.97, 49.11], '28': [1.38, 48.31], '29': [-4.10, 48.26],
  '2A': [8.92, 41.86], '2B': [9.29, 42.40], '30': [4.18, 43.99], '31': [1.18, 43.35],
  '32': [0.45, 43.69], '33': [-0.58, 44.83], '34': [3.58, 43.59], '35': [-1.68, 48.11],
  '36': [1.57, 46.78], '37': [0.69, 47.26], '38': [5.58, 45.26], '39': [5.69, 46.73],
  '40': [-0.77, 43.89], '41': [1.41, 47.62], '42': [4.16, 45.73], '43': [3.85, 45.11],
  '44': [-1.68, 47.36], '45': [2.10, 47.91], '46': [1.62, 44.62], '47': [0.46, 44.34],
  '48': [3.50, 44.52], '49': [-0.56, 47.39], '50': [-1.32, 49.08], '51': [4.07, 48.96],
  '52': [5.14, 48.11], '53': [-0.77, 48.07], '54': [6.17, 48.79], '55': [5.38, 49.00],
  '56': [-2.82, 47.74], '57': [6.67, 49.04], '58': [3.50, 47.11], '59': [3.22, 50.45],
  '60': [2.42, 49.42], '61': [0.11, 48.62], '62': [2.28, 50.51], '63': [3.13, 45.73],
  '64': [-0.77, 43.26], '65': [0.15, 43.05], '66': [2.53, 42.60], '67': [7.55, 48.67],
  '68': [7.21, 47.86], '69': [4.61, 45.87], '70': [6.08, 47.62], '71': [4.53, 46.64],
  '72': [0.20, 47.93], '73': [6.39, 45.49], '74': [6.42, 46.04], '75': [2.35, 48.86],
  '76': [0.97, 49.66], '77': [2.99, 48.62], '78': [1.83, 48.83], '79': [-0.33, 46.52],
  '80': [2.28, 49.92], '81': [2.17, 43.79], '82': [1.29, 44.08], '83': [6.22, 43.47],
  '84': [5.19, 44.05], '85': [-1.29, 46.68], '86': [0.46, 46.56], '87': [1.24, 45.89],
  '88': [6.37, 48.17], '89': [3.56, 47.84], '90': [6.92, 47.63], '91': [2.24, 48.52],
  '92': [2.24, 48.84], '93': [2.48, 48.91], '94': [2.47, 48.78], '95': [2.12, 49.08],
  // DROM
  '971': [-61.55, 16.25], '972': [-61.02, 14.64], '973': [-53.13, 3.92],
  '974': [55.54, -21.12], '976': [45.15, -12.84],
};

/** Centroïde [lng, lat] d'un département ; null pour un code inconnu. */
export function departementCentroid(code: string): readonly [number, number] | null {
  return DEPARTEMENT_CENTROIDS[code] ?? null;
}
