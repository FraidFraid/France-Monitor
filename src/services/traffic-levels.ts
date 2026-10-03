// src/services/traffic-levels.ts : retards et niveaux des quatre panneaux Trafics (spec 2026-10-03
// panneaux trafic § 1 et § 3). Fonctions pures, sans DOM ni réseau, partagées par les services clients
// et les vues ; « n.d. » quand la source manque, jamais une couleur inventée (S4).
import type { AirEmergency, AirOverviewResponse, MaritimeSnapshot, RailGroupStats, RailOverviewResponse, RoadEvent, RoadNationalResponse } from '../types/index.ts';
import type { HealthLevel } from './health-levels.ts';

/** Échelle L1 plus « nd », partagée avec les panneaux Santé. */
export type LayerLevel = HealthLevel;

export type TrafficSource = 'dir' | 'qtv' | 'traficolor' | 'cnir' | 'tomtom' | 'opensky' | 'opensky-departures' | 'sncf' | 'siri-sx' | 'ais';

/** Niveau et phrase courte de la ligne de niveau (« 4 accidents et 1 coupure en cours »). */
export interface LevelVerdict { level: LayerLevel; reason: string }

const MINUTE_MS = 60_000;

/** Délai (minutes) après la date de la donnée au-delà duquel elle est « en retard » (tableau S2 de la spec). */
const LATE_AFTER_MIN: Record<Exclude<TrafficSource, 'tomtom'>, number> = {
  dir: 30,
  qtv: 20,
  traficolor: 20,
  cnir: 120,
  opensky: 10,
  'opensky-departures': 300,
  sncf: 20,
  'siri-sx': 20,
  ais: 5,
};

/** TomTom : 45 min de 7 h à 21 h (heure de Paris), 75 min la nuit (collecte toutes les 15 ou 30 min). */
const TOMTOM_DAY_MIN = 45;
const TOMTOM_NIGHT_MIN = 75;

const PARIS_HOUR = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' });

/** Heure (0 à 23) à Paris pour un instant donné (fr-FR écrit « 07 h » : on lit la seule partie « hour »). */
export function parisHour(instant: number): number {
  return Number(PARIS_HOUR.formatToParts(new Date(instant)).find((p) => p.type === 'hour')?.value ?? Number.NaN);
}

/** Vrai de 7 h à 21 h, heure de Paris (cadence de jour de la collecte TomTom). */
export function isParisDaytime(instant: number): boolean {
  const h = parisHour(instant);
  return h >= 7 && h < 21;
}

