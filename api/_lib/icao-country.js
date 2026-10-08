// api/_lib/icao-country.js : pays d'immatriculation d'un aéronef par son bloc d'adresse OACI de 24 bits (spec 2026-10-04
// souveraineté V2 ; contrats, arbitrage 4 ; faits § 5.3). Plages publiques de l'OACI (57 pays) : Annexe 10, volume III, partie I,
// chapitre 9, tableau 9-1 « Attribution des adresses d'aéronef aux États ». Revue finale M4 : quatre blocs ramenés à leur taille
// attribuée (Luxembourg, Biélorussie, Qatar, Oman : 1 024 adresses chacun) et membres de l'OTAN manquants ajoutés (Albanie, Croatie,
// Estonie, Islande, Lettonie, Lituanie, Macédoine du Nord, Monténégro, Slovaquie, Slovénie), avec Malte et Chypre ; bloc France inchangé.
// Le bloc donne l'État d'immatriculation, pas l'opérateur : la méthode du panneau le dit. Une adresse non OACI (« ~… », TIS-B)
// ou hors table n'a pas de pays ; la famille est alors « autres », jamais une hypothèse « France ».

/** Blocs d'adresses (début et fin inclus), annexe 10 de l'OACI. */
export const ICAO_BLOCKS = Object.freeze([
  { country: 'France', start: 0x380000, end: 0x3bffff },
  { country: 'Allemagne', start: 0x3c0000, end: 0x3fffff },
  { country: 'Royaume-Uni', start: 0x400000, end: 0x43ffff },
  { country: 'Italie', start: 0x300000, end: 0x33ffff },
  { country: 'Espagne', start: 0x340000, end: 0x37ffff },
  { country: 'Belgique', start: 0x448000, end: 0x44ffff },
  { country: 'Pays-Bas', start: 0x480000, end: 0x487fff },
  { country: 'Suisse', start: 0x4b0000, end: 0x4b7fff },
  { country: 'Luxembourg', start: 0x4d0000, end: 0x4d03ff },
  { country: 'Autriche', start: 0x440000, end: 0x447fff },
  { country: 'Portugal', start: 0x490000, end: 0x497fff },
  { country: 'Irlande', start: 0x4ca000, end: 0x4cafff },
  { country: 'Pologne', start: 0x488000, end: 0x48ffff },
  { country: 'Tchéquie', start: 0x498000, end: 0x49ffff },
  { country: 'Danemark', start: 0x458000, end: 0x45ffff },
  { country: 'Norvège', start: 0x478000, end: 0x47ffff },
  { country: 'Suède', start: 0x4a8000, end: 0x4affff },
  { country: 'Finlande', start: 0x460000, end: 0x467fff },
  { country: 'Grèce', start: 0x468000, end: 0x46ffff },
  { country: 'Turquie', start: 0x4b8000, end: 0x4bffff },
  { country: 'Roumanie', start: 0x4a0000, end: 0x4a7fff },
  { country: 'Bulgarie', start: 0x450000, end: 0x457fff },
  { country: 'Hongrie', start: 0x470000, end: 0x477fff },
  { country: 'Ukraine', start: 0x508000, end: 0x50ffff },
  { country: 'Biélorussie', start: 0x510000, end: 0x5103ff },
  { country: 'Russie', start: 0x100000, end: 0x1fffff },
  { country: 'Chine', start: 0x780000, end: 0x7bffff },
  { country: 'États-Unis', start: 0xa00000, end: 0xafffff },
  { country: 'Canada', start: 0xc00000, end: 0xc3ffff },
  { country: 'Israël', start: 0x738000, end: 0x73ffff },
  { country: 'Arabie saoudite', start: 0x710000, end: 0x717fff },
  { country: 'Émirats arabes unis', start: 0x896000, end: 0x896fff },
  { country: 'Qatar', start: 0x06a000, end: 0x06a3ff },
  { country: 'Koweït', start: 0x706000, end: 0x706fff },
  { country: 'Bahreïn', start: 0x894000, end: 0x894fff },
  { country: 'Oman', start: 0x70c000, end: 0x70c3ff },
  { country: 'Jordanie', start: 0x740000, end: 0x747fff },
  { country: 'Égypte', start: 0x010000, end: 0x017fff },
  { country: 'Algérie', start: 0x0a0000, end: 0x0a7fff },
  { country: 'Maroc', start: 0x020000, end: 0x027fff },
  { country: 'Tunisie', start: 0x028000, end: 0x02ffff },
  { country: 'Inde', start: 0x800000, end: 0x83ffff },
  { country: 'Japon', start: 0x840000, end: 0x87ffff },
  { country: 'Australie', start: 0x7c0000, end: 0x7fffff },
  { country: 'Brésil', start: 0xe40000, end: 0xe7ffff },
  // Membres de l'OTAN et de l'Union européenne absents jusqu'à la revue finale (M4), même tableau 9-1.
  { country: 'Islande', start: 0x4cc000, end: 0x4ccfff },
  { country: 'Chypre', start: 0x4c8000, end: 0x4c83ff },
  { country: 'Malte', start: 0x4d2000, end: 0x4d23ff },
  { country: 'Albanie', start: 0x501000, end: 0x5013ff },
  { country: 'Croatie', start: 0x501c00, end: 0x501fff },
  { country: 'Lettonie', start: 0x502c00, end: 0x502fff },
  { country: 'Lituanie', start: 0x503c00, end: 0x503fff },
  { country: 'Slovaquie', start: 0x505c00, end: 0x505fff },
  { country: 'Slovénie', start: 0x506c00, end: 0x506fff },
  { country: 'Estonie', start: 0x511000, end: 0x5113ff },
  { country: 'Macédoine du Nord', start: 0x512000, end: 0x5123ff },
  { country: 'Monténégro', start: 0x516000, end: 0x5163ff },
].map((b) => Object.freeze(b)));

/**
 * Pays du bloc OACI d'une adresse de 24 bits (« 3bf004 » : France) ; null pour une adresse non OACI (« ~… »), illisible ou hors table.
 * @param {string} hex
 * @returns {string | null}
 */
export function icaoCountry(hex) {
  const h = String(hex ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  const n = Number.parseInt(h, 16);
  return ICAO_BLOCKS.find((b) => n >= b.start && n <= b.end)?.country ?? null;
}

/**
 * Famille d'un aéronef : « francais » pour le bloc France (380000 à 3BFFFF), « autres » pour tout le reste.
 * @param {string} hex
 * @returns {'francais' | 'autres'}
 */
export function aircraftFamily(hex) {
  return icaoCountry(hex) === 'France' ? 'francais' : 'autres';
}
