// tests/sovereignty-sanctions-api.test.ts : registre national des gels (spec 2026-10-04 souveraineté § 3.4 ; contrats § 2.7 ; faits
// § 5.10) sur le jeu d'essai anonymisé du 04/10/2026 : date relue chaque heure, fichier relu seulement à une publication nouvelle,
// comptes par nature et différences d'IdRegistre, aucun nom ni détail nominatif dans la réponse ni dans le KV.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/_lib/route-budget.js', async (orig) => ({ ...(await orig<typeof import('../api/_lib/route-budget.js')>()), ROUTE_BUDGET_MS: 25 }));
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import {
  GELS_DATE_URL, GELS_FILE_URL, GELS_PENDING_NOTE, __resetGelsForTests, diffIds, ensureGelsFresh, normalizePublicationDate, storedGels, parseGelsDate, summarizeGels,
} from '../api/_lib/gels-avoirs.js';
import handler, { CACHE_CONTROL, PENDING_CACHE_CONTROL, loadSanctions } from '../api/_handlers/sovereignty/sanctions.js';
import type { SanctionsResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

interface Entry { IdRegistre: number; Nature: string; Nom: string; RegistreDetail: unknown[] }
interface GelsFile { Publications: { DatePublication: string; PublicationDetail: Entry[] } }
const fx = (name: string): string => readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8');
const DATE = fx('dgtresor-gels-derniere-date.txt');
const FILE = JSON.parse(fx('dgtresor-gels-reduit.json')) as GelsFile;
const NOW = Date.parse('2026-10-04T16:48:22+02:00');
const MIN = 60_000;
const UA = 'FranceMonitor/1.0 (+https://www.francemonitor.com)';

/** Toutes les chaînes nominatives du jeu d'essai (Nom, valeurs de RegistreDetail) : aucune ne doit sortir. */
function nominative(file: GelsFile): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string' && v.length >= 4) out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const e of file.Publications.PublicationDetail) { out.add(e.Nom); walk(e.RegistreDetail); }
  return [...out];
}
/** Publication suivante construite : l'entrée 900002 retirée, deux entrées fictives ajoutées (900101, 900102). */
function nextPublication(): GelsFile {
  const detail = FILE.Publications.PublicationDetail.filter((e) => e.IdRegistre !== 900002);
  return {
    Publications: {
      DatePublication: '2026-10-04T17:30:00.0000000+02:00',
      PublicationDetail: [
        ...detail,
        { IdRegistre: 900101, Nature: 'Personne morale', Nom: 'Entite fictive 041', RegistreDetail: [] },
        { IdRegistre: 900102, Nature: 'Navire', Nom: 'Navire fictif 004', RegistreDetail: [] },
      ],
    },
  };
}

let writes: string[] = [];
function sources(date: string | FakeResponse = DATE, file: GelsFile | FakeResponse = FILE) {
  return stubFetch((url) => {
    if (url === GELS_DATE_URL) return typeof date === 'string' ? respond(date) : date;
    if (url === GELS_FILE_URL) return 'ok' in file ? file : respond(file);
    return respond('introuvable', 404);
  });
}

