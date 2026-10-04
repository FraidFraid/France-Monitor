// src/services/environment-inputs.ts : entrées Environnement du score France, des situations, de la frise, de la note de situation,
// de l'export, du poste v2, de l'ISNR et du stress hydro (spec 2026-10-04 environnement § 2.7 ; contrats § 6). Adaptateurs purs sur
// les dernières lectures des services (tâche 9) : la formule du score et ses cibles ne changent pas, seules les entrées changent.
import type {
  ActiveFire, EnvironmentAvailability, FireFoyer, FiresResponse, FloodSectionRef, FloodsResponse, LocatedFireIncident, MeteoAlert,
  VigilanceResponse,
} from '../types/index.ts';
import { scoreFireDetections, toActiveFire } from './environment-fires.ts';
import { floodsToSectionRefs } from './environment-floods.ts';
import { firesLevel, floodsLevel, vigilanceLevel, type LayerLevel } from './environment-levels.ts';
import { vigilanceToMeteoAlerts } from './environment-vigilance.ts';

/**
 * Âge au-delà duquel une collecte des feux ne compte plus : 2 jours après sa lecture, comme le serveur qui ne la sert plus
 * (api/_lib/fires-collect.js, LAST_TTL_SEC). Le client garde la collecte précédente après une erreur : un onglet resté ouvert
 * compterait sinon de vieilles détections.
 */
const FIRES_COLLECTION_MAX_AGE_MS = 2 * 86_400_000;

export interface EnvironmentInputs {
  /** Départements en jaune ou plus de l'échéance du jour (J). */
  meteoAlerts: MeteoAlert[];
  /** Tronçons Vigicrues en jaune ou plus, tracé publié. */
  floodSegments: FloodSectionRef[];
  /** Détections en France non récurrentes, au format du regroupement DBSCAN (entrée nettoyée, spec § 2.7). */
  activeFires: ActiveFire[];
  /** Incidents DBSCAN sur ces détections, géo-résolus (situations WILDFIRE_ESCALATION, onglet « Dossier d'un feu »). */
  fireIncidents: LocatedFireIncident[];
  /** Foyers du serveur en France (confirmés, isolés, récurrents) : tuile « Météo » et fiche Environnement. */
  fireFoyers: FireFoyer[];
  /**
   * Sources lues (S3) : une source indisponible donne des listes vides au score (formule inchangée), mais « n.d. » et un point gris
   * sur la tuile « Météo » et la fiche Environnement, jamais un « 0 » vert.
   */
  environmentAvailable: EnvironmentAvailability;
  /** Niveau de la pastille Feux, même fonction que le panneau (firesLevel) : part « Feux » de la tuile « Météo » (arbitrage 14). */
  firesPillLevel: LayerLevel;
}

/** Collecte des feux encore comptée : lue il y a moins de 2 jours ; date absente ou illisible : aucune collecte. */
function servedFires(fires: FiresResponse | null, now: number): FiresResponse | null {
  if (fires === null || fires.readAt === null) return null;
  const readAt = Date.parse(fires.readAt);
  return Number.isFinite(readAt) && now - readAt < FIRES_COLLECTION_MAX_AGE_MS ? fires : null;
}

/**
 * Pastille Feux (firesLevel) : foyers et météo des forêts du jour, le plus haut des deux. Une collecte écartée (plus de 2 jours, ou
 * jamais lue par le serveur) compte comme FIRMS en panne : seule la météo des forêts du jour colore encore ; jamais lue : n.d.
 */
function firesPillLevel(fires: FiresResponse | null, served: FiresResponse | null, now: number): LayerLevel {
  if (fires === null) return 'nd';
  return firesLevel(served ?? { ...fires, readAt: null, foyers: [], detections: [] }, now).level;
}

/**
 * Entrées du jour à l'instant `now` ; une source jamais lue donne des listes vides (jamais une valeur inventée) et se dit
 * indisponible. Une collecte des feux de plus de 2 jours compte comme jamais lue : ni détections, ni foyers, ni incidents.
 * Vigilance et crues sont indisponibles quand leur pastille dit n.d. (carte sans date ou sans échéance du jour, relevé absent).
 */
export function buildEnvironmentInputs(
  vigilance: VigilanceResponse | null, floods: FloodsResponse | null, fires: FiresResponse | null, fireIncidents: readonly LocatedFireIncident[],
  now: number,
): EnvironmentInputs {
  const served = servedFires(fires, now);
  return {
    meteoAlerts: vigilanceToMeteoAlerts(vigilance, 'J'),
    floodSegments: floodsToSectionRefs(floods),
    activeFires: scoreFireDetections(served).map(toActiveFire),
    fireIncidents: served === null ? [] : [...fireIncidents],
    fireFoyers: served?.foyers ?? [],
    environmentAvailable: {
      vigilance: vigilance !== null && vigilanceLevel(vigilance, 'J').level !== 'nd',
      floods: floods !== null && floodsLevel(floods).level !== 'nd',
      fires: served !== null,
    },
    firesPillLevel: firesPillLevel(fires, served, now),
  };
}
