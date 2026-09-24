// api/_lib/news-events-db.js — persistance des événements dans Neon (appelé par le cron d'ingestion).
//
// Tables (idempotentes, créées au besoin par ensureEventTables et par scripts/init-db.mjs) :
//   news_events     un événement : agrégat de ses articles (titre, gravité, corroboration, statut)
//   news_event_log  journal des changements (créé, aggravé, corroboré, refroidi, clos, rouvert)
//   news_items.event_id  rattachement de chaque article à son événement
// Toute la logique de décision est dans event-clustering.js et event-model.js (pures) ;
// ce module ne fait que lire, appeler ces fonctions, puis écrire par lots (unnest).

import { planEventAssignments } from './event-clustering.js';
import { summarizeEvent, eventStatusAt, diffEvent } from './event-model.js';

export const EVENTS_BUDGET_PER_TICK = 1000;
const WINDOW_HOURS = 72;
// Les membres couvrent la fenêtre de rattachement (72 h avant) plus les 6 h « après ».
const MEMBER_WINDOW_HOURS = 78;
const RETENTION_DAYS = 90;

/** @typedef {(strings: TemplateStringsArray, ...params: unknown[]) => Promise<Record<string, unknown>[]>} Sql */

/** @param {Sql} sql */
export async function ensureEventTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS news_events (
    id bigserial PRIMARY KEY,
    seed_article_id bigint UNIQUE NOT NULL,
    title text NOT NULL,
    category text NOT NULL DEFAULT 'general',
    severity text NOT NULL DEFAULT 'info',
    first_seen timestamptz NOT NULL,
    last_seen timestamptz NOT NULL,
    article_count int NOT NULL DEFAULT 1,
    source_count int NOT NULL DEFAULT 1,
    independent_count int NOT NULL DEFAULT 1,
    source_names text[] NOT NULL DEFAULT '{}',
    lat double precision,
    lon double precision,
    status text NOT NULL DEFAULT 'active',
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_news_events_last_seen ON news_events (last_seen DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS news_event_log (
    id bigserial PRIMARY KEY,
    event_id bigint NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    kind text NOT NULL,
    from_value text,
    to_value text
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_news_event_log_at ON news_event_log (at DESC)`;
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS event_id bigint`;
  await sql`CREATE INDEX IF NOT EXISTS idx_news_items_event ON news_items (event_id)`;
}

const toMs = (v) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));
const toNum = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Rattache les articles récents non encore regroupés, recalcule les événements touchés,
 * journalise les changements, fait vieillir les statuts et purge au-delà de 90 jours.
 * @param {Sql} sql
 * @param {{ insertedIds?: number[], now?: number, deadline?: number, budget?: number }} [options]
 */
