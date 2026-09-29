import { describe, it, expect } from 'vitest';
import { weatherRadarSummary } from './weather-radar.ts';
import { freshnessOf } from './freshness.ts';

// 19:40 heure de Paris (CEST = UTC+2) le 29/09/2026.
const FRAME_AT = Date.parse('2026-09-29T17:40:00Z');
const MIN = 60_000;

describe('weatherRadarSummary', () => {
  it('trame observée : date, heure de Paris, nature « observation »', () => {
    const s = weatherRadarSummary({ time: FRAME_AT, kind: 'past' }, 'ready', FRAME_AT + 5 * MIN, 'fr');
    expect(s.state).toBe('ready');
    expect(s.imageLabel).toBe('Image du 29/09 à 19:40');
    expect(s.natureLabel).toBe('observation');
    expect(s.stale).toBe(false);
    expect(s.staleLabel).toBeNull();
  });

  it('trame de prévision : nature « prévision à court terme »', () => {
    const s = weatherRadarSummary({ time: FRAME_AT, kind: 'nowcast' }, 'ready', FRAME_AT - 10 * MIN, 'fr');
    expect(s.natureLabel).toBe('prévision à court terme');
    expect(s.stale).toBe(false);
  });

  it('image de plus de 30 min : périmée, avec « données du jj/mm à hh:mm »', () => {
    const s = weatherRadarSummary({ time: FRAME_AT, kind: 'past' }, 'ready', FRAME_AT + 31 * MIN, 'fr');
    expect(s.stale).toBe(true);
    expect(s.staleLabel).toBe('données du 29/09 à 19:40');
    const ok = weatherRadarSummary({ time: FRAME_AT, kind: 'past' }, 'ready', FRAME_AT + 30 * MIN, 'fr');
    expect(ok.stale).toBe(false);
  });

  it('aucune trame : chargement, jamais « indisponible »', () => {
    const s = weatherRadarSummary(null, 'loading', FRAME_AT, 'fr');
    expect(s.state).toBe('loading');
    expect(s.message).toBe('Chargement de l’image radar…');
    expect(s.imageLabel).toBeNull();
  });

  it('échec réel du chargement : indisponible', () => {
    const s = weatherRadarSummary(null, 'error', FRAME_AT, 'fr');
    expect(s.state).toBe('error');
    expect(s.message).toBe('Image radar indisponible pour le moment');
  });

  it('une trame déjà chargée reste affichée même si un rafraîchissement échoue', () => {
    const s = weatherRadarSummary({ time: FRAME_AT, kind: 'past' }, 'error', FRAME_AT + MIN, 'fr');
    expect(s.state).toBe('ready');
  });

  it('la source weatherRadar de la fraîcheur vaut 30 min', () => {
    expect(freshnessOf(FRAME_AT, 'weatherRadar', FRAME_AT + 30 * MIN)).toBe('fresh');
    expect(freshnessOf(FRAME_AT, 'weatherRadar', FRAME_AT + 30 * MIN + 1)).toBe('stale');
  });
});
