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
  readonly observation?: string;
  readonly qualification?: 'DÉMONSTRATION';
  readonly warning?: string;
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
  const now = options.now ?? Date.now();
  const mtgFrpStatus = options.runtime
    ? deriveFireObservationStatus(options.runtime.mtgFrp, now)
    : 'NON CONNECTÉ';
  const radar2dStatus = options.runtime
    ? deriveFireObservationStatus(options.runtime.radar2d, now)
    : 'NON CONNECTÉ';

  return [
    {
      id: 'firms',
      icon: 'flame',
      label: 'FIRMS · VIIRS',
      role: 'Activité thermique au sol',
      timing: options.multiSource
        ? '~40 min entre passages d’une grappe · 2 grappes/jour'
        : '~1 h entre passages d’une grappe · 2 grappes/jour',
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
      label: 'MTG-FRP',
      role: 'Intensité thermique et évolution rapide',
      timing: 'Mesure 10 min · livraison ~20 min, jusqu’à 45 min',
      status: mtgFrpStatus,
      observation: formatObservation(options.runtime?.mtgFrp, now),
      qualification: 'DÉMONSTRATION',
    },
    {
      id: 'radar-2d',
      icon: 'wind',
      label: 'Réflectivité radar 2D Météo-France',
      role: 'Réflectivité atmosphérique 2D · aide à l’interprétation du panache',
      timing: 'Mesures 5 min · résolution 1 km',
      status: radar2dStatus,
      observation: formatObservation(options.runtime?.radar2d, now),
      warning: 'Réflectivité atmosphérique 2D — aide à l’interprétation, sans diagnostic automatique',
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

function formatObservation(
  feed: FireObservationRuntimeState['mtgFrp'] | undefined,
  now: number,
): string | undefined {
  if (!feed || (feed.status !== 'ok' && feed.status !== 'stale') || feed.observedAt === null) {
    return undefined;
  }
  const observed = new Date(feed.observedAt);
  if (!Number.isFinite(observed.getTime())) return undefined;
  const ageMinutes = Math.max(0, Math.round((now - feed.observedAt) / 60_000));
  const age = ageMinutes < 60
    ? `${ageMinutes} min`
    : `${Math.floor(ageMinutes / 60)} h ${ageMinutes % 60} min`;
  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(observed);
  return `Observation ${time} · âge ${age}`;
}
