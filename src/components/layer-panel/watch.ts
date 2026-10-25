// src/components/layer-panel/watch.ts : surveillance de la Vue générale dynamique (12/10/2026). Pur, sans DOM.
// La Vue générale montre un socle (vigilance météo, crues) et, pour les couches suivies en continu, seulement celles qui sont en
// orange ou en rouge en ce moment (décision du 19/10/2026 : le jaune et les sources « n.d. » n'y figurent plus, leur onglet les montre).
// Le niveau de chaque couche est celui de la pastille de son panneau (fonctions *HeadLevel partagées), jamais un calcul parallèle.
import type {
  AirQualityResponse, CloudOutagesResponse, CyberResponse, DisastersResponse, DroughtResponse, EarthquakesResponse, EcowattResponse, EmsResponse, FiresResponse,
  AirOverviewResponse, FloodsResponse, FuelTensionDashboard, GnssResponse, InternetOutagesResponse, MapLayers, MaritimeSnapshot, MilitaryResponse,
  NuclearState, PowerOutagesResponse, RailOverviewResponse, RoadNationalResponse, TelecomOutagesResponse, VigilanceResponse,
} from '../../types/index.ts';
import { airLevel, maritimeLevel, railLevel, roadLevel } from '../../services/traffic-levels.ts';
import { cloudHeadLevel } from './outages-cloud.ts';
import { internetHeadLevel } from './outages-internet.ts';
import { powerHeadLevel } from './outages-power.ts';
import { droughtHeadLevel } from './secheresse.ts';
import { disastersHeadLevel } from './catastrophes.ts';
import { oilHeadLevel } from './oil.ts';
import type { NationalHealthSummary } from './veille.ts';
import { LEVEL_RANK, type VigilanceLevel } from '../../services/vigilance.ts';
import { cyberHeadLevel } from './cyber.ts';
import { defenseHeadLevel } from './defense-b.ts';
import { floodsHeadLevel } from './crues.ts';
import { firesHeadLevel } from './feux.ts';
import { ecowattHeadLevel } from './grid.ts';
import { nuclearHeadLevel } from './nuclear.ts';
import { telecomHeadLevel } from './outages-telecom.ts';
import { airQualityHeadLevel } from './qualite-air.ts';
import { earthquakesHeadLevel } from './seismes.ts';
import { vigilanceHeadLevel } from './vigilance.ts';

export type WatchLevel = VigilanceLevel | 'nd';

/** Donnée d'une source : `loaded` faux tant que la première lecture n'a pas abouti (ni donnée ni erreur) : pas encore de verdict. */
export interface Watched<T> {
  data: T | null;
  loaded: boolean;
}

export interface GeneralWatchInput {
  vigilance: Watched<VigilanceResponse>;
  floods: Watched<FloodsResponse>;
  fires: Watched<FiresResponse>;
  earthquakes: Watched<EarthquakesResponse>;
  airQuality: Watched<AirQualityResponse>;
  telecom: Watched<TelecomOutagesResponse>;
  ecowatt: Watched<EcowattResponse>;
  nuclear: Watched<NuclearState>;
  cyber: Watched<CyberResponse>;
  military: Watched<MilitaryResponse>;
  fuel: Watched<FuelTensionDashboard>;
  power: Watched<PowerOutagesResponse>;
  internet: Watched<InternetOutagesResponse>;
  cloud: Watched<CloudOutagesResponse>;
  drought: Watched<DroughtResponse>;
  /** Catastrophes : GDACS et Copernicus EMS (20/10/2026) ; absent : couche non suivie (anciens appelants, tests). */
  disasters?: Watched<{ gdacs: DisastersResponse | null; ems: EmsResponse | null }>;
  /** Trafics (lot 1 Transports, 25/10/2026) : niveaux des pastilles des 4 panneaux ; absent : couches non suivies (anciens appelants, tests). */
  traffic?: {
    road: Watched<RoadNationalResponse>;
    air: Watched<AirOverviewResponse>;
    rail: Watched<RailOverviewResponse>;
    maritime: Watched<MaritimeSnapshot>;
  };
  /** Niveau national de santé (veille sanitaire, urgences) ; le panneau Veille sanitaire le montre. */
  health: Watched<NationalHealthSummary>;
  gnss: GnssResponse | null;
  now: number;
}

export interface WatchEntry {
  key: keyof MapLayers;
  level: WatchLevel;
}

/** Socle de la Vue générale : les deux vigilances officielles, toujours affichées (référence quotidienne des préfectures). */
export const GENERAL_SOCLE: ReadonlyArray<keyof MapLayers> = ['environmental', 'floods'];

/** Couches suivies en continu, sans que leur couche soit allumée (données chargées pour l'indice et les situations). */
export const WATCHED_LAYERS: ReadonlyArray<keyof MapLayers> = [
  'environmental', 'floods', 'fires', 'earthquakes', 'airQuality', 'drought', 'outagesElec', 'outagesTelecom', 'outagesInternet',
  'outagesCloud', 'powerGrid', 'nuclearFleet', 'oilNetwork', 'cyber', 'military', 'health', 'disasters',
  'trafficRail', 'trafficRoad', 'trafficAir', 'trafficMaritime',
];

/**
 * Couches lentes : seulement en crise (rouge). La sécheresse est un stock d'arrêtés qui évolue sur des semaines ; ses niveaux jaune
 * et orange sont des restrictions courantes, pas un événement à traiter (recommandation OSINT du 12/10/2026).
 */
const CRISIS_ONLY: ReadonlySet<keyof MapLayers> = new Set<keyof MapLayers>(['drought']);

