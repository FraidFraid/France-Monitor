// src/services/environment-inputs.ts : entrées Environnement du score France, des situations, de la frise, de la note de situation,
// de l'export, du poste v2, de l'ISNR et du stress hydro (spec 2026-10-04 environnement § 2.7 ; contrats § 6). Adaptateurs purs sur
// les dernières lectures des services (tâche 9) : la formule du score et ses cibles ne changent pas, seules les entrées changent.
import type {
  ActiveFire, AirEpisode, AirQualityResponse, EarthquakesResponse, EnvironmentAvailability, FireFoyer, FiresResponse, FloodSectionRef,
  FloodsResponse, LocatedFireIncident, MeteoAlert, Quake, VigilanceResponse,
} from '../types/index.ts';
import { scoreFireDetections, toActiveFire } from './environment-fires.ts';
import { floodsToSectionRefs } from './environment-floods.ts';
import { firesLevel, firmsState, floodsLevel, isEnvironmentDataLate, vigilanceLevel, type LayerLevel } from './environment-levels.ts';
import { vigilanceToMeteoAlerts } from './environment-vigilance.ts';

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
  /** Séismes des 7 derniers jours (phase B, situations sismiques) ; absents : aucune situation. */
  quakes?: Quake[];
  /** Épisodes de pollution de J à J+2 (phase B, situation « épisode d'alerte »). */
  airEpisodes?: AirEpisode[];
  /**
   * Sources lues (S3) : une source indisponible donne des listes vides au score (formule inchangée), mais « n.d. » et un point gris
   * sur la tuile « Météo » et la fiche Environnement, jamais un « 0 » vert.
   */
  environmentAvailable: EnvironmentAvailability;
  /** Niveau de la pastille Feux, même fonction que le panneau (firesLevel) : part « Feux » de la tuile « Météo » (arbitrage 14). */
  firesPillLevel: LayerLevel;
}

/**
 * Carte de vigilance qui compte : pastille lue (carte datée, échéance du jour) et à l'heure (update_time + 15 h, S2), comme le
 * panneau qui dit alors n.d. ; sinon aucune (le client garde la carte précédente après une erreur).
 */
function servedVigilance(v: VigilanceResponse | null, now: number): VigilanceResponse | null {
  if (v === null || vigilanceLevel(v, 'J').level === 'nd' || isEnvironmentDataLate('vigilance', v.updateTime, now)) return null;
  return v;
}

/** Relevé Vigicrues qui compte : lu et à l'heure (relevé du serveur + 30 min, S2), comme le panneau ; sinon aucun. */
function servedFloods(f: FloodsResponse | null, now: number): FloodsResponse | null {
  if (f === null || floodsLevel(f).level === 'nd' || isEnvironmentDataLate('vigicrues', f.readAt, now)) return null;
  return f;
}

/**
 * Collecte des feux qui compte : FIRMS à l'heure (firmsState : dernière acquisition + 14 h, collecte de moins de 2 jours) ;
 * en retard ou en panne : aucune détection, aucun foyer, aucun incident.
 */
function servedFires(fires: FiresResponse | null, now: number): FiresResponse | null {
  return fires !== null && firmsState(fires, now) === 'ok' ? fires : null;
}

/**
 * Entrées du jour à l'instant `now`. Une source jamais lue, en échec ou en retard (S2, mêmes délais que les panneaux) donne des
 * listes vides (jamais une valeur inventée) et se dit indisponible : la tuile « Météo » dit alors n.d. en gris, le moniteur
 * d'alertes ne lève aucune vigilance d'une carte périmée, le score voit des listes vides (formule inchangée). Pastille Feux :
 * firesLevel, seule fonction de la pastille du panneau (FIRMS en retard ou en panne, la météo des forêts du jour colore seule).
 */
export function buildEnvironmentInputs(
  vigilance: VigilanceResponse | null, floods: FloodsResponse | null, fires: FiresResponse | null, fireIncidents: readonly LocatedFireIncident[],
  now: number,
): EnvironmentInputs {
  const servedMap = servedVigilance(vigilance, now);
  const servedSections = servedFloods(floods, now);
  const served = servedFires(fires, now);
  return {
    meteoAlerts: vigilanceToMeteoAlerts(servedMap, 'J'),
    floodSegments: floodsToSectionRefs(servedSections),
    activeFires: scoreFireDetections(served).map(toActiveFire),
    fireIncidents: served === null ? [] : [...fireIncidents],
    fireFoyers: served?.foyers ?? [],
    environmentAvailable: { vigilance: servedMap !== null, floods: servedSections !== null, fires: served !== null },
    firesPillLevel: fires === null ? 'nd' : firesLevel(fires, now).level,
  };
}

/**
 * Séismes servis aux situations (§ 3.3, S2) : relevé du serveur (BCSF-RéNaSS, EMSC en repli) de moins de 30 min. Relevé absent,
 * illisible ou en retard (le client garde la réponse précédente après une erreur) : aucun séisme, donc aucune situation créée ni gardée.
 */
export function servedQuakes(quakes: EarthquakesResponse | null, now: number): Quake[] {
  if (quakes === null || isEnvironmentDataLate('bcsf', quakes.readAt, now)) return [];
  return [...quakes.quakes];
}

/**
 * Épisodes servis aux situations (§ 3.2, S2, S3) : couche des épisodes lue (date_maj publiée) et à jour (date_maj + 36 h). Couche en
 * panne (indice seul lu, episodesUpdatedAt absent) ou en retard : aucun épisode, jamais une alerte gardée d'une lecture périmée.
 */
export function servedAirEpisodes(air: AirQualityResponse | null, now: number): AirEpisode[] {
  if (air === null || isEnvironmentDataLate('atmo', air.episodesUpdatedAt, now)) return [];
  return [...air.episodes];
}
