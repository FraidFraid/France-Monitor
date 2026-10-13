// tests/asnr-api.test.ts
// /api/nuclear/asnr (spec 2026-10-13 ASNR sûreté) : lecture horaire (RSS + page 0), rattrapage unique des pages suivantes, avis lu une
// fois, journal de 12 mois dans kv-history, INES jamais abaissé, aucune écriture si le journal est illisible, ASNR en panne : journal servi.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { ASNR_LOG_KEY, ASNR_RSS_URL, asnrListUrl, loadAsnr, mergeEvent } from '../api/_lib/asnr.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/nuclear/asnr.js';
import type { AsnrResponse } from '../src/types/index.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const read = (name: string): string => readFileSync(new URL(`./fixtures/nuclear/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-13T08:00:00Z');
const PAGES: Record<number, string> = { 0: 'asnr-actualites-0.html', 1: 'asnr-actualites-1.html', 2: 'asnr-actualites-1.html', 3: 'asnr-actualites-3.html', 4: 'asnr-actualites-4.html', 5: 'asnr-actualites-5.html', 6: 'asnr-actualites-1.html', 7: 'asnr-actualites-7.html', 8: 'asnr-actualites-8.html' };
const DETAILS: Record<string, string> = {
  'hospices-civils-de-lyon-contamination-externe-dun-travailleur-conduisant-au-depassement': 'asnr-detail-hcl-lyon.html',
  'lasnr-active-son-centre-de-crise-la-suite-dun-evenement-la-centrale-de-chooz': 'asnr-detail-chooz-crise.html',
};

/** Faux Redis en mémoire : get/set, ou panne de lecture. */
function fakeKv(opts: { failGet?: boolean; initial?: unknown } = {}) {
  const store = new Map<string, string>();
  if (opts.initial !== undefined) store.set(ASNR_LOG_KEY, JSON.stringify(opts.initial));
  const writes: string[] = [];
  __setKvClientForTests({
    get: async (k: string) => { if (opts.failGet) throw new Error('redis'); return store.get(k) ?? null; },
    set: async (k: string, v: string) => { writes.push(k); store.set(k, v); },
  });
  return { store, writes };
}

function asnrSite(url: string) {
  if (url === ASNR_RSS_URL) return respond(read('asnr-rss.xml'));
  const page = /\/actualites\?page=(\d+)$/.exec(url);
  if (page) return PAGES[Number(page[1])] ? respond(read(PAGES[Number(page[1])])) : respond('x', 404);
  const slug = url.split('/').pop() ?? '';
  return respond(DETAILS[slug] ? read(DETAILS[slug]) : '<html><main><p>Texte sans site.</p></main></html>');
}

beforeEach(() => { __resetSwrCacheForTests(); __resetKvForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); __setKvClientForTests(null); });

describe('loadAsnr', () => {
  it('premier relevé : rattrapage jusqu’à la page de plus de 12 mois, 7 événements classés, journal écrit', async () => {
    const kv = fakeKv();
    const log = stubFetch(asnrSite);
    const body = await loadAsnr(NOW);
    expect(log.urls.filter((u) => u.includes('?page='))).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map(asnrListUrl));
    expect(body.errors).toEqual([]);
    expect(body.readAt).toBe('2026-10-13T08:00:00.000Z');
    expect(body.events.map((e) => [e.date, e.kind, e.plantId, e.ines])).toEqual([
      ['2026-10-01', 'installation', 'nuc-flamanville', null],
      ['2026-07-22', 'radioprotection', null, 2],
      ['2026-06-30', 'crise', 'nuc-chooz', null],
      ['2026-05-07', 'crise', 'nuc-cruas', null],
      ['2026-01-09', 'crise', 'nuc-flamanville', null],
      ['2025-12-20', 'crise', 'nuc-chooz', null],
      ['2025-11-20', 'crise', null, null],
    ]);
    expect(body.events[0]).not.toHaveProperty('textRead');
    expect(kv.writes).toContain(ASNR_LOG_KEY);
    const stored = JSON.parse(kv.store.get(ASNR_LOG_KEY) ?? '{}') as { backfilledAt: string | null };
    expect(stored.backfilledAt).toBe('2026-10-13T08:00:00.000Z');
  });

  it('relevé suivant : RSS et page 0 seulement, aucun avis relu', async () => {
    fakeKv();
    stubFetch(asnrSite);
    await loadAsnr(NOW);
    __resetSwrCacheForTests();
    vi.setSystemTime(NOW + 2 * 3_600_000);
    const log = stubFetch(asnrSite);
    const body = await loadAsnr(NOW + 2 * 3_600_000);
    expect(log.urls).toEqual([ASNR_RSS_URL, asnrListUrl(0)]);
    expect(body.events).toHaveLength(7);
  });

  it('journal illisible (Redis en panne) : événements du relevé servis, panne nommée, aucune écriture', async () => {
    const kv = fakeKv({ failGet: true });
    stubFetch(asnrSite);
    const body = await loadAsnr(NOW);
    expect(body.errors).toContain('ASNR : journal indisponible, relevé non enregistré');
    expect(kv.writes).not.toContain(ASNR_LOG_KEY);
    expect(body.events.some((e) => e.kind === 'radioprotection')).toBe(true);
  });

  it('ASNR injoignable sans relevé connu : journal servi, readAt null, panne nommée', async () => {
    const event = { id: 'asnr-x', url: 'https://www.asnr.fr/actualites/x', title: 'Incident à la centrale nucléaire de Golfech', date: '2026-10-10', kind: 'installation', ines: 1, plantId: 'nuc-golfech', site: 'Golfech', textRead: true };
    fakeKv({ initial: { backfilledAt: '2026-10-01T00:00:00.000Z', events: [event] } });
    stubFetch(() => respond('x', 503));
    const body = await loadAsnr(NOW);
    expect(body.readAt).toBeNull();
    expect(body.events.map((e) => e.id)).toEqual(['asnr-x']);
    expect(body.errors[0]).toMatch(/^ASNR/);
  });

  it('page 0 sans carte lisible : erreur nommée, le RSS reste lu', async () => {
    fakeKv({ initial: { backfilledAt: '2026-10-01T00:00:00.000Z', events: [] } });
    stubFetch((url) => (url === asnrListUrl(0) ? respond('<html><body>Nouvelle maquette</body></html>') : asnrSite(url)));
    const body = await loadAsnr(NOW);
    expect(body.errors).toContain('ASNR (actualités) : aucune actualité lisible');
    expect(body.events.map((e) => e.plantId)).toEqual(['nuc-flamanville']);
  });

  it('événements de plus de 12 mois retirés du journal', async () => {
    const old = { id: 'asnr-old', url: 'https://www.asnr.fr/actualites/old', title: 'Incident à la centrale nucléaire de Penly', date: '2025-09-01', kind: 'installation', ines: 1, plantId: 'nuc-penly', site: 'Penly', textRead: true };
    fakeKv({ initial: { backfilledAt: '2026-10-01T00:00:00.000Z', events: [old] } });
    stubFetch(asnrSite);
    const body = await loadAsnr(NOW);
    expect(body.events.some((e) => e.id === 'asnr-old')).toBe(false);
  });
});

