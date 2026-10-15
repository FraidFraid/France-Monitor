import { describe, expect, it } from 'vitest';
import { buildEolienLayerFeatureCollection } from './mapbox-eolien-layer.ts';
import type { EolienParkSummary } from './types.ts';

const park = (status: EolienParkSummary['status']): EolienParkSummary => ({
  id: status, groupId: status, name: status, status, kind: 'onshore', sourceType: 'turbine', coordinates: [2, 47],
  capacityMw: 2, turbineCount: 1, commissioningYear: null, operator: null, commune: null, department: null, region: null,
  estimatedProductionMw: null,
});

describe('éoliennes sur les états de l’énergie', () => {
  it('démantelée = hors service (gris), en service = sans état suivi (gris clair), jamais de rouge', () => {
    const fc = buildEolienLayerFeatureCollection(null, [park('inactive'), park('operating')]);
    expect(fc.features[0].properties).toMatchObject({ energyState: 'maintenance', color: '#6e6e80' });
    expect(fc.features[1].properties).toMatchObject({ energyState: 'nonSuivi', color: '#c7c7cc' });
  });
});
