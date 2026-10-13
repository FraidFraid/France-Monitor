// src/components/deckgl/nuclear-map-asnr.ts : anneaux des avis de sûreté ASNR sur les centrales EDF (spec 2026-10-13), parties pures.
// Orange (avis de moins de 7 jours), gris jusqu'à 30 jours, rien au-delà ; jamais de position hors des centrales connues.
import type { LayerSpecification } from 'maplibre-gl';
import type { AsnrResponse } from '../../types/index.ts';
import { NUCLEAR_PLANTS } from '../../config/infrastructure.ts';
import { ASNR_MAP_DAYS, ASNR_SITUATION_DAYS, asnrAgeDays } from '../../services/asnr-events.ts';
import { LYR_ASNR_RING, SRC_ASNR_RINGS } from './constants.ts';

const RECENT_HEX = '#ff9f0a';
const OLD_HEX = '#8e8e93';

export function asnrRingFeatures(r: AsnrResponse | null, now: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const newest = new Map<string, number>();
  for (const e of r?.events ?? []) {
    if (e.plantId === null) continue;
    const age = asnrAgeDays(e.date, now);
    if (age < 0 || age > ASNR_MAP_DAYS) continue;
    newest.set(e.plantId, Math.min(newest.get(e.plantId) ?? Number.POSITIVE_INFINITY, age));
  }
  const features: Array<GeoJSON.Feature<GeoJSON.Point>> = [];
  for (const [plantId, age] of newest) {
    const plant = NUCLEAR_PLANTS.find((p) => p.id === plantId);
    if (!plant) continue;
    const tone = age <= ASNR_SITUATION_DAYS ? 'recent' : 'old';
    features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: [plant.coordinates[0], plant.coordinates[1]] },
      properties: { plantId, tone, color: tone === 'recent' ? RECENT_HEX : OLD_HEX },
    });
  }
  return { type: 'FeatureCollection', features };
}

export const ASNR_RING_LAYER: LayerSpecification = {
  id: LYR_ASNR_RING, type: 'circle', source: SRC_ASNR_RINGS, layout: { visibility: 'none' },
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 14, 8, 19, 12, 24],
    'circle-color': 'rgba(0,0,0,0)',
    'circle-stroke-width': 2.4,
    'circle-stroke-color': ['get', 'color'],
    'circle-stroke-opacity': 0.95,
  },
};