export async function runEventPass(sql, options = {}) {
  const now = options.now ?? Date.now();
  const deadline = options.deadline ?? Infinity;
  const insertedIds = options.insertedIds ?? [];
  const budget = options.budget ?? EVENTS_BUDGET_PER_TICK;
  const windowStart = new Date(now - WINDOW_HOURS * 3600_000).toISOString();
  const memberStart = new Date(now - MEMBER_WINDOW_HOURS * 3600_000).toISOString();
  const stats = { considered: 0, created: 0, attached: 0, skipped: 0, ambiguous: 0, logged: 0, statusChanges: 0 };

  // Date effective : publication, bornée à collecte + 1 h (certains flux annoncent 2034).
  const pending = await sql`
    SELECT n.id, n.title,
           LEAST(coalesce(n.published_at, n.collected_at), n.collected_at + interval '1 hour') AS effective_at,
           n.lat, n.lon
    FROM news_items n
    WHERE n.event_id IS NULL
      AND n.collected_at > ${windowStart}
      AND coalesce((to_jsonb(n)->>'is_noise')::boolean, false) = false
    ORDER BY (n.id = ANY(${insertedIds}::bigint[])) DESC, n.collected_at ASC
    LIMIT ${budget}
  `;
  stats.considered = pending.length;

  if (pending.length > 0 && Date.now() < deadline) {
    const members = await sql`
      SELECT n.id, n.event_id, n.title,
             LEAST(coalesce(n.published_at, n.collected_at), n.collected_at + interval '1 hour') AS effective_at,
             n.lat, n.lon
      FROM news_items n
      WHERE n.event_id IS NOT NULL AND n.collected_at > ${memberStart}
    `;
    const plan = planEventAssignments(
      pending.map((r) => ({ id: Number(r.id), title: String(r.title), publishedAt: toMs(r.effective_at), lat: toNum(r.lat), lon: toNum(r.lon) })),
      members.map((r) => ({ articleId: Number(r.id), eventId: Number(r.event_id), title: String(r.title), publishedAt: toMs(r.effective_at), lat: toNum(r.lat), lon: toNum(r.lon) })),
    );
    stats.skipped = plan.skipped.length;
    stats.ambiguous = plan.ambiguous.length;

    // Chaque requête Neon HTTP est sa propre transaction : l'ordre des écritures rend la passe
    // reprenable. Le rattachement des articles est écrit EN DERNIER ; tant qu'il n'a pas eu
    // lieu, les articles restent en attente et le passage suivant refait tout à l'identique
    // (graines idempotentes, agrégats recalculés, « créé » décidé par l'absence de journal).

    // 1. Événements « graines » (un par nouvel événement), idempotent grâce à seed_article_id.
    const seedIds = plan.seeds;
    const seedRows = new Map(pending.map((r) => [Number(r.id), r]));
    const seedToEvent = new Map();
    if (seedIds.length > 0) {
      const titles = seedIds.map((id) => String(seedRows.get(id).title));
      const seen = seedIds.map((id) => new Date(toMs(seedRows.get(id).effective_at)).toISOString());
      await sql`
        INSERT INTO news_events (seed_article_id, title, first_seen, last_seen)
        SELECT * FROM unnest(${seedIds}::bigint[], ${titles}::text[], ${seen}::timestamptz[], ${seen}::timestamptz[])
        ON CONFLICT (seed_article_id) DO NOTHING
      `;
      const rows = await sql`SELECT id, seed_article_id FROM news_events WHERE seed_article_id = ANY(${seedIds}::bigint[])`;
      for (const r of rows) seedToEvent.set(Number(r.seed_article_id), Number(r.id));
    }

    // 2. Rattachements décidés (graines et ajouts), pas encore écrits.
    /** @type {Map<number, number>} article → événement */
    const assignments = new Map();
    for (const seed of seedIds) {
      const eventId = seedToEvent.get(seed);
      if (eventId !== undefined) assignments.set(seed, eventId);
    }
    for (const a of plan.attaches) {
      const eventId = 'eventId' in a.target ? a.target.eventId : seedToEvent.get(a.target.seedArticleId);
      if (eventId !== undefined) assignments.set(a.articleId, eventId);
    }
    stats.attached = plan.attaches.length;

    // 3. Agrégats et journal des événements touchés, articles en attente compris.
    const touched = [...new Set(assignments.values())];
    if (touched.length > 0) {
      const refreshed = await refreshEvents(sql, touched, assignments, now);
      stats.created = refreshed.created;
      stats.logged += refreshed.logged;
    }

    // 4. Rattachement des articles, en dernier (voir plus haut).
    if (assignments.size > 0) {
      await sql`
        UPDATE news_items AS n SET event_id = v.event_id
        FROM unnest(${[...assignments.keys()]}::bigint[], ${[...assignments.values()]}::bigint[]) AS v(id, event_id)
        WHERE n.id = v.id
      `;
    }
  }

  // 4. Rétention alignée sur news_items (90 jours), AVANT le vieillissement : un événement
  //    purgé ne doit pas laisser d'entrée « clos » orpheline dans le journal.
  const cutoff = new Date(now - RETENTION_DAYS * 86_400_000).toISOString();
  await sql`DELETE FROM news_event_log WHERE at < ${cutoff}`;
  await sql`DELETE FROM news_events WHERE last_seen < ${cutoff}`;
  // 5. Vieillissement des statuts (actif → refroidissement → clos).
  const aging = await sql`
    SELECT id, severity, independent_count, status, last_seen
    FROM news_events
    WHERE status <> 'closed' AND last_seen < ${new Date(now - 12 * 3600_000).toISOString()}
  `;
  const statusIds = [];
  const statusValues = [];
  const log = [];
  for (const r of aging) {
    const next = eventStatusAt(toMs(r.last_seen), now);
    if (next === r.status) continue;
    statusIds.push(Number(r.id));
    statusValues.push(next);
    const before = { severity: String(r.severity), independentCount: Number(r.independent_count), status: String(r.status) };
    for (const entry of diffEvent(before, { ...before, status: next })) log.push({ eventId: Number(r.id), ...entry });
  }
  if (statusIds.length > 0) {
    await sql`
      UPDATE news_events AS e SET status = v.status, updated_at = now()
      FROM unnest(${statusIds}::bigint[], ${statusValues}::text[]) AS v(id, status)
      WHERE e.id = v.id
    `;
    stats.statusChanges = statusIds.length;
    stats.logged += await writeLog(sql, log, now);
  }

  return stats;
}

/**
 * Recalcule les agrégats des événements touchés et écrit leur journal. Les articles en attente
 * (`assignments`, pas encore rattachés en base) comptent déjà dans l'agrégat. Un événement
 * sans aucune entrée de journal est « créé » : décision reprenable après un passage interrompu.
 * @param {Sql} sql
 * @param {number[]} eventIds
 * @param {Map<number, number>} assignments  article en attente → événement
 * @param {number} now
 * @returns {Promise<{ logged: number, created: number }>}
 */
