#!/usr/bin/env node
// scripts/reclassify-legacy.mjs — rattrapage du classement (29/09/2026).
//
// Les articles notés avant kw-2 / groq-2 (reported_severity NULL, collectés avant le 28/09 16:30 UTC)
// gardaient leur ancienne gravité ; un événement étant recalculé sur TOUS ses articles, les sujets
// longs restaient rouges ou orange (38 des 40 premiers événements en production le 29/09).
//
// Méthode = colonne « mots-clés seuls » du rejeu (replayKeywords, docs/classification.md) : kw-2
// pour les articles notés par mots-clés ; pour ceux notés par l'ancienne passe Groq, leur note
// plafonnée par les règles du titre. Aucun appel LLM. Portée : articles collectés depuis 7 jours et
// articles des événements vus depuis 7 jours (une liste d'événements ne montre que les 48 dernières
// heures). Événements recalculés par le code de l'ingestion (refreshEvents) sans journal de gravité.
// Reprenable : seules les lignes encore sans reported_severity sont touchées.
//
// Mode --llm (après le rattrapage) : les anciennes notes Groq (groq-1, invite sans grille) restées
// high/critical sont renotées par la passe LLM de production (runLlmPass, grille groq-2), puis leurs
// événements recalculés. Quota Groq gratuit partagé avec la production : pause entre les appels
// (8 000 jetons/min) et plafond de dépense (--budget, 50 000 jetons par défaut). Reprenable.
//
//   node --env-file=.env.development.local scripts/reclassify-legacy.mjs           # essai à blanc
//   node --env-file=.env.development.local scripts/reclassify-legacy.mjs --apply   # écrit en base
//   node --env-file=.env --env-file=.env.development.local scripts/reclassify-legacy.mjs --llm [--apply] [--budget 50000]
import { pathToFileURL } from 'node:url';
import { classify } from '../api/_lib/server-classifier.js';
import { summarizeEvent, SEVERITY_RANK } from '../api/_lib/event-model.js';
import { encodeReasons } from '../api/_lib/classification-columns.js';
import { loadEventArticles, refreshEvents } from '../api/_lib/news-events-db.js';
import { classifierLlmConfig, classifyBatch, LLM_BATCH_SIZE } from '../api/_lib/llm-classifier.js';
import { runLlmPass } from '../api/_lib/llm-pass.js';
import { replayKeywords } from './replay-classification.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 2000;
const UPDATE_CHUNK = 500;
const EVENT_CHUNK = 200;
const LIST_STATUSES = ['active', 'cooling'];
const LIST_LIMIT = 40;
const LLM_PAUSE_MS = 25_000;
const LLM_DEFAULT_BUDGET = 50_000;
/** Estimation par appel (rejeu du 28/09 : ~52 000 jetons pour ~26 appels). */
const TOKENS_PER_CALL = 2_000;

/** @typedef {import('../api/_lib/news-events-db.js').Sql} Sql */

/**
 * @typedef {{ id: number, eventId: number | null, title: string, description: string | null,
 *   category: string | null, severity: string | null, confidence: number | null, classifierVersion: string | null }} LegacyRow
 * @typedef {{ category: string, severity: string, confidence: number, version: string,
 *   reportedSeverity: string, temporality: string, zone: string, reasons: string[] }} Note
 */

/**
 * @param {LegacyRow} row
 * @returns {Note}
 */
export function legacyNote(row) {
  const byGroq = typeof row.classifierVersion === 'string' && row.classifierVersion.startsWith('groq-');
  const note = replayKeywords({
    scoredBy: byGroq ? 'groq' : 'keywords',
    title: row.title,
    description: row.description,
    category: row.category ?? 'general',
    severity: row.severity ?? 'info',
  });
  // replayKeywords ne rend pas la confiance : celle des mots-clés vient de classify(), celle de
  // l'ancienne passe Groq est gardée.
  const confidence = byGroq ? (row.confidence ?? 0) : classify(row.title, row.description ?? undefined).confidence;
  return {
    category: note.category, severity: note.severity, confidence, version: note.scoredBy,
    reportedSeverity: note.reportedSeverity, temporality: note.temporality, zone: note.zone, reasons: note.reasons,
  };
}

