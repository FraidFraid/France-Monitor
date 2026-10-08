// api/_lib/health-terms.js : dictionnaire déterministe de maladies et de pays pour traduire en français les
// titres de l'OMS (Disease Outbreak News) et les sujets de l'ECDC (spec 2026-10-03 panneaux santé § 2.5).
// Aucun modèle de langue : un terme inconnu laisse le titre original (translateOutbreakTitle rend null).
import { cleanText } from './health-http.js';

const key = (s) => cleanText(s).toLowerCase().replace(/[’']/g, "'");

/** Maladies et intitulés (clé en minuscules) → français. */
const DISEASES = new Map(Object.entries({
  'ebola disease caused by bundibugyo virus': 'Maladie à virus Ebola (souche Bundibugyo)',
  'ebola disease caused by sudan virus': 'Maladie à virus Ebola (souche Soudan)',
  'ebola virus disease': 'Maladie à virus Ebola',
  'ebola disease': 'Maladie à virus Ebola',
  ebola: 'Ebola',
  'hantavirus outbreak linked to cruise ship travel': 'Foyer d’hantavirus lié à une croisière',
  'hantavirus pulmonary syndrome': 'Syndrome pulmonaire à hantavirus',
  'nipah virus disease': 'Infection à virus Nipah',
  'nipah virus infection': 'Infection à virus Nipah',
  'yellow fever': 'Fièvre jaune',
  'marburg virus disease': 'Maladie à virus de Marburg',
  cholera: 'Choléra',
  mpox: 'Mpox',
  measles: 'Rougeole',
  dengue: 'Dengue',
  chikungunya: 'Chikungunya',
  'chikungunya virus disease': 'Chikungunya',
  'zika virus disease': 'Infection à virus Zika',
  'oropouche virus disease': 'Maladie à virus Oropouche',
  'middle east respiratory syndrome coronavirus': 'Coronavirus du syndrome respiratoire du Moyen-Orient (MERS-CoV)',
  'middle east respiratory syndrome coronavirus (mers-cov)': 'Coronavirus du syndrome respiratoire du Moyen-Orient (MERS-CoV)',
  'middle eastern respiratory syndrome (mers)': 'MERS',
  diphtheria: 'Diphtérie',
  meningitis: 'Méningite',
  plague: 'Peste',
  'lassa fever': 'Fièvre de Lassa',
  'rift valley fever': 'Fièvre de la vallée du Rift',
  'crimean-congo haemorrhagic fever': 'Fièvre hémorragique de Crimée-Congo',
  'crimean congo haemorrhagic fever': 'Fièvre hémorragique de Crimée-Congo',
  anthrax: 'Charbon (anthrax)',
  poliomyelitis: 'Poliomyélite',
  'west nile virus': 'Virus du Nil occidental',
  'west nile virus infection': 'Infection à virus du Nil occidental',
  'west nile virus infections': 'Infection à virus du Nil occidental',
  legionellosis: 'Légionellose',
  botulism: 'Botulisme',
  malaria: 'Paludisme',
  'avian influenza': 'Grippe aviaire',
  'seasonal influenza': 'Grippe saisonnière',
  'covid-19': 'COVID-19',
  'respiratory syncytial infection': 'Infection à VRS',
  'respiratory syncytial virus': 'VRS',
  vibriosis: 'Vibrioses',
  vibrio: 'Vibrio',
}));

/** Pays et zones des titres OMS → français. */
const PLACES = new Map(Object.entries({
  'democratic republic of the congo': 'République démocratique du Congo', congo: 'Congo', uganda: 'Ouganda', india: 'Inde',
  global: 'situation mondiale', 'multi-locations': 'plusieurs pays', 'multi-country': 'plusieurs pays', 'multi-country outbreak': 'plusieurs pays',
  afghanistan: 'Afghanistan', algeria: 'Algérie', angola: 'Angola', argentina: 'Argentine', australia: 'Australie', bangladesh: 'Bangladesh',
  benin: 'Bénin', 'bolivia (plurinational state of)': 'Bolivie', botswana: 'Botswana', brazil: 'Brésil', 'burkina faso': 'Burkina Faso',
  burundi: 'Burundi', 'cabo verde': 'Cap-Vert', cambodia: 'Cambodge', cameroon: 'Cameroun', canada: 'Canada',
  'central african republic': 'République centrafricaine', chad: 'Tchad', chile: 'Chili', china: 'Chine', colombia: 'Colombie',
  comoros: 'Comores', "côte d'ivoire": 'Côte d’Ivoire', cuba: 'Cuba', djibouti: 'Djibouti', ecuador: 'Équateur', egypt: 'Égypte',
  'equatorial guinea': 'Guinée équatoriale', eritrea: 'Érythrée', eswatini: 'Eswatini', ethiopia: 'Éthiopie', fiji: 'Fidji',
  france: 'France', 'french guiana': 'Guyane', gabon: 'Gabon', gambia: 'Gambie', germany: 'Allemagne', ghana: 'Ghana', greece: 'Grèce',
  guadeloupe: 'Guadeloupe', guinea: 'Guinée', 'guinea-bissau': 'Guinée-Bissau', haiti: 'Haïti', indonesia: 'Indonésie',
  'iran (islamic republic of)': 'Iran', iraq: 'Irak', israel: 'Israël', italy: 'Italie', japan: 'Japon', jordan: 'Jordanie',
  kazakhstan: 'Kazakhstan', kenya: 'Kenya', kuwait: 'Koweït', "lao people's democratic republic": 'Laos', lebanon: 'Liban',
  lesotho: 'Lesotho', liberia: 'Libéria', libya: 'Libye', madagascar: 'Madagascar', malawi: 'Malawi', malaysia: 'Malaisie', mali: 'Mali',
  martinique: 'Martinique', mauritania: 'Mauritanie', mauritius: 'Maurice', mayotte: 'Mayotte', mexico: 'Mexique', mongolia: 'Mongolie',
  morocco: 'Maroc', mozambique: 'Mozambique', myanmar: 'Myanmar', namibia: 'Namibie', nepal: 'Népal', 'new zealand': 'Nouvelle-Zélande',
  niger: 'Niger', nigeria: 'Nigeria', oman: 'Oman', pakistan: 'Pakistan', panama: 'Panama', 'papua new guinea': 'Papouasie-Nouvelle-Guinée',
  paraguay: 'Paraguay', peru: 'Pérou', philippines: 'Philippines', portugal: 'Portugal', qatar: 'Qatar', 'republic of korea': 'République de Corée',
  réunion: 'La Réunion', 'la réunion': 'La Réunion', rwanda: 'Rwanda', 'saint martin': 'Saint-Martin', 'saudi arabia': 'Arabie saoudite',
  senegal: 'Sénégal', seychelles: 'Seychelles', 'sierra leone': 'Sierra Leone', 'solomon islands': 'Îles Salomon', somalia: 'Somalie',
  'south africa': 'Afrique du Sud', 'south sudan': 'Soudan du Sud', spain: 'Espagne', 'sri lanka': 'Sri Lanka', sudan: 'Soudan',
  'syrian arab republic': 'Syrie', thailand: 'Thaïlande', 'timor-leste': 'Timor-Leste', togo: 'Togo', tunisia: 'Tunisie', 'türkiye': 'Turquie',
  ukraine: 'Ukraine', 'united arab emirates': 'Émirats arabes unis', 'united kingdom of great britain and northern ireland': 'Royaume-Uni',
  'united republic of tanzania': 'Tanzanie', tanzania: 'Tanzanie', 'united states of america': 'États-Unis',
  'venezuela (bolivarian republic of)': 'Venezuela', 'viet nam': 'Viêt Nam', yemen: 'Yémen', zambia: 'Zambie', zimbabwe: 'Zimbabwe',
}));

/** Maladie ou sujet en français ; grippe A(HxNy) reconnue ; null si inconnu. */
export function translateDisease(text) {
  const k = key(text);
  if (DISEASES.has(k)) return DISEASES.get(k);
  const avian = /^avian influenza a\((h\d+(?:n\d+)?)\)$/.exec(k);
  if (avian) return `Grippe aviaire A(${avian[1].toUpperCase()})`;
  const flu = /^influenza a\((h\d+(?:n\d+)?)\)$/.exec(k);
  if (flu) return `Grippe A(${flu[1].toUpperCase()})`;
  return null;
}

/** Pays ou zone en français ; null si inconnu. */
export function translatePlace(name) {
  return PLACES.get(key(name)) ?? null;
}

function joinFr(items) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items.at(-1)}`;
}

/**
 * Titre OMS « maladie - pays » ou « maladie, pays & pays » → « maladie : pays et pays » ; null dès qu'un
 * terme est inconnu (l'appelant garde alors le titre original).
 */
export function translateOutbreakTitle(title) {
  const t = cleanText(title);
  const dash = t.lastIndexOf(' - ');
  const comma = t.indexOf(', ');
  const cut = dash > 0 ? { at: dash, len: 3 } : comma > 0 ? { at: comma, len: 2 } : null;
  if (!cut) return translateDisease(t);
  const disease = translateDisease(t.slice(0, cut.at));
  const places = t.slice(cut.at + cut.len).split(/\s*(?:&|,|\band\b)\s*/).filter(Boolean).map(translatePlace);
  if (!disease || places.length === 0 || places.some((p) => p === null)) return null;
  return `${disease} : ${joinFr(places)}`;
}

/** Titre du rapport hebdomadaire ECDC → « Rapport hebdomadaire des menaces sanitaires, semaine 40 » ; sinon original. */
export function translateEcdcTitle(title) {
  const week = /week\s+(\d{1,2})/i.exec(title);
  return week ? `Rapport hebdomadaire des menaces sanitaires, semaine ${Number(week[1])}` : cleanText(title);
}

/** Sujet ECDC en français, ou original s'il est inconnu. */
export function translateTopic(topic) {
  return translateDisease(topic) ?? cleanText(topic);
}
