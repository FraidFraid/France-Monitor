// src/components/layer-panel/traffic.fixture.ts : jeux d'essai des services, des vues et de la carte Trafics (jamais importé par
// l'application). Valeurs réelles du samedi 03/10/2026 (facts.md, maquette trafic-panneaux). Fictives : événements DIR de
// remplissage (« repère 1 » à « repère 58 ») et heures de début des fermetures sans date publiée, bouchons concédés autres que
// l'A8, routes et débits des stations lentes, aéronefs au-dessus du territoire, échantillons de volume, annuaires de Beauvais et
// de Bordeaux, crédits OpenSky, trajectoires inhabituelles, trains autres que les cinq plus gros retards et tous les arrêts,
// nombres de trains des situations de Narbonne et d'Agen, découpage supprimés et service réduit des groupes, navires sensibles
// listés, quota TomTom du jour, bouchons TomTom autres que les plus longs de Paris et de Lyon, sections Traficolor géolocalisées, comptes de
// navires par type.
import type {
  AirOverviewResponse, AirportActivity, ConcededJam, MaritimeSnapshot, RailGroupStats, RailOverviewResponse, RailSituation,
  RailSituationsResponse, RailTrain, RoadAggloOfficial, RoadEvent, RoadNationalResponse, RoadSpeedStation, RoadUrbanResponse, UrbanJam,
} from '../../types/index.ts';
import type { SourceSlot } from '../../services/health-surveillance.ts';
import type { RoadTrafficState } from '../../services/traffic-road.ts';
import type { AirOverviewState } from '../../services/traffic-air.ts';
import type { RailTrafficState } from '../../services/traffic-rail.ts';
import type { MaritimeState } from '../../services/traffic-maritime.ts';

/** Samedi 03/10/2026, 15:15 à Paris (13:15 UTC) : toutes les sources du jeu d'essai sont à l'heure. */
export const TRAFFIC_NOW = Date.parse('2026-10-03T13:15:00Z');

/** Heure de Paris (heure d'été, UTC+2) au format ISO : paris('14:57') = « 2026-10-03T14:57:00+02:00 ». */
export function paris(hhmm: string, day = '2026-10-03'): string {
  return `${day}T${hhmm}:00+02:00`;
}

// ─── Route : réseau national (DIR) ───

function ev(over: Partial<RoadEvent> & Pick<RoadEvent, 'id' | 'kind' | 'label' | 'dir' | 'start'>): RoadEvent {
  return {
    subtype: '', road: null, place: null, direction: null, end: null, severity: 'medium', safety: false, planned: false,
    longTerm: false, lat: null, lon: null, detail: '', ...over,
  };
}

const NAMED: readonly RoadEvent[] = [
  ev({ id: 'acc-a55', kind: 'accident', subtype: 'accident', label: 'Accident', road: 'A55', place: 'Les Pennes-Mirabeau',
    direction: 'vers Marseille', dir: 'DIR Méditerranée', start: paris('14:44'), safety: true, lat: 43.371, lon: 5.321 }),
  ev({ id: 'acc-a86', kind: 'accident', subtype: 'accident', label: 'Accident', road: 'A86', place: 'Colombes',
    direction: 'vers Versailles', dir: 'DIR Île-de-France', start: paris('14:08'), detail: 'bande d’arrêt', lat: 48.922, lon: 2.227 }),
  ev({ id: 'acc-n10-yrieix', kind: 'accident', subtype: 'accident', label: 'Accident', road: 'N10', place: 'Saint-Yrieix-sur-Charente',
    direction: 'vers Bordeaux', dir: 'DIR Atlantique', start: paris('13:55'), severity: 'high',
    detail: 'bande d’arrêt et chaussée entière', lat: 45.673, lon: 0.14 }),
  ev({ id: 'acc-n10-vignolles', kind: 'accident', subtype: 'accident', label: 'Accident', road: 'N10', place: 'Vignolles',
    direction: 'vers Bordeaux', dir: 'DIR Atlantique', start: paris('13:02'), safety: true, detail: 'bande d’arrêt', lat: 45.521, lon: -0.099 }),
  ev({ id: 'queue-a7', kind: 'queue', subtype: 'queuingTraffic', label: 'Bouchon', road: 'A7', place: 'Saint-Fons',
    direction: 'vers Lyon', dir: 'DIR Centre-Est', start: paris('14:36'), detail: 'toutes voies', lat: 45.694, lon: 4.844 }),
  ev({ id: 'closure-a63', kind: 'closure', subtype: 'roadClosed', label: 'Route coupée', road: 'A63', place: 'Cestas à Pessac',
    direction: 'vers Bordeaux', dir: 'DIR Atlantique', start: paris('09:25'), lat: 44.788, lon: -0.631 }),
  ev({ id: 'gravel-flumet', kind: 'obstruction', subtype: 'slipperyRoad', label: 'Gravillons', place: 'Flumet (Savoie)',
    dir: 'DIR Centre-Est', start: paris('14:15'), detail: 'après trois accidents', lat: 45.817, lon: 6.515 }),
];

