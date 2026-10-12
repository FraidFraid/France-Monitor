// src/services/financial-stability.test.ts : garde de forme de /api/finance/stability et états du panneau des sources (« BCE »,
// « Écart OAT-Bund ») ; une réponse où tout est « unavailable » reste lisible.
import { describe, expect, it } from 'vitest';
import type { FinancialStabilityResponse } from '../types/index.ts';
import { bceStatus, isFinancialStabilityResponse, spreadStatus, type FinancialStabilitySlot } from './financial-stability.ts';

const OK: FinancialStabilityResponse = {
  readAt: '2026-10-12T08:00:00.000Z',
  series: [{ id: 'cissFr', value: 0.05, date: '2026-10-09', history: [{ date: '2026-10-09', value: 0.05 }], status: 'ok', error: null }],
  rates: [{ id: 'depot', value: 2.5, since: '2026-09-16', previous: 2.25, status: 'ok', error: null }],
  spread: { value: 1.43, fr10y: 4.9, de10y: 3.47, readAt: '2026-10-12T08:00:00.000Z', history: [], status: 'ok', error: null },
  errors: [],
};
const slot = (data: FinancialStabilityResponse | null, error: string | null = null): FinancialStabilitySlot => ({ data, error, fetchedAt: 1 });

describe('garde', () => {
  it('réponse complète acceptée ; forme fausse refusée', () => {
    expect(isFinancialStabilityResponse(OK)).toBe(true);
    expect(isFinancialStabilityResponse({ ...OK, series: [{ id: 'autre' }] })).toBe(false);
    expect(isFinancialStabilityResponse({ ...OK, spread: null })).toBe(false);
  });
  it('tout « unavailable » : toujours une réponse valide', () => {
    const empty: FinancialStabilityResponse = {
      ...OK,
      series: [{ id: 'cissFr', value: null, date: null, history: [], status: 'unavailable', error: 'BCE CISS France : HTTP 503' }],
      rates: [{ id: 'depot', value: null, since: null, previous: null, status: 'unavailable', error: 'x' }],
      spread: { value: null, fr10y: null, de10y: null, readAt: null, history: [], status: 'unavailable', error: 'y' },
    };
    expect(isFinancialStabilityResponse(empty)).toBe(true);
  });
});

describe('panneau des sources', () => {
  it('tout à jour : « ok » daté du relevé', () => {
    expect(bceStatus(slot(OK))).toEqual({ status: 'ok', lastUpdate: new Date('2026-10-12T08:00:00.000Z'), error: undefined });
    expect(spreadStatus(slot(OK))).toEqual({ status: 'ok', lastUpdate: new Date('2026-10-12T08:00:00.000Z'), error: undefined });
  });
  it('une série en retard : « stale » avec la cause', () => {
    const late = { ...OK, series: [{ ...OK.series[0]!, status: 'stale' as const, error: 'BCE CISS France : dernière valeur au 06/10' }] };
    expect(bceStatus(slot(late))).toMatchObject({ status: 'stale', error: 'BCE CISS France : dernière valeur au 06/10' });
  });
  it('toutes les parties BCE absentes : « error » ; écart absent : « error »', () => {
    const down = {
      ...OK,
      series: [{ ...OK.series[0]!, value: null, status: 'unavailable' as const, error: 'a' }],
      rates: [{ ...OK.rates[0]!, value: null, status: 'unavailable' as const, error: 'b' }],
      spread: { ...OK.spread, value: null, status: 'unavailable' as const, error: 'c' },
    };
    expect(bceStatus(slot(down))).toMatchObject({ status: 'error', error: 'a ; b' });
    expect(spreadStatus(slot(down))).toMatchObject({ status: 'error', error: 'c' });
  });
  it('rien lu : « error » si la lecture a échoué, sinon « loading »', () => {
    expect(bceStatus(slot(null, 'HTTP 502'))).toEqual({ status: 'error', lastUpdate: null, error: 'HTTP 502' });
    expect(spreadStatus(slot(null))).toEqual({ status: 'loading', lastUpdate: null, error: undefined });
  });
});
