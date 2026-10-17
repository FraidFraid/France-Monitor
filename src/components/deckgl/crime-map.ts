// src/components/deckgl/crime-map.ts : couche Criminalité (spec 2026-10-17 criminalité), parties pures : départements colorés par le
// rapport de leur taux à celui de la France, ronds des villes de 20 000 habitants et plus (indicateurs communaux), infobulles .hm-tip
// échappées, sources et couches MapLibre. Les teintes d'alerte sont celles de l'échelle L1 (vigilance.ts), réservées à ce qui dépasse
// la moyenne nationale ; en dessous, des gris-bleu neutres.
import type { LayerSpecification } from 'maplibre-gl';
import type { CrimeCity, CrimeDataset, CrimeDepartment, CrimeIndicatorKey } from '../../types/index.ts';
import { levelHex } from '../../services/vigilance.ts';
import {
  crimeBand, crimeValue, franceRate, indicatorOf, rankCities, ratioToFrance, type CrimeBand, type CrimeReading,
} from '../../services/crime.ts';
import { frNumber, NBSP } from '../layer-panel/format.ts';
import { formatCrimeCount, formatCrimeRate, formatEvolution, rateBaseWord } from '../layer-panel/crime-format.ts';
import { LYR_CRIME_CITY, LYR_CRIME_FILL, LYR_CRIME_LABEL, LYR_CRIME_LINE, SRC_CRIME_CITIES, SRC_CRIME_DEPTS } from './constants.ts';
import { escapeHtml } from './format-utils.ts';

/** Teinte de chaque bande : neutres sous la moyenne nationale, L1 au-dessus. */
export const CRIME_BAND_HEX: Readonly<Record<CrimeBand, string>> = {
  bas: '#94a3b8', moyen: '#64748b', jaune: levelHex('jaune'), orange: levelHex('orange'), rouge: levelHex('rouge'), nd: '#475569',
};
/** Opacité du remplissage : discret sous la moyenne, de plus en plus franc au-dessus. */
export const CRIME_BAND_FILL: Readonly<Record<CrimeBand, number>> = { bas: 0.06, moyen: 0.28, jaune: 0.45, orange: 0.55, rouge: 0.65, nd: 0 };
export const CRIME_BAND_WORD: Readonly<Record<CrimeBand, string>> = {
  bas: 'sous 0,8 fois la France', moyen: '0,8 à 1,25 fois la France', jaune: '1,25 à 1,6 fois la France', orange: '1,6 à 2 fois la France',
  rouge: '2 fois la France et plus', nd: 'n.d.',
};
/** Villes étiquetées sur la carte : les plus fortes en taux. */
export const CRIME_LABELLED_CITIES = 15;
const MIN_RADIUS = 5;
const MAX_RADIUS = 14;
const MIN_POP = 20_000;
const MAX_POP = 2_200_000;

/** Rayon du rond d'une ville : racine de la population, 5 px à 20 000 habitants, 14 px vers Paris. */
export function crimeCityRadius(population: number): number {
  const t = (Math.sqrt(Math.max(MIN_POP, population)) - Math.sqrt(MIN_POP)) / (Math.sqrt(MAX_POP) - Math.sqrt(MIN_POP));
  return Math.round((MIN_RADIUS + Math.min(1, Math.max(0, t)) * (MAX_RADIUS - MIN_RADIUS)) * 10) / 10;
}

const row = (k: string, v: string): string => `<div class="hm-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`;
const dot = (band: CrimeBand): string => `<i class="hm-dot" style="background:${CRIME_BAND_HEX[band]}"></i>`;

/** Corps d'infobulle commun : titre, indicateur, nombre, taux, rapport à la France, évolution, « estimé ». */
function tipBody(
  title: string, sub: string, ds: CrimeDataset, key: CrimeIndicatorKey, r: CrimeReading, ratio: number | null, band: CrimeBand,
): string {
  const ind = indicatorOf(ds, key);
  const rows = [
    row(`Faits ${ds.year}`, r.estimated ? 'estimé' : formatCrimeCount(r.count)),
    row(`Taux (${rateBaseWord(ind)})`, formatCrimeRate(key, r.rate)),
    row('Rapport à la France', ratio === null ? 'n.d.' : `${frNumber(ratio, 2)}${NBSP}×`),
  ];
  if (ds.previousYear !== null && !r.estimated) rows.push(row(`Évolution vs ${ds.previousYear}`, formatEvolution(r.count, r.previous)));
  return `<b>${dot(band)}${escapeHtml(title)}</b><div class="hm-sub">${escapeHtml(sub)}</div>${rows.join('')}`
    + (r.estimated ? '<div class="hm-note">Estimation lissée : le nombre est masqué par le secret statistique.</div>' : '');
}

