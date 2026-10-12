// src/components/deckgl/environment-map-disasters.ts : couche Catastrophes (GDACS) (spec 2026-10-12 GDACS), parties pures : source et
// couches MapLibre, points, couleur et infobulle .hm-tip préparées et échappées. Sur sol français : niveau L1 (levelHex) ; hors de
// France : gris ; relevé en retard (S2) : neutre. Module à part pour ne pas toucher les tables figées de la phase B.
import type { LayerSpecification } from 'maplibre-gl';
import type { DisasterAlert, DisastersResponse } from '../../types/index.ts';
import { isEnvironmentDataLate } from '../../services/environment-levels.ts';
import { levelHex } from '../../services/vigilance.ts';
import { clockOf } from '../layer-panel/environment-format.ts';
import { DISASTER_ABROAD_HEX, DISASTER_TYPE_LABEL, ENV_NEUTRAL_HEX } from '../layer-panel/environment-legend.ts';
import { LYR_DISASTERS, LYR_DISASTER_LABEL, LYR_OUT_TELECOM_MAINT, SRC_DISASTERS } from './constants.ts';
import { escapeHtml } from './format-utils.ts';

const RANK = { rouge: 3, orange: 2, vert: 1 } as const;

export function disasterHex(x: DisasterAlert, late: boolean): string {
  if (late) return ENV_NEUTRAL_HEX;
  return x.frenchTerritory === null ? DISASTER_ABROAD_HEX : levelHex(x.level);
}

function body(x: DisasterAlert, late: boolean, now: number): string {
  const where = x.frenchTerritory ?? (x.countries.length > 1 ? `${x.countries.length} pays` : (x.countries[0] ?? 'n.d.'));
  const rows: Array<[string, string]> = [
    ['Niveau', `Alerte ${x.level}`],
    ['Période', x.current ? `en cours depuis ${clockOf(x.from, now)}` : `du ${clockOf(x.from, now)} au ${clockOf(x.to, now)}`],
    ['Gravité', x.severity ?? 'n.d.'],
    ['Source', 'GDACS'],
  ];
  return `<b>${escapeHtml(`${DISASTER_TYPE_LABEL[x.type]} · ${where}`)}</b><div class="hm-sub">${escapeHtml(x.name)}</div>`
    + rows.map(([k, v]) => `<div class="hm-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join('')
    + (late ? '<div class="hm-note">Relevé en retard : couleur retirée.</div>' : '');
}

export function disasterFeatures(d: DisastersResponse | null, now: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!d) return { type: 'FeatureCollection', features: [] };
  const late = isEnvironmentDataLate('gdacs', d.readAt, now);
  return {
    type: 'FeatureCollection',
    features: d.alerts.map((x): GeoJSON.Feature<GeoJSON.Point> => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
      properties: {
        id: x.id, color: disasterHex(x, late), radius: x.frenchTerritory !== null ? 9 : 6,
        sortKey: RANK[x.level] + (x.frenchTerritory !== null ? 10 : 0),
        label: x.frenchTerritory !== null ? DISASTER_TYPE_LABEL[x.type] : '', body: body(x, late, now),
      },
    })),
  };
}

export const DISASTER_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_DISASTERS, type: 'circle', source: SRC_DISASTERS, layout: { 'circle-sort-key': ['get', 'sortKey'], visibility: 'none' },
    paint: {
      'circle-color': ['get', 'color'], 'circle-radius': ['get', 'radius'], 'circle-opacity': 0.9,
      'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
    },
  },
  {
    id: LYR_DISASTER_LABEL, type: 'symbol', source: SRC_DISASTERS,
    layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold'], visibility: 'none' },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#0a0a0f', 'text-halo-width': 2 },
  },
];

export const DISASTER_LAYER_KEYS: Readonly<Record<'disasters', readonly string[]>> = { disasters: [LYR_DISASTERS, LYR_DISASTER_LABEL] };

/** Au-dessus des surfaces, comme les séismes (même ancre que placeEnvBPoints). */
export function placeDisasterPoints(map: { getLayer(id: string): unknown; moveLayer(id: string, before?: string): unknown }): void {
  if (!map.getLayer(LYR_OUT_TELECOM_MAINT)) return;
  for (const l of DISASTER_LAYERS) if (map.getLayer(l.id)) map.moveLayer(l.id, LYR_OUT_TELECOM_MAINT);
}