/** Remplissage (fictif) : 58 incidents qui complètent les 64 du jour, répartis pour reproduire les comptes par DIR. */
const FILLER_KINDS: ReadonlyArray<readonly [string, string, number]> = [
  ['Véhicule en panne', 'brokenDownVehicle', 37], ['Obstacle', 'obstructionOnTheRoad', 12], ['Personnes sur la chaussée', 'peopleOnRoadway', 3],
  ['Animal', 'animalPresence', 1], ['Objet sur la chaussée', 'objectOnTheRoad', 3], ['Dégâts sur la chaussée', 'infrastructureDamage', 2],
];
const FILLER_DIRS: ReadonlyArray<readonly [string, number]> = [
  ['DIR Méditerranée', 20], ['DIR Centre-Est', 9], ['DIR Ouest', 9], ['DIR Île-de-France', 6], ['DIR Massif-Central', 6],
  ['DIR Atlantique', 2], ['DIR Sud-Ouest', 2], ['DIR Est', 2], ['DIR Nord', 1], ['CORG', 1],
];

function fillers(): RoadEvent[] {
  const kinds = FILLER_KINDS.flatMap(([label, subtype, n]) => Array.from({ length: n }, () => [label, subtype] as const));
  const dirs = FILLER_DIRS.flatMap(([dir, n]) => Array.from({ length: n }, () => dir));
  return kinds.map(([label, subtype], i) => ev({
    id: `filler-${i + 1}`, kind: 'obstruction', subtype, label, dir: dirs[i], place: `repère ${i + 1}`,
    start: new Date(Date.parse(paris('08:00')) + i * 5 * 60_000).toISOString(),
  }));
}

