// src/services/asnr-events.test.ts
// Service client ASNR (spec 2026-10-13) : garde de forme, statut du panneau des sources (retard au-delà de 3 h), âge en jours.
import { describe, expect, it } from 'vitest';
import type { AsnrResponse } from '../types/index.ts';
import { asnrAgeDays, asnrEventsOf, asnrStatus, isAsnrResponse } from './asnr-events.ts';

const NOW = Date.parse('2026-10-13T08:00:00Z');
const EVENT = { id: 'asnr-a', url: 'https://www.asnr.fr/actualites/a', title: 'Incident à la centrale nucléaire de Golfech', date: '2026-10-10', kind: 'installation', ines: 1, plantId: 'nuc-golfech', site: 'Golfech' };
const RESPONSE: AsnrResponse = { readAt: '2026-10-13T07:30:00.000Z', events: [EVENT as AsnrResponse['events'][number]], errors: [] };

describe('isAsnrResponse', () => {
  it('accepte la réponse de la route, refuse un groupe inconnu ou un INES non entier', () => {
    expect(isAsnrResponse(RESPONSE)).toBe(true);
    expect(isAsnrResponse({ ...RESPONSE, events: [{ ...EVENT, kind: 'autre' }] })).toBe(false);
    expect(isAsnrResponse({ ...RESPONSE, events: [{ ...EVENT, ines: 1.5 }] })).toBe(false);
  });
});

describe('asnrStatus', () => {
  it('ok à l’heure ; en retard après 3 h ; erreur sans donnée', () => {
    expect(asnrStatus({ data: RESPONSE, error: null, fetchedAt: NOW }, NOW).status).toBe('ok');
    expect(asnrStatus({ data: RESPONSE, error: null, fetchedAt: NOW }, NOW + 4 * 3_600_000).status).toBe('stale');
    expect(asnrStatus({ data: null, error: 'HTTP 502', fetchedAt: null }, NOW).status).toBe('error');
  });
});

describe('asnrEventsOf et asnrAgeDays', () => {
  it('journal servi même en retard ; âge en jours depuis minuit UTC du jour publié', () => {
    expect(asnrEventsOf(RESPONSE)).toHaveLength(1);
    expect(asnrEventsOf(null)).toEqual([]);
    expect(asnrAgeDays('2026-10-10', NOW)).toBeCloseTo(3.33, 1);
  });
});
