// src/components/layer-panel/health.fixture.ts : jeux d'essai des services et des vues Santé (jamais importé par l'application).
// Valeurs réelles du 03/10/2026 (facts.md, maquette sante-panneaux). Fictives : références départementales (refEr), semaines
// d'été (urgences S28 à S36, SUM'eau S13 à S30), populations sous 2,5 de 2022 et 2023, valeurs départementales des professions
// hors extrêmes cités, sites d'urgences générés et numéros FINESS ; choisies pour reproduire les niveaux de la maquette.
import type {
  AlertLevelsResponse, AplDataset, AplDepartment, AplProfession, DrugShortage, DrugShortagesV2, EmergencySite, EpidemicPhase,
  HospitalCategory, HospitalsDataset, InternationalResponse, MinistryMessage, MinistryMessagesResponse, OutbreakNews, ProductRecall,
  RecallRisk, RecallsResponse, RegionalAlertLevel, SentinellesIndicator, SentinellesNationalResponse, ShortageStatus, SyndromeKey,
  SyndromicDepartment, SyndromicDepartmentValue, SyndromicResponse, SyndromicSeries, SyndromicWeekPoint, WastewaterPoint, WastewaterResponse,
} from '../../types/index.ts';
import type { HealthSurveillanceState, SourceSlot } from '../../services/health-surveillance.ts';
import type { HealthOfferState } from '../../services/health-offer.ts';

const DAY_MS = 86_400_000;

/** Samedi 03/10/2026, 08:00 à Paris (semaine S40 ; dernière semaine publiée : S39, du 21 au 27 septembre). */
export const HEALTH_NOW = Date.parse('2026-10-03T06:00:00Z');

/** Lundi (AAAA-MM-JJ) de la semaine ISO `week` de `year`. */
export function isoMonday(year: number, week: number): string {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return new Date(jan4 + (-dow + (week - 1) * 7) * DAY_MS).toISOString().slice(0, 10);
}
export function weekId(year: number, week: number): string {
  return `${year}-S${String(week).padStart(2, '0')}`;
}

// ─── Urgences et SOS Médecins (Odissé) ───

type Triple = [number, number, number];
const pt = (year: number, week: number, er: number | null, hosp: number | null = null, sos: number | null = null): SyndromicWeekPoint =>
  ({ week: weekId(year, week), start: isoMonday(year, week), er, hosp, sos });

interface SeriesSpec {
  key: SyndromeKey; label: string; ageClass: string;
  /** Même semaine S39 des trois saisons précédentes : [part aux urgences, hospitalisations après passage] (en %). */
  refs: { y2023: [number, number]; y2024: [number, number]; y2025: [number, number] };
  /** 2025-S28 à S38, comparaison de la courbe IRA (fictif) ; absent : seule S39 de 2025. */
  prevSummer?: number[];
  /** 2026-S28 à S36, courbe IRA (fictif) ; absent : rien avant S37. */
  summer?: number[];
  s37: number;
  /** [urgences, hospitalisations après passage, SOS Médecins] en %. */
  s38: Triple;
  s39: Triple;
  /** Classes d'âge : [S38, S39]. */
  ages?: Record<string, [Triple, Triple]>;
}

