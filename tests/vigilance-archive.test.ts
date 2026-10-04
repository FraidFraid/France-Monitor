// tests/vigilance-archive.test.ts : départements en vigilance sur 30 jours, lus dans l'archive open data de Météo-France
// (spec 2026-10-04 environnement E5, contrat § 2.1). Arbre réel de septembre et octobre 2026 (listes de fichiers réduites à la
// carte ou aux textes) et cartes réelles des 02, 03 et 04/10 (comptes de J et J+1) ; les autres cartes de la fenêtre sont
// construites dans le test (J finissant à minuit de Paris, 3 départements jaunes).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests, kvGetJson, kvSetJson } from '../api/_lib/kv-history.js';
import { parisDay } from '../api/_lib/paris-time.js';
import {
  ARCHIVE_TREE_URL, DAILY_KEY, __resetVigilanceArchiveForTests, archiveCarteUrl, cartesByParisDay, dayCountsOf, ensureVigilanceArchiveFresh,
  overlayCurrentDay, readVigilanceHistory,
} from '../api/_lib/vigilance-archive.js';
import { CARTE_URL, TEXTES_URL, __resetVigilanceStateForTests } from '../api/_lib/meteo-vigilance.js';
import handler from '../api/_handlers/environment/vigilance.js';
import type { VigilanceDayCount, VigilanceResponse } from '../src/types/index.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const fxJson = <T>(name: string): T => JSON.parse(fx(name)) as T;

type Tree = Record<string, Record<string, Record<string, Record<string, string[]>>>>;
const NOW = Date.parse('2026-10-04T10:10:00+02:00');
const MIN = 60_000;
const TREE = fxJson<Tree>('vigilance-hexagone-tree-extrait.json');
const CARTES = fxJson<Record<string, unknown>>('vigilance-archive-cartes-extrait.json');

/** Carte construite pour un dossier sans fixture : échéance J jusqu'à minuit de Paris (22:00Z, heure d'été), 3 départements jaunes. */
function synthetic(path: string): unknown {
  const [y, m, d, f] = path.split('/');
  const day = parisDay(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(f.slice(0, 2)), Number(f.slice(2, 4)), Number(f.slice(4, 6))));
  return { product: { update_time: `${y}-${m}-${d}T${f.slice(0, 2)}:${f.slice(2, 4)}:00Z`, periods: [
    { echeance: 'J', begin_validity_time: `${y}-${m}-${d}T${f.slice(0, 2)}:00:00Z`, end_validity_time: `${day}T22:00:00Z`, max_count_items: [{ color_id: 2, count: 3 }] },
  ] } };
}

/** Archive simulée : arbre donné, cartes réelles quand elles existent, construites sinon ; dossiers de `failing` en HTTP 503. */
function archive(tree: unknown = TREE, failing: ReadonlySet<string> = new Set()): ReturnType<typeof stubFetch> {
  return stubFetch((url) => {
    if (url === ARCHIVE_TREE_URL) return respond(tree as object);
    const m = /\/metropole\/(\d{4}\/\d{2}\/\d{2}\/\d{6})\/CDP_CARTE_EXTERNE\.json$/.exec(url);
    if (m) return failing.has(m[1]) ? respond('<html><body>Service Unavailable</body></html>', 503) : respond((CARTES[m[1]] ?? synthetic(m[1])) as object);
    if (url === CARTE_URL) return respond(fx('vigilance-encours-reduit.json'));
    if (url === TEXTES_URL) return respond(fx('vigilance-textes-reduit.json'));
    return respond('introuvable', 404);
  });
}

const cartesRead = (log: ReturnType<typeof stubFetch>): number => log.urls.filter((u) => u.includes('/metropole/')).length;
const day = (days: readonly VigilanceDayCount[], date: string): VigilanceDayCount | undefined => days.find((d) => d.date === date);

