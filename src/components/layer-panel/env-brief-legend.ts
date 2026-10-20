// src/components/layer-panel/env-brief-legend.ts : légende de la couche « Enjeux exposés » (pastille En bref, onglet Environnement).
// Couleur du disque = type d'enjeu (deckgl/exposure-map.ts, source unique) ; couleur de l'anneau = niveau du phénomène qui l'expose.
import { levelHex } from '../../services/vigilance.ts';
import { EXPOSURE_KIND_HEX, EXPOSURE_KIND_WORD } from '../deckgl/exposure-map.ts';
import type { LegendCategory } from '../MapLegend.ts';

export const ENV_BRIEF_LEGEND: LegendCategory = {
  id: 'envBrief',
  title: 'Enjeux exposés',
  items: [
    { id: 'eb-nucleaire', label: EXPOSURE_KIND_WORD.nucleaire, color: EXPOSURE_KIND_HEX.nucleaire, shape: 'circle' },
    { id: 'eb-seveso-haut', label: EXPOSURE_KIND_WORD['seveso-haut'], color: EXPOSURE_KIND_HEX['seveso-haut'], shape: 'circle' },
    { id: 'eb-hopital', label: EXPOSURE_KIND_WORD.hopital, color: EXPOSURE_KIND_HEX.hopital, shape: 'circle' },
    { id: 'eb-seveso-bas', label: EXPOSURE_KIND_WORD['seveso-bas'], color: EXPOSURE_KIND_HEX['seveso-bas'], shape: 'circle' },
    { id: 'eb-ehpad', label: EXPOSURE_KIND_WORD.ehpad, color: EXPOSURE_KIND_HEX.ehpad, shape: 'circle' },
    { id: 'eb-ring-rouge', label: 'Anneau rouge : phénomène rouge', borderColor: levelHex('rouge'), shape: 'ring' },
    { id: 'eb-ring-orange', label: 'Anneau orange : phénomène orange', borderColor: levelHex('orange'), shape: 'ring' },
  ],
  source: { label: 'Géorisques (Seveso) · SAE et FINESS (urgences, EHPAD) · EDF (centrales)' },
  refresh: { label: 'Recalculé à chaque lecture des phénomènes' },
  notes: [
    'Seuls les enjeux à portée d’un phénomène en cours sont dessinés : crue à 2\u00a0km, feu à 5\u00a0km, séisme de 10 à 50\u00a0km, zone Copernicus.',
    'Pointillés : portée d’un feu ou d’un séisme.',
  ],
};
