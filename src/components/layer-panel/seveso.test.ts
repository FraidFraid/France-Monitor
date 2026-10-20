// src/components/layer-panel/seveso.test.ts : pastille « Sites Seveso » de l'onglet Environnement (vue, niveau, carte).
import { describe, expect, it } from 'vitest';
import type { ExposureAsset, ExposureResult, Hazard } from '../../services/environment-exposure.ts';
import { levelHex } from '../../services/vigilance.ts';
import { SEVESO_HAUT_HEX, sevesoFeatures } from '../deckgl/seveso-map.ts';
import { visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { buildSevesoView, sevesoByDept, sevesoExposures, sevesoHeadLevel } from './seveso.ts';

const NOW = Date.parse('2026-10-20T10:00:00Z');
const site = (over: Partial<ExposureAsset>): ExposureAsset => ({
  id: 'seveso-1', kind: 'seveso-haut', name: 'Raffinerie', commune: 'Fos', dept: '13', lon: 4.9, lat: 43.4, detail: 'Seveso seuil haut', url: null, ...over,
});
const hazard = (over: Partial<Hazard>): Hazard => ({
  id: 'h', kind: 'crue', label: 'Crue orange · Vistre', level: 'orange', depts: [], circles: [], lines: [], bufferKm: 2, rings: [],
  kinds: ['nucleaire', 'seveso-haut', 'hopital', 'seveso-bas', 'ehpad'], since: null, ...over,
});
const sites = [site({}), site({ id: 'seveso-2', kind: 'seveso-bas', name: 'Dépôt', dept: '30' }), site({ id: 'seveso-3', name: 'Chimie', dept: '30' })];
const data = { sites, readAt: '2026-10-20T08:51:51.716Z', source: 'Géorisques' };
const view = (exposed: ReturnType<typeof sevesoExposures>) =>
  buildSevesoView({ data, error: null, exposed, canFocus: true, now: NOW, open: (_id, byDefault) => byDefault });

describe('Sites Seveso', () => {
  it('exposés : proches d’un phénomène, plus les seuils hauts d’un département en vigilance orange ou rouge', () => {
    const result: ExposureResult = {
      hazards: [],
      nearby: [{ asset: sites[1], hazard: hazard({}), distanceKm: 1.2 }],
      departmental: [{ hazard: hazard({ id: 'v', kind: 'vigilance', label: 'Vigilance rouge pluie-inondation', level: 'rouge', depts: ['30'] }), dept: '30', counts: {}, named: [] }],
    };
    const ex = sevesoExposures(result, sites);
    expect(ex?.map((e) => [e.asset.id, e.distanceKm])).toEqual([['seveso-3', null], ['seveso-2', 1.2]]);
    expect(sevesoExposures(null, sites)).toBeNull();
  });
  it('niveau : phénomène le plus grave touchant un site ; seuil bas un cran plus bas ; rien d’exposé : vert ; sans données : n.d.', () => {
    expect(sevesoHeadLevel(data, [{ asset: sites[1], hazard: hazard({ level: 'rouge' }), distanceKm: 0 }])).toBe('orange');
    expect(sevesoHeadLevel(data, [{ asset: sites[0], hazard: hazard({ level: 'rouge' }), distanceKm: 0 }])).toBe('rouge');
    expect(sevesoHeadLevel(data, [])).toBe('vert');
    expect(sevesoHeadLevel(null, [])).toBe('nd');
    expect(sevesoHeadLevel(data, null)).toBe('nd');
  });
  it('vue : exposés d’abord (cliquables), répartition par département, jamais vide', () => {
    const ex = [{ asset: sites[0], hazard: hazard({}), distanceKm: 1.2 }];
    const v = view(ex);
    expect(v.head.figure).toMatchObject({ value: '1', level: 'orange' });
    const html = renderLayerView('seveso', v);
    expect(html).toContain('data-lon="4.9"');
    expect(visibleText(html)).toContain('à 1,2\u00a0km');
    expect(visibleText(renderLayerView('seveso', view([])))).toContain('Aucun site Seveso à portée d’un phénomène en cours');
    expect(sevesoByDept(sites).map((r) => r.dept)).toEqual(['30', '13']);
    expect(html).not.toContain('\u2014');
  });
  it('carte : couleur par seuil, anneau de la couleur du phénomène pour un site exposé', () => {
    const fc = sevesoFeatures(sites, [{ asset: sites[0], hazard: hazard({ level: 'rouge' }), distanceKm: 0 }]);
    expect(fc.features).toHaveLength(3);
    expect(fc.features[0].properties).toMatchObject({ fill: SEVESO_HAUT_HEX, ring: levelHex('rouge'), exposed: 1 });
    expect(fc.features[1].properties?.['exposed']).toBe(0);
  });
});
