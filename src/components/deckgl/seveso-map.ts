// src/components/deckgl/seveso-map.ts : couche « Sites Seveso » de l'onglet Environnement (20/10/2026). Pur.
// Un point par établissement : couleur franche par seuil (sarcelle foncée seuil haut, claire seuil bas, comme la couche Enjeux exposés),
// jamais une couleur L1 en propre ; un site à portée d'un phénomène en cours est cerclé de la couleur L1 de ce phénomène. Regroupés
// aux petites échelles (groupe cerclé d'orange s'il contient un site exposé), nommés au zoom 9 pour les seuils hauts.
import type { GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type { Exposure, ExposureAsset } from '../../services/environment-exposure.ts';
import { levelHex } from '../../services/vigilance.ts';
import { escapeHtml } from './format-utils.ts';
import { EXPOSURE_KIND_HEX } from './exposure-map.ts';

export const SRC_SEVESO = 'seveso-src';
export const LYR_SEVESO_CLUSTER = 'seveso-cluster';
export const LYR_SEVESO_CLUSTER_COUNT = 'seveso-cluster-count';
export const LYR_SEVESO = 'seveso';
export const LYR_SEVESO_LABEL = 'seveso-label';
export const SEVESO_LAYER_IDS: readonly string[] = [LYR_SEVESO_CLUSTER, LYR_SEVESO_CLUSTER_COUNT, LYR_SEVESO, LYR_SEVESO_LABEL];

export const SEVESO_HAUT_HEX = EXPOSURE_KIND_HEX['seveso-haut'];
export const SEVESO_BAS_HEX = EXPOSURE_KIND_HEX['seveso-bas'];
const OUTLINE_HEX = '#05060a';

export function sevesoFeatures(sites: readonly ExposureAsset[] | null, exposed: readonly Exposure[] | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!sites) return { type: 'FeatureCollection', features: [] };
  const byId = new Map((exposed ?? []).map((e) => [e.asset.id, e]));
  return {
    type: 'FeatureCollection',
    features: sites.filter((s) => s.kind === 'seveso-haut' || s.kind === 'seveso-bas').map((s): GeoJSON.Feature<GeoJSON.Point> => {
      const e = byId.get(s.id);
      const haut = s.kind === 'seveso-haut';
      const where = e ? (e.inFloodZone ? 'dans la zone inondable cartographiée' : e.distanceKm === null ? 'dans le département' : e.distanceKm === 0 ? 'dans la zone' : `à ${e.distanceKm.toFixed(1).replace('.', ',')}\u00a0km`) : '';
      const body = `<b><i class="hm-dot" style="background:${haut ? SEVESO_HAUT_HEX : SEVESO_BAS_HEX}"></i>${escapeHtml(s.name)}</b>`
        + `<div class="hm-sub">${escapeHtml([haut ? 'Seveso seuil haut' : 'Seveso seuil bas', s.commune].filter(Boolean).join(' · '))}</div>`
        + (e ? `<div class="hm-row"><span>Exposé à</span><span>${escapeHtml(e.hazard.label)}</span></div><div class="hm-row"><span>Distance</span><span>${escapeHtml(where)}</span></div>` : '')
        + '<div class="hm-note">Source : Géorisques (installations classées).</div>';
      return {
        type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: {
          id: s.id, name: s.name, haut, fill: haut ? SEVESO_HAUT_HEX : SEVESO_BAS_HEX, radius: haut ? 5.5 : 3.5,
          ring: e ? levelHex(e.hazard.level) : OUTLINE_HEX, ringWidth: e ? 2.5 : 1, exposed: e ? 1 : 0,
          sortKey: (e ? 10 : 0) + (haut ? 2 : 1), body,
        },
      };
    }),
  };
}

/** Source regroupée jusqu'au zoom 7 ; `exposed` compte les sites exposés du groupe. */
export function sevesoSourceSpec(): GeoJSONSourceSpecification {
  return {
    type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 36, clusterMaxZoom: 7,
    clusterProperties: { exposed: ['+', ['get', 'exposed']] },
  };
}

export const SEVESO_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_SEVESO_CLUSTER, type: 'circle', source: SRC_SEVESO, filter: ['has', 'point_count'], layout: { visibility: 'none' },
    paint: {
      'circle-color': SEVESO_HAUT_HEX, 'circle-opacity': 0.8,
      'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 8, 20, 12, 100, 17],
      'circle-stroke-color': ['case', ['>', ['get', 'exposed'], 0], levelHex('orange'), OUTLINE_HEX],
      'circle-stroke-width': ['case', ['>', ['get', 'exposed'], 0], 2.5, 1],
    },
  },
  {
    id: LYR_SEVESO_CLUSTER_COUNT, type: 'symbol', source: SRC_SEVESO, filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 10, 'text-font': ['Open Sans Semibold'], visibility: 'none' },
    paint: { 'text-color': '#05262a' },
  },
  {
    id: LYR_SEVESO, type: 'circle', source: SRC_SEVESO, filter: ['!', ['has', 'point_count']],
    layout: { 'circle-sort-key': ['get', 'sortKey'], visibility: 'none' },
    paint: {
      'circle-color': ['get', 'fill'], 'circle-radius': ['get', 'radius'], 'circle-opacity': 0.95,
      'circle-stroke-color': ['get', 'ring'], 'circle-stroke-width': ['get', 'ringWidth'],
    },
  },
  {
    id: LYR_SEVESO_LABEL, type: 'symbol', source: SRC_SEVESO, minzoom: 9, filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'haut'], true]],
    layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'text-font': ['Open Sans Semibold'], 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 11, visibility: 'none' },
    paint: { 'text-color': '#e8e8ec', 'text-halo-color': '#05060a', 'text-halo-width': 1.3 },
  },
];
