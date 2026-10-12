// src/components/deckgl/environment-map-disasters.test.ts : points de la couche Catastrophes (GDACS) : couleur L1 sur sol français,
// gris hors de France, neutre en retard ; infobulle échappée, sans tiret cadratin ni date ISO.
import { describe, expect, it } from 'vitest';
import type { DisasterAlert, DisastersResponse } from '../../types/index.ts';
import { levelHex } from '../../services/vigilance.ts';
import { DISASTER_ABROAD_HEX, ENV_NEUTRAL_HEX } from '../layer-panel/environment-legend.ts';
import { DISASTER_LAYER_KEYS, disasterFeatures } from './environment-map-disasters.ts';
import { ENV_LAYER_KEYS, ENV_SOURCE_IDS, envTooltipHtml } from './environment-map.ts';
import { LYR_DISASTERS, LYR_DISASTER_LABEL, SRC_DISASTERS } from './constants.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');
const a = (over: Partial<DisasterAlert>): DisasterAlert => ({
  id: 'TC-1', type: 'cyclone', level: 'rouge', name: 'Tropical Cyclone <b>X</b>', countries: ['GLP'], frenchTerritory: 'Guadeloupe',
  lat: 16.2, lon: -61.5, from: '2026-10-10T00:00:00.000Z', to: '2026-10-12T06:00:00.000Z', current: true, severity: 'Hurricane', url: null, ...over,
});
const body = (alerts: DisasterAlert[], readAt = '2026-10-12T07:55:00.000Z'): DisastersResponse => ({ readAt, alerts, errors: [] });

describe('disasterFeatures', () => {
  it('[lng, lat] ; couleur L1 en France, gris ailleurs, neutre en retard ; étiquette sur sol français seulement', () => {
    const fc = disasterFeatures(body([a({}), a({ id: 'EQ-2', level: 'orange', frenchTerritory: null, countries: ['PAN'] })]), NOW);
    expect(fc.features[0]?.geometry.coordinates).toEqual([-61.5, 16.2]);
    expect(fc.features.map((f) => f.properties?.['color'])).toEqual([levelHex('rouge'), DISASTER_ABROAD_HEX]);
    expect(fc.features.map((f) => f.properties?.['label'])).toEqual(['Cyclone', '']);
    const late = disasterFeatures(body([a({})], '2026-10-12T07:00:00.000Z'), NOW);
    expect(late.features[0]?.properties?.['color']).toBe(ENV_NEUTRAL_HEX);
    expect(disasterFeatures(null, NOW).features).toEqual([]);
  });
  it('infobulle : nom échappé, territoire, niveau en mots, aucune date ISO ni tiret cadratin', () => {
    const html = envTooltipHtml(LYR_DISASTERS, disasterFeatures(body([a({})]), NOW).features[0]?.properties ?? {}) ?? '';
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).toContain('Guadeloupe');
    expect(html).toContain('Alerte rouge');
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T|—/);
  });
  it('branchée dans les tables de la carte Environnement', () => {
    expect(ENV_SOURCE_IDS).toContain(SRC_DISASTERS);
    expect(ENV_LAYER_KEYS.disasters).toEqual(DISASTER_LAYER_KEYS.disasters);
    expect(DISASTER_LAYER_KEYS.disasters).toEqual([LYR_DISASTERS, LYR_DISASTER_LABEL]);
  });
});

describe('contexte européen et textes français', () => {
  it('sécheresse centrée hors de France touchant la métropole : grise, sans étiquette ; infobulle traduite', () => {
    const drought = a({
      id: 'DR-1', type: 'secheresse', level: 'orange', frenchTerritory: 'France (Hexagone et Corse)', countries: ['AUT', 'FRA'],
      name: 'Drought in Austria, France', severity: 'Medium impact for agricultural drought in 1759971 km2',
    });
    const [f] = disasterFeatures(body([drought]), NOW).features;
    expect([f?.properties?.['color'], f?.properties?.['label']]).toEqual([DISASTER_ABROAD_HEX, '']);
    const html = envTooltipHtml(LYR_DISASTERS, f?.properties ?? {}) ?? '';
    expect(html).toContain('Sécheresse agricole, impact moyen');
    expect(html).toContain('Contexte européen');
    expect(html).not.toMatch(/Drought|km2/);
  });
});
