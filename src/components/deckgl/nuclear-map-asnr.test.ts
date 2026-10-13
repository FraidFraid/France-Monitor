// src/components/deckgl/nuclear-map-asnr.test.ts
// Anneaux ASNR (spec 2026-10-13) : sur une centrale connue seulement ; orange de moins de 7 jours, gris jusqu'à 30 jours, rien au-delà ;
// un anneau par centrale (le plus récent l'emporte).
import { describe, expect, it } from 'vitest';
import type { AsnrEvent, AsnrResponse } from '../../types/index.ts';
import { ASNR_RING_LAYER, asnrRingFeatures } from './nuclear-map-asnr.ts';

const NOW = Date.parse('2026-10-13T08:00:00Z');
const ev = (over: Partial<AsnrEvent>): AsnrEvent => ({
  id: 'a', url: 'u', title: 't', date: '2026-10-12', kind: 'installation', ines: 1, plantId: 'nuc-chooz', site: 'Chooz', ...over,
});
const resp = (events: AsnrEvent[]): AsnrResponse => ({ readAt: '2026-10-13T07:30:00.000Z', events, errors: [] });

describe('asnrRingFeatures', () => {
  it('centrale connue : point aux coordonnées de NUCLEAR_PLANTS, couleur selon l’âge', () => {
    const fc = asnrRingFeatures(resp([ev({}), ev({ id: 'b', plantId: 'nuc-cruas', site: 'Cruas-Meysse', date: '2026-09-25' })]), NOW);
    expect(fc.features.map((f) => [f.properties?.['plantId'], f.properties?.['tone']])).toEqual([['nuc-chooz', 'recent'], ['nuc-cruas', 'old']]);
    expect(fc.features[0]?.geometry.coordinates).toEqual([4.7991, 50.0908]);
  });
  it('sans centrale, plus de 30 jours ou réponse absente : aucun anneau', () => {
    expect(asnrRingFeatures(resp([ev({ plantId: null, site: null }), ev({ id: 'c', date: '2026-08-01' })]), NOW).features).toEqual([]);
    expect(asnrRingFeatures(null, NOW).features).toEqual([]);
  });
  it('deux avis sur une centrale : un seul anneau, le plus récent', () => {
    const fc = asnrRingFeatures(resp([ev({ date: '2026-09-20' }), ev({ id: 'b', date: '2026-10-12' })]), NOW);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.properties?.['tone']).toBe('recent');
  });
  it('couche cercle masquée par défaut', () => {
    expect(ASNR_RING_LAYER).toMatchObject({ type: 'circle', layout: { visibility: 'none' } });
  });
});