const SPECS: readonly SeriesSpec[] = [
  { key: 'ira', label: 'IRA', ageClass: 'Tous âges', refs: { y2023: [3.292, 5.4], y2024: [3.451, 5.6], y2025: [2.542, 5.2] },
    prevSummer: [2.07, 2.05, 1.98, 1.87, 1.9, 2.02, 1.89, 2.03, 2.01, 2.39, 2.45],
    summer: [1.62, 1.55, 1.56, 1.48, 1.49, 1.58, 1.6, 1.61, 1.59],
    s37: 1.614, s38: [1.898, 4.218, 9.302], s39: [2.108, 4.726, 11.06],
    ages: {
      '00-04 ans': [[3.627, 8.101, 7.015], [4.143, 8.864, 8.024]],
      '05-14 ans': [[0.6, 1.9, 5.1], [0.635, 2.1, 5.6]],
      '15-64 ans': [[1.15, 3.5, 9.4], [1.269, 3.9, 10.9]],
      '65 ans ou plus': [[3.536, 5.932, 10.383], [3.915, 6.624, 13.521]],
    } },
  { key: 'bronchio', label: 'Bronchiolite', ageClass: '0 an', refs: { y2023: [10.601, 12.9], y2024: [8.051, 13.5], y2025: [7.242, 13] },
    s37: 3.957, s38: [5.793, 11.768, 3.455], s39: [6.598, 12.375, 4.017] },
  { key: 'gastro', label: 'Gastro-entérite', ageClass: 'Tous âges', refs: { y2023: [0.975, 1], y2024: [1.028, 1.2], y2025: [1.064, 1.1] },
    s37: 1.05, s38: [1.058, 0.923, 5.478], s39: [1.097, 0.992, 5.268] },
  { key: 'asthme', label: 'Asthme', ageClass: 'Tous âges', refs: { y2023: [1.15, 1.5], y2024: [1.2, 1.7], y2025: [1.1, 1.6] },
    s37: 1.15, s38: [1.134, 1.697, 1.372], s39: [1.037, 1.443, 1.375] },
  { key: 'allergie', label: 'Allergie', ageClass: 'Tous âges', refs: { y2023: [0.75, 0.4], y2024: [0.66, 0.3], y2025: [0.7, 0.35] },
    s37: 0.76, s38: [0.731, 0.369, 1.215], s39: [0.661, 0.322, 1.1] },
  { key: 'grippe', label: 'Grippe', ageClass: 'Tous âges', refs: { y2023: [0.26, 0.2], y2024: [0.42, 0.3], y2025: [0.31, 0.25] },
    s37: 0.211, s38: [0.246, 0.144, 3.901], s39: [0.276, 0.182, 4.61] },
  { key: 'covid', label: 'COVID-19', ageClass: 'Tous âges', refs: { y2023: [0.61, 0.8], y2024: [0.95, 1.1], y2025: [0.52, 0.7] },
    s37: 0.124, s38: [0.181, 0.236, 0.966], s39: [0.209, 0.322, 1.136],
    ages: { '65 ans ou plus': [[0.275, 0.36, 0.603], [0.374, 0.523, 1.061]] } },
];

function series(s: SeriesSpec): SyndromicSeries {
  const france: SyndromicWeekPoint[] = [
    pt(2023, 39, ...s.refs.y2023),
    pt(2024, 39, ...s.refs.y2024),
    ...(s.prevSummer ?? []).map((er, i) => pt(2025, 28 + i, er)),
    pt(2025, 39, ...s.refs.y2025),
    ...(s.summer ?? []).map((er, i) => pt(2026, 28 + i, er)),
    pt(2026, 37, s.s37),
    pt(2026, 38, ...s.s38),
    pt(2026, 39, ...s.s39),
  ];
  const ages: Record<string, SyndromicWeekPoint[]> = {};
  for (const [age, [s38, s39]] of Object.entries(s.ages ?? {})) ages[age] = [pt(2026, 38, ...s38), pt(2026, 39, ...s39)];
  return { key: s.key, label: s.label, ageClass: s.ageClass, france, ages };
}

const dv = (er: number, hosp: number | null, sos: number | null, refEr: number[]): SyndromicDepartmentValue => ({ er, hosp, sos, refEr });
const DEPARTMENTS: readonly SyndromicDepartment[] = [
  { code: '974', name: 'La Réunion', values: { ira: dv(5.679, 5.98, null, [4.2, 4.9, 4.6]), grippe: dv(3.85, 2.575, null, [2.9, 3.3, 3.2]),
    bronchio: dv(10.425, 17.647, null, [9, 10, 9.5]), gastro: dv(3.399, 2.243, null, [3.1, 3.3, 3]) } },
  { code: '976', name: 'Mayotte', values: { ira: dv(3.888, 4.1, null, [3.1, 2.8, 3.3]), grippe: dv(0.9, 0.7, null, [0.6, 0.8, 0.7]),
    gastro: dv(3.78, 2.6, null, [3.2, 2.9, 3.1]) } },
  { code: '48', name: 'Lozère', values: { ira: dv(3.711, 6, null, [3.2, 3.5, 3.4]), gastro: dv(1.4, 1.1, null, [1.5, 1.2, 1.6]) } },
  { code: '13', name: 'Bouches-du-Rhône', values: { ira: dv(2.415, 5.025, 17.829, [2.3, 2, 2.2]),
    bronchio: dv(6.604, 14.607, 0, [7.2, 8, 7]), gastro: dv(1.672, 1.41, 6.804, [1.8, 1.9, 1.7]) } },
  { code: '69', name: 'Rhône', values: { ira: dv(2.005, 6.546, 11.406, [1.9, 1.8, 1.85]),
    bronchio: dv(5.913, 19.149, 7.692, [6.5, 7.4, 6.8]), gastro: dv(0.922, 0.584, 6.103, [1, 1.1, 0.9]) } },
  { code: '971', name: 'Guadeloupe', values: { ira: dv(1.9, 3.1, null, [2.2, 2.5, 2.1]), grippe: dv(1.008, 0.8, null, [0.8, 1.3, 1.1]),
    gastro: dv(1.1, 0.9, null, [1.2, 1, 1.3]) } },
  { code: '59', name: 'Nord', values: { ira: dv(1.85, 4.4, 10.2, [2.3, 2.6, 2.4]), bronchio: dv(7.2, 12, 4.1, [7.9, 8.3, 8]),
    gastro: dv(1.3, 1, 5, [1.4, 1.5, 1.3]) } },
  { code: '75', name: 'Paris', values: { ira: dv(1.757, 3.376, 13.405, [2.4, 2.9, 2.6]), bronchio: dv(6.091, 5.263, 2.463, [7, 8, 7.5]),
    gastro: dv(1.218, 0.959, 5.5, [1.3, 1.4, 1.2]) } },
  { code: '973', name: 'Guyane', values: { ira: dv(1.6, 2.9, null, [1.9, 2, 1.7]), grippe: dv(1.245, 1, null, [1.5, 1.4, 1.6]),
    gastro: dv(2.202, 1.7, null, [2.5, 2.3, 2.4]) } },
  { code: '972', name: 'Martinique', values: { ira: dv(1.5, 2.8, null, [1.7, 1.8, 1.6]), grippe: dv(0.5, 0.4, null, [0.9, 0.7, 0.8]),
    gastro: dv(1, 0.8, null, [1.1, 1.2, 1]) } },
];

