// src/services/protests.test.ts : garde du contrat /api/social/protests (spec 2026-10-17 manifestations).
import { describe, expect, it } from 'vitest';
import type { ProtestItem, ProtestsResponse } from '../types/index.ts';
import { PROTESTS_URL, isProtestsLate, isProtestsResponse } from './protests.ts';

const item = (over: Partial<ProtestItem> = {}): ProtestItem => ({
  id: 'demosphere:1', source: 'demosphere', status: 'annonce', title: 'Manifestation pour les retraites', startsAt: '2026-10-17T13:00:00.000Z',
  allDay: false, city: 'Toulouse', dept: '31', lat: 43.6, lon: 1.44, url: 'https://demosphere.net/rv/1', edition: 'Toulouse', violent: false, articles: [], ...over,
});
const gdelt = (over: Partial<ProtestItem> = {}): ProtestItem => item({
  id: 'gdelt:paris', source: 'gdelt', status: 'signale', title: 'Manifestation', city: 'Paris', dept: null, lat: null, lon: null, edition: null, violent: true,
  articles: [{ url: 'https://exemple.fr/a', domain: 'exemple.fr', seenAt: '2026-10-17T09:00:00.000Z', violent: true }], ...over,
});
const body = (items: ProtestItem[] = [item(), gdelt()]): ProtestsResponse => ({
  readAt: '2026-10-17T09:05:00.000Z', items,
  demosphere: { readAt: '2026-10-17T09:05:00.000Z', editions: 19, failedEditions: [], scanned: 120 },
  gdelt: { readAt: '2026-10-17T09:00:00.000Z', files: 96, missingFiles: 0 }, errors: [],
});

describe('isProtestsResponse', () => {
  it('accepte une réponse valide, y compris sans aucun item', () => {
    expect(isProtestsResponse(body())).toBe(true);
    expect(isProtestsResponse(body([]))).toBe(true);
  });
  it('rejette les charges mal formées', () => {
    expect(isProtestsResponse(null)).toBe(false);
    expect(isProtestsResponse({})).toBe(false);
    expect(isProtestsResponse({ ...body(), items: 'x' })).toBe(false);
    expect(isProtestsResponse({ ...body(), errors: null })).toBe(false);
    expect(isProtestsResponse({ ...body(), gdelt: { readAt: null } })).toBe(false);
    expect(isProtestsResponse({ ...body(), demosphere: null })).toBe(false);
  });
  it('rejette un item hors contrat : statut, source, coordonnée, articles', () => {
    expect(isProtestsResponse(body([item({ status: 'confirme' as never })]))).toBe(false);
    expect(isProtestsResponse(body([item({ source: 'x' as never })]))).toBe(false);
    expect(isProtestsResponse(body([item({ lat: '43' as never })]))).toBe(false);
    expect(isProtestsResponse(body([item({ lat: 43.6, lon: null })]))).toBe(false);
    expect(isProtestsResponse(body([item({ articles: [{ url: 1 } as never] })]))).toBe(false);
    expect(isProtestsResponse(body([item({ title: undefined as never })]))).toBe(false);
  });
});

describe('contrat et retard', () => {
  it('lit uniquement la route du serveur, jamais Démosphère ni GDELT', () => {
    expect(PROTESTS_URL).toBe('/api/social/protests');
  });
  it('relevé en retard au-delà de 30 min ou illisible', () => {
    const now = Date.parse('2026-10-17T10:00:00Z');
    expect(isProtestsLate('2026-10-17T09:40:00Z', now)).toBe(false);
    expect(isProtestsLate('2026-10-17T09:20:00Z', now)).toBe(true);
    expect(isProtestsLate(null, now)).toBe(true);
  });
});