const LONG_TERM: readonly RoadEvent[] = [
  ev({ id: 'lt-puymorens', kind: 'closure', subtype: 'roadClosed', label: 'Route coupée', road: 'N320', place: 'tunnel du Puymorens',
    dir: 'DIR Sud-Ouest', start: paris('00:00', '2026-06-01'), end: paris('23:59', '2026-10-29'), planned: true, longTerm: true,
    lat: 42.556, lon: 1.799 }),
  ev({ id: 'lt-tarascon', kind: 'closure', subtype: 'roadClosed', label: 'Route coupée', road: 'N20',
    place: 'Tarascon-sur-Ariège à Saint-Jean-de-Verges', dir: 'DIR Sud-Ouest', start: paris('13:50', '2026-09-28'),
    end: paris('18:00', '2026-10-06'), planned: true, longTerm: true, lat: 42.95, lon: 1.62 }),
  ev({ id: 'lt-n7', kind: 'closure', subtype: 'roadClosed', label: 'Route coupée', road: 'N7',
    place: 'Saint-Martin-d’Estréaux à Godinière', dir: 'AURA_DIRCE', start: paris('15:11', '2026-09-28'),
    end: paris('18:00', '2026-10-23'), planned: true, longTerm: true, lat: 46.22, lon: 3.78 }),
  ev({ id: 'lt-merens', kind: 'obstruction', subtype: 'rockfalls', label: 'Éboulement', road: 'N20', place: 'Mérens-les-Vals',
    dir: 'CORG', start: '2026-01-31T08:00:00+01:00', longTerm: true, lat: 42.656, lon: 1.835 }),
  ev({ id: 'lt-cosne', kind: 'obstruction', subtype: 'subsidence', label: 'Affaissement de talus', road: 'A77',
    place: 'Cosne-Cours-sur-Loire', dir: 'DIR Centre-Est', start: '2026-03-02T08:00:00+01:00', end: '2026-12-31T23:59:00+01:00',
    longTerm: true, lat: 47.41, lon: 2.93 }),
  ev({ id: 'lt-works-a75', kind: 'works', subtype: 'roadworks', label: 'Chantier', road: 'A75', place: 'repère chantier 1',
    dir: 'DIR Massif-Central', start: paris('07:00', '2026-09-15'), end: '2026-11-30T18:00:00+01:00', planned: true, longTerm: true,
    lat: 45.03, lon: 3.19 }),
];

const BY_DIR: ReadonlyArray<readonly [string, number]> = [
  ['DIR Méditerranée', 21], ['DIR Centre-Est', 11], ['DIR Ouest', 9], ['DIR Île-de-France', 7], ['DIR Massif-Central', 6],
  ['DIR Atlantique', 4], ['DIR Sud-Ouest', 2], ['DIR Est', 2], ['DIR Nord', 1], ['CORG', 1], ['DIR Centre-Ouest', 0], ['AURA_DIRCE', 0],
  ['DIR Nord-Ouest', 0],
];

const SLOWEST: readonly RoadSpeedStation[] = [
  { id: 'DIRSO-A620-031', dir: 'DIR Sud-Ouest', road: 'A620', speed: 14, flow: 1320, lat: 43.62, lon: 1.41 },
  { id: 'DIRSO-A620-033', dir: 'DIR Sud-Ouest', road: 'A620', speed: 16, flow: 1410, lat: 43.6, lon: 1.42 },
  { id: 'DIRSO-A620-035', dir: 'DIR Sud-Ouest', road: 'A620', speed: 18, flow: 1250, lat: 43.58, lon: 1.43 },
  { id: 'DIRMED-A50-013', dir: 'DIR Méditerranée', road: 'A50', speed: 21, flow: 1580, lat: 43.29, lon: 5.42 },
  { id: 'DIRCE-A7-069', dir: 'DIR Centre-Est', road: 'A7', speed: 27, flow: 2100, lat: 45.7, lon: 4.84 },
];

/** Traficolor : part saturée parmi les sections renseignées (inconnues écartées), arrondie au centième. */
function official(network: string, label: string, sections: number, freeFlow: number, heavy: number, congested: number,
  unknown: number): RoadAggloOfficial {
  const known = sections - unknown;
  return {
    network, label, sections, freeFlow, heavy, congested, unknown,
    congestedPct: known > 0 ? Math.round((congested / known) * 10_000) / 100 : null, at: paris('15:06'),
  };
}

const OFFICIAL: readonly RoadAggloOfficial[] = [
  official('Lyon', 'Lyon', 354, 247, 0, 1, 106), official('Marius', 'Marseille', 195, 166, 5, 13, 11),
  official('Limoges', 'Limoges', 133, 99, 0, 12, 22), official('Lille', 'Lille', 357, 339, 15, 2, 1),
  official('Alienor', 'Bordeaux', 196, 178, 0, 4, 14),
];