describe('mergeEvent', () => {
  const base = { id: 'a', url: 'u', title: 't', date: '2026-10-02', kind: 'installation', ines: 2, plantId: null, site: null, textRead: true };
  it('INES enrichi jamais abaissé, date la plus ancienne gardée, site complété', () => {
    expect(mergeEvent(base, { ...base, ines: 1, date: '2026-10-01', plantId: 'nuc-penly', site: 'Penly' }))
      .toMatchObject({ ines: 2, date: '2026-10-01', plantId: 'nuc-penly', site: 'Penly', textRead: true });
    expect(mergeEvent({ ...base, ines: null }, { ...base, ines: 1 }).ines).toBe(1);
    expect(mergeEvent(base, { ...base, ines: null }).ines).toBe(2);
  });
});

describe('route', () => {
  it('200 et cache CDN ; ASNR injoignable sans journal : 502 no-store', async () => {
    fakeKv();
    stubFetch(asnrSite);
    const ok = await callHandler<AsnrResponse>(handler);
    expect([ok.status, ok.cache]).toEqual([200, CACHE_CONTROL]);
    __resetSwrCacheForTests();
    __resetKvForTests();
    fakeKv();
    stubFetch(() => respond('x', 503));
    const down = await callHandler<AsnrResponse>(handler);
    expect([down.status, down.cache]).toEqual([502, 'no-store']);
  });
});

describe('revue finale', () => {
  const base = { id: 'a', url: 'u', title: 't', date: '2026-10-02', kind: 'installation', ines: 2, plantId: 'nuc-penly', site: 'Penly', textRead: true };
  it('relevé sans texte (carte de liste) : le groupe calculé avec le texte est gardé', () => {
    expect(mergeEvent(base, { ...base, kind: 'radioprotection', plantId: null, site: null, textRead: false }).kind).toBe('installation');
  });
  it('rattrapage : page vide après une page pleine = fin de liste, sans erreur', async () => {
    const kv = fakeKv();
    stubFetch((url) => (/page=([2-9]|1\d)$/.test(url) ? respond('<html><body>vide</body></html>') : asnrSite(url)));
    const body = await loadAsnr(NOW);
    expect(body.errors).toEqual([]);
    const stored = JSON.parse(kv.store.get(ASNR_LOG_KEY) ?? '{}') as { backfilledAt: string | null };
    expect(stored.backfilledAt).not.toBeNull();
  });
  it('rattrapage en panne : les pages déjà lues ne sont pas relues à l’appel suivant', async () => {
    fakeKv();
    stubFetch((url) => (url === asnrListUrl(3) ? respond('x', 503) : asnrSite(url)));
    const first = await loadAsnr(NOW);
    expect(first.errors.some((e) => e.startsWith('ASNR (actualités, page 3)'))).toBe(true);
    const log = stubFetch((url) => (url === asnrListUrl(3) ? respond('x', 503) : asnrSite(url)));
    await loadAsnr(NOW + 60_000);
    expect(log.urls.filter((u) => u === asnrListUrl(1) || u === asnrListUrl(2))).toEqual([]);
  });
});