async function refreshEvents(sql, eventIds, assignments, now) {
  const pendingIds = [...assignments.keys()];
  const rows = await sql`
    SELECT n.id, n.event_id, n.title, n.feed_id, f.name AS feed_name, f.tier,
           LEAST(coalesce(n.published_at, n.collected_at), n.collected_at + interval '1 hour') AS effective_at,
           n.category, n.severity, n.lat, n.lon
    FROM news_items n LEFT JOIN feeds f ON f.id = n.feed_id
    WHERE n.event_id = ANY(${eventIds}::bigint[]) OR n.id = ANY(${pendingIds}::bigint[])
  `;
  const current = await sql`
    SELECT e.id, e.severity, e.independent_count, e.status,
           EXISTS (SELECT 1 FROM news_event_log l WHERE l.event_id = e.id) AS logged
    FROM news_events e WHERE e.id = ANY(${eventIds}::bigint[])
  `;
  const before = new Map(current.map((r) => [Number(r.id), r.logged === true
    ? { severity: String(r.severity), independentCount: Number(r.independent_count), status: String(r.status) }
    : null]));
  const byEvent = new Map();
  for (const r of rows) {
    const id = assignments.get(Number(r.id)) ?? Number(r.event_id);
    if (!byEvent.has(id)) byEvent.set(id, []);
    byEvent.get(id).push({
      id: Number(r.id), title: String(r.title), feedId: String(r.feed_id), feedName: r.feed_name === null ? null : String(r.feed_name),
      tier: toNum(r.tier), publishedAt: toMs(r.effective_at), category: r.category === null ? null : String(r.category),
      severity: r.severity === null ? null : String(r.severity), lat: toNum(r.lat), lon: toNum(r.lon),
    });
  }
  const cols = { id: [], title: [], category: [], severity: [], first: [], last: [], articles: [], sources: [], independent: [], names: [], lat: [], lon: [], status: [] };
  const log = [];
  let created = 0;
  for (const [id, articles] of byEvent) {
    const agg = summarizeEvent(articles);
    const status = eventStatusAt(agg.lastSeen, now);
    cols.id.push(id); cols.title.push(agg.title); cols.category.push(agg.category); cols.severity.push(agg.severity);
    cols.first.push(new Date(agg.firstSeen).toISOString()); cols.last.push(new Date(agg.lastSeen).toISOString());
    cols.articles.push(agg.articleCount); cols.sources.push(agg.sourceCount); cols.independent.push(agg.independentCount);
    cols.names.push(JSON.stringify(agg.sourceNames)); cols.lat.push(agg.lat); cols.lon.push(agg.lon); cols.status.push(status);
    const previous = before.get(id) ?? null;
    if (previous === null) created += 1;
    for (const entry of diffEvent(previous, { severity: agg.severity, independentCount: agg.independentCount, status })) log.push({ eventId: id, ...entry });
  }
  if (cols.id.length === 0) return { logged: 0, created };
  await sql`
    UPDATE news_events AS e SET
      title = v.title, category = v.category, severity = v.severity,
      first_seen = v.first_seen, last_seen = v.last_seen,
      article_count = v.article_count, source_count = v.source_count, independent_count = v.independent_count,
      source_names = ARRAY(SELECT jsonb_array_elements_text(v.names::jsonb)),
      lat = v.lat, lon = v.lon, status = v.status, updated_at = now()
    FROM unnest(
      ${cols.id}::bigint[], ${cols.title}::text[], ${cols.category}::text[], ${cols.severity}::text[],
      ${cols.first}::timestamptz[], ${cols.last}::timestamptz[], ${cols.articles}::int[], ${cols.sources}::int[],
      ${cols.independent}::int[], ${cols.names}::text[], ${cols.lat}::float8[], ${cols.lon}::float8[], ${cols.status}::text[]
    ) AS v(id, title, category, severity, first_seen, last_seen, article_count, source_count, independent_count, names, lat, lon, status)
    WHERE e.id = v.id
  `;
  return { logged: await writeLog(sql, log, now), created };
}

/** @param {Sql} sql @param {Array<{ eventId: number, kind: string, from: string | null, to: string | null }>} entries @param {number} now */
async function writeLog(sql, entries, now) {
  if (entries.length === 0) return 0;
  const at = new Date(now).toISOString();
  await sql`
    INSERT INTO news_event_log (event_id, at, kind, from_value, to_value)
    SELECT v.event_id, ${at}::timestamptz, v.kind, v.from_value, v.to_value
    FROM unnest(${entries.map((e) => e.eventId)}::bigint[], ${entries.map((e) => e.kind)}::text[],
                ${entries.map((e) => e.from)}::text[], ${entries.map((e) => e.to)}::text[]) AS v(event_id, kind, from_value, to_value)
  `;
  return entries.length;
}
