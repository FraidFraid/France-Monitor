// src/components/layer-panel/criminalite-legend.ts : légende de la couche Criminalité (spec 2026-10-17 criminalité) : la règle de couleur
// (taux rapporté à celui de la France) et la réserve sur les homicides, publiés au département seulement. Les teintes viennent de la
// carte (deckgl/crime-map.ts), source unique.
import type { CrimeDataset, CrimeIndicatorKey } from '../../types/index.ts';
import { franceRate, indicatorOf } from '../../services/crime.ts';
import type { LegendCategory } from '../MapLegend.ts';
import { CRIME_BAND_HEX } from '../deckgl/crime-map.ts';
import { formatCrimeRate, rateBaseWord } from './crime-format.ts';

export const CRIME_LEGEND: LegendCategory = {
  id: 'crime',
  title: 'Criminalité',
  items: [
    { id: 'crime-rouge', label: '2 fois la France et plus', color: CRIME_BAND_HEX.rouge, shape: 'square' },
    { id: 'crime-orange', label: '1,6 à 2 fois la France', color: CRIME_BAND_HEX.orange, shape: 'square' },
    { id: 'crime-jaune', label: '1,25 à 1,6 fois la France', color: CRIME_BAND_HEX.jaune, shape: 'square' },
    { id: 'crime-moyen', label: '0,8 à 1,25 fois la France', color: CRIME_BAND_HEX.moyen, shape: 'square' },
    { id: 'crime-bas', label: 'Moins de 0,8 fois la France', color: CRIME_BAND_HEX.bas, shape: 'square' },
  ],
  source: { label: 'SSMSI (ministère de l’Intérieur) · délinquance enregistrée' },
  refresh: { label: 'Données annuelles, rééditées en janvier et juillet' },
  notes: [
    'Couleur : taux du département (ou de la ville) rapporté à celui de la France. Délinquance enregistrée, pas délinquance réelle.',
    'Homicides et tentatives : publiés au département seulement, pas de rond par ville. Rond pâle : valeur estimée (secret statistique).',
  ],
};

/** Légende datée : indicateur affiché, année du fichier et taux national de référence. */
export function crimeLegend(ds: CrimeDataset | null, key: CrimeIndicatorKey): LegendCategory {
  const base: LegendCategory = { ...CRIME_LEGEND, items: CRIME_LEGEND.items.map((i) => ({ ...i })) };
  if (!ds) return { ...base, notes: ['Données : fichier indisponible.', ...(CRIME_LEGEND.notes ?? [])] };
  const ind = indicatorOf(ds, key);
  const fr = franceRate(ds, key);
  const head = `${ind?.label ?? key} ${ds.year} · France ${formatCrimeRate(key, fr)} (${rateBaseWord(ind)}).`;
  return { ...base, source: { ...(CRIME_LEGEND.source ?? { label: '' }), year: ds.year }, notes: [head, ...(CRIME_LEGEND.notes ?? [])] };
}
