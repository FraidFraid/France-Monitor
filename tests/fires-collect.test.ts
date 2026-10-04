// Collecte serveur FIRMS (spec 2026-10-04 environnement § 2.4, E3, S2, S3) : détections réelles du 03 et du 04/10/2026
// (Fos-sur-Mer, Yonne, Nièvre, limite Allier et Cher ; Dillingen en Sarre, Esch au Luxembourg, Ruhr ; Dunkerque en MODIS),
// rattachement par les vrais polygones départementaux, historique et amorçage dans le stockage clé-valeur simulé.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests, kvGetJson, kvSetJson } from '../api/_lib/kv-history.js';
import { FIRMS_PUBLIC_CSV_URL } from '../api/_lib/firms.js';
import { cellOf, lastDays } from '../api/_lib/fire-foyers.js';
import { departementAt } from '../api/_lib/geo-fr.js';
import {
  BOOTSTRAP_KEY, DAYS_KEY, FIRES_CADENCE_MS, LAST_KEY, MISSING_KEY_ERROR, TOO_OLD_ERROR, collectFires, ensureFiresFresh, isFiresDue,
  nextPassesOf,
} from '../api/_lib/fires-collect.js';
import { type FakeResponse, respond, stubFetch } from './helpers/traffic-fixtures.ts';

// Rattachement réel, remplaçable dans un test (exception levée au milieu d'un cycle).
vi.mock('../api/_lib/geo-fr.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/_lib/geo-fr.js')>();
  return { ...real, departementAt: vi.fn(real.departementAt) };
});

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T10:10:00+02:00');
const KEY = 'CLE-SECRETE';
const MIN = 60_000;
const DAY = 86_400_000;
const DOWN = (url: string): FakeResponse | null => (url.includes('/api/area/') ? respond('erreur', 503) : null);
const FRANCE = fx('firms-france-extrait.csv');
const MODIS = fx('firms-modis-nrt-extrait.csv');
const VIIRS_HEADER = `${FRANCE.split('\n')[0]}\n`;
const MODIS_HEADER = `${MODIS.split('\n')[0]}\n`;

/** Lignes réelles d'un satellite VIIRS (colonne satellite : N, N20, N21). */
function viirs(sat: string): string {
  const [header, ...lines] = FRANCE.trim().split('\n');
  return `${[header, ...lines.filter((l) => l.split(',')[7] === sat)].join('\n')}\n`;
}

/** FIRMS simulé : lecture de 2 jours par source, amorçage de 5 jours vide ; `override` force une réponse. */
function firms(override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    if (/\/5\/\d{4}-\d{2}-\d{2}$/.test(url)) return respond(url.includes('/MODIS_NRT/') ? MODIS_HEADER : VIIRS_HEADER);
    if (url.endsWith('/VIIRS_SNPP_NRT/-6,41,10,52/2')) return respond(viirs('N'));
    if (url.endsWith('/VIIRS_NOAA20_NRT/-6,41,10,52/2')) return respond(viirs('N20'));
    if (url.endsWith('/VIIRS_NOAA21_NRT/-6,41,10,52/2')) return respond(viirs('N21'));
    if (url.endsWith('/MODIS_NRT/-6,41,10,52/2')) return respond(MODIS);
    if (url === FIRMS_PUBLIC_CSV_URL) return respond(viirs('N') + fx('firms-viirs-snpp-nrt-extrait.csv').split('\n').slice(1).join('\n'));
    return respond('introuvable', 404);
  });
}

type Day = { cells: string[]; france: number; recurrent: number };