/** Sections Traficolor géolocalisées (amendement 3 du contrôleur) : extrait fictif de Lyon et de Marseille, statut du dernier fichier. */
const SECTIONS: ReadonlyArray<RoadNationalResponse['sections'][number]> = [
  { id: 'Lyon-A7-12', network: 'Lyon', status: 'congested', path: [[4.84, 45.7], [4.842, 45.71]] },
  { id: 'Lyon-A7-13', network: 'Lyon', status: 'heavy', path: [[4.842, 45.71], [4.845, 45.72]] },
  { id: 'Marius-A50-04', network: 'Marius', status: 'freeFlow', path: [[5.42, 43.29], [5.44, 43.285]] },
  { id: 'Marius-A7-02', network: 'Marius', status: 'unknown', path: [[5.37, 43.33], [5.38, 43.34]] },
];

const CONCEDED: readonly ConcededJam[] = [
  { motorway: 'A8', lengthKm: 4.5, from: 'Italie', to: 'Aix-en-Provence', operator: 'Escota', importance: 3,
    text: '*** Bouchon de 4,5 km toutes les voies , A8 , de Italie - Genova vers Aix-en-Provence' },
  { motorway: 'A7', lengthKm: 3.2, from: 'Lyon', to: 'Marseille', operator: 'ASF', importance: 2, text: '** Bouchon de 3,2 km , A7' },
  { motorway: 'A8', lengthKm: 2.1, from: 'Aix-en-Provence', to: 'Nice', operator: 'Escota', importance: 2, text: '** Bouchon de 2,1 km , A8' },
  { motorway: 'A9', lengthKm: 1.8, from: 'Montpellier', to: 'Perpignan', operator: 'ASF', importance: 1, text: '* Bouchon de 1,8 km , A9' },
  { motorway: 'A13', lengthKm: 1.5, from: 'Paris', to: 'Caen', operator: 'SAPN-Sanef', importance: 1, text: '* Bouchon de 1,5 km , A13' },
  { motorway: 'A50', lengthKm: 1.2, from: 'Toulon', to: 'Marseille', operator: 'Escota', importance: 1, text: '* Bouchon de 1,2 km , A50' },
  { motorway: 'A57', lengthKm: 0.9, from: 'Toulon', to: 'Nice', operator: 'Escota', importance: 1, text: '* Bouchon de 0,9 km , A57' },
  { motorway: 'A47', lengthKm: 0.8, from: 'Saint-Étienne', to: 'Lyon', operator: 'DIRCE Lyon et St Etienne', importance: 1,
    text: '* Bouchon de 0,8 km , A47' },
];

export function roadNationalFixture(): RoadNationalResponse {
  return structuredClone({
    publishedAt: '2026-10-03T14:57:44+02:00',
    events: [...NAMED, ...fillers()],
    longTerm: [...LONG_TERM],
    counts: { incidents: 64, accidents: 4, closures: 1, obstructions: 59, weather: 0, works: 99 },
    byDir: BY_DIR.map(([dir, incidents]) => ({ dir, incidents })),
    speeds: { at: paris('15:00'), stations: 1026, under50: 19, median: 89, slowest: [...SLOWEST] },
    agglos: [...OFFICIAL],
    sections: [...SECTIONS],
    conceded: { at: paris('14:57'), jams: [...CONCEDED] },
    errors: [],
  });
}

// ─── Route : agglomérations (TomTom, collecte du serveur) ───

const PARIS_LONGEST: UrbanJam = {
  road: 'A86', from: 'Rueil-Malmaison', to: 'Colombes', lengthKm: 3.6, delayMin: 24.3, magnitude: 3, start: paris('12:42'),
  lat: 48.905, lon: 2.205, path: [[2.18, 48.877], [2.205, 48.905], [2.227, 48.922]],
};
const LYON_LONGEST: UrbanJam = {
  road: null, from: 'Pierre-Bénite', to: 'Lyon Perrache', lengthKm: 1.4, delayMin: 9.2, magnitude: 3, start: paris('14:20'),
  lat: 45.712, lon: 4.828, path: [[4.826, 45.703], [4.828, 45.712], [4.829, 45.72]],
};

