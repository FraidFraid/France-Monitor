// src/components/deckgl/environment-map-disasters.ts : couche Catastrophes (GDACS) (spec 2026-10-12 GDACS), parties pures : source et
// couches MapLibre, points, couleur et infobulle .hm-tip préparées et échappées. Sur sol français : niveau L1 (levelHex) ; hors de
// France : gris ; relevé en retard (S2) : neutre. Module à part pour ne pas toucher les tables figées de la phase B.
import type { LayerSpecification } from 'maplibre-gl';
import type { DisasterAlert, DisastersResponse } from '../../types/index.ts';
import { frenchName, frenchSeverity, isEuropeanContext } from '../../services/disasters-format.ts';
import { isEnvironmentDataLate } from '../../services/environment-levels.ts';
import { levelHex } from '../../services/vigilance.ts';
import { clockOf } from '../layer-panel/environment-format.ts';
import { ALERT_WORD, DISASTER_ABROAD_HEX, DISASTER_TYPE_LABEL, ENV_NEUTRAL_HEX } from '../layer-panel/environment-legend.ts';
import { LYR_DISASTERS, LYR_DISASTER_LABEL, LYR_OUT_TELECOM_MAINT, SRC_DISASTERS } from './constants.ts';
import { escapeHtml } from './format-utils.ts';

const RANK = { rouge: 3, orange: 2, vert: 1 } as const;

/** Alerte coloriée : territoire français au sens strict (hors contexte européen). */
const colored = (x: DisasterAlert): boolean => x.frenchTerritory !== null && !isEuropeanContext(x);

export function disasterHex(x: DisasterAlert, late: boolean): string {
  if (late) return ENV_NEUTRAL_HEX;
  return colored(x) ? levelHex(x.level) : DISASTER_ABROAD_HEX;
}

function body(x: DisasterAlert, late: boolean, now: number): string {
  const context = isEuropeanContext(x);
  const where = !context && x.frenchTerritory !== null ? x.frenchTerritory : (x.countries.length > 1 ? `${x.countries.length} pays` : (x.countries[0] ?? 'n.d.'));
  const rows: Array<[string, string]> = [
    ['Niveau', ALERT_WORD[x.level]],
    ['Période', x.current ? `en cours depuis ${clockOf(x.from, now)}` : `du ${clockOf(x.from, now)} au ${clockOf(x.to, now)}`],
    ['Gravité', frenchSeverity(x) ?? 'n.d.'],
    ['Source', 'GDACS'],
  ];
  const sub = frenchName(x);
  return `<b>${escapeHtml(`${DISASTER_TYPE_LABEL[x.type]} · ${where}`)}</b>${sub && sub !== where ? `<div class="hm-sub">${escapeHtml(sub)}</div>` : ''}`
    + rows.map(([k, v]) => `<div class="hm-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join('')
    + (context ? '<div class="hm-note">Contexte européen : touche la métropole, centré hors de France.</div>' : '')
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
        id: x.id, color: disasterHex(x, late), radius: colored(x) ? 9 : 6,
        sortKey: RANK[x.level] + (colored(x) ? 10 : 0),
        label: colored(x) ? DISASTER_TYPE_LABEL[x.type] : '', body: body(x, late, now),
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