beforeEach(() => {
  __resetSwrCacheForTests();
  __resetVigilanceStateForTests();
  __resetVigilanceArchiveForTests();
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('METEO_FRANCE_API_KEY', 'cle-test');
});
afterEach(() => {
  __setKvClientForTests(null);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('lecture de l’archive', () => {
  it('URL d’une carte : dossier « metropole », mois et jour sur deux chiffres', () => {
    expect(archiveCarteUrl(2026, 10, 3, '140009'))
      .toBe('https://files.data.gouv.fr/meteofrance/data/vigilance/metropole/2026/10/03/140009/CDP_CARTE_EXTERNE.json');
    expect(ARCHIVE_TREE_URL).toBe('https://files.data.gouv.fr/meteofrance/data/vigilance/vigilance-hexagone-tree.json');
  });

  it('comptes de J : carte réelle du 03/10 à 14:00:09Z, 18 départements jaunes', () => {
    expect(dayCountsOf(CARTES['2026/10/03/140009'])).toEqual({ date: '2026-10-03', jaune: 18, orange: 0, rouge: 0 });
    expect(dayCountsOf(CARTES['2026/10/03/065000'])).toEqual({ date: '2026-10-03', jaune: 18, orange: 2, rouge: 0 });
  });

  it('jour de la publication : fin de validité de J moins 1 ms, à Paris (heure d’été et d’hiver)', () => {
    const carte = (end: string): unknown => ({ product: { periods: [{ echeance: 'J', end_validity_time: end, max_count_items: [] }] } });
    expect(dayCountsOf(carte('2026-10-01T22:00:00Z')).date).toBe('2026-10-01');
    expect(dayCountsOf(carte('2026-10-26T23:00:00Z')).date).toBe('2026-10-26');
    expect(() => dayCountsOf({ product: { periods: [{ echeance: 'J1' }] } })).toThrow(/échéance J illisible/);
  });

  it('arbre réel : 76 cartes du 04/09 au 04/10 (jours de Paris), dossiers de textes seuls écartés', () => {
    const byDay = cartesByParisDay(TREE, '2026-09-04', '2026-10-04');
    expect([...byDay.values()].reduce((n, l) => n + l.length, 0)).toBe(76);
    expect(byDay.size).toBe(31);
    expect(byDay.get('2026-10-03')).toEqual(['2026/10/03/040007', '2026/10/03/065000', '2026/10/03/100727', '2026/10/03/140009', '2026/10/03/200047']);
    expect(byDay.get('2026-10-04')).toEqual(['2026/10/04/040047', '2026/10/04/080010']);
    // 22:00:04Z le 29/09 = 00:00 le 30/09 à Paris.
    expect(byDay.get('2026-09-30')).toHaveLength(7);
    expect(byDay.get('2026-09-30')?.[0]).toBe('2026/09/29/220004');
    expect(() => cartesByParisDay([], '2026-09-04', '2026-10-04')).toThrow(/arbre/);
  });
});

describe('redirection de l’arbre', () => {
  it('l’arbre est lu avec le suivi des redirections de fetch (302 vers OVH), jamais en mode manuel ou en erreur', async () => {
    const log = archive();
    await ensureVigilanceArchiveFresh(NOW);
    const redirects = log.inits.map((init) => init?.redirect);
    expect(redirects.length).toBeGreaterThan(0);
    expect(redirects.every((r) => r === undefined || r === 'follow')).toBe(true);
  });
});

describe('relève de l’archive (une fois par jour de Paris après 01:00)', () => {
  it('amorçage : arbre puis 76 cartes ; maximum par couleur et nombre de publications par jour', async () => {
    const log = archive();
    await ensureVigilanceArchiveFresh(NOW);
    expect(log.urls[0]).toBe(ARCHIVE_TREE_URL);
    expect(cartesRead(log)).toBe(76);
    const stored = await kvGetJson(DAILY_KEY, NOW) as { days: VigilanceDayCount[]; checkedDay: string | null; error: string | null };
    expect([stored.days.length, stored.checkedDay, stored.error]).toEqual([31, '2026-10-04', null]);
    const { days, since, error } = await readVigilanceHistory(NOW);
    expect([days.length, since, error]).toEqual([30, '2026-09-05', null]);
    expect(day(days, '2026-10-02')).toEqual({ date: '2026-10-02', jaune: 10, orange: 0, rouge: 0, publications: 2 });
    expect(day(days, '2026-10-03')).toEqual({ date: '2026-10-03', jaune: 18, orange: 2, rouge: 0, publications: 5 });
    expect(day(days, '2026-10-04')).toEqual({ date: '2026-10-04', jaune: 5, orange: 2, rouge: 0, publications: 2 });
    expect(day(days, '2026-09-30')?.publications).toBe(7);
  });

  it('une seule fois par jour ; avant 01:00 rien ; le lendemain, seuls les jours dont l’arbre a changé sont relus', async () => {
    archive();
    await ensureVigilanceArchiveFresh(NOW);
    const same = archive();
    await ensureVigilanceArchiveFresh(NOW + 90 * MIN);
    expect(same.urls).toEqual([]);
    const night = archive();
    await ensureVigilanceArchiveFresh(Date.parse('2026-10-05T00:30:00+02:00'));
    expect(night.urls).toEqual([]);
    const tree = structuredClone(TREE);
    tree['2026']['10']['04']['200005'] = ['CDP_CARTE_EXTERNE.json'];
    tree['2026']['10']['05'] = { '040003': ['CDP_CARTE_EXTERNE.json'] };
    const next = archive(tree);
    const morning = Date.parse('2026-10-05T06:10:00+02:00');
    await ensureVigilanceArchiveFresh(morning);
    expect(cartesRead(next)).toBe(4);
    const { days } = await readVigilanceHistory(morning);
    expect(day(days, '2026-10-04')).toEqual({ date: '2026-10-04', jaune: 5, orange: 2, rouge: 0, publications: 3 });
    expect(day(days, '2026-10-05')).toEqual({ date: '2026-10-05', jaune: 3, orange: 0, rouge: 0, publications: 1 });
    expect(days[0].date).toBe('2026-09-06');
  });

  it('arbre en panne : nommée, historique gardé ; nouvelle tentative après 1 h seulement', async () => {
    await kvSetJson(DAILY_KEY, { days: [{ date: '2026-10-03', jaune: 18, orange: 2, rouge: 0, publications: 5 }], checkedDay: '2026-10-03', error: null }, 3_600, NOW);
    const down = stubFetch(() => respond('introuvable', 404));
    await ensureVigilanceArchiveFresh(NOW);
    expect(down.urls).toEqual([ARCHIVE_TREE_URL]);
    const history = await readVigilanceHistory(NOW);
    expect([history.error, history.days.length]).toEqual(['archive vigilance : HTTP 404', 1]);
    const soon = stubFetch(() => respond('introuvable', 404));
    await ensureVigilanceArchiveFresh(NOW + 30 * MIN);
    expect(soon.urls).toEqual([]);
    const later = stubFetch(() => respond('introuvable', 404));
    await ensureVigilanceArchiveFresh(NOW + 61 * MIN);
    expect(later.urls).toEqual([ARCHIVE_TREE_URL]);
  });

  it('une carte en panne : jour gardé avec ses publications lues, panne nommée ; relu seul une heure plus tard', async () => {
    archive(TREE, new Set(['2026/10/03/100727']));
    await ensureVigilanceArchiveFresh(NOW);
    const first = await readVigilanceHistory(NOW);
    expect(first.error).toBe('archive vigilance, cartes : 1 en échec (HTTP 503)');
    expect(day(first.days, '2026-10-03')).toEqual({ date: '2026-10-03', jaune: 18, orange: 2, rouge: 0, publications: 4 });
    const retry = archive();
    await ensureVigilanceArchiveFresh(NOW + 61 * MIN);
    expect(cartesRead(retry)).toBe(5);
    const second = await readVigilanceHistory(NOW + 61 * MIN);
    expect([second.error, day(second.days, '2026-10-03')?.publications]).toEqual([null, 5]);
  });
});

describe('jour courant et route', () => {
  it('superposition : maximum entre l’archive et la carte en cours, publications de l’archive gardées', () => {
    const j = { end: '2026-10-04T22:00:00Z', counts: [{ color: 2, count: 5 }, { color: 3, count: 2 }] };
    expect(overlayCurrentDay([{ date: '2026-10-04', jaune: 3, orange: 0, rouge: 0, publications: 1 }], j))
      .toEqual([{ date: '2026-10-04', jaune: 5, orange: 2, rouge: 0, publications: 1 }]);
    expect(overlayCurrentDay([{ date: '2026-10-04', jaune: 7, orange: 0, rouge: 1, publications: 2 }], j))
      .toEqual([{ date: '2026-10-04', jaune: 7, orange: 2, rouge: 1, publications: 2 }]);
    expect(overlayCurrentDay([], j)).toEqual([{ date: '2026-10-04', jaune: 5, orange: 2, rouge: 0, publications: 0 }]);
    expect(overlayCurrentDay([], null)).toEqual([]);
  });

  it('route : historique gardé, jour de J superposé (5 jaunes, 2 orange), aucune erreur', async () => {
    await kvSetJson(DAILY_KEY, { days: [
      { date: '2026-10-02', jaune: 10, orange: 0, rouge: 0, publications: 2 },
      { date: '2026-10-03', jaune: 18, orange: 2, rouge: 0, publications: 5 },
      { date: '2026-10-04', jaune: 3, orange: 0, rouge: 0, publications: 1 },
    ], checkedDay: '2026-10-04', error: null }, 3_600, NOW);
    const log = archive();
    const { status, body } = await callHandler<VigilanceResponse>(handler);
    expect(log.urls).not.toContain(ARCHIVE_TREE_URL);
    expect([status, body.errors]).toEqual([200, []]);
    expect(body.history).toEqual({ since: '2026-10-02', days: [
      { date: '2026-10-02', jaune: 10, orange: 0, rouge: 0, publications: 2 },
      { date: '2026-10-03', jaune: 18, orange: 2, rouge: 0, publications: 5 },
      { date: '2026-10-04', jaune: 5, orange: 2, rouge: 0, publications: 1 },
    ] });
  });

  it('route : archive en panne au premier passage, 200 avec la panne nommée et le seul jour courant', async () => {
    stubFetch((url) => {
      if (url === CARTE_URL) return respond(fx('vigilance-encours-reduit.json'));
      if (url === TEXTES_URL) return respond(fx('vigilance-textes-reduit.json'));
      return respond('introuvable', 404);
    });
    const { status, body } = await callHandler<VigilanceResponse>(handler);
    expect([status, body.errors]).toEqual([200, ['archive vigilance : HTTP 404']]);
    expect(body.history).toEqual({ since: '2026-10-04', days: [{ date: '2026-10-04', jaune: 5, orange: 2, rouge: 0, publications: 0 }] });
  });
});
