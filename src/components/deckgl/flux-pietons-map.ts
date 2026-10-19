// src/components/deckgl/flux-pietons-map.ts : couche Flux piétons, parties pures : rues chargées (épaisseur = personnes passées,
// couleur = probabilité de saturation : cyan fluide, L1 au-delà de 10 %), isochrones de marche 5/10/20 min en tirets, point de
// rassemblement. Phase choisie : arrivée ou dispersion. Infobulle .hm-tip échappée, marquée ESTIMATION MODÉLISÉE.
import type { GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type { FluxPhase } from '../../types/index.ts';
import { BAND_WORD, bandHex, phaseValues, saturationBand, type FluxFeature, type FluxSegmentProps } from '../../services/flux-pietons.ts';
import { LYR_FLUX_ISO, LYR_FLUX_LINES, LYR_FLUX_POINT, SRC_FLUX } from './constants.ts';
import { escapeHtml } from './format-utils.ts';

const NBSP = ' ';
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const int = (v: number): string => Math.round(v).toLocaleString('fr-FR').replace(/\s/g, NBSP);
const pct = (v: number): string => `${Math.round(v * 100)}${NBSP}%`;
const row = (k: string, v: string): string => `<div class="hm-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`;

function segmentProps(p: Record<string, unknown>): FluxSegmentProps {
  return {
    kind: 'troncon', rue: typeof p['rue'] === 'string' ? p['rue'] : '(sans nom)', largeur: num(p['largeur']),
    chargeP50: num(p['chargeP50']), chargeP90: num(p['chargeP90']), densiteP90: num(p['densiteP90']), pSaturation: num(p['pSaturation']),
    chargeDepartP90: num(p['chargeDepartP90']), pSaturationDepart: num(p['pSaturationDepart']), pEmprise: num(p['pEmprise']),
    parcours: p['parcours'] === true, pGoulot: num(p['pGoulot']),
  };
}

/** Infobulle d'une rue : valeurs de la phase choisie, toujours présentées comme des estimations. */
export function fluxTipBody(p: FluxSegmentProps, phase: FluxPhase): string {
  const { charge, pSat } = phaseValues(p, phase);
  const band = saturationBand(pSat);
  return `<b><i class="hm-dot" style="background:${bandHex(band)}"></i>${escapeHtml(p.rue)}</b>`
    + `<div class="hm-sub">${phase === 'arrivee' ? 'Arrivée' : 'Dispersion'} · estimation modélisée</div>`
    + row('Personnes passées (haut)', int(charge))
    + (phase === 'arrivee' ? row('Personnes passées (médiane)', int(p.chargeP50)) + row('Densité (haut)', `${p.densiteP90.toFixed(2).replace('.', ',')}${NBSP}pers/m²`) : '')
    + row('Saturation', `${pct(pSat)} des tirages`)
    + row('Largeur', `${int(p.largeur)}${NBSP}m`)
    + (p.pEmprise > 0.05 ? row('Occupée par la foule', `${pct(p.pEmprise)} des tirages`) : '')
    + (p.parcours ? row('Cortège', p.pGoulot > 0.1 ? `goulot dans ${pct(p.pGoulot)} des tirages` : 'sur le parcours') : '')
    + `<div class="hm-note">${escapeHtml(BAND_WORD[band])}. Haut = 9 tirages sur 10 en dessous.</div>`;
}

/** Objets de la carte pour la phase choisie : rues sans passage dans cette phase (moins d'une personne) retirées. */
export function fluxFeatures(list: readonly FluxFeature[] | null, phase: FluxPhase): GeoJSON.FeatureCollection {
  if (!list) return { type: 'FeatureCollection', features: [] };
  const features: GeoJSON.Feature[] = [];
  for (const f of list) {
    const kind = f.properties['kind'];
    if (kind !== 'troncon') {
      features.push({ type: 'Feature', geometry: f.geometry, properties: { ...f.properties } });
      continue;
    }
    const p = segmentProps(f.properties);
    const { charge, pSat } = phaseValues(p, phase);
    if (charge < 1 && !(p.parcours && phase === 'arrivee')) continue;
    features.push({
      type: 'Feature', geometry: f.geometry,
      properties: { kind, charge, color: bandHex(saturationBand(pSat)), sortKey: pSat * 1000 + Math.min(charge, 999), body: fluxTipBody(p, phase) },
    });
  }
  return { type: 'FeatureCollection', features };
}

export function fluxSourceSpec(): GeoJSONSourceSpecification {
  return { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
}

export const FLUX_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_FLUX_ISO, type: 'line', source: SRC_FLUX, filter: ['==', ['get', 'kind'], 'isochrone'], layout: { visibility: 'none' },
    paint: {
      'line-color': '#e5e7eb', 'line-width': 1.2, 'line-dasharray': [3, 3],
      'line-opacity': ['match', ['get', 'minutes'], 5, 0.75, 10, 0.55, 0.35],
    },
  },
  {
    id: LYR_FLUX_LINES, type: 'line', source: SRC_FLUX, filter: ['==', ['get', 'kind'], 'troncon'],
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'sortKey'] },
    paint: {
      'line-color': ['get', 'color'], 'line-opacity': 0.9,
      // Épaisseur = personnes passées (échelle logarithmique), grossie avec le zoom.
      'line-width': ['interpolate', ['linear'], ['zoom'],
        12, ['interpolate', ['linear'], ['ln', ['max', 1, ['get', 'charge']]], 0, 0.8, 8, 4],
        17, ['interpolate', ['linear'], ['ln', ['max', 1, ['get', 'charge']]], 0, 2, 8, 12]],
    },
  },
  {
    id: LYR_FLUX_POINT, type: 'circle', source: SRC_FLUX, filter: ['==', ['get', 'kind'], 'rassemblement'], layout: { visibility: 'none' },
    paint: { 'circle-color': '#ffffff', 'circle-radius': 6, 'circle-stroke-width': 3, 'circle-stroke-color': '#0a0a0f' },
  },
];

export const FLUX_LAYER_IDS: readonly string[] = [LYR_FLUX_ISO, LYR_FLUX_LINES, LYR_FLUX_POINT];