function deptFeature(f: GeoJSON.Feature, ds: CrimeDataset, key: CrimeIndicatorKey, fr: number | null, byCode: ReadonlyMap<string, CrimeDepartment>): GeoJSON.Feature {
  const code = String(f.properties?.['code'] ?? '');
  const dept = byCode.get(code);
  const r = crimeValue(dept?.values[key]);
  const ratio = ratioToFrance(r.rate, fr);
  const band = crimeBand(ratio);
  const name = dept?.name ?? String(f.properties?.['nom'] ?? code);
  const body = dept && r.rate !== null
    ? tipBody(`${name} (${code})`, indicatorOf(ds, key)?.label ?? key, ds, key, r, ratio, band)
    : `<b>${escapeHtml(name)}</b><div class="hm-sub">${escapeHtml(indicatorOf(ds, key)?.label ?? key)}</div>${row('Taux', 'n.d.')}`;
  return {
    ...f,
    properties: { ...(f.properties ?? {}), crimeBand: band, crimeColor: CRIME_BAND_HEX[band], crimeFill: CRIME_BAND_FILL[band], crimeBody: body },
  };
}

/** Contours des départements peints pour l'indicateur choisi ; un département sans taux reste transparent. */
export function crimeDeptFeatures(base: GeoJSON.FeatureCollection | null, ds: CrimeDataset | null, key: CrimeIndicatorKey): GeoJSON.FeatureCollection {
  if (!base || !ds) return { type: 'FeatureCollection', features: [] };
  const fr = franceRate(ds, key);
  const byCode = new Map(ds.departments.map((d): [string, CrimeDepartment] => [d.code, d]));
  return { type: 'FeatureCollection', features: base.features.map((f) => deptFeature(f, ds, key, fr, byCode)) };
}

/** Ronds des villes (indicateurs communaux seulement) ; étiquette sur les plus fortes en taux. Estimé : rond plus pâle. */
export function crimeCityFeatures(ds: CrimeDataset | null, key: CrimeIndicatorKey): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const empty: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: 'FeatureCollection', features: [] };
  if (!ds || indicatorOf(ds, key)?.communal === false) return empty;
  const fr = franceRate(ds, key);
  const labelled = new Set(rankCities(ds, key, CRIME_LABELLED_CITIES).map((c) => c.city.code));
  const features: Array<GeoJSON.Feature<GeoJSON.Point>> = [];
  // Ordre stable (population, puis code) ; le rond le plus au-dessus de la moyenne nationale est dessiné en dernier (sortKey).
  const cities: CrimeCity[] = [...ds.cities].sort((a, b) => b.population - a.population || a.code.localeCompare(b.code));
  for (const city of cities) {
    const r = crimeValue(city.values[key]);
    if (r.rate === null) continue;
    const ratio = ratioToFrance(r.rate, fr);
    const band = crimeBand(ratio);
    features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: [city.lon, city.lat] },
      properties: {
        id: city.code, color: CRIME_BAND_HEX[band], radius: crimeCityRadius(city.population), estimated: r.estimated,
        label: labelled.has(city.code) ? city.name : '', sortKey: Math.round((ratio ?? 0) * 100),
        body: tipBody(city.name, `${indicatorOf(ds, key)?.label ?? key} · dép. ${city.dept}`, ds, key, r, ratio, band),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export const CRIME_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_CRIME_FILL, type: 'fill', source: SRC_CRIME_DEPTS, layout: { visibility: 'none' },
    paint: { 'fill-color': ['coalesce', ['get', 'crimeColor'], 'rgba(0, 0, 0, 0)'], 'fill-opacity': ['coalesce', ['get', 'crimeFill'], 0] },
  },
  {
    id: LYR_CRIME_LINE, type: 'line', source: SRC_CRIME_DEPTS, layout: { visibility: 'none' },
    paint: { 'line-color': ['coalesce', ['get', 'crimeColor'], '#64748b'], 'line-width': 0.9, 'line-opacity': 0.85 },
  },
];

/** Ronds et étiquettes des villes : posés avec les couches de points, au-dessus des surfaces. */
export const CRIME_CITY_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_CRIME_CITY, type: 'circle', source: SRC_CRIME_CITIES, layout: { 'circle-sort-key': ['get', 'sortKey'], visibility: 'none' },
    paint: {
      'circle-color': ['get', 'color'], 'circle-radius': ['get', 'radius'],
      'circle-opacity': ['case', ['boolean', ['get', 'estimated'], false], 0.4, 0.88],
      'circle-stroke-width': ['case', ['boolean', ['get', 'estimated'], false], 1, 2],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': ['case', ['boolean', ['get', 'estimated'], false], 0.45, 1],
    },
  },
  {
    id: LYR_CRIME_LABEL, type: 'symbol', source: SRC_CRIME_CITIES,
    layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold'], visibility: 'none' },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#0a0a0f', 'text-halo-width': 2 },
  },
];

export const CRIME_LAYER_IDS: readonly string[] = [LYR_CRIME_FILL, LYR_CRIME_LINE, LYR_CRIME_CITY, LYR_CRIME_LABEL];
