// tests/ingest-published-at.test.ts : date de publication d'un article à l'ingestion (22/10/2026). Un flux qui date un article dans le
// futur (Nice Matin en 2034, Le Télégramme au 25/10) le gardait en tête de toutes les listes triées par date.
import { describe, expect, it } from 'vitest';
import { parsePublishedAt } from '../api/ingest/news.ts';

const NOW = Date.parse('2026-10-22T13:00:00Z');

describe('parsePublishedAt', () => {
  it('date lisible du passé : gardée', () => {
    expect(parsePublishedAt('Thu, 22 Oct 2026 12:57:00 GMT', NOW)).toBe('2026-10-22T12:57:00.000Z');
  });
  it('date future (au-delà d’une heure) : heure de la collecte', () => {
    expect(parsePublishedAt('Mon, 14 Aug 2034 09:00:00 GMT', NOW)).toBe('2026-10-22T13:00:00.000Z');
    expect(parsePublishedAt('2026-10-25T12:00:00Z', NOW)).toBe('2026-10-22T13:00:00.000Z');
  });
  it('léger décalage d’horloge (moins d’une heure) : gardé', () => {
    expect(parsePublishedAt('2026-10-22T13:20:00Z', NOW)).toBe('2026-10-22T13:20:00.000Z');
  });
  it('absente ou illisible : null', () => {
    expect(parsePublishedAt(undefined, NOW)).toBeNull();
    expect(parsePublishedAt('demain', NOW)).toBeNull();
  });
});
