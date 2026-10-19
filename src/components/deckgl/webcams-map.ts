// src/components/deckgl/webcams-map.ts : couche Webcams, parties pures : un point par webcam coloré par l'état de son lien (vert
// actif, gris mort ou non vérifiable), regroupement natif MapLibre aux petites échelles (groupe vert s'il contient au moins un lien
// actif), infobulle .hm-tip échappée, source et couches MapLibre.
import type { GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type { Webcam, WebcamsDataset } from '../../types/index.ts';
import { WEBCAM_STATUS_HEX, WEBCAM_STATUS_WORD, frDateTime, isVideoWebcam, sourceOf, webcamPlace } from '../../services/webcams.ts';

/** Contour des directs vidéo : rouge franc, lisible sur le vert comme sur le gris. */
export const WEBCAM_VIDEO_STROKE = '#ff3b30';
import { LYR_WEBCAMS, LYR_WEBCAM_CLUSTER, LYR_WEBCAM_CLUSTER_COUNT, SRC_WEBCAMS } from './constants.ts';
import { escapeHtml } from './format-utils.ts';

/** Ordre de dessin : les liens actifs au-dessus. */
const STATUS_RANK: Readonly<Record<Webcam['status'], number>> = { ok: 3, unknown: 2, down: 1 };

const row = (k: string, v: string): string => `<div class="hm-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`;

/** Corps de l'infobulle : nom, commune, source, état, date de vérification. */
export function webcamTipBody(w: Webcam, ds: WebcamsDataset): string {
  const source = sourceOf(ds, w.source)?.name ?? w.source;
  const state = `${WEBCAM_STATUS_WORD[w.status]}${w.httpStatus !== null ? ` (HTTP\u00a0${w.httpStatus})` : ''}`;
  return `<b><i class="hm-dot" style="background:${WEBCAM_STATUS_HEX[w.status]}"></i>${escapeHtml(w.name)}</b>`
    + `<div class="hm-sub">${escapeHtml(webcamPlace(w))}${isVideoWebcam(w) ? ' · vidéo en direct' : ''}</div>`
    + row('Source', source) + row('État', state) + row('Vérifiée le', frDateTime(w.checkedAt) ?? 'n.d.')
    + '<div class="hm-note">Clic : fiche et lien vers la webcam.</div>';
}

export function webcamFeatures(ds: WebcamsDataset | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!ds) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: ds.webcams.map((w): GeoJSON.Feature<GeoJSON.Point> => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [w.lon, w.lat] },
      properties: {
        id: w.id, status: w.status, color: WEBCAM_STATUS_HEX[w.status], video: isVideoWebcam(w),
        // Vidéos au-dessus des images de même état.
        sortKey: STATUS_RANK[w.status] * 2 + (isVideoWebcam(w) ? 1 : 0), body: webcamTipBody(w, ds),
      },
    })),
  };
}

/** Source regroupée : jusqu'au zoom 9, `ok` compte les liens actifs du groupe. */
export function webcamSourceSpec(): GeoJSONSourceSpecification {
  return {
    type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 40, clusterMaxZoom: 9,
    clusterProperties: { ok: ['+', ['case', ['==', ['get', 'status'], 'ok'], 1, 0]] },
  };
}

export const WEBCAM_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_WEBCAM_CLUSTER, type: 'circle', source: SRC_WEBCAMS, filter: ['has', 'point_count'], layout: { visibility: 'none' },
    paint: {
      'circle-color': ['case', ['>', ['get', 'ok'], 0], WEBCAM_STATUS_HEX.ok, WEBCAM_STATUS_HEX.down],
      'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 9, 20, 13, 100, 18],
      'circle-opacity': 0.85, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
    },
  },
  {
    id: LYR_WEBCAM_CLUSTER_COUNT, type: 'symbol', source: SRC_WEBCAMS, filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11, 'text-font': ['Open Sans Semibold'], visibility: 'none' },
    paint: { 'text-color': '#0a0a0f' },
  },
  {
    id: LYR_WEBCAMS, type: 'circle', source: SRC_WEBCAMS, filter: ['!', ['has', 'point_count']],
    layout: { 'circle-sort-key': ['get', 'sortKey'], visibility: 'none' },
    paint: {
      'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4.5, 10, 6.5],
      'circle-opacity': 0.95,
      'circle-stroke-width': ['case', ['get', 'video'], 2.5, 1.5],
      'circle-stroke-color': ['case', ['get', 'video'], WEBCAM_VIDEO_STROKE, '#ffffff'],
    },
  },
];

export const WEBCAM_LAYER_IDS: readonly string[] = [LYR_WEBCAM_CLUSTER, LYR_WEBCAM_CLUSTER_COUNT, LYR_WEBCAMS];
