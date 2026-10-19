// src/components/deckgl/flux-pietons-map.ts : couche Flux piétons, parties pures : rues chargées (épaisseur = personnes passées,
// couleur = probabilité de saturation : cyan fluide, L1 au-delà de 10 %), isochrones de marche 5/10/20 min en tirets, point de
// rassemblement. Phase choisie : arrivée ou dispersion ; ou un instant du rejeu (curseur) : débit de la rue à cet instant, couleur
// selon la part de sa capacité. Infobulle .hm-tip échappée, marquée ESTIMATION MODÉLISÉE.
import type { GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type { FluxPhase, FluxTiming } from '../../types/index.ts';
import { BAND_WORD, bandHex, phaseValues, saturationBand, type FluxBand, type FluxFeature, type FluxSegmentProps } from '../../services/flux-pietons.ts';
import { relativeLabel, segmentFlowAt } from '../../services/flux-timeline.ts';
import { LYR_FLUX_ISO, LYR_FLUX_LINES, LYR_FLUX_OTHERS, LYR_FLUX_OTHERS_LABEL, LYR_FLUX_POINT, SRC_FLUX } from './constants.ts';
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
    distance: typeof p['distance'] === 'number' && Number.isFinite(p['distance']) ? p['distance'] : null,
  };
}

/** Moment d'un rassemblement : à venir, en cours (3 h après le début annoncé), passé. */
export type FluxMoment = 'avenir' | 'encours' | 'passe';

/**
 * Moment lu par la valeur (clair = actuel), jamais par une teinte : les teintes de la carte disent déjà la saturation (cyan, L1)
 * et les autres couches. En cours : disque blanc plein ; à venir : anneau blanc ; passé : anneau gris, fin.
 */
export const FLUX_MOMENT_STYLE: Readonly<Record<FluxMoment, { fill: string; stroke: string; text: string; word: string }>> = {
  encours: { fill: '#ffffff', stroke: '#ffffff', text: '#ffffff', word: 'en cours' },
  avenir: { fill: '#0a0a0f', stroke: '#ffffff', text: '#e8e8ec', word: 'à venir' },
  passe: { fill: '#0a0a0f', stroke: '#6b7280', text: '#8a8f98', word: 'passé' },
};

/** Autre rassemblement prévu, non choisi : point, identifiant (clic), étiquette « ville · date » et moment. */
export interface FluxOtherEvent { id: string; point: [number, number]; label: string; moment: FluxMoment }

/** Instant du rejeu : minutes après le début annoncé et paramètres de temps de l'événement. */
export interface FluxInstant { atMin: number; timing: FluxTiming }

/** Débit à l'instant rapporté à la capacité de la rue → niveau : L1 dès la moitié de la capacité, rouge au-delà. */
export function instantBand(ratio: number): FluxBand {
  if (ratio >= 1) return 'rouge';
  if (ratio >= 0.75) return 'orange';
  if (ratio >= 0.5) return 'jaune';
  return 'fluide';
}
const INSTANT_WORD: Readonly<Record<FluxBand, string>> = {
  fluide: 'débit sous la moitié de la capacité de la rue',
  jaune: 'débit entre la moitié et les trois quarts de la capacité',
  orange: 'débit proche de la capacité de la rue',
  rouge: 'débit au-delà de la capacité : rue saturée',
};

/** Infobulle d'une rue à un instant du rejeu. */
export function fluxInstantTipBody(p: FluxSegmentProps, flow: number, ratio: number, atMin: number): string {
  const band = instantBand(ratio);
  return `<b><i class="hm-dot" style="background:${bandHex(band)}"></i>${escapeHtml(p.rue)}</b>`
    + `<div class="hm-sub">${escapeHtml(relativeLabel(atMin))} · estimation modélisée</div>`
    + row('Débit (haut)', `${int(flow)}${NBSP}pers/min`)
    + row('Part de la capacité', pct(ratio))
    + row('Largeur', `${int(p.largeur)}${NBSP}m`)
    + row('Distance au point', `${int(p.distance ?? 0)}${NBSP}m`)
    + `<div class="hm-note">${escapeHtml(INSTANT_WORD[band])}. Haut = 9 tirages sur 10 en dessous.</div>`;
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

/**
 * Objets de la carte pour la phase choisie : rues sans passage dans cette phase (moins d'une personne) retirées. Avec un instant du
 * rejeu : débit de chaque rue à cet instant (rues vides retirées) ; épaisseur = personnes passant en 10 minutes à ce débit.
 */
export function fluxFeatures(
  list: readonly FluxFeature[] | null, phase: FluxPhase, instant: FluxInstant | null = null, others: readonly FluxOtherEvent[] = [],
): GeoJSON.FeatureCollection {
  // Autres rassemblements prévus : toujours visibles, même sans événement choisi.
  const features: GeoJSON.Feature[] = others.map((o) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: o.point }, properties: { kind: 'autre', id: o.id, label: o.label, moment: o.moment },
  }));
  for (const f of list ?? []) {
    const kind = f.properties['kind'];
    if (kind !== 'troncon') {
      features.push({ type: 'Feature', geometry: f.geometry, properties: { ...f.properties } });
      continue;
    }
    const p = segmentProps(f.properties);
    if (instant && p.distance !== null) {
      const { flow, ratio } = segmentFlowAt({ ...p, distance: p.distance }, instant.timing, instant.atMin);
      if (flow < 0.1) continue;
      features.push({
        type: 'Feature', geometry: f.geometry,
        properties: { kind, charge: flow * 10, color: bandHex(instantBand(ratio)), sortKey: ratio * 1000 + Math.min(flow, 999), body: fluxInstantTipBody(p, flow, ratio, instant.atMin) },
      });
      continue;
    }
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
    id: LYR_FLUX_OTHERS, type: 'circle', source: SRC_FLUX, filter: ['==', ['get', 'kind'], 'autre'], layout: { visibility: 'none' },
    // Mêmes valeurs que FLUX_MOMENT_STYLE (expressions MapLibre littérales).
    paint: {
      'circle-color': ['match', ['get', 'moment'], 'encours', '#ffffff', 'passe', '#0a0a0f', '#0a0a0f'],
      'circle-stroke-color': ['match', ['get', 'moment'], 'encours', '#ffffff', 'passe', '#6b7280', '#ffffff'],
      'circle-radius': ['match', ['get', 'moment'], 'encours', 7, 'passe', 4.5, 6],
      'circle-stroke-width': ['match', ['get', 'moment'], 'passe', 1.5, 2.5],
    },
  },
  {
    id: LYR_FLUX_OTHERS_LABEL, type: 'symbol', source: SRC_FLUX, filter: ['==', ['get', 'kind'], 'autre'],
    layout: { visibility: 'none', 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold'], 'text-optional': true },
    paint: { 'text-color': ['match', ['get', 'moment'], 'encours', '#ffffff', 'passe', '#8a8f98', '#e8e8ec'], 'text-halo-color': '#0a0a0f', 'text-halo-width': 1.5 },
  },
  {
    id: LYR_FLUX_POINT, type: 'circle', source: SRC_FLUX, filter: ['==', ['get', 'kind'], 'rassemblement'], layout: { visibility: 'none' },
    paint: { 'circle-color': '#ffffff', 'circle-radius': 6, 'circle-stroke-width': 3, 'circle-stroke-color': '#0a0a0f' },
  },
];

export const FLUX_LAYER_IDS: readonly string[] = [LYR_FLUX_ISO, LYR_FLUX_LINES, LYR_FLUX_OTHERS, LYR_FLUX_OTHERS_LABEL, LYR_FLUX_POINT];
