/**
 * foreign-places.ts — Lieux et acteurs étrangers pour la zone « étranger » du classifieur
 * (spec docs/superpowers/specs/2026-09-28-classification-evenements-design.md § 4.2, garde 5).
 *
 * Exclusions volontaires (ambiguës avec la France ou avec des mots courants) : Vienne
 * (ville et département), Luxembourg (jardin, Sénat), Bruxelles (institutions européennes),
 * Valence, Florence, Porto (Porto-Vecchio), Le Cap (« franchir le cap »), Maurice (prénom),
 * Monaco (traité comme local), Sahel (opérations françaises), « indien » (océan Indien).
 */
export const FOREIGN_COUNTRIES: readonly string[] = [
  'Afghanistan', 'Afrique du Sud', 'Albanie', 'Algérie', 'Allemagne', 'Andorre', 'Angleterre', 'Angola',
  'Arabie saoudite', 'Argentine', 'Arménie', 'Australie', 'Autriche', 'Azerbaïdjan', 'Bahreïn', 'Bangladesh',
  'Belgique', 'Bénin', 'Biélorussie', 'Birmanie', 'Bolivie', 'Bosnie', 'Brésil', 'Bulgarie', 'Burkina Faso',
  'Burundi', 'Cambodge', 'Cameroun', 'Canada', 'Chili', 'Chine', 'Chypre', 'Cisjordanie', 'Colombie', 'Congo',
  'Corée du Nord', 'Corée du Sud', 'Côte d’Ivoire', 'Crimée', 'Croatie', 'Cuba', 'Danemark', 'Donbass', 'Écosse',
  'Égypte', 'Émirats arabes unis', 'Équateur', 'Érythrée', 'Espagne', 'Estonie', 'États-Unis', 'Éthiopie',
  'Finlande', 'Gabon', 'Gaza', 'Géorgie', 'Ghana', 'Grande-Bretagne', 'Grèce', 'Groenland', 'Guatemala', 'Guinée',
  'Haïti', 'Honduras', 'Hongrie', 'Inde', 'Indonésie', 'Irak', 'Iran', 'Irlande', 'Irlande du Nord', 'Islande',
  'Israël', 'Italie', 'Jamaïque', 'Japon', 'Jordanie', 'Kazakhstan', 'Kenya', 'Kosovo', 'Koweït', 'Kurdistan',
  'Laos', 'Lettonie', 'Liban', 'Libye', 'Lituanie', 'Macédoine', 'Madagascar', 'Malaisie', 'Mali', 'Malte',
  'Maroc', 'Mauritanie', 'Mexique', 'Moldavie', 'Mongolie', 'Monténégro', 'Mozambique', 'Myanmar', 'Namibie',
  'Népal', 'Nicaragua', 'Niger', 'Nigeria', 'Norvège', 'Nouvelle-Zélande', 'Oman', 'Ouganda', 'Ouzbékistan',
  'Pakistan', 'Palestine', 'Panama', 'Paraguay', 'Pays-Bas', 'Pays de Galles', 'Pérou', 'Philippines', 'Pologne',
  'Portugal', 'Qatar', 'République tchèque', 'Roumanie', 'Royaume-Uni', 'Russie', 'Rwanda', 'Salvador', 'Sénégal',
  'Serbie', 'Sierra Leone', 'Singapour', 'Slovaquie', 'Slovénie', 'Somalie', 'Soudan', 'Sri Lanka', 'Suède',
  'Suisse', 'Syrie', 'Taïwan', 'Tanzanie', 'Tchad', 'Tchéquie', 'Thaïlande', 'Togo', 'Tunisie', 'Turquie',
  'Ukraine', 'Uruguay', 'Venezuela', 'Vietnam', 'Yémen', 'Zambie', 'Zimbabwe',
];

