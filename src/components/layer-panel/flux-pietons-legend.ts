// src/components/layer-panel/flux-pietons-legend.ts : légende de la couche Flux piétons : couleur = probabilité de saturation
// (cyan fluide, L1 au-delà de 10 %), épaisseur = personnes passées, tirets = temps de marche. Teintes du service, source unique.
import type { FluxIndex } from '../../types/index.ts';
import { BAND_WORD, FLUX_WARNING, bandHex } from '../../services/flux-pietons.ts';
import { frDateTime } from '../../services/webcams.ts';
import type { LegendCategory } from '../MapLegend.ts';

export const FLUX_LEGEND: LegendCategory = {
  id: 'pedestrianFlows',
  title: 'Flux piétons',
  items: [
    { id: 'flux-fluide', label: BAND_WORD.fluide, color: bandHex('fluide'), shape: 'square' },
    { id: 'flux-jaune', label: BAND_WORD.jaune, color: bandHex('jaune'), shape: 'square' },
    { id: 'flux-orange', label: BAND_WORD.orange, color: bandHex('orange'), shape: 'square' },
    { id: 'flux-rouge', label: BAND_WORD.rouge, color: bandHex('rouge'), shape: 'square' },
  ],
  source: { label: 'flux_osint · OpenStreetMap, INSEE, Open-Meteo' },
  refresh: { label: 'Recalcul toutes les 15\u00a0min' },
  notes: [
    FLUX_WARNING,
    'Épaisseur : personnes passées pendant la phase. Tirets : 5, 10 et 20\u00a0min de marche ; point blanc : rassemblement.',
  ],
};

export function fluxLegend(index: FluxIndex | null): LegendCategory {
  const base: LegendCategory = { ...FLUX_LEGEND, items: FLUX_LEGEND.items.map((i) => ({ ...i })) };
  if (!index) return { ...base, notes: ['Données : publication illisible.', ...(FLUX_LEGEND.notes ?? [])] };
  const n = index.evenements.length;
  const head = n === 0 ? 'Aucune prévision publiée.' : `${n}\u00a0prévision${n > 1 ? 's' : ''} · publiée${n > 1 ? 's' : ''} le ${frDateTime(index.generatedAt) ?? 'n.d.'}.`;
  return { ...base, notes: [head, ...(FLUX_LEGEND.notes ?? [])] };
}