export function roadUrbanFixture(): RoadUrbanResponse {
  return structuredClone({
    collectedAt: paris('15:00'),
    agglos: [
      { name: 'Paris', jams: 260, jamKm: 169.5, delayMin: 1193, longest: PARIS_LONGEST, collectedAt: paris('15:00') },
      { name: 'Lyon', jams: 26, jamKm: 11.7, delayMin: 83, longest: LYON_LONGEST, collectedAt: paris('15:00') },
    ],
    jams: [
      PARIS_LONGEST, LYON_LONGEST,
      { road: 'N118', from: 'Vélizy', to: 'Sèvres', lengthKm: 2.2, delayMin: 11, magnitude: 2, start: paris('14:05'), lat: 48.79, lon: 2.2,
        path: [[2.19, 48.78], [2.2, 48.79], [2.21, 48.81]] },
      { road: 'A6', from: 'Évry', to: 'Paris', lengthKm: 1.1, delayMin: 4, magnitude: 1, start: paris('14:40'), lat: 48.7, lon: 2.39,
        path: [[2.42, 48.64], [2.39, 48.7], [2.37, 48.76]] },
    ],
    quota: { callsToday: 588, limit: 2500 },
    errors: [],
  });
}

// ─── Air (OpenSky, collecte du serveur) ───

const WINDOW = { begin: paris('13:09'), end: paris('15:09') };

/** Positions publiques des aéroports suivis, [lon, lat] (amendement 3 : `AirportActivity.lat`, `lon`). */
const AIRPORT_AT: Readonly<Record<string, readonly [number, number]>> = {
  LFPG: [2.5479, 49.0097], LFPO: [2.3794, 48.7262], LFMN: [7.2159, 43.6584], LFLL: [5.0811, 45.7256], LFML: [5.2214, 43.4393],
  LFRS: [-1.6108, 47.1532], LFBO: [1.3638, 43.6293], LFBD: [-0.7156, 44.8283], LFOB: [2.1128, 49.4544],
};

function airport(icao: string, iata: string, name: string, departures: number | null, onGround: number, approaching: number,
  board: AirportActivity['board'] = null): AirportActivity {
  const [lon, lat] = AIRPORT_AT[icao] ?? [0, 0];
  return { icao, iata, name, lat, lon, departures, departuresWindow: departures === null ? null : { ...WINDOW }, onGround, approaching, board };
}

export function airOverviewFixture(): AirOverviewResponse {
  return {
    at: '2026-10-03T15:09:39+02:00', airborneZone: 1301, airborneFrance: 612, onGround: 148,
    emergencies: [], emergencyLog: [],
    airports: [
      airport('LFPG', 'CDG', 'Paris-CDG', 71, 3, 23), airport('LFPO', 'ORY', 'Paris-Orly', 34, 8, 22), airport('LFMN', 'NCE', 'Nice', 16, 3, 4),
      airport('LFLL', 'LYS', 'Lyon', 11, 4, 4), airport('LFML', 'MRS', 'Marseille', 11, 0, 3), airport('LFRS', 'NTE', 'Nantes', 7, 3, 2),
      airport('LFBO', 'TLS', 'Toulouse', 4, 8, 3),
      airport('LFBD', 'BOD', 'Bordeaux', 3, 3, 1, { delayed: 2, cancelled: 0, at: paris('15:00') }),
      airport('LFOB', 'BVA', 'Beauvais-Tillé', null, 2, 1, { delayed: 3, cancelled: 1, at: paris('14:55') }),
    ],
    volume: {
      samples: Array.from({ length: 12 }, (_, i) => ({
        at: new Date(Date.parse(paris('13:10')) + i * 10 * 60_000).toISOString(),
        airborneZone: 1240 + i * 5, airborneFrance: 580 + i * 3,
      })),
      sameHourPrevDays: [],
    },
    anomalies: [
      { callsign: 'EZY45HD', kind: 'holding', airport: 'ORY', at: paris('14:52') },
      { callsign: 'AFR1534', kind: 'go-around', airport: 'CDG', at: paris('14:31') },
      { callsign: null, kind: 'holding', airport: 'NCE', at: paris('14:05') },
    ],
    credits: { remaining: 2140 },
    errors: [],
  };
}