export function syndromicFixture(): SyndromicResponse {
  return {
    week: { id: '2026-S39', start: '2026-09-21', end: '2026-09-27' }, publishedAt: '2026-09-30T10:01:00Z',
    syndromes: SPECS.map(series), departments: structuredClone(DEPARTMENTS) as SyndromicDepartment[], errors: [],
  };
}

// ─── Niveaux d'alerte (Odissé) : hors saison partout sauf la grippe à Mayotte (pré-épidémie, S39) ───

const al = (region: string, regionName: string, pathology: 'grippe' | 'bronchiolite', phase: EpidemicPhase, week: number): RegionalAlertLevel =>
  ({ region, regionName, pathology, phase, week: weekId(2026, week), start: isoMonday(2026, week) });
const METRO_REGIONS: ReadonlyArray<[string, string]> = [
  ['11', 'Île-de-France'], ['24', 'Centre-Val de Loire'], ['27', 'Bourgogne-Franche-Comté'], ['28', 'Normandie'], ['32', 'Hauts-de-France'],
  ['44', 'Grand Est'], ['52', 'Pays de la Loire'], ['53', 'Bretagne'], ['75', 'Nouvelle-Aquitaine'], ['76', 'Occitanie'],
  ['84', 'Auvergne-Rhône-Alpes'], ['93', 'Provence-Alpes-Côte d’Azur'], ['94', 'Corse'],
];

export function alertLevelsFixture(): AlertLevelsResponse {
  return {
    levels: [
      ...METRO_REGIONS.flatMap(([c, n]) => [al(c, n, 'grippe', 1, 16), al(c, n, 'bronchiolite', 1, 16)]),
      al('01', 'Guadeloupe', 'grippe', 1, 15), al('01', 'Guadeloupe', 'bronchiolite', 1, 15),
      al('02', 'Martinique', 'grippe', 3, 15), al('02', 'Martinique', 'bronchiolite', 1, 15),
      al('03', 'Guyane', 'grippe', 1, 16), al('03', 'Guyane', 'bronchiolite', 1, 16),
      al('04', 'La Réunion', 'grippe', 1, 15), al('04', 'La Réunion', 'bronchiolite', 1, 15),
      al('06', 'Mayotte', 'grippe', 2, 39), al('06', 'Mayotte', 'bronchiolite', 4, 16),
    ],
    bulletins: [
      { territory: 'Océan Indien', title: 'Surveillance sanitaire à La Réunion et à Mayotte : point au 2 octobre', date: '2026-10-02',
        url: 'https://www.santepubliquefrance.fr/regions/ocean-indien/documents/bulletin-regional/2026/point-au-2-octobre', summary: 'Cas sporadiques de dengue.' },
      { territory: 'Guyane', title: 'Chikungunya et dengue en Guyane : point au 2 octobre', date: '2026-10-02',
        url: 'https://www.santepubliquefrance.fr/regions/guyane/documents/bulletin-regional/2026/point-au-2-octobre', summary: 'Activité dengue faible.' },
      { territory: 'Antilles', title: 'Dengue aux Antilles : situation au 10 septembre', date: '2026-09-10',
        url: 'https://www.santepubliquefrance.fr/regions/antilles/documents/bulletin-regional/2026/situation-au-10-septembre', summary: 'Circulation faible.' },
    ],
    latestWeek: { id: '2026-S39', start: '2026-09-21', end: '2026-09-27' },
    ignoredRegionCodes: ['07', '08'],
    errors: [],
  };
}

