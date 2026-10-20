// src/components/layer-panel/crues-impact.test.ts : section « Conséquences des crues » du panneau Crues.
import { describe, expect, it } from 'vitest';
import type { ExposureAsset, Hazard } from '../../services/environment-exposure.ts';
import { visibleText } from './format.ts';
import { impactSection, sortImpacts, type SectionImpact } from './crues-impact.ts';

const hazard: Hazard = {
  id: 'crue-MO1', kind: 'crue', label: 'Crue orange · Vistre', level: 'orange', depts: [], circles: [], lines: [], bufferKm: 2, rings: [],
  kinds: ['ehpad'], since: null,
};
const asset: ExposureAsset = { id: 'e1', kind: 'ehpad', name: 'EHPAD Les Saules', commune: 'Nîmes', dept: '30', lon: 4.3, lat: 43.8, detail: null, url: null };
const impact = (over: Partial<SectionImpact>): SectionImpact => ({
  sectionId: 'MO1', name: 'Vistre', level: 'orange', zone: 'cartographiee', zoneCount: 12,
  population: { communes: [{ code: '30189', name: 'Nîmes', dept: '30', pop: 148_000, lon: 4.36, lat: 43.84 }], total: 148_000, method: 'zone-inondable' },
  people: { total: 12_345, over80: 912, communes: [{ name: 'Nîmes', dept: '30', people: 12_345, pop: 148_000 }] },
  exposures: [{ asset, hazard, distanceKm: 0.4, inFloodZone: true }], excluded: [], ...over,
});

describe('Conséquences des crues', () => {
  it('par tronçon : zone inondable, population, communes, enjeux en zone, interrupteur allumé', () => {
    const s = impactSection({ impacts: [impact({})], zonesOn: true, canFocus: true }, true);
    const text = visibleText(s.html);
    expect(text).toContain('cartographiée (12 zones)');
    expect(text).toMatch(/1.EHPAD\./);
    expect(text).toMatch(/≈.12.300.habitants en zone inondable/);
    expect(text).toMatch(/dont 80 ans et plus\s*≈.910/);
    expect(text).toMatch(/148.000.hab\. dans la commune/);
    expect(text).toContain('carreaux Insee de 200');
    expect(text).toContain('EHPAD Les Saules');
    expect(text).toContain('en zone inondable');
    expect(text).toContain('jamais un nombre de sinistrés');
    expect(s.html).toContain('data-flood-zones aria-pressed="true"');
    expect(s.html).toContain('data-lon="4.3"');
    expect(s.html).not.toContain('—');
  });
  it('interrupteur éteint : rien lu, repli sur la distance, dit dans le panneau', () => {
    const s = impactSection({ impacts: [impact({ zone: 'off', zoneCount: 0, people: null, exposures: [] })], zonesOn: false, canFocus: false }, true);
    const text = visibleText(s.html);
    expect(text).toContain('1 commune touchée');
    expect(text).toMatch(/148.000.hab\. au total/);
    expect(text).toContain('pas des habitants exposés');
    expect(text).not.toContain('habitants en zone inondable');
    expect(text).toContain('Afficher les zones inondables officielles');
    expect(text).toContain('Zones inondables masquées (interrupteur éteint)');
    expect(text).toContain('à moins de 2 km du tronçon');
    expect(text).toContain('aucun recensé');
  });
  it('enjeux écartés par la zone officielle : nommés', () => {
    const far: ExposureAsset = { ...asset, id: 'e2', kind: 'seveso-bas', name: 'Distillerie', commune: 'Vauvert' };
    const text = visibleText(impactSection({ impacts: [impact({ excluded: [{ asset: far, hazard, distanceKm: 1.9 }] })], zonesOn: true, canFocus: false }, true).html);
    expect(text).toMatch(/Écarté par la zone officielle.*Distillerie \(site Seveso seuil bas, Vauvert\)/);
  });
  it('enjeux pas encore lus : chargement ; aucun tronçon : ligne vide ; tri niveau puis habitants', () => {
    expect(impactSection({ impacts: null, zonesOn: true, canFocus: false }, true).summary).toBe('…');
    expect(impactSection({ impacts: [], zonesOn: true, canFocus: false }, true).summary).toBe('aucune');
    const sorted = sortImpacts([impact({ name: 'A', level: 'jaune' }), impact({ name: 'B' }), impact({ name: 'C', population: null, people: null })]);
    expect(sorted.map((x) => x.name)).toEqual(['B', 'C', 'A']);
  });
});