// ─── Rail (SNCF, SIRI SX) ───

function group(key: string, label: string, trains: number, avg: number | null, max: number | null, cancelled = 0, reduced = 0): RailGroupStats {
  return { key, label, trains, avgDelayMin: avg, maxDelayMin: max, cancelled, reduced, detour: 0 };
}

type Stop = RailTrain['stops'][number];
const stop = (name: string, lat: number, lon: number, delayMin: number | null): Stop => ({ name, lat, lon, delayMin });

function train(over: Partial<RailTrain> & Pick<RailTrain, 'id' | 'number' | 'origin' | 'destination' | 'effect' | 'delayMin' | 'stops'>): RailTrain {
  return { kind: 'grandes-lignes', axis: null, region: null, status: 'en-cours', updatedAt: paris('15:08'), ...over };
}

const TRAINS: readonly RailTrain[] = [
  train({ id: 'SNCF:2026-10-03:9713', number: '9713', axis: 'sud-est', origin: 'Paris Gare de Lyon', destination: 'Barcelone Sants',
    effect: 'retard', delayMin: 140, stops: [stop('Paris Gare de Lyon', 48.8443, 2.3743, 0), stop('Perpignan', 42.6961, 2.8793, 135),
      stop('Barcelone Sants', 41.3792, 2.1402, 140)] }),
  train({ id: 'SNCF:2026-10-03:6204', number: '6204', axis: 'sud-est', origin: 'Perpignan', destination: 'Paris Gare de Lyon',
    effect: 'retard', delayMin: 110, stops: [stop('Perpignan', 42.6961, 2.8793, 0), stop('Narbonne', 43.1906, 3.0057, 105),
      stop('Paris Gare de Lyon', 48.8443, 2.3743, 110)] }),
  train({ id: 'SNCF:2026-10-03:9866', number: '9866', axis: 'province', origin: 'Marseille Saint-Charles', destination: 'Bruxelles-Midi',
    effect: 'modifie', delayMin: 90, stops: [stop('Marseille Saint-Charles', 43.3027, 5.3806, 0), stop('Lille Europe', 50.6393, 3.0757, 88),
      stop('Bruxelles-Midi', 50.8357, 4.3367, 90)] }),
  train({ id: 'SNCF:2026-10-03:4760', number: '4760', axis: 'province', origin: 'Marseille Saint-Charles', destination: 'Bordeaux Saint-Jean',
    effect: 'retard', delayMin: 70, stops: [stop('Marseille Saint-Charles', 43.3027, 5.3806, 0), stop('Toulouse Matabiau', 43.6114, 1.4536, 65),
      stop('Bordeaux Saint-Jean', 44.8258, -0.5562, 70)] }),
  train({ id: 'SNCF:2026-10-03:7885', number: '7885', axis: 'sud-est', origin: 'Paris Gare de Lyon', destination: 'Perpignan',
    effect: 'retard', delayMin: 60, stops: [stop('Paris Gare de Lyon', 48.8443, 2.3743, 0), stop('Narbonne', 43.1906, 3.0057, 55),
      stop('Perpignan', 42.6961, 2.8793, 60)] }),
  train({ id: 'SNCF:2026-10-03:4400', number: '4400', axis: 'province', origin: 'Lyon Part-Dieu', destination: 'Tours',
    effect: 'supprime', delayMin: null, stops: [stop('Lyon Part-Dieu', 45.7606, 4.8593, null), stop('Tours', 47.3897, 0.6939, null)] }),
  train({ id: 'SNCF:2026-10-03:871234', number: '871234', kind: 'ter', region: 'occitanie', origin: 'Narbonne', destination: 'Toulouse Matabiau',
    effect: 'retard', delayMin: 180, stops: [stop('Narbonne', 43.1906, 3.0057, 0), stop('Toulouse Matabiau', 43.6114, 1.4536, 180)] }),
  train({ id: 'SNCF:2026-10-03:8521', number: '8521', axis: 'atlantique', origin: 'Paris Montparnasse', destination: 'Bordeaux Saint-Jean',
    effect: 'retard', delayMin: 20, status: 'a-venir', stops: [stop('Paris Montparnasse', 48.8414, 2.3207, 20),
      stop('Bordeaux Saint-Jean', 44.8258, -0.5562, 20)] }),
];

