import { describe, it, expect, beforeAll, vi } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { ensureEventTables, runEventPass } from '../api/_lib/news-events-db.js';
// @ts-expect-error — module JS sans déclaration de types
import { listEvents, getEventDetail, listChanges, parseSince, parseStatuses, parseLimit, mapEventRow } from '../api/_lib/news-events-read.js';
// @ts-expect-error — module JS sans déclaration de types
import eventsHandler from '../api/_handlers/events.js';
import { createTestSql, seedFeeds, insertArticles, type Sql } from './helpers/pglite-sql.ts';

const H = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-23T06:00:00Z');
const RINER = 'Paris. Teddy Riner visé par des messages haineux : une enquête ouverte pour injures racistes';

describe('paramètres', () => {
  it('parseSince borne à [maintenant − 7 j, maintenant] et retombe sur 24 h', () => {
    const now = T0;
    expect(parseSince(null, now).getTime()).toBe(now - 24 * H);
    expect(parseSince('pas une date', now).getTime()).toBe(now - 24 * H);
    expect(parseSince(String(now + H), now).getTime()).toBe(now - 24 * H);
    expect(parseSince('2026-09-01T00:00:00Z', now).getTime()).toBe(now - 7 * 24 * H);
    expect(parseSince(new Date(now - 3 * H).toISOString(), now).getTime()).toBe(now - 3 * H);
  });

  it('parseStatuses ignore les valeurs inconnues ; parseLimit borne à 1..100', () => {
    expect(parseStatuses(null)).toEqual(['active', 'cooling']);
    expect(parseStatuses('closed,bogus')).toEqual(['closed']);
    expect(parseLimit('500')).toBe(100);
    expect(parseLimit('0')).toBe(1);
    expect(parseLimit(null)).toBe(40);
  });

  it('mapEventRow expose l’identifiant de preuve E<id>', () => {
    const e = mapEventRow({ id: '42', title: 't', category: 'weather', severity: 'high', status: 'active', first_seen: '2026-09-23T06:00:00Z', last_seen: '2026-09-23T07:00:00Z', article_count: 3, source_count: 3, independent_count: 2, source_names: ['A'], lat: null, lon: null });
    expect(e).toMatchObject({ id: 42, evidenceId: 'E42', firstSeen: '2026-09-23T06:00:00.000Z', lat: null });
  });
});

describe('lecture (Postgres embarqué)', () => {
  let sql: Sql;
  beforeAll(async () => {
    ({ sql } = await createTestSql());
    await seedFeeds(sql);
    await ensureEventTables(sql);
    await insertArticles(sql, [
      { id: 1, feedId: 'le-progres', title: RINER, publishedAt: T0, severity: 'medium' },
      { id: 2, feedId: 'le-monde', title: RINER, publishedAt: T0 + H, severity: 'medium' },
      { id: 3, feedId: 'sud-ouest', title: 'Bordeaux : un marché de producteurs inauguré place des Quinconces', publishedAt: T0, category: 'general', severity: 'info' },
      { id: 4, feedId: 'france-info', title: 'Explosion dans une usine chimique de Seine-Maritime, plan particulier déclenché', publishedAt: T0 + H, severity: 'critical' },
    ]);
    await runEventPass(sql, { now: T0 + 2 * H, insertedIds: [1, 2, 3, 4] });
  });

  it('liste sans le bruit « info » mono-source, gravité puis corroboration en tête', async () => {
    const events = await listEvents(sql, { statuses: ['active', 'cooling'], limit: 10 });
    expect(events.map((e: { title: string }) => e.title)).toEqual([
      'Explosion dans une usine chimique de Seine-Maritime, plan particulier déclenché',
      RINER,
    ]);
    expect(events[1]).toMatchObject({ independentCount: 2, sourceNames: ['Le Progrès', 'Le Monde'] });
  });

  it('détaille un événement avec ses articles et son journal', async () => {
    const [top] = await listEvents(sql, { statuses: ['active'], limit: 1 });
    const riner = (await listEvents(sql, { statuses: ['active'], limit: 10 }))[1];
    const detail = await getEventDetail(sql, riner.id);
    expect(detail.articles.map((a: { feedName: string }) => a.feedName)).toEqual(['Le Progrès', 'Le Monde']);
    expect(detail.log.map((l: { kind: string }) => l.kind)).toEqual(['created']);
    expect(await getEventDetail(sql, top.id + 999)).toBeNull();
  });

  it('fil des changements : totaux complets, détail limité aux changements notables', async () => {
    const out = await listChanges(sql, new Date(T0 - H));
    expect(out.totals).toEqual({ created: 3 });
    const detailed = out.changes.map((c: { kind: string; event: { severity: string } }) => [c.kind, c.event.severity]).sort();
    expect(detailed).toEqual([['created', 'critical'], ['created', 'medium']]);
  });

  it('détaille un événement né déjà corroboré, même de gravité moyenne (relecture finale #4)', async () => {
    const out = await listChanges(sql, new Date(T0 - H));
    const titles = out.changes.map((c: { event: { title: string } }) => c.event.title);
    expect(titles).toContain(RINER);
    expect(titles).not.toContain('Bordeaux : un marché de producteurs inauguré place des Quinconces');
  });
});

describe('handler /api/events', () => {
  function mockRes() {
    const res = {
      statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string>,
      setHeader(k: string, v: string) { res.headers[k.toLowerCase()] = v; },
      status(c: number) { res.statusCode = c; return res; },
      json(b: unknown) { res.body = b; return res; },
    };
    return res;
  }

  it('405 hors GET, 503 explicite sans DATABASE_URL', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const post = mockRes();
    await eventsHandler({ method: 'POST', url: '/api/events' }, post);
    expect(post.statusCode).toBe(405);
    const get = mockRes();
    await eventsHandler({ method: 'GET', url: '/api/events' }, get);
    expect(get.statusCode).toBe(503);
    expect(get.body).toEqual({ error: 'events database not configured' });
    vi.unstubAllEnvs();
  });
});
