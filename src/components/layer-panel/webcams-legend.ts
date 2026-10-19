// src/components/layer-panel/webcams-legend.ts : légende de la couche Webcams : couleur = état du lien au recensement. Les teintes
// viennent du service (services/webcams.ts), source unique.
import type { WebcamsDataset } from '../../types/index.ts';
import { WEBCAM_STATUS_HEX, frDateTime, webcamCounts } from '../../services/webcams.ts';
import { WEBCAM_VIDEO_STROKE } from '../deckgl/webcams-map.ts';
import type { LegendCategory } from '../MapLegend.ts';

export const WEBCAMS_LEGEND: LegendCategory = {
  id: 'webcams',
  title: 'Webcams',
  items: [
    { id: 'webcams-ok', label: 'Lien actif au recensement', color: WEBCAM_STATUS_HEX.ok, shape: 'circle' },
    { id: 'webcams-down', label: 'Lien mort', color: WEBCAM_STATUS_HEX.down, shape: 'circle' },
    { id: 'webcams-unknown', label: 'Non vérifiable', color: WEBCAM_STATUS_HEX.unknown, shape: 'circle' },
    { id: 'webcams-video', label: 'Contour rouge : vidéo en direct (YouTube)', color: WEBCAM_VIDEO_STROKE, shape: 'circle' },
  ],
  source: { label: 'OpenStreetMap (ODbL) · data.gouv.fr (Licence Ouverte) · directs YouTube choisis' },
  refresh: { label: 'Recensement statique, régénéré à la main' },
  notes: [
    'Groupe vert : au moins un lien actif. Clic sur un groupe : zoom ; sur un point : fiche.',
    'Images propriété de leur diffuseur ; aucune image enregistrée par France Monitor.',
  ],
};

/** Légende datée : nombre de webcams et date du recensement. */
export function webcamsLegend(ds: WebcamsDataset | null): LegendCategory {
  const base: LegendCategory = { ...WEBCAMS_LEGEND, items: WEBCAMS_LEGEND.items.map((i) => ({ ...i })) };
  if (!ds) return { ...base, notes: ['Données : fichier indisponible.', ...(WEBCAMS_LEGEND.notes ?? [])] };
  const c = webcamCounts(ds.webcams);
  const head = `Liens actifs : ${c.ok} sur ${c.total}\u00a0webcams, dont ${c.video}\u00a0vidéos en direct · recensement du ${frDateTime(ds.generatedAt) ?? 'n.d.'}.`;
  return { ...base, notes: [head, ...(WEBCAMS_LEGEND.notes ?? [])] };
}
