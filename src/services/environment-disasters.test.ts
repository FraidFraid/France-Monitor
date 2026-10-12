// src/services/environment-disasters.test.ts : garde du contrat /api/environment/disasters et statut du panneau des sources.
import { describe, expect, it } from 'vitest';
import type { DisasterAlert, DisastersResponse } from '../types/index.ts';
import { disastersStatus, isDisastersResponse } from './environment-disasters.ts';
import { isEnvironmentDataLate } from './environment-levels.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');
const alert: DisasterAlert = {
  id: 'TC-1', type: 'cyclone', level: 'rouge', name: 'Tropical Cyclone TEST-26', countries: ['GLP'], frenchTerritory: 'Guadeloupe',
  lat: 16.2, lon: -61.5, from: '2026-10-10T00:00:00.000Z', to: '2026-10-12T06:00:00.000Z', current: true, severity: null, url: null,
};
const body: DisastersResponse = { readAt: '2026-10-12T07:55:00.000Z', alerts: [alert], errors: [] };

describe('isDisastersResponse', () => {
  it('accepte le contrat ; rejette type, niveau ou coordonnée hors contrat', () => {
    expect(isDisastersResponse(body)).toBe(true);
    expect(isDisastersResponse({ ...body, alerts: [{ ...alert, type: 'tsunami' }] })).toBe(false);
    expect(isDisastersResponse({ ...body, alerts: [{ ...alert, level: 'Red' }] })).toBe(false);
    expect(isDisastersResponse({ ...body, alerts: [{ ...alert, lat: '16' }] })).toBe(false);
    expect(isDisastersResponse({ ...body, errors: null })).toBe(false);
  });
});

describe('retard et statut', () => {
  it('GDACS en retard au-delà de 30 min', () => {
    expect(isEnvironmentDataLate('gdacs', '2026-10-12T07:31:00.000Z', NOW)).toBe(false);
    expect(isEnvironmentDataLate('gdacs', '2026-10-12T07:29:00.000Z', NOW)).toBe(true);
  });
  it('statut : ok à jour ; dégradé avec une panne nommée', () => {
    const slot = { data: body, error: null, fetchedAt: NOW };
    expect(disastersStatus({ disasters: slot }, NOW).status).toBe('ok');
    expect(disastersStatus({ disasters: { ...slot, data: { ...body, errors: ['GDACS Guadeloupe : HTTP 500'] } } }, NOW).status).toBe('stale');
  });
});
