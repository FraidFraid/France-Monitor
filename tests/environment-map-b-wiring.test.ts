// tests/environment-map-b-wiring.test.ts
// Branchement de la carte de la phase B : méthodes de DeckGLMap (données posées comme dans les méthodes de la tâche 15) et
// délégations de MapContainer (source lue, comme tests/traffic-map-wiring.test.ts).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const deck = readFileSync(new URL('../src/components/DeckGLMap.ts', import.meta.url), 'utf8');
const container = readFileSync(new URL('../src/components/MapContainer.ts', import.meta.url), 'utf8');
const envMap = readFileSync(new URL('../src/components/deckgl/environment-map.ts', import.meta.url), 'utf8');

describe('carte de la phase B', () => {
  it('environment-map.ts concatène les constantes de la phase B et réexporte ses constructeurs', () => {
    for (const part of ['...ENV_B_SOURCE_IDS', '...ENV_B_FILL_LAYERS', '...ENV_B_POINT_LAYERS', '...ENV_B_HOVERABLE', 'LYR_TIDE_GAUGES',
      "export { airDeptFeatures, droughtDeptFeatures, quakeFeatures, tideGaugeFeatures } from './environment-map-b.ts';"]) expect(envMap).toContain(part);
  });
  it('DeckGLMap : quatre méthodes, départements lus par getDepartmentsGeojson (cache de la tâche 15), données posées comme à la tâche 15 (setData puis infobulle fermée)', () => {
    for (const part of ['async updateDroughtLayer(d: DroughtResponse | null, now: number): Promise<void>', 'droughtDeptFeatures(geo, d, now)',
      'async updateAirQualityLayer(a: AirQualityResponse | null, now: number): Promise<void>', 'airDeptFeatures(geo, a, now)',
      'updateEarthquakesLayer(q: EarthquakesResponse | null, now: number): void', 'quakeFeatures(q, now)',
      'updateSeaLevelsLayer(s: SeaLevelsResponse | null, v: VigilanceResponse | null, now: number): void', 'tideGaugeFeatures(s, v, now)']) {
      expect(deck).toContain(part);
    }
    expect(deck).toContain('(this.map.getSource(SRC_DROUGHT) as maplibregl.GeoJSONSource | undefined)?.setData(geo ? droughtDeptFeatures(geo, d, now) : emptyFC());');
    expect(deck).toContain('(this.map.getSource(SRC_AIR_QUALITY) as maplibregl.GeoJSONSource | undefined)?.setData(geo ? airDeptFeatures(geo, a, now) : emptyFC());');
    expect(deck).not.toContain('setEnvSource(');
  });
  it('MapContainer délègue à la carte WebGL', () => {
    for (const part of ['this.deckMap?.updateDroughtLayer(d, now)', 'this.deckMap?.updateAirQualityLayer(a, now)', 'this.deckMap?.updateEarthquakesLayer(q, now)',
      'this.deckMap?.updateSeaLevelsLayer(s, v, now)']) expect(container).toContain(part);
  });
});
