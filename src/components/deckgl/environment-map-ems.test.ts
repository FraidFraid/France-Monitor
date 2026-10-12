// src/components/deckgl/environment-map-ems.test.ts : zones Copernicus EMS sur la carte (spec 2026-10-12) : polygones des activations
// françaises en cours, étiquette du code, infobulle échappée ; relevé en retard ou absent : rien.
import { describe, expect, it } from 'vitest';
import type { EmsResponse } from '../../types/index.ts';
import { EMS_LAYERS, emsZoneFeatures } from './environment-map-ems.ts';
import { LYR_EMS_ZONE_FILL, LYR_EMS_ZONE_LABEL, LYR_EMS_ZONE_LINE, SRC_EMS_ZONES } from './constants.ts';
import { ENV_LAYER_KEYS, ENV_SOURCE_IDS, envTooltipHtml } from './environment-map.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');
const RING: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 0]];
const ems = (over: Partial<EmsResponse> = {}): EmsResponse => ({
  readAt: '2026-10-12T07:55:00.000Z',
  active: [{
    code: 'EMSR866', category: 'inondation', name: 'Flood in <New Aquitaine>', place: 'New Aquitaine', territory: 'France (Hexagone et Corse)',
    activationTime: '2026-10-11T11:50:00.000Z', eventTime: null, closed: false, gdacsId: null, products: 14,
    url: 'https://mapping.emergency.copernicus.eu/activations/EMSR866', activator: 'COGIC', population: 83890,
    zones: [{ name: 'Cognac', ring: RING }, { name: 'Saintes', ring: RING }], lon: -0.67, lat: 45.27,
  }],
  recent: [], elsewhere: { count: 0, countries: [] }, errors: [], ...over,
});

describe('emsZoneFeatures', () => {
  it('un polygone par zone, étiquette du code, infobulle échappée', () => {
    const fc = emsZoneFeatures(ems(), NOW);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]?.geometry.coordinates).toEqual([RING]);
    expect(fc.features[0]?.properties).toMatchObject({ label: 'EMSR866' });
    const html = envTooltipHtml(LYR_EMS_ZONE_FILL, fc.features[0]?.properties ?? {}) ?? '';
    expect(html).toContain('Inondation');
    expect(html).toContain('Cognac');
    expect(html).not.toContain('<New Aquitaine>');
  });
  it('relevé en retard (plus de 60 min) ou absent : aucune zone', () => {
    expect(emsZoneFeatures(ems({ readAt: '2026-10-12T06:30:00.000Z' }), NOW).features).toEqual([]);
    expect(emsZoneFeatures(null, NOW).features).toEqual([]);
  });
  it('couches enregistrées sous la clé Catastrophes, contour pointillé violet', () => {
    expect(ENV_SOURCE_IDS).toContain(SRC_EMS_ZONES);
    expect(ENV_LAYER_KEYS.disasters).toEqual(expect.arrayContaining([LYR_EMS_ZONE_FILL, LYR_EMS_ZONE_LINE, LYR_EMS_ZONE_LABEL]));
    const line = EMS_LAYERS.find((l) => l.id === LYR_EMS_ZONE_LINE);
    expect(line?.type).toBe('line');
    expect(JSON.stringify(line)).toContain('line-dasharray');
    expect(JSON.stringify(line)).toContain('#a78bfa');
  });
});
