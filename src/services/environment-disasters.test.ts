// src/services/environment-disasters.test.ts : garde du contrat /api/environment/disasters et statut du panneau des sources.
import { describe, expect, it } from 'vitest';
import type { DisasterAlert, DisastersResponse, EmsResponse } from '../types/index.ts';
import { disastersStatus, emsStatus, isDisastersResponse, isEmsResponse } from './environment-disasters.ts';
import { servedEms } from './environment-inputs.ts';
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
    const ems = { data: null, error: null, fetchedAt: null };
    expect(disastersStatus({ disasters: slot, ems }, NOW).status).toBe('ok');
    expect(disastersStatus({ disasters: { ...slot, data: { ...body, errors: ['GDACS Guadeloupe : HTTP 500'] } }, ems }, NOW).status).toBe('stale');
  });
});

describe('Copernicus EMS (spec 2026-10-12)', () => {
  const NOW_EMS = Date.parse('2026-10-12T08:00:00Z');
  const ems = (over: Partial<EmsResponse> = {}): EmsResponse => ({
    readAt: '2026-10-12T07:50:00.000Z',
    active: [{
      code: 'EMSR866', category: 'inondation', name: 'Flood in New Aquitaine, France', place: 'New Aquitaine', territory: 'France (Hexagone et Corse)',
      activationTime: '2026-10-11T11:50:00.000Z', eventTime: null, closed: false, gdacsId: null, products: 14,
      url: 'https://mapping.emergency.copernicus.eu/activations/EMSR866', activator: 'COGIC', population: 83890,
      zones: [{ name: 'Cognac', ring: [[0, 0], [1, 0], [1, 1], [0, 0]] }], lon: -0.67, lat: 45.27,
    }],
    recent: [], elsewhere: { count: 2, countries: ['Panama', 'Grèce'] }, errors: [], ...over,
  });
  it('garde de forme', () => {
    expect(isEmsResponse(ems())).toBe(true);
    expect(isEmsResponse({ ...ems(), elsewhere: null })).toBe(false);
    expect(isEmsResponse({ ...ems(), active: [{ code: 'X' }] })).toBe(false);
  });
  it('servi au moteur seulement à jour (60 min)', () => {
    expect(servedEms(ems(), NOW_EMS)).toHaveLength(1);
    expect(servedEms(ems({ readAt: '2026-10-12T06:30:00.000Z' }), NOW_EMS)).toEqual([]);
    expect(servedEms(null, NOW_EMS)).toEqual([]);
  });
  it('panneau des sources : relevé daté, retard au-delà de 60 min', () => {
    const slot = (data: EmsResponse | null, error: string | null = null) => ({ data, error, fetchedAt: NOW_EMS });
    const state = (e: EmsResponse | null) => ({ disasters: { data: null, error: null, fetchedAt: null }, ems: slot(e) });
    expect(emsStatus(state(ems()), NOW_EMS).status).toBe('ok');
    expect(emsStatus(state(ems({ readAt: '2026-10-12T06:30:00.000Z' })), NOW_EMS).status).toBe('stale');
  });
});