/**
 * @param {Sql} sql
 * @param {string} since  ISO
 * @returns {Promise<LegacyRow[]>}
 */
export async function selectLegacyArticles(sql, since) {
  /** @type {LegacyRow[]} */
  const out = [];
  let cursor = 0;
  for (;;) {
    const rows = await sql`
      SELECT n.id, n.event_id, n.title, n.description, n.category, n.severity, n.confidence, n.classifier_version
      FROM news_items n
      WHERE n.reported_severity IS NULL AND n.id > ${cursor}
        AND (n.collected_at > ${since}
             OR n.event_id IN (SELECT e.id FROM news_events e WHERE e.last_seen > ${since}))
      ORDER BY n.id
      LIMIT ${PAGE_SIZE}
    `;
    for (const r of rows) {
      out.push({
        id: Number(r.id), eventId: r.event_id == null ? null : Number(r.event_id), title: String(r.title),
        description: r.description == null ? null : String(r.description), category: r.category == null ? null : String(r.category),
        severity: r.severity == null ? null : String(r.severity), confidence: r.confidence == null ? null : Number(r.confidence),
        classifierVersion: r.classifier_version == null ? null : String(r.classifier_version),
      });
    }
    if (rows.length < PAGE_SIZE) return out;
    cursor = Number(rows[rows.length - 1].id);
  }
}

/**
 * @param {Sql} sql
 * @param {Map<number, Note>} notes  article → nouvelle note
 */
export async function writeNotes(sql, notes) {
  const entries = [...notes.entries()];
  for (let i = 0; i < entries.length; i += UPDATE_CHUNK) {
    const chunk = entries.slice(i, i + UPDATE_CHUNK);
    /** @template T @param {(n: Note) => T} pick */
    const col = (pick) => chunk.map(([, n]) => pick(n));
    await sql`
      UPDATE news_items AS n SET
        category = v.category, severity = v.severity, confidence = v.confidence, classifier_version = v.version,
        reported_severity = v.reported, temporality = v.temporality, zone = v.zone, reasons = v.reasons
      FROM unnest(
        ${chunk.map(([id]) => id)}::bigint[], ${col((n) => n.category)}::text[], ${col((n) => n.severity)}::text[],
        ${col((n) => n.confidence)}::real[], ${col((n) => n.version)}::text[], ${col((n) => n.reportedSeverity)}::text[],
        ${col((n) => n.temporality)}::text[], ${col((n) => n.zone)}::text[], ${col((n) => encodeReasons(n.reasons))}::text[]
      ) AS v(id, category, severity, confidence, version, reported, temporality, zone, reasons)
      WHERE n.id = v.id AND n.reported_severity IS NULL
    `;
  }
}

/**
 * Recalcule les événements par le code de l'ingestion, sans journal de gravité.
 * @param {Sql} sql
 * @param {number[]} eventIds
 * @param {number} now
 */
export async function refreshLegacyEvents(sql, eventIds, now) {
  let logged = 0;
  for (let i = 0; i < eventIds.length; i += EVENT_CHUNK) {
    logged += (await refreshEvents(sql, eventIds.slice(i, i + EVENT_CHUNK), new Map(), now, { journal: false })).logged;
  }
  return logged;
}

/**
 * Rang de tri de /api/events (api/_lib/news-events-read.js listEvents), rangs à partir de 1.
 * @param {{ severity: string, peakSeverity: string | null, independentCount: number }} e
 */
export function listRank(e) {
  const rank = (/** @type {string} */ s) => (SEVERITY_RANK[s] ?? 0) + 1;
  return Math.max(rank(e.severity) + Math.min(e.independentCount - 1, 2), rank(e.peakSeverity ?? e.severity));
}

/**
 * Les 40 premiers événements que /api/events servirait, avec les agrégats donnés.
 * @param {Array<{ id: number, title: string, severity: string, peakSeverity: string | null, independentCount: number, lastSeen: number }>} events
 */
