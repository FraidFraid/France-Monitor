// src/services/health-offer.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HEALTH_NOW, aplFixture, hospitalsFixture, offerFixture } from '../components/layer-panel/health.fixture.ts';
import { APL_URL, HOSPITALS_URL, fetchHealthOffer, isAplDataset, isHospitalsDataset, offerStatus, resetHealthOfferCache } from './health-offer.ts';

function stubFetch(status: Partial<Record<string, number>> = {}) {
  const f = vi.fn(async (url: string) => {
    const code = status[url] ?? 200;
    const body = url === APL_URL ? aplFixture() : hospitalsFixture();
    return { ok: code >= 200 && code < 300, status: code, json: async () => body };
  });
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => { vi.unstubAllGlobals(); resetHealthOfferCache(); });

describe('offre de soins : fichiers annuels (spec 2026-10-03 § 2.7, § 2.8)', () => {
  it('lit les deux fichiers une fois par session', async () => {
    const f = stubFetch();
    const a = await fetchHealthOffer(null, HEALTH_NOW);
    expect(f.mock.calls.map((c) => c[0]).sort()).toEqual([APL_URL, HOSPITALS_URL].sort());
    expect(a.apl).toEqual({ data: aplFixture(), error: null, fetchedAt: HEALTH_NOW });
    expect(a.hospitals.data?.sites).toHaveLength(616);
    await fetchHealthOffer(a, HEALTH_NOW + 10 * 3_600_000);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('fichier en erreur : erreur portée, données précédentes gardées, relu à l’appel suivant', async () => {
    stubFetch({ [APL_URL]: 404 });
    const a = await fetchHealthOffer(offerFixture(), HEALTH_NOW);
    expect(a.apl.error).toBe('HTTP 404');
    expect(a.apl.data).toEqual(aplFixture());
    const f = stubFetch();
    const b = await fetchHealthOffer(a, HEALTH_NOW + 1000);
    expect(f.mock.calls.map((c) => c[0])).toEqual([APL_URL]);
    expect(b.apl.error).toBeNull();
  });
  it('gardes de forme', () => {
    expect(isAplDataset(aplFixture())).toBe(true);
    expect(isHospitalsDataset(hospitalsFixture())).toBe(true);
    expect(isAplDataset({ ...aplFixture(), departments: [{ code: '75' }] })).toBe(false);
    expect(isHospitalsDataset({ ...hospitalsFixture(), sites: [{ finess: '1', lat: 'x' }] })).toBe(false);
  });
  it('panneau des sources : date de publication DREES et date FINESS, jamais l’heure de lecture', () => {
    const o = offerFixture();
    expect(offerStatus(o, 'apl')).toEqual({ status: 'ok', lastUpdate: new Date('2026-07-22T12:00:00Z'), error: undefined });
    expect(offerStatus(o, 'hospitals').lastUpdate).toEqual(new Date('2026-05-04T12:00:00Z'));
    expect(offerStatus({ ...o, hospitals: { data: null, error: 'HTTP 500', fetchedAt: null } }, 'hospitals'))
      .toEqual({ status: 'error', lastUpdate: null, error: 'HTTP 500' });
  });
});