beforeEach(() => {
  writes = [];
  __resetKvForTests();
  __resetGelsForTests();
  __setKvClientForTests({ get: async () => null, set: async (_key: string, value: string) => { writes.push(value); } });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('analyse', () => {
  it('date de l’API (heure de Paris) avec son décalage, heure d’été comprise ; date du fichier ramenée aux millisecondes', () => {
    expect(parseGelsDate(DATE)).toBe('2026-10-02T10:36:17+02:00');
    expect(parseGelsDate('15/01/2026 09:00:00')).toBe('2026-01-15T09:00:00+01:00');
    expect(parseGelsDate('2026-10-02')).toBeNull();
    expect(normalizePublicationDate('2026-10-02T10:36:17.1263651+02:00')).toBe('2026-10-02T10:36:17.126+02:00');
    expect(normalizePublicationDate('2026-10-02T10:36:17+02:00')).toBe('2026-10-02T10:36:17+02:00');
    expect(normalizePublicationDate('hier')).toBeNull();
  });
  it('comptes par nature et identifiants seulement : aucun nom ne sort', () => {
    const s = summarizeGels(FILE);
    expect(Object.keys(s).sort()).toEqual(['ids', 'morales', 'navires', 'physiques', 'publishedAt', 'total']);
    expect([s.publishedAt, s.total, s.physiques, s.morales, s.navires, s.ids.length, s.ids[0], s.ids[39]])
      .toEqual(['2026-10-02T10:36:17.126+02:00', 40, 27, 10, 3, 40, 900001, 900040]);
    const text = JSON.stringify(s);
    for (const v of nominative(FILE)) expect(text).not.toContain(v);
    expect(() => summarizeGels({ Publications: {} })).toThrow('fichier illisible (publication ou entrées absentes)');
  });
  it('différence des IdRegistre ; premier passage : n.d., jamais « tout est nouveau »', () => {
    expect(diffIds(null, [1, 2, 3])).toEqual({ added: null, removed: null });
    expect(diffIds([1, 2, 3, 900002], [1, 2, 3, 900101, 900102])).toEqual({ added: 2, removed: 1 });
  });
});

describe('relève', () => {
  it('premier passage : date puis fichier, en-tête FranceMonitor ; différence n.d. ; rien de nominatif dans la réponse ni dans le KV', async () => {
    const log = sources();
    const r = await ensureGelsFresh(NOW);
    expect(log.urls).toEqual([GELS_DATE_URL, GELS_FILE_URL]);
    for (const init of log.inits) expect(sentHeader(init, 'User-Agent')).toBe(UA);
    expect(r.current).toEqual({ publishedAt: '2026-10-02T10:36:17.126+02:00', total: 40, physiques: 27, morales: 10, navires: 3, added: null, removed: null });
    expect([r.readAt, r.dateCheckedAt, r.errors, r.history.publications.length, r.history.since])
      .toEqual(['2026-10-04T14:48:22.000Z', '2026-10-04T14:48:22.000Z', [], 1, '2026-10-02T10:36:17.126+02:00']);
    const text = `${JSON.stringify(r)}\n${writes.join('\n')}`;
    for (const v of nominative(FILE)) expect(text).not.toContain(v);
  });
  it('moins d’une heure après : aucun appel ; une heure après, même date : la date seule est relue', async () => {
    sources();
    await ensureGelsFresh(NOW);
    const quiet = sources();
    await ensureGelsFresh(NOW + 30 * MIN);
    expect(quiet.urls).toEqual([]);
    const again = sources();
    const r = await ensureGelsFresh(NOW + 61 * MIN);
    expect(again.urls).toEqual([GELS_DATE_URL]);
    expect([r.readAt, r.dateCheckedAt]).toEqual(['2026-10-04T14:48:22.000Z', '2026-10-04T15:49:22.000Z']);
  });
  it('publication suivante : deux entrées ajoutées, une retirée ; historique de la plus ancienne à la plus récente', async () => {
    sources();
    await ensureGelsFresh(NOW);
    sources('04/10/2026 17:30:00', nextPublication());
    const r = await ensureGelsFresh(NOW + 2 * 60 * MIN);
    expect(r.current).toMatchObject({ publishedAt: '2026-10-04T17:30:00.000+02:00', total: 41, added: 2, removed: 1 });
    expect(r.history.publications.map((p) => [p.publishedAt, p.added, p.removed]))
      .toEqual([['2026-10-02T10:36:17.126+02:00', null, null], ['2026-10-04T17:30:00.000+02:00', 2, 1]]);
    const text = `${JSON.stringify(r)}\n${writes.join('\n')}`;
    for (const v of [...nominative(FILE), 'Entite fictive 041', 'Navire fictif 004']) expect(text).not.toContain(v);
  });
  it('date en panne : publication gardée, date de contrôle inchangée, panne nommée ; fichier en panne : publication gardée, date relue', async () => {
    sources();
    await ensureGelsFresh(NOW);
    sources(respond('indisponible', 503));
    const dateDown = await ensureGelsFresh(NOW + 61 * MIN);
    expect([dateDown.current?.total, dateDown.dateCheckedAt, dateDown.errors]).toEqual([40, '2026-10-04T14:48:22.000Z', ['Registre des gels, date : HTTP 503']]);
    sources('04/10/2026 17:30:00', respond('indisponible', 503));
    const fileDown = await ensureGelsFresh(NOW + 122 * MIN);
    expect([fileDown.current?.publishedAt, fileDown.dateCheckedAt, fileDown.errors])
      .toEqual(['2026-10-02T10:36:17.126+02:00', '2026-10-04T16:50:22.000Z', ['Registre des gels, fichier : HTTP 503']]);
  });
});

describe('reprises et ordre des écritures', () => {
  /** Redis simulé et durable : survit à un redémarrage (mémoire vidée) ; `failKey` fait échouer l'écriture d'une clé. */
  function persistentKv(failKey?: string) {
    const store = new Map<string, string>();
    const order: string[] = [];
    __setKvClientForTests({
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: string) => {
        order.push(key);
        if (failKey && key.endsWith(failKey)) throw new Error('écriture refusée');
        store.set(key, value);
      },
    });
    return { store, order };
  }
  it('premier passage : le fichier en panne donne 200 avec current nul et la date lue ; relève suivante une heure plus tard', async () => {
    sources(DATE, respond('indisponible', 503));
    const first = await ensureGelsFresh(NOW);
    expect([first.current, first.dateCheckedAt, first.readAt, first.errors]).toEqual([null, '2026-10-04T14:48:22.000Z', null, ['Registre des gels, fichier : HTTP 503']]);
    const route = await callHandler<SanctionsResponse>(handler);
    expect(route.status).toBe(200);
    const quiet = sources();
    await ensureGelsFresh(NOW + 30 * MIN);
    expect(quiet.urls).toEqual([]);
    const retry = sources();
    const r = await ensureGelsFresh(NOW + 61 * MIN);
    expect(retry.urls).toEqual([GELS_DATE_URL, GELS_FILE_URL]);
    expect([r.current?.total, r.errors, r.readAt]).toEqual([40, [], '2026-10-04T15:49:22.000Z']);
  });
  it('même publication relue après un redémarrage sans état : la différence gardée dans l’historique est reprise', async () => {
    const kv = persistentKv();
    sources();
    await ensureGelsFresh(NOW);
    sources('04/10/2026 17:30:00', nextPublication());
    await ensureGelsFresh(NOW + 2 * 60 * MIN);
    for (const key of [...kv.store.keys()]) if (key.endsWith('gels:state')) kv.store.delete(key);
    __resetKvForTests();
    __resetGelsForTests();
    const log = sources('04/10/2026 17:30:00', nextPublication());
    const r = await ensureGelsFresh(NOW + 3 * 60 * MIN);
    expect(log.urls).toEqual([GELS_DATE_URL, GELS_FILE_URL]);
    expect(r.current).toMatchObject({ publishedAt: '2026-10-04T17:30:00.000+02:00', total: 41, added: 2, removed: 1 });
    expect(r.history.publications).toHaveLength(2);
  });
  it('les identifiants sont écrits en dernier : une coupure avant refait la même différence', async () => {
    const kv = persistentKv();
    sources();
    await ensureGelsFresh(NOW);
    kv.order.length = 0;
    sources('04/10/2026 17:30:00', nextPublication());
    await ensureGelsFresh(NOW + 2 * 60 * MIN);
    expect(kv.order.map((k) => k.split(':').slice(-1)[0])).toEqual(['history', 'state', 'ids']);
  });
  it('écriture de l’historique refusée : la réponse garde la différence et les identifiants ne sont écrits qu’après', async () => {
    const kv = persistentKv('gels:history');
    sources();
    await ensureGelsFresh(NOW);
    sources('04/10/2026 17:30:00', nextPublication());
    const r = await ensureGelsFresh(NOW + 2 * 60 * MIN);
    expect(r.current).toMatchObject({ added: 2, removed: 1 });
    expect(kv.order[kv.order.length - 1]).toMatch(/gels:ids$/);
    expect(kv.order.filter((k) => k.endsWith('gels:history'))).toHaveLength(2);
  });
});

describe('échéance de la route', () => {
  it('lecture plus longue que l’échéance : état gardé avec la note, 200 et cache de 60 s ; la relève continue et sert la suivante', async () => {
    sources();
    await ensureGelsFresh(NOW);
    const later = NOW + 2 * 60 * MIN;
    vi.setSystemTime(later);
    stubFetch(async (url) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return url === GELS_DATE_URL ? respond('04/10/2026 17:30:00') : respond(nextPublication());
    });
    const slow = await callHandler<SanctionsResponse>(handler);
    expect([slow.status, slow.cache, slow.body.current?.total, slow.body.errors]).toEqual([200, PENDING_CACHE_CONTROL, 40, [GELS_PENDING_NOTE]]);
    const kept = await storedGels(later, GELS_PENDING_NOTE);
    expect(kept.errors).toEqual([GELS_PENDING_NOTE]);
    await ensureGelsFresh(later);
    const done = await loadSanctions(later, { budgetMs: 1000 });
    expect([done.current?.total, done.current?.added, done.errors]).toEqual([41, 2, []]);
  });
  it('jamais lu et lecture trop longue : 502 non mis en cache, avec la note', async () => {
    stubFetch(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); return respond(DATE); });
    const r = await callHandler<SanctionsResponse>(handler);
    expect([r.status, r.cache, r.body.current, r.body.errors]).toEqual([502, 'no-store', null, [GELS_PENDING_NOTE]]);
    await ensureGelsFresh(NOW);
  });
});

describe('route GET /api/sovereignty/sanctions', () => {
  it('200 et cache de 30 min ; jamais lu (date en panne) : 502 non mis en cache, même forme', async () => {
    sources();
    const ok = await callHandler<SanctionsResponse>(handler);
    expect([ok.status, ok.cache, ok.body.current?.total]).toEqual([200, CACHE_CONTROL, 40]);
    __resetKvForTests();
    __resetGelsForTests();
    sources(respond('erreur', 500));
    const down = await callHandler<SanctionsResponse>(handler);
    expect([down.status, down.cache, down.body.current, down.body.history]).toEqual([502, 'no-store', null, { publications: [], since: null }]);
    expect(down.body.errors).toEqual(['Registre des gels, date : HTTP 500']);
  });
  it('aucun fetch direct dans le module', () => {
    expect(readFileSync(new URL('../api/_lib/gels-avoirs.js', import.meta.url), 'utf8')).not.toMatch(/\bfetch\(/);
  });
});
