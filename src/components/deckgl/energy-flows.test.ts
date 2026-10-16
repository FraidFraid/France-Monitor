// src/components/deckgl/energy-flows.test.ts
import { describe, expect, it } from 'vitest';
import { buildFlowFeatures, flowArcFromFeature, formatFlowValue, kmBetween, stubFromBorder, type FlowArc } from './energy-flows.ts';

const line = (coords: [number, number][]): [number, number][] => coords;
const arc = (over: Partial<FlowArc>): FlowArc => ({
  kind: 'elec', coordinates: line([[8, 50], [6, 49], [4, 48], [2.5, 46.5]]), isImport: true, country: 'Allemagne', name: '',
  hubName: '', flowValue: 2878, flowUnit: 'MW', lineWidth: 4, ...over,
});

describe('flèches d’échange', () => {
  it('valeur au format français, unité insécable, n.d. si absente', () => {
    expect(formatFlowValue(2878, 'MW')).toBe(`${(2878).toLocaleString('fr-FR')} MW`);
    expect(formatFlowValue(null, 'MW')).toBe('n.d.');
  });
  it('segment de 110 km depuis la frontière, orienté import vers l’intérieur, export vers la frontière', () => {
    const c: [number, number][] = [[8, 50], [7.5, 49.75], [7, 49.5], [6, 49], [2.5, 46.5]];
    const imp = stubFromBorder(c, true);
    expect(imp[0]).toEqual([8, 50]);
    let km = 0; for (let i = 1; i < imp.length; i += 1) km += kmBetween(imp[i - 1], imp[i]);
    expect(km).toBeGreaterThanOrEqual(110);
    expect(km).toBeLessThan(200);
    const exp = stubFromBorder([...c].reverse(), false);
    expect(exp.at(-1)).toEqual([8, 50]);
  });
  it('chaque pays garde sa propre valeur ; étiquette côté étranger', () => {
    const fc = buildFlowFeatures([arc({}), arc({ country: 'Suisse', flowValue: 1529, isImport: false, coordinates: [[2.5, 46.5], [5, 46.5], [7.5, 46.8]] })]);
    const texts = fc.labels.features.map((f) => String(f.properties?.text));
    expect(texts[0]).toContain('Allemagne · électricité');
    expect(texts[0]).toContain('import');
    expect(texts[1]).toContain('Suisse');
    expect(texts[1]).toContain('export');
    expect(texts[0]).not.toEqual(texts[1].replace('Suisse', 'Allemagne'));
    expect(fc.labels.features[0].geometry).toEqual({ type: 'Point', coordinates: [8, 50] });
    expect(fc.labels.features[1].geometry).toEqual({ type: 'Point', coordinates: [7.5, 46.8] });
  });
  it('import de pétrole : route maritime jusqu’au port, épaisseur selon le volume, détroits traversés', () => {
    const fc = buildFlowFeatures([arc({ kind: 'petrole', country: '', name: 'Moyen-Orient', hubName: 'Fos / Lavera', flowValue: 93, flowUnit: 'kb/j',
      coordinates: [[40, 27.5], [20, 40], [4.94, 43.43]] })]);
    const l = fc.lines.features[0];
    expect(l.properties?.w).toBeCloseTo(2 + 93 / 40);
    const coords = (l.geometry as GeoJSON.LineString).coordinates;
    expect(coords[0]).toEqual([50.2, 26.6]);
    expect(coords.at(-1)).toEqual([4.94, 43.43]);
    expect(String(fc.labels.features[0].properties?.text)).toContain('vers Fos / Lavera');
    expect(fc.chokes.features.map((f) => f.properties?.name)).toEqual(['Ormuz', 'Bab-el-Mandeb', 'Suez']);
    expect(JSON.parse(String(fc.chokes.features[0].properties?.flows))).toEqual([{ who: 'Moyen-Orient', value: 93, unit: 'kb/j' }]);
  });
  it('épaisseur du pétrole bornée à 10 ; sans valeur, épaisseur des arcs de l’app', () => {
    const big = buildFlowFeatures([arc({ kind: 'petrole', name: 'Afrique', flowValue: 5000, flowUnit: 'kb/j', coordinates: [[2, 17], [4.94, 43.43]] })]);
    expect(big.lines.features[0].properties?.w).toBe(10);
    const none = buildFlowFeatures([arc({ flowValue: null, lineWidth: 10 })]);
    expect(none.lines.features[0].properties?.w).toBe(9);
  });
  it('pointe à l’extrémité du trait, dans le sens du flux', () => {
    const fc = buildFlowFeatures([arc({})]);
    const tip = (fc.lines.features[0].geometry as GeoJSON.LineString).coordinates.at(-1);
    expect((fc.heads.features[0].geometry as GeoJSON.Point).coordinates).toEqual(tip);
  });
  it('lit un arc GeoJSON de l’app', () => {
    const f: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] },
      properties: { isImport: 'true', country: 'Espagne', flowValue: 661, flowUnit: 'MW', lineWidth: 3 } };
    expect(flowArcFromFeature('elec', f)).toMatchObject({ isImport: true, country: 'Espagne', flowValue: 661, name: '', hubName: '' });
    expect(flowArcFromFeature('elec', { ...f, geometry: { type: 'Point', coordinates: [1, 2] } })).toBeNull();
  });
});