// ─── Sentinelles (flux RSS, S39 provisoire) ───

const ind = (key: SentinellesIndicator['key'], label: string, parent: 'ira' | null, rate: number, ciLow: number, ciHigh: number,
  previous: number, trend: string): SentinellesIndicator => ({ key, label, parent, rate, ciLow, ciHigh, previous, trend, activity: 'faible' });

export function sentinellesFixture(): SentinellesNationalResponse {
  return {
    week: { id: '2026-S39', start: '2026-09-21', end: '2026-09-27' }, provisional: true,
    indicators: [
      ind('ira', 'IRA', null, 151, 144, 158, 103, 'en augmentation'),
      ind('covid', 'COVID-19', 'ira', 13, 9, 17, 9, 'légère augmentation'),
      ind('grippe', 'Grippe', 'ira', 4, 1, 7, 5, 'stable'),
      ind('vrs', 'VRS', 'ira', 0, 0, 6, 0, 'stable'),
      ind('bronchiolite', 'Bronchiolite (moins de 1 an)', null, 135, 45, 225, 236, 'stable'),
      ind('diarrhee', 'Diarrhée aiguë', null, 50, 46, 55, 45, 'stable'),
      ind('varicelle', 'Varicelle', null, 4, 3, 5, 2, 'légère augmentation'),
    ],
    topRegions: [
      { indicator: 'ira', region: 'Bourgogne-Franche-Comté', rate: 310, ciLow: 259, ciHigh: 361 },
      { indicator: 'ira', region: 'Bretagne', rate: 254, ciLow: 212, ciHigh: 296 },
      { indicator: 'ira', region: 'Hauts-de-France', rate: 186, ciLow: 159, ciHigh: 214 },
      { indicator: 'diarrhee', region: 'Corse', rate: 95, ciLow: 36, ciHigh: 154 },
    ],
    bulletinUrl: 'https://www.sentiweb.fr/6917.pdf', errors: [],
  };
}

// ─── SUM'eau : 26 semaines (S13 à S38), S31 à S38 réelles ───

const WW: readonly number[] = [
  260, 245, 230, 220, 210, 200, 195, 190, 186, 183, 185, 188, 192, 199, 215, 240, 270, 305,
  339.6, 384.1, 465.1, 563, 711.7, 928.7, 1279.7, 1838.9,
];

export function wastewaterFixture(): WastewaterResponse {
  return {
    points: WW.map((v, i): WastewaterPoint => ({ week: weekId(2026, 13 + i), start: isoMonday(2026, 13 + i), national54: v, national12: null })),
    lastYear: { week: weekId(2025, 38), start: isoMonday(2025, 38), national54: 3340, national12: null },
    stationsReporting: 48, stationsTotal: 55, publishedAt: '2026-09-30T10:30:00Z', errors: [],
  };
}

// ─── OMS et ECDC ───

const EBOLA = 'Ebola (virus Bundibugyo), République démocratique du Congo';
const EBOLA_EN = 'Ebola disease caused by Bundibugyo virus - Democratic Republic of the Congo';
const EBOLA_UG = 'Ebola (virus Bundibugyo), République démocratique du Congo et Ouganda';
const EBOLA_UG_EN = 'Ebola disease caused by Bundibugyo virus, Democratic Republic of the Congo & Uganda';
const don = (n: number, date: string, title: string, originalTitle: string): OutbreakNews => ({
  id: `2026-DON${n}`, title, originalTitle, date, url: `https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON${n}`, summary: '',
});
const ecdcUrl = (slug: string): string => `https://www.ecdc.europa.eu/en/publications-data/communicable-disease-threats-report-${slug}`;

