// src/services/health-surveillance.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HEALTH_NOW, alertLevelsFixture, drugsFixture, internationalFixture, ministryFixture, recallsFixture, sentinellesFixture,
  surveillanceFixture, syndromicFixture, wastewaterFixture,
} from '../components/layer-panel/health.fixture.ts';
import {
  HEALTH_SURVEILLANCE_URLS, HEALTH_TTL_MS, fetchHealthSurveillance, isAlertLevelsResponse, isDrugShortagesV2, isInternationalResponse,
  isMinistryMessagesResponse, isRecallsResponse, isSentinellesNationalResponse, isSyndromicResponse, isWastewaterResponse,
  mergeSurveillance, resetHealthSurveillanceCache, surveillanceDataDate, surveillanceLate, surveillanceStatus, type HealthSurveillanceKey,
} from './health-surveillance.ts';

const KEYS = Object.keys(HEALTH_SURVEILLANCE_URLS) as HealthSurveillanceKey[];
const BODIES: Record<HealthSurveillanceKey, unknown> = {
  syndromic: syndromicFixture(), alerts: alertLevelsFixture(), sentinelles: sentinellesFixture(), wastewater: wastewaterFixture(),
  international: internationalFixture(), ministry: ministryFixture(),
  // La route garde ses champs historiques jusqu'à la tâche 19 : seuls les champs V2 sont retenus.
  drugs: { ...drugsFixture(), shortages: [{ drug_name: 'x' }], last_update: '2026-10-02', metadata: {} },
  recalls: recallsFixture(),
};
const KEY_OF = new Map(KEYS.map((k) => [HEALTH_SURVEILLANCE_URLS[k], k]));
type Reply = { status: number; body?: unknown; html?: boolean };

function stubFetch(over: Partial<Record<HealthSurveillanceKey, Reply>> = {}) {
  const f = vi.fn(async (url: string) => {
    const key = KEY_OF.get(url);
    if (!key) throw new Error(`URL inattendue ${url}`);
    const o = over[key];
    if (o?.html) return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    if (o) return { ok: o.status >= 200 && o.status < 300, status: o.status, json: async () => o.body ?? {} };
    return { ok: true, status: 200, json: async () => BODIES[key] };
  });
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => { vi.unstubAllGlobals(); resetHealthSurveillanceCache(); });

