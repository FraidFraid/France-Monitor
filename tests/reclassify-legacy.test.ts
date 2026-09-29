import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { ensureEventTables, runEventPass } from '../api/_lib/news-events-db.js';
// @ts-expect-error — module JS sans déclaration de types
import { legacyNote, selectLegacyArticles, writeNotes, refreshLegacyEvents, listRank, selectLegacyGroqSerious, meteredClassify } from '../scripts/reclassify-legacy.mjs';
import { createTestSql, seedFeeds, insertArticles, type Sql } from './helpers/pglite-sql.ts';

const H = 60 * 60 * 1000;
const DAY = 24 * H;
const T0 = Date.parse('2026-09-27T06:00:00Z');
const BANGKOK = 'Thaïlande : l’état de catastrophe déclaré à Bangkok après des inondations meurtrières';
const RINER = 'Paris. Teddy Riner visé par des messages haineux : une enquête ouverte pour injures racistes';

let sql: Sql;

beforeEach(async () => {
  ({ sql } = await createTestSql());
  await seedFeeds(sql);
  await ensureEventTables(sql);
}, 30_000);

interface Legacy { id: number; eventId: number | null }

async function reclassify(now: number): Promise<{ legacy: Legacy[]; logged: number }> {
  const legacy: Legacy[] = await selectLegacyArticles(sql, new Date(now - 7 * DAY).toISOString());
  await writeNotes(sql, new Map(legacy.map((r) => [r.id, legacyNote(r)])));
  const eventIds = [...new Set(legacy.map((r) => r.eventId).filter((id) => id !== null))];
  return { legacy, logged: await refreshLegacyEvents(sql, eventIds, now) };
}

async function events(): Promise<Record<string, unknown>[]> {
  return sql`SELECT * FROM news_events ORDER BY id`;
}

async function logKinds(): Promise<string[]> {
  const rows = await sql`SELECT kind FROM news_event_log ORDER BY id`;
  return rows.map((r) => String(r.kind));
}

describe('legacyNote', () => {
  it('ancienne note Groq : gardée comme gravité signalée, plafonnée par le titre, confiance conservée', () => {
    expect(legacyNote({ id: 1, eventId: null, title: BANGKOK, description: null, category: 'floods', severity: 'critical', confidence: 0.75, classifierVersion: 'groq-1' }))
      .toEqual({ category: 'floods', severity: 'medium', confidence: 0.75, version: 'groq-1', reportedSeverity: 'critical', temporality: 'en_cours', zone: 'etranger', reasons: ['etranger'] });
  });

  it('ancienne note mots-clés : note kw-2 complète', () => {
    expect(legacyNote({ id: 2, eventId: null, title: 'Condamné pour terrorisme : un homme écroué', description: null, category: 'security', severity: 'critical', confidence: 0.9, classifierVersion: 'kw-1' }))
      .toMatchObject({ severity: 'low', reportedSeverity: 'high', temporality: 'passe', version: 'kw-2' });
  });
});