export function internationalFixture(): InternationalResponse {
  return {
    who: [
      don(618, '2026-09-25', EBOLA, EBOLA_EN), don(617, '2026-09-10', EBOLA, EBOLA_EN), don(616, '2026-08-28', EBOLA, EBOLA_EN),
      don(615, '2026-08-14', EBOLA, EBOLA_EN), don(614, '2026-08-01', EBOLA, EBOLA_EN),
      don(613, '2026-07-17', EBOLA_UG, EBOLA_UG_EN), don(612, '2026-07-03', EBOLA_UG, EBOLA_UG_EN),
      don(611, '2026-07-02', 'Hantavirus lié à une croisière, plusieurs pays', 'Hantavirus outbreak linked to cruise ship travel, Multi-locations'),
      don(609, '2026-06-25', 'Virus Nipah, Inde', 'Nipah virus disease - India'),
      don(610, '2026-06-24', 'Fièvre jaune, monde', 'Yellow fever - Global'),
    ],
    ecdc: [
      { title: 'Communicable disease threats report, 26 September - 2 October, week 40', date: '2026-10-02', url: ecdcUrl('26-september-2-october-week-40'),
        topics: ['Ebola', 'grippe aviaire', 'virus du Nil occidental', 'dengue', 'chikungunya', 'CCHF', 'choléra', 'COVID-19', 'VRS', 'vibrioses'] },
      { title: 'Communicable disease threats report, 19-25 September, week 39', date: '2026-09-25', url: ecdcUrl('19-25-september-week-39'),
        topics: ['virus respiratoires', 'Ebola', 'virus du Nil occidental', 'CCHF', 'dengue', 'chikungunya', 'vibrioses'] },
      { title: 'Communicable disease threats report, 12-18 September, week 38', date: '2026-09-18', url: ecdcUrl('12-18-september-week-38'),
        topics: ['Ebola', 'paludisme', 'botulisme', 'grippe aviaire', 'rougeole'] },
    ],
    errors: [],
  };
}

// ─── Messages DGS-Urgent et MARS (portail PEPS) ───

const msg = (kind: MinistryMessage['kind'], number: string, date: string, title: string, reply = false): MinistryMessage => ({
  kind, number, date, title, reply, url: `https://peps.sante.gouv.fr/actu/${kind === 'MARS' ? 'mars' : 'dgs-urgent'}-${number}.pdf`,
});

export function ministryFixture(): MinistryMessagesResponse {
  return {
    messages: [
      msg('MARS', '2026_14', '2026-09-22', 'Campagne de vaccination 2026-2027 : message aux établissements de santé'),
      msg('DGS-Urgent', '2026_12', '2026-09-28', 'Campagne de vaccination 2026-2027 contre la grippe saisonnière et le COVID-19', true),
      msg('DGS-Urgent', '2026-11', '2026-09-18', 'Cas de diphtérie ORL porteur du gène tox dans le Dunkerquois : vigilance renforcée'),
      msg('DGS-Urgent', '2026-10', '2026-08-10', 'Campagne de vaccination et d’immunisation VRS du nourrisson'),
      msg('MARS', '2026_09', '2026-06-02', 'Vague de chaleur : préparation des établissements de santé'),
      msg('DGS-Urgent', '2026-08', '2026-05-20', 'Rougeole : conduite à tenir autour d’un cas'),
    ],
    sourceUrl: 'https://peps.sante.gouv.fr/actu/actualites.html',
    officialUrl: 'https://sante.gouv.fr/ministere/informations-pratiques/site/dgs-urgent',
    errors: [],
  };
}

// ─── ANSM : 47 ruptures et 133 tensions (180 situations actives), 99 remises, 17 arrêts ───

const shortage = (name: string, status: ShortageStatus, updatedAt: string, domains: string[], startedAt: string | null = null): DrugShortage => ({
  name, status, updatedAt, startedAt, availableAgainAt: null, domains,
  url: `https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/${encodeURIComponent(name)}`,
});
/** [domaine, ruptures, tensions] générés en plus des trois entrées nommées. */
const BULK: ReadonlyArray<[string, number, number]> = [
  ['Infectiologie', 14, 11], ['Psychiatrie', 6, 16], ['Cardiologie', 4, 17], ['Ophtalmologie', 3, 17], ['Oncologie', 6, 12],
  ['Hépato-gastro-entérologie', 2, 15], ['Neurologie', 4, 10], ['Endocrinologie', 3, 11], ['Pneumologie', 2, 12], ['Rhumatologie', 2, 10],
];

export function drugsFixture(): DrugShortagesV2 {
  const items: DrugShortage[] = [
    shortage('Plerixafor Arrow 20 mg/mL', 'rupture', '2026-10-02', ['Hématologie'], '2026-09-23'),
    shortage('Mytélase', 'tension', '2026-09-30', ['Neurologie']),
    shortage('Kétoprofène Pharmy II', 'tension', '2026-09-28', ['Rhumatologie']),
    ...BULK.flatMap(([domain, r, t]) => [
      ...Array.from({ length: r }, (_, i) => shortage(`${domain} ${i + 1}`, 'rupture', '2026-09-01', [domain])),
      ...Array.from({ length: t }, (_, i) => shortage(`${domain} ${r + i + 1}`, 'tension', '2026-09-01', [domain])),
    ]),
    shortage('Amoxicilline Biogaran 1 g', 'remise', '2026-09-29', ['Infectiologie']),
    shortage('Spécialité retirée', 'arret', '2026-09-15', ['Cardiologie']),
  ];
  return {
    items, counts: { rupture: 47, tension: 133, remise: 99, arret: 17 }, latestUpdate: '2026-10-02',
    mitmListUrl: 'https://ansm.sante.fr/documents/reference/medicaments-dinteret-therapeutique-majeur-mitm', errors: [],
  };
}