/** Vrai si la donnée est en retard sur le rythme de sa source ; date absente ou illisible : en retard. */
export function isTrafficDataLate(source: TrafficSource, dataDate: string | null, now: number): boolean {
  if (dataDate === null) return true;
  const t = Date.parse(dataDate);
  if (!Number.isFinite(t)) return true;
  const minutes = source === 'tomtom'
    ? (isParisDaytime(now) ? TOMTOM_DAY_MIN : TOMTOM_NIGHT_MIN)
    : LATE_AFTER_MIN[source];
  return t + minutes * MINUTE_MS < now;
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

/** Sous-types d'éboulement ou de coulée comptés comme « météo » quand ils sont récents (règle § 3.1). */
const LANDSLIDE_SUBTYPES: ReadonlySet<string> = new Set(['rockfalls', 'landslips', 'mudSlide', 'avalanches']);

function isWeatherEvent(e: RoadEvent): boolean {
  return e.kind === 'weather' || LANDSLIDE_SUBTYPES.has(e.subtype);
}

/**
 * Pastille Trafic routier (§ 3.1), sur les événements en cours (`events` : non planifiés, moins de 24 h) :
 * n.d. sans publication des DIR ;
 * rouge si des événements météo touchent au moins 2 DIR, ou si au moins 5 coupures non planifiées de moins de 24 h ;
 * orange si un événement météo est en cours, ou au moins 2 de ces coupures ;
 * jaune si au moins une de ces coupures, ou au moins 5 accidents ;
 * vert sinon : les accidents ne dépassent jamais le jaune.
 */
export function roadLevel(r: RoadNationalResponse): LevelVerdict {
  if (r.publishedAt === null) return { level: 'nd', reason: 'flux des DIR indisponible' };
  const accidents = r.events.filter((e) => e.kind === 'accident').length;
  const closures = r.events.filter((e) => e.kind === 'closure' && !e.planned && !e.longTerm).length;
  const weather = r.events.filter(isWeatherEvent);
  const weatherDirs = new Set(weather.map((e) => e.dir));
  // Seuils arbitrés par le contrôleur (03/10) : les accidents, fréquents sur le réseau national (10 un samedi
  // ordinaire à 16 h 39), ne dépassent jamais le jaune ; orange et rouge viennent des coupures et de la météo.
  const closuresWords = `${plural(closures, 'coupure non planifiée', 'coupures non planifiées')} de moins de 24 h`;
  if (weatherDirs.size >= 2) return { level: 'rouge', reason: `événements météo dans ${weatherDirs.size} DIR` };
  if (closures >= 5) return { level: 'rouge', reason: closuresWords };
  if (weather.length > 0) return { level: 'orange', reason: `${weather[0].label} en cours (${weather[0].dir})` };
  if (closures >= 2) return { level: 'orange', reason: closuresWords };
  if (closures > 0 || accidents >= 5) {
    const parts = [accidents > 0 ? plural(accidents, 'accident') : '', closures > 0 ? plural(closures, 'coupure') : ''].filter(Boolean);
    return { level: 'jaune', reason: `${parts.join(' et ')} en cours` };
  }
  if (accidents > 0) return { level: 'vert', reason: `${plural(accidents, 'accident')} en cours, aucune coupure` };
  return { level: 'vert', reason: 'aucun accident ni coupure en cours' };
}

/**
 * Urgence confirmée (T3) : code vu sur au moins deux lectures des états, donc dernière vue postérieure à la première.
 * Le journal du serveur garde la première vue d'un épisode et met à jour la dernière à chaque lecture.
 */
export function isEmergencyConfirmed(e: Pick<AirEmergency, 'firstSeen' | 'lastSeen'>): boolean {
  const first = Date.parse(e.firstSeen);
  const last = Date.parse(e.lastSeen);
  return Number.isFinite(first) && Number.isFinite(last) && last > first;
}

/**
 * Seul prédicat des urgences qui colorent (pastille, gros chiffre, ligne du panneau, carte, légende) : au-dessus du
 * territoire ou de ses approches (`overFrance`, moins de 40 km) et confirmée, pour les trois codes. Les autres sont
 * montrées en gris (hors territoire ; « vu une fois, à confirmer »).
 */
export function emergencyColoursPill(e: Pick<AirEmergency, 'overFrance' | 'firstSeen' | 'lastSeen'>): boolean {
  return e.overFrance && isEmergencyConfirmed(e);
}

/**
 * Pastille Trafic aérien (§ 3.2) sur les urgences en cours qui colorent (emergencyColoursPill) : rouge si un 7500 ;
 * orange si un 7700 ; jaune si un 7600 ; vert sinon ; n.d. sans collecte OpenSky.
 */
export function airLevel(a: AirOverviewResponse): LevelVerdict {
  if (a.at === null) return { level: 'nd', reason: 'OpenSky indisponible' };
  const counted = a.emergencies.filter(emergencyColoursPill);
  const hijack = counted.find((e) => e.squawk === '7500');
  if (hijack) return { level: 'rouge', reason: `7500\u00a0détournement : ${hijack.callsign ?? hijack.icao24}` };
  const general = counted.find((e) => e.squawk === '7700');
  if (general) return { level: 'orange', reason: `7700\u00a0urgence au-dessus du territoire : ${general.callsign ?? general.icao24}` };
  const radio = counted.find((e) => e.squawk === '7600');
  if (radio) return { level: 'jaune', reason: `7600\u00a0panne\u00a0radio : ${radio.callsign ?? radio.icao24}` };
  return { level: 'vert', reason: a.emergencies.length === 0 ? 'aucun aéronef en urgence' : 'aucune urgence confirmée au-dessus du territoire ou de ses approches' };
}

/** Groupe (axe ou région) d'au moins 3 trains au plus fort retard moyen, ou null. */
export function worstGroup(groups: readonly RailGroupStats[]): RailGroupStats | null {
  let worst: RailGroupStats | null = null;
  for (const g of groups) {
    if (g.trains < 3 || g.avgDelayMin === null) continue;
    if (!worst || (worst.avgDelayMin ?? 0) < g.avgDelayMin) worst = g;
  }
  return worst;
}

/**
 * Pastille Réseau ferroviaire (§ 3.3) : rouge si un axe ou une région d'au moins 3 trains a 90 min de retard
 * moyen ou plus, ou si au moins 10 trains sont supprimés en cours ; orange dès 45 min ; jaune si au moins
 * 15 trains grandes lignes ont 15 min ou plus ; vert sinon ; n.d. sans données SNCF.
 */
export function railLevel(r: RailOverviewResponse): LevelVerdict {
  if (r.updatedAt === null) return { level: 'nd', reason: 'API SNCF indisponible' };
  const groups = [...r.axes, ...r.regions];
  const cancelled = groups.reduce((sum, g) => sum + g.cancelled, 0);
  const worst = worstGroup(groups);
  const worstText = worst ? `retard moyen de ${Math.round(worst.avgDelayMin ?? 0)} min : ${worst.label} (${worst.trains} trains)` : '';
  if (worst && (worst.avgDelayMin ?? 0) >= 90) return { level: 'rouge', reason: worstText };
  if (cancelled >= 10) return { level: 'rouge', reason: `${cancelled} trains supprimés en cours` };
  if (worst && (worst.avgDelayMin ?? 0) >= 45) return { level: 'orange', reason: worstText };
  if (r.longDistance.delayed15 >= 15) return { level: 'jaune', reason: `${r.longDistance.delayed15} trains grandes lignes à 15 min ou plus` };
  return { level: 'vert', reason: 'aucun axe ni région fortement retardé' };
}

/**
 * Pastille Trafic maritime (§ 3.4) sur les signalements confirmés (T3) : rouge si un pétrolier ou un navire à
 * passagers est en difficulté confirmée ; orange si un autre navire l'est ; vert sinon ; n.d. si l'AIS n'a
 * jamais répondu (jamais « aucun navire » quand l'AIS est indisponible).
 */
export function maritimeLevel(m: MaritimeSnapshot): LevelVerdict {
  if (m.at === null || m.lastMessageAt === null) return { level: 'nd', reason: 'AIS indisponible' };
  const confirmed = m.signals.filter((s) => s.confirmed);
  const sensitive = confirmed.find((s) => s.sensitive);
  if (sensitive) return { level: 'rouge', reason: `${sensitive.statusLabel} : ${sensitive.name ?? sensitive.mmsi} (pétrolier ou passagers)` };
  if (confirmed.length > 0) return { level: 'orange', reason: `${confirmed[0].statusLabel} : ${confirmed[0].name ?? confirmed[0].mmsi}` };
  return { level: 'vert', reason: 'aucun navire en difficulté confirmée' };
}