export function railOverviewFixture(): RailOverviewResponse {
  return structuredClone({
    updatedAt: '2026-10-03T15:10:29+02:00',
    longDistance: { active: 37, delayed15: 20 },
    axes: [
      group('sud-est', 'Sud-Est', 6, 56.7, 140), group('province', 'Province, transversales', 21, 23.6, 90, 1, 1),
      group('atlantique', 'Atlantique', 4, 15, 20), group('intercites-bercy', 'Intercités Bercy', 3, 6.7, 10),
      group('est', 'Est', 2, 10, 15), group('nord', 'Nord', 1, 10, 10, 0, 1),
    ],
    regions: [
      group('occitanie', 'Occitanie', 5, 58, 180, 0, 1), group('paca', 'Provence-Alpes-Côte d’Azur', 6, 52.5, 200, 0, 1),
      group('hauts-de-france', 'Hauts-de-France', 8, 34.4, 90, 0, 2), group('auvergne-rhone-alpes', 'Auvergne-Rhône-Alpes', 9, 16.7, 50),
      group('grand-est', 'Grand Est', 8, 11.2, 30, 0, 2), group('ile-de-france', 'Île-de-France', 4, 12.5, 40, 0, 1),
      group('nouvelle-aquitaine', 'Nouvelle-Aquitaine', 4, 33.8, 100, 0, 1), group('normandie', 'Normandie', 2, 15, 20),
      group('bretagne', 'Bretagne', 1, 30, 30), group('non-rattache', 'Non rattaché', 3, 1.7, 5, 0, 2),
    ],
    topDelays: TRAINS.slice(0, 5),
    trains: [...TRAINS],
    errors: [],
  });
}

const SITUATIONS: readonly RailSituation[] = [
  { id: 'sx-narbonne', title: 'Intempéries et crues à Narbonne', cause: 'de fortes précipitations et des crues ont affecté les voies',
    causeKind: 'intemperies', scope: 'Occitanie', start: paris('06:40'), end: paris('12:00', '2026-10-04'), trains: 14 },
  { id: 'sx-hazebrouck', title: 'Accident routier à un passage à niveau', cause: 'accident à un passage à niveau entre Hazebrouck et Dunkerque',
    causeKind: 'passage-a-niveau', scope: 'TGV Nord', start: paris('13:20'), end: null, trains: 8 },
  { id: 'sx-chateauroux', title: 'Panne d’installation près de Châteauroux', cause: 'panne d’installation en gare',
    causeKind: 'panne-installation', scope: 'Intercités', start: paris('11:05'), end: null, trains: 78 },
  { id: 'sx-agen', title: 'Obstacle sur les voies Agen–Bordeaux', cause: 'un obstacle a été signalé sur les voies entre AGEN et BORDEAUX',
    causeKind: 'obstacle', scope: 'Nouvelle-Aquitaine', start: paris('14:20'), end: null, trains: 3 },
];

