// src/components/deckgl/environment-map-ems.ts : zones Copernicus EMS de la couche Catastrophes (spec 2026-10-12 Copernicus EMS),
// parties pures : polygones des activations françaises en cours, contour violet pointillé (couleur d'aucun niveau), étiquette du
// code, infobulle .hm-tip préparée et échappée. Relevé en retard (60 min) ou absent : aucune zone.
import type { LayerSpecification } from 'maplibre-gl';
import type { EmsActivation, EmsResponse } from '../../types/index.ts';
import { isEnvironmentDataLate } from '../../services/environment-levels.ts';
import { frNumber, NBSP } from '../layer-panel/format.ts';
import { EMS_CATEGORY_LABEL, EMS_ZONE_HEX } from '../layer-panel/environment-legend.ts';
import { LYR_EMS_ZONE_FILL, LYR_EMS_ZONE_LABEL, LYR_EMS_ZONE_LINE, SRC_EMS_ZONES } from './constants.ts';
import { escapeHtml } from './format-utils.ts';

function body(a: EmsActivation, zone: string): string {
  const rows: Array<[string, string]> = [
    ['Activation', a.code],
    ['Zone', zone || 'n.d.'],
    ['Déclencheur', a.activator ?? 'n.d.'],
    ['Population', a.population !== null ? `${frNumber(a.population, 0)}${NBSP}hab.` : 'n.d.'],
    ['Source', 'Copernicus EMS'],
  ];
  return `<b>${escapeHtml(`${EMS_CATEGORY_LABEL[a.category]} · ${a.territory}`)}</b><div class="hm-sub">${escapeHtml(a.name)}</div>`
    + rows.map(([k, v]) => `<div class="hm-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join('');
}

export function emsZoneFeatures(e: EmsResponse | null, now: number): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (!e || e.readAt === null || isEnvironmentDataLate('ems', e.readAt, now)) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: e.active.flatMap((a) => a.zones.map((z): GeoJSON.Feature<GeoJSON.Polygon> => ({
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [z.ring] },
      properties: { code: a.code, label: a.code, body: body(a, z.name) },
    }))),
  };
}

export const EMS_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_EMS_ZONE_FILL, type: 'fill', source: SRC_EMS_ZONES, layout: { visibility: 'none' },
    paint: { 'fill-color': EMS_ZONE_HEX, 'fill-opacity': 0.08 },
  },
  {
    id: LYR_EMS_ZONE_LINE, type: 'line', source: SRC_EMS_ZONES, layout: { visibility: 'none', 'line-join': 'round' },
    paint: { 'line-color': EMS_ZONE_HEX, 'line-width': 1.6, 'line-dasharray': [2, 1.5], 'line-opacity': 0.9 },
  },
  {
    id: LYR_EMS_ZONE_LABEL, type: 'symbol', source: SRC_EMS_ZONES,
    layout: { 'text-field': ['get', 'label'], 'text-size': 10, 'text-font': ['Open Sans Semibold'], 'symbol-placement': 'point', visibility: 'none' },
    paint: { 'text-color': EMS_ZONE_HEX, 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.5 },
  },
];

export const EMS_LAYER_IDS: readonly string[] = [LYR_EMS_ZONE_FILL, LYR_EMS_ZONE_LINE, LYR_EMS_ZONE_LABEL];
