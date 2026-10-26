// tests/news-event-pressure.test.ts : route /api/news/event-pressure (26/10/2026) et sa lecture côté page (src/services/event-pressure.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENT_PRESSURE_SQL, queryEventPressure } from '../api/_handlers/news/event-pressure.js';
import { fetchEventPressure, isEventPressureResponse } from '../src/services/event-pressure.ts';

const NOW = Date.parse('2026-10-17T18:00:00Z');

afterEach(() => { vi.unstubAllEnvs(); });

describe('route : événements distincts sur 24 h complètes', () => {
  it('compte des événements (DISTINCT event_id), jamais des articles ; social moyen ou plus, sécurité élevée ou plus', () => {
    expect(EVENT_PRESSURE_SQL).toContain('COUNT(DISTINCT event_id) FILTER (WHERE category = \'social\' AND severity IN (\'medium\', \'high\', \'critical\'))');
    expect(EVENT_PRESSURE_SQL).toContain('COUNT(DISTINCT event_id) FILTER (WHERE category = \'security\' AND severity IN (\'high\', \'critical\'))');
    expect(EVENT_PRESSURE_SQL).not.toMatch(/LIMIT/i);
  });
  it('fenêtre des 24 h qui précèdent ; comptages en nombres', async () => {
    const calls: unknown[][] = [];
    const r = await queryEventPressure(NOW, async (_text, params) => { calls.push(params); return [{ social: '111', security_high: 24 }]; });
    expect(calls[0]).toEqual(['2026-10-16T18:00:00.000Z', '2026-10-17T18:00:00.000Z']);
    expect(r).toEqual({ status: 200, body: { readAt: '2026-10-17T18:00:00.000Z', since: '2026-10-16T18:00:00.000Z', socialEvents24h: 111, securityHighEvents24h: 24 } });
  });
  it('base absente ou en panne : 503, jamais un zéro', async () => {
    vi.stubEnv('DATABASE_URL', '');
    expect((await queryEventPressure(NOW)).status).toBe(503);
    const down = await queryEventPressure(NOW, async () => { throw new Error('quota'); });
    expect(down.status).toBe(503);
  });
});

describe('lecture côté page', () => {
  const ok = { readAt: '2026-10-17T18:00:00.000Z', since: '2026-10-16T18:00:00.000Z', socialEvents24h: 111, securityHighEvents24h: 24 };
  it('forme validée : comptages entiers positifs', () => {
    expect(isEventPressureResponse(ok)).toBe(true);
    expect(isEventPressureResponse({ ...ok, socialEvents24h: -1 })).toBe(false);
    expect(isEventPressureResponse({ ...ok, securityHighEvents24h: '24' })).toBe(false);
    expect(isEventPressureResponse(null)).toBe(false);
  });
  it('HTTP en erreur, réseau en panne ou corps mal formé : null', async () => {
    const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await fetchEventPressure(respond(200, ok))).toEqual(ok);
    expect(await fetchEventPressure(respond(503, { error: 'x' }))).toBeNull();
    expect(await fetchEventPressure(respond(200, { readAt: 'x' }))).toBeNull();
    expect(await fetchEventPressure((async () => { throw new Error('réseau'); }) as unknown as typeof fetch)).toBeNull();
  });
});
