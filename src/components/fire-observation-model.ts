export type FireObservationSourceId = 'firms' | 'gibs' | 'mtg-frp' | 'radar';
export type FireObservationStatus = 'ACTIF' | 'À LA DEMANDE' | 'NON CONNECTÉ';

export interface FireObservationSource {
  id: FireObservationSourceId;
  label: string;
  role: string;
  timing: string;
  status: FireObservationStatus;
}

export const FIRE_OBSERVATION_CNRS_URL =
  'https://www.cnrs.fr/fr/la-recherche/expertise-scientifique/esco-incendies-de-foret-et-ville';
export const FIRE_OBSERVATION_LSA_SAF_URL =
  'https://lsa-saf.eumetsat.int/en/news/news/release-of-mtg-fire-radiative-power-product-as-demonstration/';

export function buildFireObservationSources(options: {
  multiSource: boolean;
}): readonly FireObservationSource[] {
  return [
    {
      id: 'firms',
      label: 'FIRMS · VIIRS',
      role: 'Activité thermique au sol',
      timing: options.multiSource ? 'Revisite France ~1 h' : 'Revisite France ~3 h',
      status: 'ACTIF',
    },
    {
      id: 'gibs',
      label: 'NASA GIBS',
      role: 'Fumée et cicatrices visibles',
      timing: 'Dernière image publiée · délai variable',
      status: 'À LA DEMANDE',
    },
    {
      id: 'mtg-frp',
      label: 'MTG · Fire Radiative Power',
      role: 'Intensité thermique et évolution rapide',
      timing: 'Mesure 10 min · livraison ~20 min, jusqu’à 45 min',
      status: 'NON CONNECTÉ',
    },
    {
      id: 'radar',
      label: 'Radar Météo-France',
      role: 'Structure et hauteur du panache',
      timing: 'Mesures 5 min · analyse volumique requise',
      status: 'NON CONNECTÉ',
    },
  ];
}
