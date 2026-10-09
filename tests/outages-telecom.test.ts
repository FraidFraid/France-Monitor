// tests/outages-telecom.test.ts : collecteur Télécoms (spec 2026-10-08 § 2.1 ; faits § 1) sur les fichiers ARCEP réels réduits du 08/10
// et du 07/10. Comptes attendus : facts.md § 1 (jeu d'essai).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import {
  ARCEP_DATASET_URL, ARCEP_FILE_BASE, __resetTelecomForTests, arcepFileUrl, classifyTelecom, dedupeSites, ensureTelecomFresh, normalizeArcepFeature,
  summarizeTelecom,
} from '../api/_lib/outages-telecom.js';
import { respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/outages/${name}`, import.meta.url), 'utf8');
const TODAY = (): { features: unknown[] } => JSON.parse(fx('arcep-2026-10-08.geojson')) as { features: unknown[] };
const PREV = (): { features: unknown[] } => JSON.parse(fx('arcep-2026-10-07.geojson')) as { features: unknown[] };
const PUBLISHED = Date.parse('2026-10-08T09:02:20Z');
const NOW = Date.parse('2026-10-08T20:00:00Z');

const CATALOG = {
  resources: [
    { title: '2026-10-08.geojson', format: 'geojson', url: arcepFileUrl('2026-10-08'), last_modified: '2026-10-08T09:02:20+00:00' },
    { title: '2026-10-07.geojson', format: 'geojson', url: arcepFileUrl('2026-10-07'), last_modified: '2026-10-07T09:02:12+00:00' },
    { title: '2020-10-08.csv', format: 'csv', url: 'https://static.data.gouv.fr/x.csv', last_modified: '2020-10-08T17:19:28+00:00' },
  ],
};

function route(url: string) {
  if (url === ARCEP_DATASET_URL) return respond(CATALOG);
  if (url === arcepFileUrl('2026-10-08')) return respond(fx('arcep-2026-10-08.geojson'), 200, { 'last-modified': 'Thu, 08 Oct 2026 09:02:20 GMT' });
  if (url === arcepFileUrl('2026-10-07')) return respond(fx('arcep-2026-10-07.geojson'), 200, { 'last-modified': 'Wed, 07 Oct 2026 09:02:12 GMT' });
  return respond('introuvable', 404);
}

beforeEach(() => {
  __resetKvForTests();
  const store = new Map<string, string>();
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
  __resetTelecomForTests();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('normalisation ARCEP', () => {
  it('département sans espace final, voix et données agrégées lues telles quelles, technologies coupées, début en UTC', () => {
    const f = TODAY().features.find((x) => (x as { properties: { station_anfr: string } }).properties.station_anfr === '0272750260');
    const site = normalizeArcepFeature(f);
    expect(site).toMatchObject({ id: '0272750260:Bouygues Telecom', operator: 'Bouygues Telecom', dept: '27' });
    expect(site?.since === null || /Z$/.test(site?.since ?? '')).toBe(true);
    for (const raw of TODAY().features) {
      const s = normalizeArcepFeature(raw);
      if (!s) continue;
      expect(['HS', 'OK', null]).toContain(s.voice);
      expect(s.dept === null || /^(\d{2,3}|2A|2B)$/.test(s.dept)).toBe(true);
    }
  });
  it('« 2026-10-07 17:50:21 » (heure de Paris) devient 2026-10-07T15:50:21.000Z', () => {
    const f = { type: 'Feature', geometry: { type: 'Point', coordinates: [3.5, 49.4] }, properties: {
      operateur: 'Free', departement: '02 ', commune: 'X', code_insee: '02001', station_anfr: '1', voix2g: null, voix3g: 'HS', voix4g: 'OK',
      data3g: 'HS', data4g: 'OK', data5g: 'HS', voix: 'HS', data: 'HS', raison: 'INT', detail: null, debut: '2026-10-07 17:50:21', fin: null } };
    expect(normalizeArcepFeature(f)).toMatchObject({ since: '2026-10-07T15:50:21.000Z', techs: ['3G', '5G'], cause: 'incident' });
  });
  it('site sans station ni département (au large de Calais) : gardé, identifié par sa position, département null', () => {
    const sites = TODAY().features.map(normalizeArcepFeature).filter((s) => s !== null);
    const orphan = sites.find((s) => s.dept === null);
    expect(orphan).toMatchObject({ operator: 'SFR', id: 'SFR@1.18028,51.10528', cause: 'incident' });
  });
  it('entité sans coordonnées : écartée', () => {
    expect(normalizeArcepFeature({ type: 'Feature', geometry: null, properties: { operateur: 'Free', station_anfr: '9' } })).toBeNull();
  });
});

describe('classement et comptes (jeu d’essai du 08/10)', () => {
  it('dédoublonnage (station, opérateur) : incident avant maintenance', () => {
    const sites = TODAY().features.map(normalizeArcepFeature).filter((s) => s !== null);
    expect(sites).toHaveLength(35);
    const kept = dedupeSites(sites);
    expect(kept).toHaveLength(34);
    expect(kept.find((s) => s.id === '0272750260:Bouygues Telecom')?.cause).toBe('incident');
  });
  it('classes relatives à la publication du fichier : 18 récentes, 11 longues, 4 maintenances, 1 sans date', () => {
    const sites = classifyTelecom(dedupeSites(TODAY().features.map(normalizeArcepFeature).filter((s) => s !== null)), PUBLISHED);
    const count = (cls: string): number => sites.filter((s) => s.cls === cls).length;
    expect([count('recente'), count('longue'), count('maintenance'), count('sans-date')]).toEqual([18, 11, 4, 1]);
    const bands = sites.filter((s) => s.cls === 'longue').map((s) => s.band);
    expect(['1-3j', '3-7j', '7-30j', '30j+'].map((b) => bands.filter((x) => x === b).length)).toEqual([3, 2, 3, 3]);
    expect(sites[0].cls).toBe('recente');
  });
  it('par opérateur, par département et depuis la veille', () => {
    const today = classifyTelecom(dedupeSites(TODAY().features.map(normalizeArcepFeature).filter((s) => s !== null)), PUBLISHED);
    const prevIds = new Set(dedupeSites(PREV().features.map(normalizeArcepFeature).filter((s) => s !== null)).map((s) => s.id));
    const s = summarizeTelecom(today, prevIds);
    expect(s.summary).toMatchObject({ total: 34, recent: 18, long: 11, maintenance: 4, undated: 1, newSincePrevious: 23, resolvedSincePrevious: 3 });
    expect(s.byOperator.map((o) => [o.operator, o.recent])).toEqual([['Free', 7], ['Bouygues Telecom', 5], ['Orange', 4], ['SFR', 2]]);
    expect(s.byDept.slice(0, 4)).toEqual([{ dept: '02', recent: 6 }, { dept: '03', recent: 3 }, { dept: '13', recent: 3 }, { dept: '2B', recent: 3 }]);
    expect(s.byOperator.reduce((n, o) => n + o.voiceCut, 0)).toBe(10);
    expect(s.byOperator.reduce((n, o) => n + o.dataCut, 0)).toBe(15);
    expect(summarizeTelecom(today, null).summary).toMatchObject({ newSincePrevious: null, resolvedSincePrevious: null });
  });
});

describe('collecte', () => {
  it('fichier du jour par sonde directe (sans le catalogue), publication par Last-Modified, User-Agent FranceMonitor', async () => {
    const log = stubFetch(route);
    const body = await ensureTelecomFresh(NOW);
    expect(body.file).toEqual({ day: '2026-10-08', publishedAt: '2026-10-08T09:02:20.000Z' });
    expect(body.previousFile).toEqual({ day: '2026-10-07', publishedAt: '2026-10-07T09:02:12.000Z' });
    expect(body.summary?.recent).toBe(18);
    expect(body.sites).toHaveLength(34);
    expect(body.errors).toEqual([]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toMatch(/^FranceMonitor\//);
    expect(log.urls[0]).toBe(arcepFileUrl('2026-10-08'));
    expect(log.urls).not.toContain(ARCEP_DATASET_URL);
    expect(log.inits.every((i) => /^FranceMonitor\//.test(sentHeader(i, 'User-Agent') ?? ''))).toBe(true);
  });
  it('une seconde lecture dans les 30 min ne rappelle pas la source', async () => {
    const log = stubFetch(route);
    await ensureTelecomFresh(NOW);
    const calls = log.urls.length;
    await ensureTelecomFresh(NOW + 10 * 60_000);
    expect(log.urls.length).toBe(calls);
  });
  it('fichier du jour en 404 : le dernier lu reste servi avec sa date et l’erreur nommée', async () => {
    stubFetch(route);
    await ensureTelecomFresh(NOW);
    stubFetch((url) => (url === ARCEP_DATASET_URL ? respond('panne', 503) : respond('introuvable', 404)));
    const body = await ensureTelecomFresh(NOW + 31 * 60_000);
    expect(body.file?.day).toBe('2026-10-08');
    expect(body.errors[0]).toMatch(/^ARCEP/);
  });
  it('jamais lu et source en panne : réponse vide, summary null, jamais 0', async () => {
    stubFetch(() => respond('panne', 503));
    const body = await ensureTelecomFresh(NOW);
    expect(body.summary).toBeNull();
    expect(body.file).toBeNull();
    expect(body.errors.length).toBeGreaterThan(0);
  });
  it('historique : un point par fichier lu, compte des pannes récentes', async () => {
    stubFetch(route);
    const body = await ensureTelecomFresh(NOW);
    expect(body.history.at(-1)).toEqual({ day: '2026-10-08', recent: 18 });
  });
  it('fichier du jour pas encore publié (9 h) : la veille est servie, le jour manquant est sondé en premier', async () => {
    const MORNING = Date.parse('2026-10-08T07:00:00Z');
    vi.setSystemTime(MORNING);
    const log = stubFetch((url) => (url === arcepFileUrl('2026-10-07')
      ? respond(fx('arcep-2026-10-07.geojson'), 200, { 'last-modified': 'Wed, 07 Oct 2026 09:02:12 GMT' }) : respond('introuvable', 404)));
    const body = await ensureTelecomFresh(MORNING);
    expect(log.urls.slice(0, 2)).toEqual([arcepFileUrl('2026-10-08'), arcepFileUrl('2026-10-07')]);
    expect(body.file).toEqual({ day: '2026-10-07', publishedAt: '2026-10-07T09:02:12.000Z' });
    expect(body.previousFile).toBeNull();
    expect(body.errors).toEqual(['ARCEP, fichier précédent : introuvable sur 10 jours']);
    expect(body.summary?.newSincePrevious).toBeNull();
  });
  it('fichier introuvable sur 10 jours et catalogue vide : réponse vide nommée, dix sondes, jamais 0', async () => {
    const log = stubFetch((url) => (url === ARCEP_DATASET_URL ? respond({ resources: [] }) : respond('introuvable', 404)));
    const body = await ensureTelecomFresh(NOW);
    const probes = log.urls.filter((u) => u.startsWith(ARCEP_FILE_BASE));
    expect(probes).toHaveLength(10);
    expect(probes[9]).toBe(arcepFileUrl('2026-09-29'));
    expect(body.file).toBeNull();
    expect(body.summary).toBeNull();
    expect(body.errors[0]).toMatch(/^ARCEP : fichier introuvable sur 10 jours/);
  });
  it('catalogue data.gouv en repli seulement : sondes à vide, fichier lu à l’URL du catalogue', async () => {
    const hosted = 'https://static.example.test/arcep';
    const log = stubFetch((url) => {
      if (url === ARCEP_DATASET_URL) {
        return respond({ resources: [
          { title: '2026-10-08.geojson', format: 'geojson', url: `${hosted}/2026-10-08.geojson`, last_modified: '2026-10-08T09:02:20+00:00' },
          { title: '2026-10-07.geojson', format: 'geojson', url: `${hosted}/2026-10-07.geojson`, last_modified: '2026-10-07T09:02:12+00:00' },
        ] });
      }
      if (url === `${hosted}/2026-10-08.geojson`) return respond(fx('arcep-2026-10-08.geojson'));
      if (url === `${hosted}/2026-10-07.geojson`) return respond(fx('arcep-2026-10-07.geojson'));
      return respond('introuvable', 404);
    });
    const body = await ensureTelecomFresh(NOW);
    expect(log.urls.slice(0, 10).every((u) => u.startsWith(ARCEP_FILE_BASE))).toBe(true);
    expect(log.urls[10]).toBe(ARCEP_DATASET_URL);
    expect(body.file).toEqual({ day: '2026-10-08', publishedAt: '2026-10-08T09:02:20.000Z' });
    expect(body.previousFile?.day).toBe('2026-10-07');
    expect(body.errors).toEqual([]);
  });
  it('panne de la source (HTTP 503) sur le fichier du jour : pas de repli sur la veille, erreur nommée', async () => {
    const log = stubFetch(() => respond('panne', 503));
    const body = await ensureTelecomFresh(NOW);
    expect(log.urls).toEqual([arcepFileUrl('2026-10-08')]);
    expect(body.errors).toEqual(['ARCEP : HTTP 503']);
  });
  it('rattrapage : le fichier précédent déjà lu n’est jamais retéléchargé, jours absents retenus', async () => {
    const log = stubFetch(route);
    await ensureTelecomFresh(NOW);
    expect(log.urls.filter((u) => u === arcepFileUrl('2026-10-07'))).toHaveLength(1);
    expect(log.urls.filter((u) => u === arcepFileUrl('2026-10-08'))).toHaveLength(1);
    // Cinq jours d'archive absents (404) tentés au plus par collecte ; la suivante passe aux cinq jours suivants.
    expect(log.urls.filter((u) => u.startsWith(ARCEP_FILE_BASE))).toHaveLength(2 + 5);
    await ensureTelecomFresh(NOW + 31 * 60_000);
    const probed = log.urls.filter((u) => u.startsWith(ARCEP_FILE_BASE));
    expect(new Set(probed).size).toBe(probed.length - 1);
    expect(probed.filter((u) => u === arcepFileUrl('2026-10-06'))).toHaveLength(1);
  });
  it('échec : attemptedAt gardé, nouvel essai après 5 min seulement, dernières données conservées', async () => {
    stubFetch(route);
    await ensureTelecomFresh(NOW);
    const down = stubFetch(() => respond('panne', 503));
    await ensureTelecomFresh(NOW + 31 * 60_000);
    const calls = down.urls.length;
    expect(calls).toBeGreaterThan(0);
    const early = await ensureTelecomFresh(NOW + 34 * 60_000);
    expect(down.urls.length).toBe(calls);
    expect(early.file?.day).toBe('2026-10-08');
    expect(early.errors[0]).toMatch(/^ARCEP/);
    const retry = stubFetch(route);
    const later = await ensureTelecomFresh(NOW + 37 * 60_000);
    expect(retry.urls.length).toBeGreaterThan(0);
    expect(later.errors).toEqual([]);
  });
  it('jour suivant : le fichier de la veille déjà lu sert de précédent sans retéléchargement', async () => {
    stubFetch(route);
    await ensureTelecomFresh(NOW);
    const NEXT = Date.parse('2026-10-09T10:00:00Z');
    vi.setSystemTime(NEXT);
    const log = stubFetch((url) => (url === arcepFileUrl('2026-10-09')
      ? respond(fx('arcep-2026-10-07.geojson'), 200, { 'last-modified': 'Fri, 09 Oct 2026 09:02:20 GMT' }) : respond('introuvable', 404)));
    const body = await ensureTelecomFresh(NEXT);
    expect(body.file?.day).toBe('2026-10-09');
    expect(body.previousFile).toEqual({ day: '2026-10-08', publishedAt: '2026-10-08T09:02:20.000Z' });
    expect(log.urls).not.toContain(arcepFileUrl('2026-10-08'));
    expect(body.history.map((h) => h.day).slice(-2)).toEqual(['2026-10-08', '2026-10-09']);
  });
  it('historique : un jour republié garde un seul point', async () => {
    stubFetch(route);
    await ensureTelecomFresh(NOW);
    stubFetch((url) => (url === arcepFileUrl('2026-10-08')
      ? respond(fx('arcep-2026-10-08.geojson'), 200, { 'last-modified': 'Thu, 08 Oct 2026 12:30:00 GMT' }) : route(url)));
    const body = await ensureTelecomFresh(NOW + 31 * 60_000);
    expect(body.file?.publishedAt).toBe('2026-10-08T12:30:00.000Z');
    expect(body.history.filter((h) => h.day === '2026-10-08')).toHaveLength(1);
  });
  it('fichier du jour mal formé (200 sans entités) : dernières données gardées, erreur nommée, jamais 0 panne', async () => {
    stubFetch(route);
    const before = await ensureTelecomFresh(NOW);
    const malformed = ['{}', '{"error":"quota"}', '{"features":[{"type":"Feature","geometry":null,"properties":{}}]}'];
    for (const [i, bad] of malformed.entries()) {
      const log = stubFetch((url) => (url === arcepFileUrl('2026-10-08') ? respond(bad, 200, { 'last-modified': 'Thu, 08 Oct 2026 12:30:00 GMT' }) : route(url)));
      const body = await ensureTelecomFresh(NOW + (31 + 10 * i) * 60_000);
      expect(log.urls.length).toBeGreaterThan(0);
      expect(body.errors[0]).toMatch(/^ARCEP : GeoJSON sans entité/);
      expect(body.file).toEqual(before.file);
      expect(body.summary).toEqual(before.summary);
      expect(body.history).toEqual(before.history);
    }
  });
  it('fichier du jour mal formé et jamais lu : réponse vide, summary null, pas de point d’historique', async () => {
    stubFetch((url) => (url === arcepFileUrl('2026-10-08') ? respond('{}', 200, { 'last-modified': 'Thu, 08 Oct 2026 09:02:20 GMT' }) : respond('introuvable', 404)));
    const body = await ensureTelecomFresh(NOW);
    expect(body.summary).toBeNull();
    expect(body.file).toBeNull();
    expect(body.history).toEqual([]);
    expect(body.errors).toEqual(['ARCEP : GeoJSON sans entités']);
  });
  it('un fichier valide sans aucune panne reste un fichier lu (0 réel)', async () => {
    stubFetch((url) => (url === arcepFileUrl('2026-10-08') ? respond('{"features":[]}', 200, { 'last-modified': 'Thu, 08 Oct 2026 09:02:20 GMT' }) : route(url)));
    const body = await ensureTelecomFresh(NOW);
    expect(body.summary).toMatchObject({ total: 0, recent: 0 });
    expect(body.errors).toEqual([]);
  });
  it('fichier précédent mal formé : courant servi, comparaison n.d., erreur nommée', async () => {
    stubFetch((url) => (url === arcepFileUrl('2026-10-07') ? respond('{}', 200, { 'last-modified': 'Wed, 07 Oct 2026 09:02:12 GMT' }) : route(url)));
    const body = await ensureTelecomFresh(NOW);
    expect(body.file?.day).toBe('2026-10-08');
    expect(body.previousFile).toBeNull();
    expect(body.summary).toMatchObject({ recent: 18, newSincePrevious: null, resolvedSincePrevious: null });
    expect(body.errors).toEqual(['ARCEP, fichier précédent : GeoJSON sans entités']);
  });
  it('fichier précédent seul en panne (503) : courant servi, comparaison n.d., pas de relecture avant 5 min, puis précédent lu', async () => {
    const down = (url: string) => (url === arcepFileUrl('2026-10-07') ? respond('panne', 503) : route(url));
    const log = stubFetch(down);
    const first = await ensureTelecomFresh(NOW);
    expect(first.file?.day).toBe('2026-10-08');
    expect(first.previousFile).toBeNull();
    expect(first.summary).toMatchObject({ recent: 18, newSincePrevious: null, resolvedSincePrevious: null });
    expect(first.errors).toEqual(['ARCEP, fichier précédent : HTTP 503']);
    const calls = log.urls.length;
    const early = await ensureTelecomFresh(NOW + 4 * 60_000);
    expect(log.urls.length).toBe(calls);
    expect(early.errors).toEqual(['ARCEP, fichier précédent : HTTP 503']);
    const fixed = stubFetch(route);
    const later = await ensureTelecomFresh(NOW + 6 * 60_000);
    expect(fixed.urls).toContain(arcepFileUrl('2026-10-07'));
    expect(later.previousFile).toEqual({ day: '2026-10-07', publishedAt: '2026-10-07T09:02:12.000Z' });
    expect(later.summary).toMatchObject({ newSincePrevious: 23, resolvedSincePrevious: 3 });
    expect(later.errors).toEqual([]);
  });
});