describe('rattrapage du classement', () => {
  it('renote les anciens articles et recalcule l’événement sans journaliser d’atténuation', async () => {
    await insertArticles(sql, [
      { id: 1, feedId: 'le-monde', title: BANGKOK, publishedAt: T0, category: 'floods', severity: 'critical' },
      { id: 2, feedId: 'france-info', title: BANGKOK, publishedAt: T0 + 0.5 * H, category: 'floods', severity: 'critical' },
      { id: 3, feedId: 'sud-ouest', title: BANGKOK, publishedAt: T0 + H, category: 'floods', severity: 'critical' },
    ]);
    await sql`UPDATE news_items SET classifier_version = 'groq-1', confidence = 0.75`;
    await runEventPass(sql, { now: T0 + 2 * H, insertedIds: [1, 2, 3] });
    expect((await events())[0]).toMatchObject({ severity: 'critical', independent_count: 3 });

    const { legacy, logged } = await reclassify(T0 + 3 * H);
    expect(legacy).toHaveLength(3);
    expect(logged).toBe(0);
    expect((await events())[0]).toMatchObject({ severity: 'medium', peak_severity: 'medium', zone: 'etranger', status: 'active' });
    const items = await sql`SELECT DISTINCT severity, reported_severity, classifier_version, zone, reasons FROM news_items`;
    expect(items).toEqual([{ severity: 'medium', reported_severity: 'critical', classifier_version: 'groq-1', zone: 'etranger', reasons: 'etranger' }]);
    expect(await logKinds()).toEqual(['created']);

    // Reprenable : un second passage ne trouve plus rien.
    expect((await reclassify(T0 + 3 * H)).legacy).toHaveLength(0);
  });

  it('laisse les articles déjà qualifiés et les événements de plus de 7 jours', async () => {
    await insertArticles(sql, [{ id: 1, feedId: 'le-monde', title: RINER, publishedAt: T0 - 10 * DAY, severity: 'critical' }]);
    await runEventPass(sql, { now: T0 - 10 * DAY + H, insertedIds: [1] });
    await insertArticles(sql, [
      { id: 2, feedId: 'le-monde', title: BANGKOK, publishedAt: T0, severity: 'critical' },
      { id: 3, feedId: 'france-info', title: BANGKOK, publishedAt: T0, severity: 'medium' },
    ]);
    await sql`UPDATE news_items SET reported_severity = 'critical', classifier_version = 'kw-2' WHERE id = 3`;
    await runEventPass(sql, { now: T0 + H, insertedIds: [2, 3] });

    const { legacy } = await reclassify(T0 + 2 * H);
    expect(legacy.map((r) => r.id)).toEqual([2]);
    const untouched = await sql`SELECT id, severity, reported_severity FROM news_items WHERE id IN (1, 3) ORDER BY id`;
    expect(untouched).toEqual([
      { id: 1, severity: 'critical', reported_severity: null },
      { id: 3, severity: 'medium', reported_severity: 'critical' },
    ]);
  });

  it('journalise encore les changements de statut dus au temps', async () => {
    await insertArticles(sql, [{ id: 1, feedId: 'le-monde', title: RINER, publishedAt: T0, severity: 'critical' }]);
    await runEventPass(sql, { now: T0 + H, insertedIds: [1] });
    const { logged } = await reclassify(T0 + 13 * H);
    expect(logged).toBe(1);
    expect((await events())[0].status).toBe('cooling');
    expect(await logKinds()).toEqual(['created', 'cooling']);
  });
});

describe('listRank', () => {
  it('reprend le tri de /api/events : gravité + corroboration, ou gravité signalée', () => {
    expect(listRank({ severity: 'medium', peakSeverity: 'medium', independentCount: 3 })).toBe(5);
    expect(listRank({ severity: 'medium', peakSeverity: 'critical', independentCount: 1 })).toBe(5);
    expect(listRank({ severity: 'low', peakSeverity: null, independentCount: 1 })).toBe(2);
  });
});

describe('mode --llm', () => {
  it('sélectionne les anciennes notes Groq restées graves, pas les autres', async () => {
    await insertArticles(sql, [
      { id: 1, feedId: 'le-monde', title: RINER, publishedAt: T0, severity: 'high' },
      { id: 2, feedId: 'france-info', title: BANGKOK, publishedAt: T0, severity: 'medium' },
      { id: 3, feedId: 'sud-ouest', title: 'Un attentat fait plusieurs morts dans une gare', publishedAt: T0, severity: 'critical' },
    ]);
    await sql`UPDATE news_items SET classifier_version = CASE WHEN id = 3 THEN 'groq-2' ELSE 'groq-1' END`;
    const targets = await selectLegacyGroqSerious(sql, new Date(T0 - 7 * DAY).toISOString());
    expect(targets).toEqual([{ id: 1, eventId: null }]);
  });

  it('refuse un appel qui dépasserait le budget, sans rien envoyer', async () => {
    const { classify, state } = meteredClassify({ budget: 1000, pauseMs: 0 });
    await expect(classify({ url: 'http://127.0.0.1:9', model: 'x', apiKey: '', version: 'llm-2' }, [{ title: 't', description: null }]))
      .rejects.toThrow(/budget de 1000 jetons/);
    expect(state.calls).toBe(0);
  });
});