// ─── RappelConso : 14 jours, 88 rappels dont 56 à risque sanitaire ───

const recall = (id: string, date: string, label: string, brand: string, risks: RecallRisk[], riskText: string, zone: string): ProductRecall =>
  ({ id, date, label, brand, category: 'alimentation', risks, riskText, zone, url: `https://rappel.conso.gouv.fr/fiche-rappel/${id}/interne` });

export function recallsFixture(): RecallsResponse {
  return {
    since: '2026-09-19', total: 88, healthRisk: 56,
    byRisk: { salmonelle: 26, listeria: 21, stec: 6, allergene: 3 },
    byDay: [
      { day: '2026-10-02', total: 11, healthRisk: 9 }, { day: '2026-10-01', total: 13, healthRisk: 8 }, { day: '2026-09-30', total: 8, healthRisk: 4 },
      { day: '2026-09-29', total: 7, healthRisk: 1 }, { day: '2026-09-28', total: 4, healthRisk: 2 }, { day: '2026-09-25', total: 13, healthRisk: 11 },
      { day: '2026-09-24', total: 8, healthRisk: 7 }, { day: '2026-09-23', total: 8, healthRisk: 4 }, { day: '2026-09-22', total: 9, healthRisk: 4 },
      { day: '2026-09-21', total: 7, healthRisk: 6 },
    ],
    latest: [
      recall('23689', '2026-10-02T17:50:00Z', 'haché de veau façon bouchère', 'carrefour le marché', ['salmonelle'], 'salmonella spp', 'France entière'),
      recall('23690', '2026-10-02T16:32:00Z', 'saucisse de volaille façon charcutière', 'maitre coq', ['salmonelle'], 'salmonella spp', 'France entière'),
      recall('23691', '2026-10-02T16:31:00Z', 'haché de veau façon boucher', 'tendriade', ['salmonelle'], 'salmonella spp', 'France entière'),
      recall('23655', '2026-10-01T15:10:00Z', 'fromage de chèvre au lait cru', 'fromagerie du val', ['listeria'], 'listeria monocytogenes', 'Grand Est'),
      recall('23642', '2026-10-01T09:20:00Z', 'rillettes de saumon', 'atelier marin', ['listeria'], 'listeria monocytogenes', 'France entière'),
      recall('23630', '2026-09-30T14:05:00Z', 'steak haché surgelé', 'bistro boeuf', ['stec'], 'escherichia coli shiga toxinogène (STEC)', 'France entière'),
      recall('23611', '2026-09-29T11:40:00Z', 'biscuits aux noisettes', 'maison doré', ['allergene'], 'substances allergisantes non déclarées', 'Occitanie'),
      recall('23598', '2026-09-28T16:00:00Z', 'thon en tranches', 'marée fraîche', ['histamine'], 'toxines endogènes : histamine', 'Bretagne'),
      recall('23580', '2026-09-25T10:15:00Z', 'saucisson sec', 'charcuterie des monts', ['salmonelle', 'listeria'], 'salmonella spp|listeria monocytogenes', 'Auvergne-Rhône-Alpes'),
      recall('23571', '2026-09-25T08:30:00Z', 'fromage de brebis', 'berger basque', ['listeria'], 'listeria monocytogenes', 'Nouvelle-Aquitaine'),
    ],
    errors: [],
  };
}

const ok = <T>(data: T): SourceSlot<T> => ({ data, error: null, fetchedAt: HEALTH_NOW });

export function surveillanceFixture(): HealthSurveillanceState {
  return {
    syndromic: ok(syndromicFixture()), alerts: ok(alertLevelsFixture()), sentinelles: ok(sentinellesFixture()),
    wastewater: ok(wastewaterFixture()), international: ok(internationalFixture()), ministry: ok(ministryFixture()),
    drugs: ok(drugsFixture()), recalls: ok(recallsFixture()),
  };
}

// ─── APL DREES 2024 ───

type Prof = Record<AplProfession, number | null>;
const P = (mg: number, inf: number, kine: number, sf: number, dent: number): Prof => ({ mg, inf, kine, sf, dent });
const aplDep = (code: string, name: string, apl: Prof, apl2023: Prof, pop: number, popUnder25: number, shareUnder25: number): AplDepartment =>
  ({ code, name, apl, apl2023, pop, popUnder25, shareUnder25 });
