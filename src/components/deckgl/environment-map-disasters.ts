// src/components/deckgl/environment-map-disasters.ts : couche Catastrophes (GDACS) (spec 2026-10-12 GDACS), parties pures : source et
// couches MapLibre, points, couleur et infobulle .hm-tip préparées et échappées. Gradation par urgence (20/10/2026, demande de
// l'utilisateur) : couleur du niveau d'alerte GDACS pour toutes les alertes, taille croissante avec l'urgence, petit point, anneau
// pulsant plus large et plus rapide quand l'alerte est grave (alertes en cours seulement). Hors de France : point plus petit et plus
// pâle (la France d'abord). Relevé en retard (S2) : neutre, sans pulsation. Module à part pour ne pas toucher les tables de la phase B.
import type { LayerSpecification } from 'maplibre-gl';
import type { DisasterAlert, DisastersResponse } from '../../types/index.ts';
import { frenchName, frenchSeverity, isEuropeanContext } from '../../services/disasters-format.ts';
import { isEnvironmentDataLate } from '../../services/environment-levels.ts';
import { levelHex } from '../../services/vigilance.ts';
import { clockOf } from '../layer-panel/environment-format.ts';
import { ALERT_WORD, DISASTER_TYPE_LABEL, ENV_NEUTRAL_HEX } from '../layer-panel/environment-legend.ts';
import { LYR_DISASTERS, LYR_DISASTER_LABEL, LYR_DISASTER_PULSE, LYR_OUT_TELECOM_MAINT, SRC_DISASTERS } from './constants.ts';
import { escapeHtml } from './format-utils.ts';
import { PULSE_BY_LEVEL, pulseLayerSpec, pulseOffset, pulsePaint } from './pulse.ts';
import { countryNameFr } from '../../utils/iso3.ts';
import { EMS_LAYER_IDS } from './environment-map-ems.ts';

const RANK = { rouge: 3, orange: 2, vert: 1 } as const;

/** Alerte coloriée : territoire français au sens strict (hors contexte européen). */
const colored = (x: DisasterAlert): boolean => x.frenchTerritory !== null && !isEuropeanContext(x);

export function disasterHex(x: DisasterAlert, late: boolean): string {
  return late ? ENV_NEUTRAL_HEX : levelHex(x.level);
}

/** Rayon du point (px) par urgence ; hors de France, un pas plus petit. */
const POINT_RADIUS = { rouge: 6, orange: 5, vert: 4 } as const;
/** Pulsation par urgence (pulse.ts, commun aux séismes). */
const PULSE = PULSE_BY_LEVEL;

function body(x: DisasterAlert, late: boolean, now: number): string {
  const context = isEuropeanContext(x);
  const where = !context && x.frenchTerritory !== null ? x.frenchTerritory : (x.countries.length > 1 ? `${x.countries.length} pays` : (x.countries[0] ? countryNameFr(x.countries[0]) : 'n.d.'));
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
        id: x.id, color: disasterHex(x, late), radius: POINT_RADIUS[x.level] - (colored(x) ? 0 : 1.5),
        alpha: colored(x) ? 1 : 0.7,
        sortKey: RANK[x.level] + (colored(x) ? 10 : 0),
        // Pulsation : alerte en cours et relevé à jour seulement (0 : pas d'anneau).
        period: x.current && !late ? PULSE[x.level].period : 0,
        amp: PULSE[x.level].amp * (colored(x) ? 1 : 0.7),
        offset: pulseOffset(x.id, PULSE[x.level].period),
        label: colored(x) ? DISASTER_TYPE_LABEL[x.type] : '', body: body(x, late, now),
      },
    })),
  };
}

/** Peinture de l'anneau (pulse.ts) ; nom gardé pour les appelants. */
export const disasterPulsePaint = pulsePaint;

export const DISASTER_LAYERS: readonly LayerSpecification[] = [
  // Sous le point : l'anneau s'élargit autour de lui.
  pulseLayerSpec(LYR_DISASTER_PULSE, SRC_DISASTERS),
  {
    id: LYR_DISASTERS, type: 'circle', source: SRC_DISASTERS, layout: { 'circle-sort-key': ['get', 'sortKey'], visibility: 'none' },
    paint: {
      'circle-color': ['get', 'color'], 'circle-radius': ['get', 'radius'], 'circle-opacity': ['get', 'alpha'],
      'circle-stroke-width': 1.2, 'circle-stroke-color': '#0a0a0f',
    },
  },
  {
    id: LYR_DISASTER_LABEL, type: 'symbol', source: SRC_DISASTERS,
    layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold'], visibility: 'none' },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#0a0a0f', 'text-halo-width': 2 },
  },
];

/** Couche Catastrophes : points GDACS et zones Copernicus EMS (spec 2026-10-12 Copernicus EMS, décision D1). */
export const DISASTER_LAYER_KEYS: Readonly<Record<'disasters', readonly string[]>> = { disasters: [LYR_DISASTERS, LYR_DISASTER_LABEL, ...EMS_LAYER_IDS] };

/** Au-dessus des surfaces, comme les séismes (même ancre que placeEnvBPoints). */
export function placeDisasterPoints(map: { getLayer(id: string): unknown; moveLayer(id: string, before?: string): unknown }): void {
  if (!map.getLayer(LYR_OUT_TELECOM_MAINT)) return;
  for (const l of DISASTER_LAYERS) if (map.getLayer(l.id)) map.moveLayer(l.id, LYR_OUT_TELECOM_MAINT);
}