export function topOfList(events) {
  return events
    .filter((e) => !(e.severity === 'info' && e.independentCount < 2))
    .sort((a, b) => listRank(b) - listRank(a) || b.lastSeen - a.lastSeen || b.id - a.id)
    .slice(0, LIST_LIMIT);
}

/** @param {Array<{ severity: string }>} items */
function distribution(items) {
  /** @type {Record<string, number>} */
  const out = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const it of items) out[it.severity] = (out[it.severity] ?? 0) + 1;
  return out;
}

/** @param {Sql} sql */
async function listedEvents(sql) {
  const rows = await sql`
    SELECT id, title, severity, to_jsonb(e)->>'peak_severity' AS peak_severity, independent_count, last_seen
    FROM news_events e WHERE status = ANY(${LIST_STATUSES}::text[])
  `;
  return rows.map((r) => ({
    id: Number(r.id), title: String(r.title), severity: String(r.severity),
    peakSeverity: r.peak_severity == null ? null : String(r.peak_severity),
    independentCount: Number(r.independent_count), lastSeen: r.last_seen instanceof Date ? r.last_seen.getTime() : Date.parse(String(r.last_seen)),
  }));
}

/** @param {string} label @param {Array<{ severity: string, peakSeverity: string | null, title: string }>} top */
function printTop(label, top) {
  console.log(`${label} : ${JSON.stringify(distribution(top))}`);
  for (const e of top.filter((x) => x.severity === 'high' || x.severity === 'critical')) {
    console.log(`   ${e.severity.padEnd(8)} ${e.title.slice(0, 100)}`);
  }
}

/**
 * Anciennes notes Groq restées high/critical dans la portée du rattrapage.
 * @param {Sql} sql
 * @param {string} since  ISO
 */
export async function selectLegacyGroqSerious(sql, since) {
  const rows = await sql`
    SELECT n.id, n.event_id
    FROM news_items n
    WHERE n.classifier_version = 'groq-1' AND n.severity IN ('high', 'critical')
      AND (n.collected_at > ${since}
           OR n.event_id IN (SELECT e.id FROM news_events e WHERE e.last_seen > ${since}))
  `;
  return rows.map((r) => ({ id: Number(r.id), eventId: r.event_id == null ? null : Number(r.event_id) }));
}

/**
 * Appel LLM de production, espacé et compté ; au-delà du budget, lève une erreur qui arrête la passe.
 * @param {{ budget: number, pauseMs: number }} options
 */
export function meteredClassify({ budget, pauseMs }) {
  const state = { tokens: 0, calls: 0 };
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init) => {
    const res = await fetch(input, init);
    const body = /** @type {{ usage?: { total_tokens?: number } } | null} */ (await res.clone().json().catch(() => null));
    state.tokens += body?.usage?.total_tokens ?? 0;
    return res;
  };
  /** @type {typeof classifyBatch} */
  const classify = async (llm, articles) => {
    if (state.tokens + TOKENS_PER_CALL > budget) throw new Error(`budget de ${budget} jetons atteint (${state.tokens} dépensés)`);
    if (state.calls > 0) await new Promise((r) => setTimeout(r, pauseMs));
    state.calls += 1;
    return classifyBatch(llm, articles, { fetchImpl });
  };
  return { classify, state };
}