const APL_DEPARTMENTS: readonly AplDepartment[] = [
  aplDep('95', 'Val-d’Oise', P(2.37, 120.4, 95.2, 18.4, 55.1), P(2.42, 121, 93, 18, 54.9), 1_270_845, 877_739, 69.1),
  aplDep('973', 'Guyane', P(1.76, 210.5, 49.3, 25.1, 28), P(1.8, 212, 50.1, 24.8, 28.5), 288_382, 197_389, 68.4),
  aplDep('91', 'Essonne', P(2.39, 110.2, 98, 19, 58.2), P(2.45, 111, 96.5, 18.7, 57.9), 1_324_546, 852_495, 64.4),
  aplDep('77', 'Seine-et-Marne', P(2.31, 115, 90.1, 18.9, 50.3), P(2.36, 116.2, 88.8, 18.5, 50), 1_452_399, 884_457, 60.9),
  aplDep('28', 'Eure-et-Loir', P(2.36, 130, 70.2, 17, 40.1), P(2.4, 131.5, 69, 16.8, 40), 432_950, 256_671, 59.3),
  aplDep('18', 'Cher', P(2.26, 150.3, 62, 16.2, 35), P(2.3, 151, 61.2, 16, 35.5), 299_496, 173_217, 57.8),
  aplDep('78', 'Yvelines', P(2.47, 67.9, 110, 20.1, 70.2), P(2.5, 68.5, 108, 19.8, 69.9), 1_470_778, 793_484, 53.9),
  aplDep('01', 'Ain', P(2.57, 125.1, 105.3, 21, 52), P(2.6, 126, 103, 20.6, 51.8), 671_289, 349_303, 52),
  aplDep('89', 'Yonne', P(2.52, 160.2, 75, 18, 38), P(2.55, 161, 74, 17.9, 38.2), 333_896, 169_484, 50.8),
  aplDep('48', 'Lozère', P(2.56, 240, 120, 15, 45), P(2.6, 238, 118, 15.2, 44), 76_503, 37_517, 49),
  aplDep('75', 'Paris', P(5.5, 90.2, 180, 28, 116.3), P(5.55, 91, 178, 27.5, 115), 2_113_705, 0, 0),
  aplDep('13', 'Bouches-du-Rhône', P(4.6, 260.1, 200.2, 26, 86.3), P(4.62, 262, 198, 25.8, 85.9), 2_069_811, 28_977, 1.4),
  aplDep('69', 'Rhône', P(3.97, 140, 150, 30.1, 80), P(4, 141, 148, 29.8, 79.5), 1_907_982, 124_019, 6.5),
  aplDep('2A', 'Corse-du-Sud', P(3.95, 380, 190, 20, 60), P(3.98, 378, 188, 19.8, 59.8), 166_045, 32_047, 19.3),
  aplDep('2B', 'Haute-Corse', P(3.86, 411.5, 185, 19, 55), P(3.9, 409, 183, 18.9, 54.8), 185_231, 30_563, 16.5),
  aplDep('971', 'Guadeloupe', P(3.57, 364, 160, 30, 45), P(3.6, 362, 158, 29.6, 44.8), 383_569, 42_576, 11.1),
  aplDep('972', 'Martinique', P(3.7, 340, 150, 36.7, 48), P(3.72, 338, 149, 36.2, 47.5), 361_019, 32_853, 9.1),
  aplDep('974', 'La Réunion', P(5.44, 470.7, 245.3, 37.1, 70), P(5.4, 468, 243, 36.8, 69.5), 881_348, 0, 0),
  aplDep('61', 'Orne', P(2.8, 140, 80, 11.9, 40), P(2.85, 141, 79, 12, 40.2), 279_942, 70_000, 25),
  aplDep('23', 'Creuse', P(3.1, 200, 70, 13, 22), P(3.15, 201, 69, 13.1, 22.5), 116_270, 20_000, 17.2),
];

export function aplFixture(): AplDataset {
  return {
    vintage: 2024, publishedAt: '2026-07-22', source: 'DREES, jeu 530_l-accessibilite-potentielle-localisee-apl',
    france: {
      apl: { mg: 3.72, inf: 154.8, kine: 123.2, sf: 22.2, dent: 61.5 },
      apl2023: { mg: 3.74, inf: 156, kine: 119.3, sf: 21.8, dent: 60.6 },
      byYear: [
        { year: 2022, aplMg: 3.79, shareUnder25: 14.9, popUnder25: 10_096_325 },
        { year: 2023, aplMg: 3.74, shareUnder25: 16.6, popUnder25: 11_248_255 },
        { year: 2024, aplMg: 3.72, shareUnder25: 18.2, popUnder25: 12_341_978 },
      ],
    },
    departments: structuredClone(APL_DEPARTMENTS) as AplDepartment[],
    missing: ['976'],
  };
}

