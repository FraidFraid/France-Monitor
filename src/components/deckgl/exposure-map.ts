// src/components/deckgl/exposure-map.ts : couche « Enjeux exposés » de l'onglet Environnement (spec 2026-10-20 § 3, lot 2). Pur.
// Un point par enjeu proche d'un phénomène en cours : disque à la couleur franche de son type (jamais une couleur L1 en propre),
// anneau à la couleur L1 du phénomène qui l'expose ; zone de portée des phénomènes localisés (feu, séisme) en cercle léger.
// Rien n'est dessiné pour un enjeu non exposé.
import type { GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type { ExposureAssetKind, ExposureResult } from '../../services/environment-exposure.ts';
import { levelHex } from '../../services/vigilance.ts';
import { LYR_EXPOSURE, LYR_EXPOSURE_LABEL, LYR_EXPOSURE_ZONES, SRC_EXPOSURE } from './constants.ts';
import { escapeHtml } from './format-utils.ts';

/** Couleur franche par type d'enjeu (nucléaire comme sur la carte Énergie, urgences en blanc comme sur la carte Santé). */
export const EXPOSURE_KIND_HEX: Readonly<Record<ExposureAssetKind, string>> = {
  nucleaire: '#8b5cf6', 'seveso-haut': '#2dd4bf', hopital: '#ffffff', 'seveso-bas': '#99f6e4', ehpad: '#93c5fd',
};
export const EXPOSURE_KIND_WORD: Readonly<Record<ExposureAssetKind, string>> = {
  nucleaire: 'Centrale nucléaire', 'seveso-haut': 'Site Seveso seuil haut', hopital: 'Service d’urgences', 'seveso-bas': 'Site Seveso seuil bas', ehpad: 'EHPAD',
};
const KIND_RADIUS: Readonly<Record<ExposureAssetKind, number>> = { nucleaire: 9, 'seveso-haut': 7, hopital: 7, 'seveso-bas': 5, ehpad: 5 };
const KIND_RANK: Readonly<Record<ExposureAssetKind, number>> = { nucleaire: 5, 'seveso-haut': 4, hopital: 3, 'seveso-bas': 2, ehpad: 1 };

/** Cercle approché (64 côtés) de rayon `km` autour d'un point, anneau [lon, lat]. */
function circleRing(lon: number, lat: number, radiusKm: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  for (let i = 0; i <= 64; i += 1) {
    const a = (i / 64) * 2 * Math.PI;
    out.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}

export function exposureFeatures(r: ExposureResult | null): GeoJSON.FeatureCollection {
  if (!r) return { type: 'FeatureCollection', features: [] };
  const zones: GeoJSON.Feature[] = r.hazards.flatMap((h) => h.circles.map((c): GeoJSON.Feature => ({
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [circleRing(c.lon, c.lat, c.radiusKm)] },
    properties: { zone: true, color: levelHex(h.level) },
  })));
  const points: GeoJSON.Feature[] = r.nearby.map((e) => {
    const where = e.distanceKm === null ? '' : e.distanceKm === 0 ? 'dans la zone' : `à ${e.distanceKm.toFixed(1).replace('.', ',')}\u00a0km`;
    const body = `<b><i class="hm-dot" style="background:${EXPOSURE_KIND_HEX[e.asset.kind]}"></i>${escapeHtml(e.asset.name)}</b>`
      + `<div class="hm-sub">${escapeHtml([EXPOSURE_KIND_WORD[e.asset.kind], e.asset.commune].filter(Boolean).join(' · '))}</div>`
      + `<div class="hm-row"><span>Exposé à</span><span>${escapeHtml(e.hazard.label)}</span></div>`
      + (where ? `<div class="hm-row"><span>Distance</span><span>${escapeHtml(where)}</span></div>` : '')
      + (e.asset.detail ? `<div class="hm-note">${escapeHtml(e.asset.detail)}</div>` : '');
    return {
      type: 'Feature', geometry: { type: 'Point', coordinates: [e.asset.lon, e.asset.lat] },
      properties: {
        id: e.asset.id, kind: e.asset.kind, name: e.asset.name, fill: EXPOSURE_KIND_HEX[e.asset.kind], ring: levelHex(e.hazard.level),
        radius: KIND_RADIUS[e.asset.kind], sortKey: KIND_RANK[e.asset.kind], labelled: e.asset.kind === 'nucleaire' || e.asset.kind === 'seveso-haut' || e.asset.kind === 'hopital',
        body,
      },
    };
  });
  return { type: 'FeatureCollection', features: [...zones, ...points] };
}

export function exposureSourceSpec(): GeoJSONSourceSpecification {
  return { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
}

export const EXPOSURE_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_EXPOSURE_ZONES, type: 'line', source: SRC_EXPOSURE, filter: ['==', ['get', 'zone'], true], layout: { visibility: 'none' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
  },
  {
    id: LYR_EXPOSURE, type: 'circle', source: SRC_EXPOSURE, filter: ['!', ['has', 'zone']],
    layout: { 'circle-sort-key': ['get', 'sortKey'], visibility: 'none' },
    paint: {
      'circle-color': ['get', 'fill'], 'circle-radius': ['get', 'radius'], 'circle-opacity': 1,
      'circle-stroke-color': ['get', 'ring'], 'circle-stroke-width': 3, 'circle-stroke-opacity': 1,
    },
  },
  {
    id: LYR_EXPOSURE_LABEL, type: 'symbol', source: SRC_EXPOSURE, minzoom: 7, filter: ['==', ['get', 'labelled'], true],
    layout: {
      'text-field': ['get', 'name'], 'text-size': 11, 'text-font': ['Open Sans Semibold'], 'text-offset': [0, 1.3], 'text-anchor': 'top',
      'text-max-width': 12, 'text-optional': true, visibility: 'none',
    },
    paint: { 'text-color': '#e8e8ec', 'text-halo-color': '#05060a', 'text-halo-width': 1.4 },
  },
];

export const EXPOSURE_LAYER_IDS: readonly string[] = [LYR_EXPOSURE_ZONES, LYR_EXPOSURE, LYR_EXPOSURE_LABEL];