export const FOREIGN_CITIES: readonly string[] = [
  'Londres', 'Manchester', 'Liverpool', 'Birmingham', 'Édimbourg', 'Dublin', 'Berlin', 'Munich', 'Hambourg',
  'Francfort', 'Cologne', 'Madrid', 'Barcelone', 'Séville', 'Rome', 'Milan', 'Naples', 'Turin', 'Venise',
  'Lisbonne', 'Amsterdam', 'Rotterdam', 'Anvers', 'Genève', 'Lausanne', 'Zurich', 'Bâle', 'Berne', 'Varsovie',
  'Prague', 'Budapest', 'Athènes', 'Istanbul', 'Ankara', 'Moscou', 'Saint-Pétersbourg', 'Kiev', 'Kyiv', 'Kharkiv',
  'Odessa', 'Marioupol', 'Minsk', 'Belgrade', 'Bucarest', 'Sofia', 'Copenhague', 'Stockholm', 'Oslo', 'Helsinki',
  'New York', 'Washington', 'Los Angeles', 'San Francisco', 'Chicago', 'Miami', 'Houston', 'La Nouvelle-Orléans',
  'Montréal', 'Québec', 'Toronto', 'Mexico', 'Bogota', 'Caracas', 'Buenos Aires', 'Rio de Janeiro', 'São Paulo',
  'Lima', 'Santiago', 'La Havane', 'Port-au-Prince', 'Tokyo', 'Pékin', 'Shanghai', 'Hong Kong', 'Séoul',
  'Pyongyang', 'Taipei', 'Bangkok', 'Manille', 'Jakarta', 'Hanoï', 'New Delhi', 'Bombay', 'Karachi', 'Islamabad',
  'Kaboul', 'Téhéran', 'Bagdad', 'Damas', 'Beyrouth', 'Jérusalem', 'Tel-Aviv', 'Ramallah', 'Amman', 'Riyad',
  'Ryad', 'Doha', 'Dubaï', 'Abou Dhabi', 'Le Caire', 'Alger', 'Tunis', 'Rabat', 'Casablanca', 'Tripoli', 'Dakar',
  'Bamako', 'Niamey', 'Ouagadougou', 'Abidjan', 'Lagos', 'Kinshasa', 'Nairobi', 'Addis-Abeba', 'Johannesburg',
  'Pretoria', 'Khartoum', 'Mogadiscio', 'Sydney', 'Melbourne',
];

/**
 * Gentilés et acteurs étrangers, déjà NORMALISÉS (minuscules, sans accents, tirets → espaces)
 * et écrits en fragments d'expression régulière (accords en option).
 */
export const FOREIGN_DEMONYM_PATTERNS: readonly string[] = [
  'russes?', 'ukrainien(?:ne)?s?', 'israelien(?:ne)?s?', 'palestinien(?:ne)?s?', 'iranien(?:ne)?s?',
  'irakien(?:ne)?s?', 'syrien(?:ne)?s?', 'libanaise?s?', 'americaine?s?', 'chinoise?s?', 'britanniques?',
  'ecossaise?s?', 'irlandaise?s?', 'allemande?s?', 'italien(?:ne)?s?', 'espagnole?s?', 'portugaise?s?',
  'belges?', 'suisses?', 'neerlandaise?s?', 'polonaise?s?', 'hongroise?s?', 'roumaine?s?', 'grecs?',
  'grecques?', 'turcs?', 'turques?', 'pakistanaise?s?', 'afghane?s?', 'japonaise?s?', 'coreen(?:ne)?s?',
  'thailandaise?s?', 'vietnamien(?:ne)?s?', 'sud africaine?s?', 'nigeriane?s?', 'malien(?:ne)?s?',
  'algerien(?:ne)?s?', 'marocaine?s?', 'tunisien(?:ne)?s?', 'egyptien(?:ne)?s?', 'saoudien(?:ne)?s?',
  'yemenites?', 'bresilien(?:ne)?s?', 'mexicaine?s?', 'venezuelien(?:ne)?s?', 'colombien(?:ne)?s?',
  'canadien(?:ne)?s?', 'quebecoise?s?', 'australien(?:ne)?s?', 'serbes?', 'bielorusses?', 'georgien(?:ne)?s?',
  'armenien(?:ne)?s?', 'houthis?', 'hamas', 'hezbollah', 'kremlin(?! bicetre)', 'maison blanche', 'pentagone',
];
