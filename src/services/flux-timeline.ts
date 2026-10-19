// src/services/flux-timeline.ts : rejeu dans le temps de l'arrivée et de la dispersion (curseur du panneau Flux piétons).
// La simulation de flux_osint donne, par rue, les personnes passées pendant chaque phase et la distance au point par le réseau.
// Les arrivées au point s'étalent sur la fenêtre d'arrivée avec une pointe (trapèze : montée, palier, descente, débit de pointe =
// facteur de pointe x débit moyen, comme le simulateur) ; une personne arrivée au point à l'instant T est passée dans une rue à d
// mètres à T - d / vitesse. Même chose à la dispersion, après la durée supposée du rassemblement. ESTIMATIONS MODÉLISÉES.
import type { FluxTiming } from '../types/index.ts';

/** Capacité d'une rue (diagramme de Weidmann) : environ 73 personnes par minute et par mètre de largeur. */
export const FLUX_CAPACITY_PERS_MIN_M = 73;

/** Montée du trapèze (minutes) pour une fenêtre et un facteur de pointe : pointe / moyenne = W / (W - a), donc a = W (1 - 1 / pointe). */
function rampOf(windowMin: number, peak: number): number {
  return windowMin * Math.min(0.5, Math.max(0, 1 - 1 / Math.max(1, peak)));
}

/** Densité (par minute, intégrale 1) au temps x de la fenêtre [0, W] ; 0 hors fenêtre. */
export function windowDensity(x: number, windowMin: number, peak: number): number {
  if (!(windowMin > 0) || x < 0 || x > windowMin) return 0;
  const a = rampOf(windowMin, peak);
  const h = 1 / (windowMin - a);
  if (a === 0) return h;
  if (x < a) return (h * x) / a;
  if (x > windowMin - a) return (h * (windowMin - x)) / a;
  return h;
}

/** Part cumulée (0 à 1) de la fenêtre écoulée au temps x. */
export function windowCumulative(x: number, windowMin: number, peak: number): number {
  if (!(windowMin > 0) || x <= 0) return 0;
  if (x >= windowMin) return 1;
  const a = rampOf(windowMin, peak);
  const h = 1 / (windowMin - a);
  if (a === 0) return h * x;
  if (x < a) return (h * x * x) / (2 * a);
  if (x <= windowMin - a) return h * (a / 2) + h * (x - a);
  const rest = windowMin - x;
  return 1 - (h * rest * rest) / (2 * a);
}

/** Minutes de marche jusqu'au point pour une distance (m). */
const walkMin = (distanceM: number, t: FluxTiming): number => distanceM / Math.max(0.1, t.vitesse) / 60;

/**
 * Bornes du curseur (minutes par rapport au début annoncé) : des premiers passages dans la rue la plus lointaine à la fin de la
 * dispersion ; arrondies à 5 min.
 */
export function timelineRange(t: FluxTiming, maxDistanceM: number): { min: number; max: number } {
  const far = walkMin(Math.max(0, maxDistanceM), t);
  return {
    min: -Math.ceil((t.arriveeMin + far) / 5) * 5,
    max: Math.ceil((t.dureeMin + t.departMin + far) / 5) * 5,
  };
}

/**
 * Débit d'une rue (personnes par minute, valeurs hautes) à l'instant `atMin` (minutes après le début annoncé) : arrivée et départ
 * additionnés ; rapport à la capacité de la rue (1 = saturée).
 */
export function segmentFlowAt(
  p: { chargeP90: number; chargeDepartP90: number; largeur: number; distance: number },
  t: FluxTiming, atMin: number,
): { flow: number; ratio: number } {
  const w = walkMin(p.distance, t);
  const arrive = p.chargeP90 * windowDensity(atMin + w + t.arriveeMin, t.arriveeMin, t.pointeArrivee);
  const leave = p.chargeDepartP90 * windowDensity(atMin - t.dureeMin - w, t.departMin, t.pointeDepart);
  const flow = arrive + leave;
  return { flow, ratio: flow / (FLUX_CAPACITY_PERS_MIN_M * Math.max(0.5, p.largeur)) };
}

/** Personnes sur place à l'instant `atMin` : arrivées cumulées moins départs cumulés, pour une affluence donnée. */
export function onSiteAt(affluence: number, t: FluxTiming, atMin: number): number {
  const arrived = windowCumulative(atMin + t.arriveeMin, t.arriveeMin, t.pointeArrivee);
  const left = windowCumulative(atMin - t.dureeMin, t.departMin, t.pointeDepart);
  return Math.max(0, affluence * (arrived - left));
}

/** Moment du rejeu en mots : « arrivées », « rassemblement », « dispersion », « avant », « après ». */
export function momentWord(t: FluxTiming, atMin: number): string {
  if (atMin < -t.arriveeMin) return 'premiers trajets';
  if (atMin < 0) return 'arrivées';
  if (atMin < t.dureeMin) return 'rassemblement sur place';
  if (atMin < t.dureeMin + t.departMin) return 'dispersion';
  return 'derniers trajets de retour';
}

const NB = '\u00a0';

/** « début − 12 min », « début », « début + 1 h 05 ». */
export function relativeLabel(atMin: number): string {
  const m = Math.round(atMin);
  if (m === 0) return 'début';
  const a = Math.abs(m);
  const text = a >= 60 ? `${Math.floor(a / 60)}${NB}h${NB}${String(a % 60).padStart(2, '0')}` : `${a}${NB}min`;
  return `début ${m < 0 ? '−' : '+'}${NB}${text}`;
}
