// src/services/environment-pollen.test.ts : garde stricte, lecture sans rejet, cache sous la relève, statut daté (S1, S2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLLEN_FIXTURE_NOW as NOW, pollenFixture } from '../components/layer-panel/pollens.fixture.ts';
import { resetTrafficSourceCache } from './traffic-source.ts';
import { POLLEN_TTL_MS, POLLEN_URL, fetchPollen, isPollenResponse, mergePollen, pollenStatus } from './environment-pollen.ts';

const wire = <T>(v: T): unknown => JSON.parse(JSON.stringify(v)) as unknown;

function stub(status = 200) {
  const f = vi.fn(async () => (status === 200 ? { ok: true, status, json: async () => wire(pollenFixture()) } : { ok: false, status, json: async () => ({}) }));
  vi.stubGlobal('fetch', f);
  return f;
}

beforeEach(() => { resetTrafficSourceCache(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('garde isPollenResponse', () => {
  it('jeu d’essai accepté ; réponse dégradée du serveur (rien de lu) acceptée', () => {
    expect(isPollenResponse(wire(pollenFixture()))).toBe(true);
    expect(isPollenResponse({ readAt: null, days: [], updatedAt: null, departments: [], sources: [], errors: ['Atmo France, pollens 2026-10-20 : HTTP 500'] })).toBe(true);
  });
  it('un élément mal formé suffit à refuser la réponse', () => {
    const noAlert = wire(pollenFixture()) as { departments: Array<{ days: Array<Record<string, unknown>> }> };
    delete noAlert.departments[0].days[0]['alerte'];
    expect(isPollenResponse(noAlert)).toBe(false);
    const badTaxon = wire(pollenFixture()) as { departments: Array<{ days: Array<{ taxa: Array<Record<string, unknown>> }> }> };
    badTaxon.departments[0].days[0].taxa[0]['taxon'] = 'chene';
    expect(isPollenResponse(badTaxon)).toBe(false);
    const strCode = wire(pollenFixture()) as { departments: Array<{ days: Array<Record<string, unknown>> }> };
    strCode.departments[1].days[0]['maxCode'] = '5';
    expect(isPollenResponse(strCode)).toBe(false);
    expect(isPollenResponse({ ...(wire(pollenFixture()) as object), days: 'J' })).toBe(false);
    expect(isPollenResponse({ ...(wire(pollenFixture()) as object), readAt: undefined })).toBe(false);
    expect(isPollenResponse(null)).toBe(false);
  });
});

describe('lecture : jamais de rejet, cache sous la relève, fusion à l’écriture', () => {
  it('lue puis servie du cache 25 min ; panne : données gardées avec leur date et le message', async () => {
    const f = stub();
    const first = await fetchPollen(null, NOW);
    expect(POLLEN_URL).toBe('/api/environment/pollen');
    expect(first.pollen).toEqual({ data: pollenFixture(), error: null, fetchedAt: NOW });
    await fetchPollen(first, NOW + POLLEN_TTL_MS - 1);
    expect(f).toHaveBeenCalledTimes(1);
    stub(502);
    const failed = await fetchPollen(first, NOW + POLLEN_TTL_MS + 1);
    expect(failed.pollen.error).toBe('HTTP 502');
    expect(mergePollen(first, failed).pollen).toEqual({ data: pollenFixture(), error: 'HTTP 502', fetchedAt: NOW });
  });
  it('première lecture en échec : pas de donnée, message', async () => {
    stub(503);
    const s = await fetchPollen(null, NOW);
    expect(s.pollen.data).toBeNull();
    expect(s.pollen.error).toBe('HTTP 503');
  });
});

describe('statut du panneau des sources', () => {
  it('à jour : ok, daté par la donnée ; en retard au-delà de 36 h : stale', async () => {
    stub();
    const s = await fetchPollen(null, NOW);
    expect(pollenStatus(s, NOW)).toMatchObject({ status: 'ok', lastUpdate: new Date('2026-10-20T10:39:06.740Z') });
    const late = pollenStatus(s, Date.parse('2026-10-22T00:00:00Z'));
    expect(late.status).toBe('stale');
    expect(late.period).toContain('(en retard)');
  });
  it('erreur sans donnée : error ; avant la première lecture : loading', async () => {
    stub(500);
    expect(pollenStatus(await fetchPollen(null, NOW), NOW).status).toBe('error');
    expect(pollenStatus({ pollen: { data: null, error: null, fetchedAt: null } }, NOW).status).toBe('loading');
  });
});
