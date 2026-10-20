// src/components/layer-panel/seveso-legend.ts : légende de la couche « Sites Seveso » : couleur = seuil (couleurs de seveso-map.ts),
// anneau = niveau du phénomène qui expose le site.
import type { SevesoDataset } from '../../services/exposure-assets.ts';
import { levelHex } from '../../services/vigilance.ts';
import { SEVESO_BAS_HEX, SEVESO_HAUT_HEX } from '../deckgl/seveso-map.ts';
import type { LegendCategory } from '../MapLegend.ts';

export const SEVESO_LEGEND: LegendCategory = {
  id: 'seveso',
  title: 'Sites Seveso',
  items: [
    { id: 'seveso-haut', label: 'Seveso seuil haut', color: SEVESO_HAUT_HEX, shape: 'circle' },
    { id: 'seveso-bas', label: 'Seveso seuil bas', color: SEVESO_BAS_HEX, shape: 'circle' },
    { id: 'seveso-ring', label: 'Anneau : exposé à un phénomène en cours (couleur du phénomène)', borderColor: levelHex('orange'), shape: 'ring' },
  ],
  source: { label: 'Géorisques, installations classées (Licence Ouverte)' },
  refresh: { label: 'Recensement trimestriel ; exposition recalculée à chaque lecture des phénomènes' },
  notes: ['Groupes aux petites échelles, cerclés d’orange s’ils contiennent un site exposé ; noms des seuils hauts au zoom 9.'],
};

/** Légende datée : nombre de sites et date du recensement. */
export function sevesoLegend(d: SevesoDataset | null): LegendCategory {
  if (!d) return { ...SEVESO_LEGEND, notes: ['Recensement indisponible.', ...(SEVESO_LEGEND.notes ?? [])] };
  const haut = d.sites.filter((s) => s.kind === 'seveso-haut').length;
  const when = d.readAt ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(d.readAt)) : 'n.d.';
  return { ...SEVESO_LEGEND, notes: [`${d.sites.length}\u00a0sites, dont ${haut}\u00a0seuil haut · recensement du ${when}.`, ...(SEVESO_LEGEND.notes ?? [])] };
}
