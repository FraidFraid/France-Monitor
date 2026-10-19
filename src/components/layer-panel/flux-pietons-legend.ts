// src/components/layer-panel/flux-pietons-legend.ts : légende de la couche Flux piétons. Deux lectures, jamais mêlées : totaux de la
// phase (couleur = probabilité de saturation, cyan fluide, L1 au-delà de 10 % ; épaisseur = personnes passées) ou instant du rejeu
// (couleur = débit rapporté à la capacité de la rue, L1 dès la moitié ; épaisseur = débit). Tirets = temps de marche ; moment des
// rassemblements par la valeur (FLUX_MOMENT_STYLE) : disque blanc en cours, anneau blanc à venir, anneau gris passé.
import type { FluxIndex } from '../../types/index.ts';
import { BAND_WORD, FLUX_WARNING, bandHex } from '../../services/flux-pietons.ts';
import { frDateTime } from '../../services/webcams.ts';
import type { LegendCategory } from '../MapLegend.ts';

export const FLUX_LEGEND: LegendCategory = {
  id: 'pedestrianFlows',
  title: 'Foule estimée (Manifestations)',
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
    'Couleur : part des 500\u00a0tirages où la rue sature pendant la phase. Épaisseur : personnes passées pendant la phase.',
    'Tirets : 5, 10 et 20\u00a0min de marche. Rassemblements : disque blanc plein = en cours, anneau blanc = à venir, anneau gris = passé ; clic sur un point pour afficher ses rues et le rejeu (le choisi est entouré de ses rues).',
  ],
};

/** Rejeu (curseur) : couleur = débit de la rue à l'instant rapporté à sa capacité (seuils de instantBand). */
const INSTANT_ITEMS: LegendCategory['items'] = [
  { id: 'flux-i-fluide', label: 'débit sous la moitié de la capacité', color: bandHex('fluide'), shape: 'square' },
  { id: 'flux-i-jaune', label: 'débit de la moitié aux trois quarts', color: bandHex('jaune'), shape: 'square' },
  { id: 'flux-i-orange', label: 'débit proche de la capacité', color: bandHex('orange'), shape: 'square' },
  { id: 'flux-i-rouge', label: 'débit au-delà : rue saturée', color: bandHex('rouge'), shape: 'square' },
];
const INSTANT_NOTES = [
  FLUX_WARNING,
  'Rejeu : la carte montre l’instant choisi sur le curseur du panneau. Couleur : débit de la rue rapporté à sa capacité (environ 73\u00a0personnes par minute et par mètre). Épaisseur : débit à cet instant.',
  'Tirets : 5, 10 et 20\u00a0min de marche. Rassemblements : disque blanc plein = en cours, anneau blanc = à venir, anneau gris = passé ; clic sur un point pour afficher ses rues et le rejeu (le choisi est entouré de ses rues).',
];

/** Légende selon le mode : totaux de la phase (par défaut) ou instant du rejeu. */
export function fluxLegend(index: FluxIndex | null, instant = false): LegendCategory {
  const items = (instant ? INSTANT_ITEMS : FLUX_LEGEND.items).map((i) => ({ ...i }));
  const notes = instant ? INSTANT_NOTES : (FLUX_LEGEND.notes ?? []);
  const base: LegendCategory = { ...FLUX_LEGEND, items };
  if (!index) return { ...base, notes: ['Données : publication illisible.', ...notes] };
  const n = index.evenements.length;
  const head = n === 0 ? 'Aucune prévision publiée.' : `${n}\u00a0prévision${n > 1 ? 's' : ''} · publiée${n > 1 ? 's' : ''} le ${frDateTime(index.generatedAt) ?? 'n.d.'}.`;
  return { ...base, notes: [head, ...notes] };
}
