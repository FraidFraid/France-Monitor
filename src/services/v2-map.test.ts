import { describe, it, expect } from 'vitest';
import { eventMapPoints, sourcesRadius, v2FloodSegments } from './v2-map.ts';
import type { FloodSegment, NewsEvent } from '../types/index.ts';

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  const id = over.id ?? 1;
  return {
    id, evidenceId: `E${id}`, title: 'Grève dans les transports lyonnais', category: 'social', severity: 'medium',
    status: 'active', firstSeen: '2026-09-29T06:00:00Z', lastSeen: '2026-09-29T07:00:00Z', articleCount: 4,
    sourceCount: 4, independentCount: 3, sourceNames: [], lat: 45.76, lon: 4.84, zone: 'france', ...over,
  };
}

describe('eventMapPoints (spec 2026-09-29 § 5)', () => {
  it('un point par événement de la liste : couleur du niveau, taille selon les sources', () => {
    const [p] = eventMapPoints([event()], 'general');
    expect(p).toMatchObject({ id: 1, level: 'jaune', radius: 8, hollow: false, lon: 4.84, lat: 45.76 });
    expect(p.color).toEqual([255, 204, 0]);
  });

  it('ni sans coordonnées, ni à l’étranger, ni clos, ni hors de la liste', () => {
    expect(eventMapPoints([
      event({ id: 2, lat: null, lon: null }),
      event({ id: 3, zone: 'etranger' }),
      event({ id: 4, status: 'closed' }),
      event({ id: 5, independentCount: 1 }), // jaune d'une seule source : hors de la liste
      event({ id: 6, severity: 'low' }),
    ], 'general')).toEqual([]);
  });

  it('« à confirmer » : anneau vide', () => {
    const [p] = eventMapPoints([event({ severity: 'medium', peakSeverity: 'high', independentCount: 1 })], 'general');
    expect(p.hollow).toBe(true);
  });

  it('filtré par le thème choisi', () => {
    expect(eventMapPoints([event({ category: 'energy' })], 'security')).toEqual([]);
    expect(eventMapPoints([event({ category: 'energy' })], 'energy')).toHaveLength(1);
  });

  it('trois tailles : 1 source, 2 à 4, 5 et plus', () => {
    expect([1, 2, 4, 5, 12].map(sourcesRadius)).toEqual([5, 8, 8, 12, 12]);
  });
});

describe('v2FloodSegments', () => {
  const line = { type: 'LineString' as const, coordinates: [] };
  const flood = (name: string, level: FloodSegment['level']): FloodSegment => ({
    id: name, name, level, dataSource: 'live', geometryFidelity: 'raw', matchConfidence: 1,
    rawVertexCount: 0, displayVertexCount: 0, geometry: line, rawGeometry: line, displayGeometry: line,
  });

  it('ne garde que les tronçons orange et rouges', () => {
    const kept = v2FloodSegments([flood('a', 'green'), flood('b', 'yellow'), flood('c', 'orange'), flood('d', 'red')]);
    expect(kept.map((s) => s.name)).toEqual(['c', 'd']);
  });
});