/** @param {Sql} sql @param {string} since @param {boolean} apply */
async function mainLlm(sql, since, apply) {
  const budgetArg = process.argv.indexOf('--budget');
  const budget = budgetArg > 0 ? Number(process.argv[budgetArg + 1]) : LLM_DEFAULT_BUDGET;
  const llm = classifierLlmConfig(process.env);
  if (!llm) throw new Error('LLM non configuré (GROQ_API_KEY ou CLASSIFIER_LLM_* absents : ajouter --env-file=.env)');
  const targets = await selectLegacyGroqSerious(sql, since);
  const calls = Math.ceil(targets.length / LLM_BATCH_SIZE);
  console.log(`Anciennes notes Groq restées high/critical : ${targets.length} → ${calls} appels, ~${calls * TOKENS_PER_CALL} jetons (budget ${budget}, ${llm.model})`);
  if (!apply) {
    console.log('Essai à blanc : aucun appel, rien n’a été écrit. Relancer avec --apply.');
    return;
  }
  const { classify, state } = meteredClassify({ budget, pauseMs: LLM_PAUSE_MS });
  const outcome = await runLlmPass(sql, {
    llm, insertedIds: targets.map((t) => t.id), keywordVersion: 'groq-1', deadline: Infinity,
    batchesPerTick: calls, classify,
  });
  const renoted = await sql`SELECT id FROM news_items WHERE id = ANY(${targets.map((t) => t.id)}::bigint[]) AND classifier_version <> 'groq-1'`;
  const renotedIds = new Set(renoted.map((r) => Number(r.id)));
  const eventIds = [...new Set(targets.filter((t) => renotedIds.has(t.id) && t.eventId !== null).map((t) => /** @type {number} */ (t.eventId)))];
  const logged = await refreshLegacyEvents(sql, eventIds, Date.now());
  console.log(`LLM : ${JSON.stringify(outcome)} ; ${state.tokens} jetons ; ${renotedIds.size} articles renotés ; ${eventIds.length} événements recalculés, ${logged} entrées de statut au journal.`);
  const left = targets.length - renotedIds.size;
  if (left > 0) console.log(`Reste ${left} articles : relancer plus tard (reprenable).`);
  printTop('40 premiers événements en base APRÈS', topOfList(await listedEvents(sql)));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL absente (lancer avec --env-file=.env.development.local)');
  const { neon } = await import('@neondatabase/serverless');
  const sql = /** @type {Sql} */ (/** @type {unknown} */ (neon(url)));
  const now = Date.now();
  const since = new Date(now - 7 * DAY_MS).toISOString();
  if (process.argv.includes('--llm')) return mainLlm(sql, since, apply);

  const legacy = await selectLegacyArticles(sql, since);
  /** @type {Map<number, Note>} */
  const notes = new Map(legacy.map((row) => [row.id, legacyNote(row)]));
  const eventIds = [...new Set(legacy.map((r) => r.eventId).filter((id) => id !== null))];
  const byGroq = legacy.filter((r) => r.classifierVersion?.startsWith('groq-')).length;
  console.log(`Articles à reclasser : ${legacy.length} (dont ${byGroq} notés par l'ancienne passe Groq) ; événements concernés : ${eventIds.length}`);
  console.log(`  articles avant : ${JSON.stringify(distribution(legacy.map((r) => ({ severity: r.severity ?? 'info' }))))}`);
  console.log(`  articles après : ${JSON.stringify(distribution([...notes.values()]))}`);

  if (!apply) {
    // Simulation des agrégats avec les nouvelles notes, même calcul que refreshEvents.
    /** @type {Map<number, { severity: string, peakSeverity: string, independentCount: number }>} */
    const simulated = new Map();
    for (let i = 0; i < eventIds.length; i += EVENT_CHUNK) {
      const byEvent = await loadEventArticles(sql, eventIds.slice(i, i + EVENT_CHUNK), new Map());
      for (const [id, articles] of byEvent) {
        const renoted = articles.map((/** @type {{ id: number }} */ a) => {
          const n = notes.get(a.id);
          return n ? { ...a, category: n.category, severity: n.severity, zone: n.zone, temporality: n.temporality, reasons: n.reasons } : a;
        });
        const agg = summarizeEvent(renoted);
        simulated.set(id, { severity: agg.severity, peakSeverity: agg.peakSeverity, independentCount: agg.independentCount });
      }
    }
    const listed = await listedEvents(sql);
    printTop('40 premiers événements AVANT', topOfList(listed));
    printTop('40 premiers événements APRÈS (simulation)', topOfList(listed.map((e) => ({ ...e, ...(simulated.get(e.id) ?? {}) }))));
    console.log('\nEssai à blanc : rien n’a été écrit. Relancer avec --apply pour appliquer.');
    return;
  }

  await writeNotes(sql, notes);
  const logged = await refreshLegacyEvents(sql, eventIds, Date.now());
  console.log(`Écrit : ${notes.size} articles, ${eventIds.length} événements recalculés, ${logged} entrées de statut au journal.`);
  printTop('40 premiers événements en base APRÈS', topOfList(await listedEvents(sql)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