// ─── Hôpitaux : 617 sites autorisés, 616 placés (CH 371, privés 150, CHU 82, GCS 7, armées 6) ───

const site = (finess: string, name: string, commune: string, dept: string, category: HospitalCategory, passages: number,
  over: Partial<EmergencySite> = {}): EmergencySite => ({
  finess, name, commune, dept, category, lat: 46.5, lon: 2.5, general: true, pediatric: false, seasonal: false, antenna: false,
  passages, bedsMco: 300, bedsIcu: null, bedsIntensive: null, bedsUhcd: 8, ...over,
});
const NAMED_SITES: readonly EmergencySite[] = [
  site('750100125', 'Pitié-Salpêtrière', 'Paris', '75', 'chu', 132_774, { lat: 48.838, lon: 2.365, bedsMco: 1600, bedsIcu: 110, bedsIntensive: 120 }),
  site('840000046', 'CH d’Avignon', 'Avignon', '84', 'ch', 128_036, { lat: 43.932, lon: 4.807, bedsIcu: 20 }),
  site('340780477', 'Lapeyronie', 'Montpellier', '34', 'chu', 127_704, { lat: 43.631, lon: 3.852, bedsIcu: 40 }),
  site('760780239', 'Charles-Nicolle', 'Rouen', '76', 'chu', 124_082, { lat: 49.442, lon: 1.107, bedsIcu: 74 }),
  site('300780038', 'CHU de Nîmes', 'Nîmes', '30', 'chu', 122_942, { lat: 43.836, lon: 4.375, bedsIcu: 30 }),
];
const GENERATED: ReadonlyArray<[HospitalCategory, number]> = [['ch', 370], ['chu', 78], ['private', 150], ['gcs', 7], ['army', 6]];
const DEPT_PLAN: ReadonlyArray<[string, number]> = [['59', 20], ['13', 17], ['75', 15], ['33', 15], ['69', 15]];
const ALL_DEPTS: readonly string[] = [
  ...Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, '0')), '2A', '2B',
  ...Array.from({ length: 75 }, (_, i) => String(i + 21)), '971', '972', '973', '974', '976',
];

export function hospitalsFixture(): HospitalsDataset {
  const plan = DEPT_PLAN.flatMap(([code, n]) => Array.from({ length: n }, () => code));
  const others = ALL_DEPTS.filter((c) => !DEPT_PLAN.some(([p]) => p === c));
  let k = 0;
  const generated = GENERATED.flatMap(([category, n]) => Array.from({ length: n }, () => {
    const i = k;
    k += 1;
    const antenna = i >= 100 && i < 106;
    return site(`99${String(i).padStart(7, '0')}`, `Site d’urgences ${i + 1}`, `Commune ${i + 1}`,
      i < plan.length ? plan[i] : others[(i - plan.length) % others.length], category, 20_000 + i * 100,
      { pediatric: i < 89, antenna, general: !antenna, seasonal: i >= 110 && i < 113, lat: 43 + (i % 50) * 0.1, lon: -1 + (i % 70) * 0.1 });
  }));
  return {
    vintage: 2025, finessDate: '2026-05-04', sites: [...structuredClone(NAMED_SITES) as EmergencySite[], ...generated], unmatched: ['830200523'],
    totals: { sites: 617, passages: 21_704_107, bedsMco: 184_933, bedsIcu: 5_755, bedsIntensive: 9_867, icuSites: 327 },
    establishments: [
      { aggregate: '1101', label: 'Centres hospitaliers régionaux (CHR et CHU)', count: 388 },
      { aggregate: '1102', label: 'Centres hospitaliers', count: 1371 },
      { aggregate: '1103', label: 'Centres hospitaliers spécialisés en santé mentale', count: 1406 },
      { aggregate: '1104', label: 'Centres de lutte contre le cancer', count: 31 },
      { aggregate: '1106', label: 'Hôpitaux locaux', count: 195 },
      { aggregate: '1107', label: 'Soins de suite et de réadaptation', count: 708 },
      { aggregate: '1109', label: 'Soins de longue durée', count: 577 },
      { aggregate: '1110', label: 'Soins de courte durée (cliniques)', count: 631 },
      { aggregate: '1111', label: 'Autres établissements relevant de la loi hospitalière', count: 3189 },
    ],
  };
}

export function offerFixture(): HealthOfferState {
  return { apl: ok(aplFixture()), hospitals: ok(hospitalsFixture()) };
}