beforeEach(() => {
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => {} });
  vi.stubEnv('NASA_FIRMS_API_KEY', KEY);
  vi.stubEnv('FIRMS_API_KEY', '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); __setKvClientForTests(null); __resetKvForTests(); });

describe('collectFires : quatre produits NRT, France par département, 24 h glissantes', () => {
  it('foyers de France, détections hors de France comptées à part, sources datées par leur dernière acquisition', async () => {
    const log = firms();
    const body = await collectFires(NOW);
    expect(body.errors).toEqual([]);
    expect(body.readAt).toBe('2026-10-04T08:10:00.000Z');
    expect(body.lastAcquisitionAt).toBe('2026-10-04T03:00:00.000Z');
    expect(body.sources).toEqual([
      { id: 'VIIRS_SNPP_NRT', ok: true, lastAcquisitionAt: '2026-10-04T03:00:00.000Z' },
      { id: 'VIIRS_NOAA20_NRT', ok: true, lastAcquisitionAt: '2026-10-04T01:41:00.000Z' },
      { id: 'VIIRS_NOAA21_NRT', ok: true, lastAcquisitionAt: '2026-10-04T00:43:00.000Z' },
      { id: 'MODIS_NRT', ok: true, lastAcquisitionAt: '2026-10-03T08:48:00.000Z' },
    ]);
    expect(body.detections).toHaveLength(13);
    expect(new Set(body.detections.map((d) => d.dept))).toEqual(new Set(['13', '89', '58', '18', '03']));
    expect(body.foyers.map((f) => [f.dept, f.detections, f.passes, f.confirmed, f.recurrent, f.frpTotalMw])).toEqual([
      ['13', 8, 4, true, false, 21.12],
      ['89', 1, 1, false, false, 11.67],
      ['58', 2, 1, false, false, 9.49],
      ['03', 2, 1, false, false, 9.2],
    ]);
    // Sarre (Dillingen) et Luxembourg (Esch) en VIIRS, Ruhr en MODIS : jamais des feux de France.
    expect(body.abroadCount).toBe(6);
    expect(body.abroad.map((a) => a.satellite).sort()).toEqual(['NOAA-20', 'NOAA-20', 'NOAA-21', 'Suomi NPP', 'Terra', 'Terra']);
    // 4 lectures de 2 jours et 8 d'amorçage (J-9 et J-4, 5 jours) ; la clé n'est que dans le chemin des URL.
    expect(log.urls).toHaveLength(12);
    expect(log.urls.filter((u) => u.endsWith('/5/2026-09-25'))).toHaveLength(4);
    expect(log.urls.filter((u) => u.endsWith('/5/2026-09-30'))).toHaveLength(4);
    expect(log.urls.every((u) => u.startsWith(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${KEY}/`))).toBe(true);
  });
  it('historique : 10 jours amorcés, la veille complète (Dunkerque en MODIS à 04:32 hors des 24 h mais compté le 03/10)', async () => {
    firms();
    const body = await collectFires(NOW);
    expect(body.daily.since).toBe('2026-09-25');
    expect(body.daily.days.map((d) => d.date)).toEqual(lastDays('2026-10-04', 10));
    expect(body.daily.days.slice(-2)).toEqual([
      { date: '2026-10-03', france: 6, recurrent: 0 },
      { date: '2026-10-04', france: 8, recurrent: 0 },
    ]);
    const days = await kvGetJson(DAYS_KEY, NOW) as Record<string, Day>;
    expect(Object.keys(days)).toHaveLength(10);
    expect(days['2026-10-04'].cells).toContain(cellOf(43.43311, 4.88785));
    expect(await kvGetJson(BOOTSTRAP_KEY, NOW)).toBe('2026-10-04T08:10:00.000Z');
  });
  it('prochains passages estimés : passages observés il y a moins de 24 h, un par satellite à 30 min près', async () => {
    firms();
    expect((await collectFires(NOW)).nextPasses).toEqual([
      { satellite: 'Terra', expectedAt: '2026-10-04T08:48:00.000Z' },
      { satellite: 'NOAA-20', expectedAt: '2026-10-04T11:45:00.000Z' },
      { satellite: 'NOAA-21', expectedAt: '2026-10-04T12:27:00.000Z' },
      { satellite: 'NOAA-21', expectedAt: '2026-10-05T00:41:00.000Z' },
      { satellite: 'Suomi NPP', expectedAt: '2026-10-05T01:20:00.000Z' },
      { satellite: 'NOAA-20', expectedAt: '2026-10-05T01:39:00.000Z' },
      { satellite: 'Suomi NPP', expectedAt: '2026-10-05T03:00:00.000Z' },
    ]);
    expect(nextPassesOf([], NOW)).toEqual([]);
  });
  it('récurrence sur l’historique : Fos-sur-Mer vue 6 jours avant aujourd’hui devient « à vérifier », classée en dernier', async () => {
    const fos = cellOf(43.439, 4.894);
    const days = Object.fromEntries(lastDays('2026-10-04', 10).map((d, i) => [d, { cells: i >= 2 && i <= 7 ? [fos] : [], france: i >= 2 && i <= 7 ? 7 : 0, recurrent: i >= 2 && i <= 7 ? 7 : 0 }]));
    await kvSetJson(DAYS_KEY, days, 12 * 86_400, NOW);
    const log = firms();
    const body = await collectFires(NOW);
    expect(log.urls).toHaveLength(4);
    expect(body.foyers.map((f) => [f.dept, f.recurrent])).toEqual([['89', false], ['58', false], ['03', false], ['13', true]]);
    expect(body.detections.filter((d) => d.dept === '13').every((d) => d.recurrent)).toBe(true);
    expect(body.daily.days.find((d) => d.date === '2026-09-27')).toEqual({ date: '2026-09-27', france: 7, recurrent: 7 });
    expect(body.daily.days.slice(-2)).toEqual([
      { date: '2026-10-03', france: 6, recurrent: 0 },
      { date: '2026-10-04', france: 8, recurrent: 8 },
    ]);
  });
  it('CSV réduits à leur en-tête : aucune détection, ce n’est pas une panne', async () => {
    firms((url) => (url.endsWith('/2') ? respond(url.includes('/MODIS_NRT/') ? MODIS_HEADER : VIIRS_HEADER) : null));
    const body = await collectFires(NOW);
    expect([body.readAt, body.errors, body.detections, body.foyers, body.abroadCount]).toEqual(['2026-10-04T08:10:00.000Z', [], [], [], 0]);
    expect(body.sources.every((s) => s.ok && s.lastAcquisitionAt === null)).toBe(true);
  });
});

describe('pannes FIRMS (S3)', () => {
  it('une source en panne : réponse partielle, la source nommée, les trois autres gardées', async () => {
    firms((url) => (url.endsWith('/MODIS_NRT/-6,41,10,52/2') ? respond('erreur', 500) : null));
    const body = await collectFires(NOW);
    expect(body.errors).toEqual(['FIRMS, MODIS : HTTP 500']);
    expect(body.sources[3]).toEqual({ id: 'MODIS_NRT', ok: false, lastAcquisitionAt: null });
    expect([body.detections.length, body.abroadCount]).toEqual([13, 4]);
  });
  it('lignes au mauvais nombre de champs : écartées, comptées par source et nommées ; le reste de la source est gardé', async () => {
    firms((url) => {
      if (url.endsWith('/VIIRS_NOAA20_NRT/-6,41,10,52/2')) return respond(`${viirs('N20')}43.43311,4.88785,330.1\n47.1,3.2\n`);
      if (url.endsWith('/MODIS_NRT/-6,41,10,52/2')) return respond(`${MODIS}51.0,2.3,310.2,1.0\n`);
      return null;
    });
    const body = await collectFires(NOW);
    expect(body.errors).toEqual(['FIRMS, NOAA-20 : 2 lignes illisibles', 'FIRMS, MODIS : 1 ligne illisible']);
    expect([body.detections.length, body.abroadCount]).toEqual([13, 6]);
    expect(body.sources.every((s) => s.ok)).toBe(true);
  });
  it('lignes aux valeurs illisibles (confiance inconnue, FRP vide) : comptées avec celles au mauvais nombre de champs', async () => {
    const [line] = viirs('N20').trim().split('\n').slice(1);
    const cols = line.split(',');
    const badConfidence = cols.map((v, i) => (i === 9 ? 'z' : v)).join(',');
    const emptyFrp = cols.map((v, i) => (i === 12 ? '' : v)).join(',');
    firms((url) => (url.endsWith('/VIIRS_NOAA20_NRT/-6,41,10,52/2') ? respond(`${viirs('N20')}${badConfidence}\n${emptyFrp}\n47.1,3.2\n`) : null));
    const body = await collectFires(NOW);
    expect(body.errors).toEqual(['FIRMS, NOAA-20 : 3 lignes illisibles']);
    expect(body.detections).toHaveLength(13);
  });
  it('page HTML à la place du CSV : erreur nommée', async () => {
    firms((url) => (url.endsWith('/VIIRS_SNPP_NRT/-6,41,10,52/2') ? respond('<!DOCTYPE html><html><body>Maintenance</body></html>') : null));
    expect((await collectFires(NOW)).errors).toEqual(['FIRMS, Suomi NPP : CSV FIRMS illisible (en-tête inattendu)']);
  });
  it('clé refusée (HTTP 400 partout) : aucune collecte, quatre erreurs nommées, la clé n’apparaît nulle part ; essai mémorisé 15 min', async () => {
    const log = firms((url) => (url.includes('/api/area/') ? respond('Invalid MAP_KEY.', 400) : null));
    const body = await ensureFiresFresh(NOW);
    expect(body.readAt).toBeNull();
    expect(body.errors).toEqual(['FIRMS, Suomi NPP : HTTP 400', 'FIRMS, NOAA-20 : HTTP 400', 'FIRMS, NOAA-21 : HTTP 400', 'FIRMS, MODIS : HTTP 400']);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(log.urls).toHaveLength(4);
    await ensureFiresFresh(NOW + 5 * 60_000);
    expect(log.urls).toHaveLength(4);
  });
  it('erreur réseau dont le message cite l’URL : la clé est masquée', async () => {
    stubFetch((url) => {
      if (url.includes('NOAA20')) throw new TypeError(`fetch failed: ${url}`);
      return respond(VIIRS_HEADER);
    });
    const body = await collectFires(NOW);
    expect(body.errors.find((e) => e.startsWith('FIRMS, NOAA-20'))).toBe('FIRMS, NOAA-20 : réseau : fetch failed: https://firms.modaps.eosdis.nasa.gov/api/area/csv/***/VIIRS_NOAA20_NRT/-6,41,10,52/2');
    expect(JSON.stringify(body)).not.toContain(KEY);
  });
  it('panne totale après une collecte réussie : la dernière collecte reste servie avec sa propre date', async () => {
    firms();
    await ensureFiresFresh(NOW);
    firms((url) => (url.includes('/api/area/') ? respond('erreur', 503) : null));
    const later = await ensureFiresFresh(NOW + 16 * 60_000);
    expect(later.readAt).toBe('2026-10-04T08:10:00.000Z');
    expect(later.detections).toHaveLength(13);
    expect(later.errors).toHaveLength(4);
    expect(later.errors[0]).toBe('FIRMS, Suomi NPP : HTTP 503');
  });
  it('panne d’un jour : collecte servie avec sa date, sources en panne à ok: false, passages déjà passés retirés ; gardée jusqu’à ses 2 jours', async () => {
    firms();
    const first = await ensureFiresFresh(NOW);
    expect(first.nextPasses.length).toBeGreaterThan(0);
    firms(DOWN);
    const later = await ensureFiresFresh(NOW + DAY);
    expect([later.readAt, later.detections.length, later.foyers.length]).toEqual(['2026-10-04T08:10:00.000Z', 13, 4]);
    expect(later.sources).toEqual(first.sources.map((s) => ({ ...s, ok: false })));
    expect(later.nextPasses).toEqual([]);
    expect(later.errors).toHaveLength(4);
    // Essai mémorisé jusqu'aux 2 jours de la collecte (2 jours moins son âge), jamais au-delà.
    expect(await kvGetJson(LAST_KEY, NOW + 2 * DAY - MIN)).not.toBeNull();
    expect(await kvGetJson(LAST_KEY, NOW + 2 * DAY + MIN)).toBeNull();
  });
  it('collecte de plus de 2 jours : plus servie, panne nommée tant que les essais se suivent ; jamais plus d’un essai par 15 min', async () => {
    firms();
    await ensureFiresFresh(NOW);
    const log = firms(DOWN);
    expect((await ensureFiresFresh(NOW + 2 * DAY - 10 * MIN)).readAt).toBe('2026-10-04T08:10:00.000Z');
    expect(log.urls).toHaveLength(4);
    const expired = await ensureFiresFresh(NOW + 2 * DAY + MIN);
    expect(log.urls).toHaveLength(4);
    expect([expired.readAt, expired.detections, expired.foyers, expired.sources, expired.nextPasses]).toEqual([null, [], [], [], []]);
    expect(expired.errors).toEqual([
      'FIRMS, Suomi NPP : HTTP 503', 'FIRMS, NOAA-20 : HTTP 503', 'FIRMS, NOAA-21 : HTTP 503', 'FIRMS, MODIS : HTTP 503', TOO_OLD_ERROR,
    ]);
    expect(TOO_OLD_ERROR).toBe('FIRMS : dernière collecte de plus de 2 jours');
    // Essais suivants, toujours en panne : la panne reste nommée, un essai par 15 min.
    const next = await ensureFiresFresh(NOW + 2 * DAY + 4 * MIN);
    expect(log.urls).toHaveLength(8);
    expect([next.readAt, next.errors.at(-1)]).toEqual([null, TOO_OLD_ERROR]);
    await ensureFiresFresh(NOW + 2 * DAY + 10 * MIN);
    expect(log.urls).toHaveLength(8);
    expect((await ensureFiresFresh(NOW + 2 * DAY + 18 * MIN)).errors.at(-1)).toBe(TOO_OLD_ERROR);
    expect(log.urls).toHaveLength(12);
  });
  it('exception au milieu d’un cycle : nommée, essai mémorisé 15 min, dernière collecte gardée', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const log = firms();
      await ensureFiresFresh(NOW);
      vi.mocked(departementAt).mockImplementation(() => { throw new Error('polygones illisibles'); });
      const failed = await ensureFiresFresh(NOW + 16 * MIN);
      expect(log.urls).toHaveLength(16);
      expect([failed.readAt, failed.detections.length, failed.errors]).toEqual(['2026-10-04T08:10:00.000Z', 13, ['FIRMS, erreur inattendue : polygones illisibles']]);
      expect(quiet).toHaveBeenCalledTimes(1);
      const memo = await ensureFiresFresh(NOW + 17 * MIN);
      expect(log.urls).toHaveLength(16);
      expect(memo.errors).toEqual(['FIRMS, erreur inattendue : polygones illisibles']);
    } finally {
      vi.mocked(departementAt).mockRestore();
      quiet.mockRestore();
    }
  });
  it('clé absente : CSV public Suomi NPP seul, dit dans les erreurs, sans amorçage', async () => {
    vi.stubEnv('NASA_FIRMS_API_KEY', '');
    const log = firms();
    const body = await collectFires(NOW);
    expect(log.urls).toEqual([FIRMS_PUBLIC_CSV_URL]);
    expect(body.errors).toEqual([MISSING_KEY_ERROR]);
    expect(MISSING_KEY_ERROR).toBe('clé FIRMS absente : Suomi NPP seul (CSV public)');
    expect(body.sources).toEqual([{ id: 'VIIRS_SNPP_PUBLIC_24H', ok: true, lastAcquisitionAt: '2026-10-04T03:00:00.000Z' }]);
    expect(body.foyers.map((f) => [f.dept, f.detections, f.passes, f.confirmed])).toEqual([['13', 2, 2, true], ['13', 1, 1, false]]);
    expect(body.abroadCount).toBe(1);
  });
});

describe('cadence et amorçage', () => {
  it('une collecte toutes les 15 min (une minute de tolérance pour la relève) ; deux appels simultanés : un seul cycle', async () => {
    expect(FIRES_CADENCE_MS).toBe(15 * 60_000);
    expect(isFiresDue(null, NOW)).toBe(true);
    expect(isFiresDue('2026-10-04T08:10:00.000Z', NOW + 13 * 60_000)).toBe(false);
    expect(isFiresDue('2026-10-04T08:10:00.000Z', NOW + 14 * 60_000)).toBe(true);
    const log = firms();
    await Promise.all([ensureFiresFresh(NOW), ensureFiresFresh(NOW)]);
    expect(log.urls).toHaveLength(12);
    await ensureFiresFresh(NOW + 5 * 60_000);
    expect(log.urls).toHaveLength(12);
    await ensureFiresFresh(NOW + 16 * 60_000);
    expect(log.urls).toHaveLength(16);
  });
  it('redémarrage : collecte et essai relus du stockage clé-valeur, aucun cycle de plus avant 15 min', async () => {
    const redis = new Map<string, string>();
    __setKvClientForTests({ get: async (k: string) => redis.get(k) ?? null, set: async (k: string, v: string) => { redis.set(k, v); } });
    const log = firms();
    await ensureFiresFresh(NOW);
    expect(log.urls).toHaveLength(12);
    __resetKvForTests();
    const restarted = await ensureFiresFresh(NOW + 5 * MIN);
    expect(log.urls).toHaveLength(12);
    expect([restarted.readAt, restarted.detections.length, restarted.errors]).toEqual(['2026-10-04T08:10:00.000Z', 13, []]);
    // Essai en échec, puis redémarrage : l'essai reste mémorisé, la collecte servie avec sa date.
    const down = firms(DOWN);
    await ensureFiresFresh(NOW + 16 * MIN);
    expect(down.urls).toHaveLength(4);
    __resetKvForTests();
    const again = await ensureFiresFresh(NOW + 20 * MIN);
    expect(down.urls).toHaveLength(4);
    expect([again.readAt, again.errors.length]).toEqual(['2026-10-04T08:10:00.000Z', 4]);
    await ensureFiresFresh(NOW + 31 * MIN);
    expect(down.urls).toHaveLength(8);
  });
  it('amorçage en échec : nommé, et pas retenté avant le lendemain', async () => {
    const log = firms((url) => (/\/5\/\d{4}-\d{2}-\d{2}$/.test(url) ? respond('erreur', 500) : null));
    const first = await collectFires(NOW);
    expect(first.errors).toHaveLength(8);
    expect(first.errors[0]).toBe('FIRMS, amorçage Suomi NPP du 2026-09-25 : HTTP 500');
    expect(first.daily.days.map((d) => d.date)).toEqual(['2026-10-03', '2026-10-04']);
    await collectFires(NOW + 16 * 60_000);
    expect(log.urls).toHaveLength(16);
  });
});
