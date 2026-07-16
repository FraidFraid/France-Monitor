import type { IconName } from './shared/icons.ts';
import type { FireObservationRuntimeState } from '../types/index.ts';
import {
  deriveFireObservationStatus,
  type FireObservationUiStatus,
} from '../services/fire-observation-runtime.ts';

export type FireObservationSourceId =
  | 'firms'
  | 'gibs'
  | 'mtg-frp'
  | 'radar-2d'
  | 'radar-3d';
export type FireObservationStatus =
  | FireObservationUiStatus
  | 'ACTIF À LA DEMANDE'
  | 'NON CONNECTÉ';

export interface FireObservationSource {
  readonly id: FireObservationSourceId;
  readonly icon: IconName;
  readonly label: string;
  readonly role: string;
  readonly timing: string;
  readonly status: FireObservationStatus;
}

export const FIRE_OBSERVATION_CNRS_URL =
  'https://www.cnrs.fr/fr/la-recherche/expertise-scientifique/esco-incendies-de-foret-et-ville';
export const FIRE_OBSERVATION_LSA_SAF_URL =
  'https://lsa-saf.eumetsat.int/en/news/news/release-of-mtg-fire-radiative-power-product-as-demonstration/';

export function buildFireObservationSources(options: {
  readonly multiSource: boolean;
  readonly runtime?: FireObservationRuntimeState;
  readonly now?: number;
}): readonly FireObservationSource[] {
  const mtgFrpStatus = options.runtime
    ? deriveFireObservationStatus(options.runtime.mtgFrp, options.now ?? 0)
    : 'NON CONNECTÉ';
  const radar2dStatus = options.runtime
    ? deriveFireObservationStatus(options.runtime.radar2d, options.now ?? 0)
    : 'NON CONNECTÉ';

  return [
    {
      id: 'firms',
      icon: 'flame',
      label: 'FIRMS · VIIRS',
      role: 'Activité thermique au sol',
      timing: options.multiSource ? 'Revisite France ~1 h' : 'Revisite France ~3 h',
      status: 'ACTIF',
    },
    {
      id: 'gibs',
      icon: 'satellite',
      label: 'NASA GIBS',
      role: 'Fumée et cicatrices visibles',
      timing: 'Dernière image publiée · délai variable',
      status: 'ACTIF À LA DEMANDE',
    },
    {
      id: 'mtg-frp',
      icon: 'timer',
      label: 'MTG · Fire Radiative Power',
      role: 'Intensité thermique et évolution rapide',
      timing: 'Mesure 10 min · livraison ~20 min, jusqu’à 45 min',
      status: mtgFrpStatus,
    },
    {
      id: 'radar-2d',
      icon: 'wind',
      label: 'Réflectivité radar 2D Météo-France',
      role: 'Réflectivité atmosphérique 2D · aide à l’interprétation du panache',
      timing: 'Mesures 5 min · résolution 1 km',
      status: radar2dStatus,
    },
    {
      id: 'radar-3d',
      icon: 'wind',
      label: 'Analyse volumique 3D du panache',
      role: 'Structure et hauteur du panache',
      timing: 'Pipeline scientifique validé requis',
      status: 'NON CONNECTÉ',
    },
  ];
}