export function railSituationsFixture(): RailSituationsResponse {
  return structuredClone({ at: '2026-10-03T15:10:28+02:00', situations: [...SITUATIONS], errors: [] });
}

// ─── Maritime (instantané du relais AIS) ───

export function maritimeSnapshotFixture(): MaritimeSnapshot {
  const zone = (id: MaritimeSnapshot['zones'][number]['zone'], label: string, vessels: number, classA: number, classB: number,
    atAnchor: number, moored: number, underWay: number, restricted: number, fishing: number): MaritimeSnapshot['zones'][number] =>
    ({ zone: id, label, vessels, classA, classB, atAnchor, moored, underWay, restricted, fishing });
  const port = (name: string, vessels: number, atAnchor: number, moored: number, underWay: number): MaritimeSnapshot['ports'][number] =>
    ({ port: name, vessels, atAnchor, moored, underWay });
  return {
    at: '2026-10-03T15:12:10+02:00', lastMessageAt: '2026-10-03T15:12:09+02:00',
    vessels: 1196, frenchFlag: 681, typedShare: 13,
    byType: {
      cargo: 48, petrolier: 21, passagers: 39, peche: 12, remorqueur: 9, plaisance: 14, 'grande-vitesse': 2, service: 6, militaire: 3,
      autre: 1, inconnu: 1041,
    },
    zones: [
      zone('mediterranee', 'Méditerranée', 499, 225, 274, 35, 117, 62, 0, 0), zone('atlantique', 'Atlantique', 360, 87, 273, 4, 12, 52, 7, 5),
      zone('manche', 'Manche', 310, 205, 105, 10, 50, 83, 18, 7),
      zone('pas-de-calais', 'Pas-de-Calais (rail de navigation)', 22, 21, 1, 0, 0, 16, 1, 3),
    ],
    ports: [
      port('Le Havre', 94, 7, 20, 41), port('Brest', 56, 0, 8, 19), port('Marseille-Fos', 53, 0, 18, 10), port('Rouen', 45, 0, 15, 7),
      port('Toulon', 22, 0, 10, 1), port('Saint-Nazaire', 18, 2, 2, 4), port('Dunkerque', 0, 0, 0, 0), port('Calais', 0, 0, 0, 0),
      port('Bordeaux', 0, 0, 0, 0),
    ],
    signals: [],
    info: { restricted: 41, draught: 3, fishing: 43 },
    sensitive: {
      tankers: 21, passenger: 39,
      list: [
        { mmsi: '227001200', name: 'PASSAGERS ESSAI 1', type: 'passagers', lat: 50.95, lon: 1.82, distanceNm: 1.1 },
        { mmsi: '228345600', name: 'PETROLIER ESSAI 1', type: 'petrolier', lat: 49.52, lon: -0.02, distanceNm: 3.4 },
        { mmsi: '247123400', name: 'PETROLIER ESSAI 2', type: 'petrolier', lat: 43.2, lon: 5.2, distanceNm: 6.8 },
      ],
    },
    errors: [],
  };
}

// ─── États des services (données reçues à l'heure du jeu d'essai) ───

function slot<T>(data: T): SourceSlot<T> {
  return { data, error: null, fetchedAt: TRAFFIC_NOW };
}

export function roadStateFixture(): RoadTrafficState {
  return { national: slot(roadNationalFixture()), urban: slot(roadUrbanFixture()) };
}
export function airStateFixture(): AirOverviewState {
  return { overview: slot(airOverviewFixture()) };
}
export function railStateFixture(): RailTrafficState {
  return { overview: slot(railOverviewFixture()), situations: slot(railSituationsFixture()) };
}
export function maritimeStateFixture(): MaritimeState {
  return { snapshot: slot(maritimeSnapshotFixture()) };
}