const ORDER: Record<WatchLevel, number> = { rouge: 0, orange: 1, jaune: 2, nd: 3, vert: 4 };

/** Niveau de chaque couche suivie dont la source a été lue au moins une fois (sinon absente : pas encore de verdict). */
export function watchLevels(input: GeneralWatchInput): Map<keyof MapLayers, WatchLevel> {
  const { now } = input;
  const out = new Map<keyof MapLayers, WatchLevel>();
  const put = <T>(key: keyof MapLayers, w: Watched<T>, level: (data: T | null) => WatchLevel): void => {
    if (w.loaded) out.set(key, level(w.data));
  };
  put('environmental', input.vigilance, (d) => vigilanceHeadLevel(d, now));
  put('floods', input.floods, (d) => floodsHeadLevel(d, now));
  put('fires', input.fires, (d) => firesHeadLevel(d, now));
  put('earthquakes', input.earthquakes, (d) => earthquakesHeadLevel(d, now));
  put('airQuality', input.airQuality, (d) => airQualityHeadLevel(d, now));
  put('outagesTelecom', input.telecom, (d) => telecomHeadLevel(d, now));
  put('drought', input.drought, (d) => droughtHeadLevel(d, now));
  put('outagesElec', input.power, (d) => powerHeadLevel(d, input.ecowatt.data?.official ?? null, now));
  put('outagesInternet', input.internet, (d) => internetHeadLevel(d, now));
  put('outagesCloud', input.cloud, (d) => cloudHeadLevel(d, now));
  put('powerGrid', input.ecowatt, (d) => ecowattHeadLevel(d, now));
  put('nuclearFleet', input.nuclear, (d) => nuclearHeadLevel(d, now));
  put('cyber', input.cyber, (d) => cyberHeadLevel(d, now));
  put('oilNetwork', input.fuel, (d) => oilHeadLevel(d, now));
  put('military', input.military, (d) => defenseHeadLevel(d, input.gnss, now));
  put('health', input.health, (d) => d?.level ?? 'nd');
  if (input.disasters) put('disasters', input.disasters, (d) => disastersHeadLevel(d?.gdacs ?? null, d?.ems ?? null, now));
  // Trafics : même niveau que l'en-tête de chaque panneau (traffic-levels.ts) ; donnée absente ou périmée (expireSlot) : n.d.
  const t = input.traffic;
  if (t) {
    put('trafficRoad', t.road, (d) => (d ? roadLevel(d).level : 'nd'));
    put('trafficAir', t.air, (d) => (d ? airLevel(d).level : 'nd'));
    put('trafficRail', t.rail, (d) => (d ? railLevel(d).level : 'nd'));
    put('trafficMaritime', t.maritime, (d) => (d ? maritimeLevel(d).level : 'nd'));
  }
  return out;
}

/** Niveaux qui font entrer une couche suivie dans la Vue générale (19/10/2026 : orange et rouge seulement). */
const GENERAL_LEVELS: ReadonlySet<WatchLevel> = new Set<WatchLevel>(['orange', 'rouge']);

/**
 * Puces de la Vue générale : le socle toujours, les autres couches suivies en orange ou en rouge ; rouge d'abord, puis orange, puis
 * le socle à son niveau ; à niveau égal, l'ordre de WATCHED_LAYERS.
 */
export function generalWatch(levels: ReadonlyMap<keyof MapLayers, WatchLevel>): WatchEntry[] {
  const out: WatchEntry[] = [];
  for (const key of WATCHED_LAYERS) {
    const level = levels.get(key);
    if (GENERAL_SOCLE.includes(key)) {
      out.push({ key, level: level ?? 'vert' });
    } else if (CRISIS_ONLY.has(key)) {
      if (level === 'rouge') out.push({ key, level });
    } else if (level !== undefined && GENERAL_LEVELS.has(level)) {
      out.push({ key, level });
    }
  }
  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level] || WATCHED_LAYERS.indexOf(a.key) - WATCHED_LAYERS.indexOf(b.key));
}

/**
 * Puce masquée dans la Vue générale : couche suivie sous l'orange (le socle, seul à y figurer sous l'orange, 19/10/2026) ; sa couche
 * reste allumée sur la carte. Orange et rouge : puce gardée. Pure.
 */
export function generalChipHidden(key: keyof MapLayers, entries: readonly WatchEntry[]): boolean {
  return entries.some((e) => e.key === key && !GENERAL_LEVELS.has(e.level));
}

export interface WatchTransition {
  key: keyof MapLayers;
  from: VigilanceLevel;
  to: VigilanceLevel;
  at: number;
}

/**
 * Passages de niveau entre deux relevés (vert, jaune, orange, rouge) ; « n.d. » n'est pas un niveau : une source qui tombe ou
 * revient n'écrit rien, le passage est noté au premier niveau connu différent du dernier connu.
 */
export function watchTransitions(
  lastKnown: ReadonlyMap<keyof MapLayers, VigilanceLevel>, levels: ReadonlyMap<keyof MapLayers, WatchLevel>, at: number,
): WatchTransition[] {
  const out: WatchTransition[] = [];
  for (const [key, level] of levels) {
    if (level === 'nd') continue;
    const from = lastKnown.get(key);
    if (from !== undefined && from !== level) out.push({ key, from, to: level, at });
  }
  return out;
}

/** Hausse de niveau (aggravation) ou baisse (désescalade) : pour le journal. */
export function isEscalation(t: WatchTransition): boolean {
  return LEVEL_RANK[t.to] > LEVEL_RANK[t.from];
}