describe('veille sanitaire : lecture client (spec 2026-10-03 § 2, S3)', () => {
  it('lit les huit routes une fois, garde chaque réponse 25 min, puis relit', async () => {
    const f = stubFetch();
    const s = await fetchHealthSurveillance(null, HEALTH_NOW);
    expect(f).toHaveBeenCalledTimes(8);
    expect(f.mock.calls.map((c) => c[0]).sort()).toEqual(Object.values(HEALTH_SURVEILLANCE_URLS).sort());
    expect(s.syndromic).toEqual({ data: syndromicFixture(), error: null, fetchedAt: HEALTH_NOW });
    expect(s.drugs.data).toEqual(drugsFixture());
    const again = await fetchHealthSurveillance(s, HEALTH_NOW + HEALTH_TTL_MS - 1);
    expect(f).toHaveBeenCalledTimes(8);
    expect(again.sentinelles.fetchedAt).toBe(HEALTH_NOW);
    await fetchHealthSurveillance(s, HEALTH_NOW + HEALTH_TTL_MS);
    expect(f).toHaveBeenCalledTimes(16);
  });
  it('cache client de 25 min, strictement sous la relève de 30 min', () => {
    expect(HEALTH_TTL_MS).toBe(25 * 60_000);
    expect(HEALTH_TTL_MS).toBeLessThan(30 * 60_000);
  });
  it('sources demandées seulement ; les autres gardent leur état', async () => {
    const f = stubFetch();
    const s = await fetchHealthSurveillance(null, HEALTH_NOW, ['syndromic', 'alerts']);
    expect(f.mock.calls.map((c) => c[0]).sort()).toEqual(['/api/health/alert-levels', '/api/health/syndromic']);
    expect(s.sentinelles).toEqual({ data: null, error: null, fetchedAt: null });
    expect(s.alerts.data).toEqual(alertLevelsFixture());
    const kept = await fetchHealthSurveillance(surveillanceFixture(), HEALTH_NOW, ['syndromic']);
    expect(kept.recalls.data).toEqual(recallsFixture());
  });
  it('HTTP en erreur, page HTML (défi anti-robot), forme inattendue : erreur portée, dernières données gardées', async () => {
    stubFetch();
    const first = await fetchHealthSurveillance(null, HEALTH_NOW);
    resetHealthSurveillanceCache();
    stubFetch({ sentinelles: { status: 429 }, ministry: { status: 200, html: true }, recalls: { status: 200, body: { total: 'x' } }, wastewater: { status: 500 } });
    const s = await fetchHealthSurveillance(first, HEALTH_NOW + 1000);
    expect(s.sentinelles).toEqual({ data: sentinellesFixture(), error: 'HTTP 429', fetchedAt: HEALTH_NOW });
    expect(s.ministry.error).toBe('réponse illisible');
    expect(s.recalls.error).toBe('réponse inattendue');
    expect(s.wastewater.error).toBe('HTTP 500');
    expect(s.syndromic.error).toBeNull();
    resetHealthSurveillanceCache();
    stubFetch({ sentinelles: { status: 503 } });
    const none = await fetchHealthSurveillance(null, HEALTH_NOW + 2000);
    expect(none.sentinelles).toEqual({ data: null, error: 'HTTP 503', fetchedAt: null });
  });
  it('réseau en échec ou délai dépassé : message en français, jamais le message natif du navigateur', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === HEALTH_SURVEILLANCE_URLS.recalls) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      throw new TypeError('Failed to fetch');
    }));
    const s = await fetchHealthSurveillance(surveillanceFixture(), HEALTH_NOW);
    expect(s.syndromic).toEqual({ data: syndromicFixture(), error: 'source injoignable', fetchedAt: surveillanceFixture().syndromic.fetchedAt });
    expect(s.recalls.error).toBe('délai dépassé');
    expect(surveillanceStatus(s, 'syndromic', HEALTH_NOW).error).toBe('source injoignable');
  });
  it('lectures concurrentes : une lecture partielle terminée en dernier ne remplace que ses sources', async () => {
    stubFetch();
    const partial = await fetchHealthSurveillance(null, HEALTH_NOW, ['syndromic', 'alerts']);
    const all = surveillanceFixture();
    const merged = mergeSurveillance(all, partial, ['syndromic', 'alerts']);
    expect(merged.syndromic).toBe(partial.syndromic);
    expect(merged.alerts).toBe(partial.alerts);
    expect(merged.sentinelles).toBe(all.sentinelles);
    expect(merged.recalls).toBe(all.recalls);
    expect(mergeSurveillance(all, partial, 'all')).toBe(partial);
    expect(mergeSurveillance(null, partial, ['syndromic'])).toBe(partial);
  });
  it('gardes de forme', () => {
    expect([isSyndromicResponse(syndromicFixture()), isAlertLevelsResponse(alertLevelsFixture()), isSentinellesNationalResponse(sentinellesFixture()),
      isWastewaterResponse(wastewaterFixture()), isInternationalResponse(internationalFixture()), isMinistryMessagesResponse(ministryFixture()),
      isDrugShortagesV2(drugsFixture()), isRecallsResponse(recallsFixture())]).toEqual(Array(8).fill(true));
    expect(isSyndromicResponse({ week: null, publishedAt: null, syndromes: [{ key: 'ira' }], departments: [], errors: [] })).toBe(false);
    expect(isDrugShortagesV2({ ...drugsFixture(), counts: { rupture: 1 } })).toBe(false);
    expect(isAlertLevelsResponse(null)).toBe(false);
    expect(isRecallsResponse([])).toBe(false);
  });
  it('date de la donnée de chaque source, jamais l’heure de lecture (S1)', () => {
    const s = surveillanceFixture();
    expect(Object.fromEntries(KEYS.map((k) => [k, surveillanceDataDate(s, k)]))).toEqual({
      syndromic: '2026-09-30T10:01:00Z', alerts: '2026-09-27', sentinelles: '2026-09-27', wastewater: '2026-09-30T10:30:00Z',
      international: '2026-10-02', ministry: '2026-09-28', drugs: '2026-10-02', recalls: '2026-10-02T17:50:00Z',
    });
  });
  it('retard selon le rythme de chaque source (S2), des deux côtés du seuil', () => {
    const s = surveillanceFixture();
    const at = (iso: string): number => Date.parse(iso);
    expect(KEYS.filter((k) => surveillanceLate(s, k, HEALTH_NOW))).toEqual([]);
    expect([surveillanceLate(s, 'syndromic', at('2026-10-12T00:00:00Z')), surveillanceLate(s, 'syndromic', at('2026-10-16T00:00:00Z'))]).toEqual([false, true]);
    expect([surveillanceLate(s, 'sentinelles', at('2026-10-09T00:00:00Z')), surveillanceLate(s, 'sentinelles', at('2026-10-12T00:00:00Z'))]).toEqual([false, true]);
    expect([surveillanceLate(s, 'wastewater', at('2026-10-10T00:00:00Z')), surveillanceLate(s, 'wastewater', at('2026-10-14T00:00:00Z'))]).toEqual([false, true]);
    expect([surveillanceLate(s, 'drugs', at('2026-10-08T00:00:00Z')), surveillanceLate(s, 'drugs', at('2026-10-11T00:00:00Z'))]).toEqual([false, true]);
    expect([surveillanceLate(s, 'recalls', at('2026-10-05T00:00:00Z')), surveillanceLate(s, 'recalls', at('2026-10-08T00:00:00Z'))]).toEqual([false, true]);
    const far = at('2027-01-01T00:00:00Z');
    expect([surveillanceLate(s, 'alerts', far), surveillanceLate(s, 'international', far), surveillanceLate(s, 'ministry', far)]).toEqual([false, false, false]);
  });
  it('panneau des sources : date de la donnée, « stale » en retard ou après un échec, « error » sans donnée', () => {
    const s = surveillanceFixture();
    expect(surveillanceStatus(s, 'syndromic', HEALTH_NOW)).toEqual({ status: 'ok', lastUpdate: new Date('2026-09-30T10:01:00Z'), error: undefined });
    expect(surveillanceStatus(s, 'alerts', HEALTH_NOW).lastUpdate).toEqual(new Date('2026-09-27T12:00:00Z'));
    expect(surveillanceStatus(s, 'drugs', Date.parse('2026-10-20T00:00:00Z')).status).toBe('stale');
    expect(surveillanceStatus({ ...s, ministry: { ...s.ministry, error: 'HTTP 500' } }, 'ministry', HEALTH_NOW).status).toBe('stale');
    expect(surveillanceStatus({ ...s, recalls: { data: null, error: 'HTTP 502', fetchedAt: null } }, 'recalls', HEALTH_NOW))
      .toEqual({ status: 'error', lastUpdate: null, error: 'HTTP 502' });
  });
});
