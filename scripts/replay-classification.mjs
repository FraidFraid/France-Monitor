#!/usr/bin/env node
/**
 * replay-classification.mjs — Rejoue kw-2 (+ LLM en option) et la qualification d'événement sur un
 * instantané local (scripts/snapshot-classification.mjs). Lecture seule : aucune écriture en base.
 * Spec : docs/superpowers/specs/2026-09-28-classification-evenements-design.md § 5.3.
 *
 *   node scripts/replay-classification.mjs .superpowers/classification/snapshot-AAAA-MM-JJ.json
 *   node --env-file-if-exists=.env scripts/replay-classification.mjs <instantané> --groq
 *
 * --groq : repasse par le LLM configuré les articles high/critical de groq-1 et les candidats
 * high/critical de kw-2 (~30 appels, ~50 000 jetons) sur le quota GRATUIT partagé avec la
 * production : à lancer UNE fois. Les autres articles gardent leur note (approximation, spec § 5.3).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classify, titleQualification, TITLE_REASON_CAP } from '../api/_lib/server-classifier.js';
import { corroboratedSeverity, qualifyEvent, mediaGroupOf, SEVERITY_RANK } from '../api/_lib/event-model.js';
import { classifierLlmConfig, classifyBatch, qualifyJudgment, LLM_BATCH_SIZE } from '../api/_lib/llm-classifier.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABELS = path.join(ROOT, 'tests/fixtures/classification/labels.json');
// 8 000 jetons/min chez Groq (palier gratuit) et ~2 500 jetons par lot : 25 s entre deux lots,
// une seule nouvelle tentative après 60 s sur un 429.
const LLM_PAUSE_MS = 25_000;
const LLM_RETRY_MS = 60_000;
const SERIOUS = new Set(['high', 'critical']);

/** @param {{ scoredBy: string | null, title: string, description: string | null, category: string, severity: string }} article */
export function replayKeywords(article) {
  if (article.scoredBy === 'groq') {
    const q = titleQualification(article.title);
    const capped = SEVERITY_RANK[article.severity] > SEVERITY_RANK[q.maxSeverity] ? q.maxSeverity : article.severity;
    const reasons = q.reasons.filter((/** @type {'passe' | 'hypothetique' | 'etranger'} */ r) => SEVERITY_RANK[article.severity] > SEVERITY_RANK[TITLE_REASON_CAP[r]]);
    return { category: article.category, severity: capped, reportedSeverity: article.severity, temporality: q.temporality, zone: q.zone, reasons, scoredBy: 'groq-1' };
  }
  const r = classify(article.title, article.description ?? undefined);
  return { category: r.category, severity: r.severity, reportedSeverity: r.reportedSeverity, temporality: r.temporality, zone: r.zone, reasons: r.reasons, scoredBy: 'kw-2' };
}

/**
 * @param {Array<{ id: number, title: string, severity: string, articleIds: number[] }>} events
 * @param {Map<number, { severity: string, zone?: string | null, temporality?: string | null, reasons?: string[] }>} notesById
 * @param {Map<number, string>} feedById
 */
export function replayEvents(events, notesById, feedById) {
  return events.map((e) => {
    const members = e.articleIds
      .filter((id) => notesById.has(id) && feedById.has(id))
      .map((id) => ({ feedId: /** @type {string} */ (feedById.get(id)), ...notesById.get(id) }));
    if (members.length === 0) {
      return { ...e, newSeverity: e.severity, peakSeverity: e.severity, zone: null, temporality: null, reasons: [], groups: 0, known: 0 };
    }
    const newSeverity = corroboratedSeverity(members);
    return {
      ...e,
      newSeverity,
      ...qualifyEvent(members, newSeverity),
      groups: new Set(members.map((m) => mediaGroupOf(m.feedId))).size,
      known: members.length,
    };
  });
}

/**
 * @param {Array<{ id: number, title?: string, expected: { severity: string, inFrance: boolean, ongoing: boolean } | null }>} labels
 * @param {Map<number, { severity: string, category?: string }>} notesById
 */
export function labelMetrics(labels, notesById) {
  const R = SEVERITY_RANK;
  const rows = labels.filter((l) => l.expected && notesById.has(l.id));
  const note = (/** @type {{ id: number }} */ l) => /** @type {{ severity: string, category?: string }} */ (notesById.get(l.id));
  const isOver = (/** @type {any} */ l) => R[l.expected.severity] <= R.medium && note(l).severity === 'critical';
  const isSerious = (/** @type {any} */ l) => R[l.expected.severity] >= R.high;
  const isKept = (/** @type {any} */ l) => R[note(l).severity] >= R.medium;
  const serious = rows.filter(isSerious);
  /** @type {Record<string, { total: number, serious: number, kept: number, overCritical: number }>} */
  const byCategory = {};
  for (const l of rows) {
    const c = note(l).category ?? 'general';
    byCategory[c] ??= { total: 0, serious: 0, kept: 0, overCritical: 0 };
    byCategory[c].total += 1;
    if (isSerious(l)) byCategory[c].serious += 1;
    if (isSerious(l) && isKept(l)) byCategory[c].kept += 1;
    if (isOver(l)) byCategory[c].overCritical += 1;
  }
  return {
    total: rows.length,
    overCritical: rows.filter(isOver),
    seriousCount: serious.length,
    recall: serious.length ? serious.filter(isKept).length / serious.length : 1,
    foreignAbove: rows.filter((l) => l.expected?.inFrance === false && R[note(l).severity] > R.medium),
    byCategory,
  };
}

/** @param {Array<Record<string, any>>} articles @param {Map<number, Record<string, any>>} notes @param {import('../api/_lib/llm-classifier.js').LlmConfig} llm */
async function replayLlm(articles, notes, llm) {
  const targets = articles.filter((a) => {
    const n = notes.get(a.id);
    return (a.scoredBy === 'groq' && SERIOUS.has(a.severity)) || (n?.scoredBy === 'kw-2' && SERIOUS.has(n.severity));
  });
  const total = Math.ceil(targets.length / LLM_BATCH_SIZE);
  for (let s = 0; s < targets.length; s += LLM_BATCH_SIZE) {
    const batch = targets.slice(s, s + LLM_BATCH_SIZE);
    let judgments;
    try {
      judgments = await classifyBatch(llm, batch);
    } catch (err) {
      if (/** @type {{ status?: number }} */ (err).status !== 429) throw err;
      console.log(`LLM : quota par minute atteint, nouvelle tentative dans ${LLM_RETRY_MS / 1000} s`);
      await new Promise((r) => setTimeout(r, LLM_RETRY_MS));
      judgments = await classifyBatch(llm, batch);
    }
    if (judgments) {
      batch.forEach((a, k) => {
        const j = judgments[k];
        if (j) notes.set(a.id, { category: j.category, ...qualifyJudgment(j, titleQualification(a.title)), scoredBy: llm.version });
      });
    }
    console.log(`LLM : lot ${s / LLM_BATCH_SIZE + 1}/${total}${judgments ? '' : ' (illisible, ignoré)'}`);
    if (s + LLM_BATCH_SIZE < targets.length) await new Promise((r) => setTimeout(r, LLM_PAUSE_MS));
  }
  return targets.length;
}

/** @param {Iterable<string>} severities */
function countBySeverity(severities) {
  /** @type {Record<string, number>} */
  const out = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const s of severities) out[s] = (out[s] ?? 0) + 1;
  return out;
}

async function main() {
  const file = process.argv[2];
  const withLlm = process.argv.includes('--groq');
  if (!file) throw new Error('usage : replay-classification.mjs <instantané.json> [--groq]');
  const snapshot = JSON.parse(await readFile(file, 'utf8'));
  const articles = snapshot.articles;

  /** @type {Map<number, Record<string, any>>} */
  const notes = new Map(articles.map((/** @type {Record<string, any>} */ a) => [a.id, replayKeywords(a)]));
  if (withLlm) {
    const llm = classifierLlmConfig(process.env);
    if (!llm) throw new Error('aucun LLM configuré : lancer avec node --env-file-if-exists=.env (GROQ_API_KEY)');
    console.log(`${await replayLlm(articles, notes, llm)} articles repassés par le LLM (${llm.version})`);
  }

  const feedById = new Map(articles.map((/** @type {Record<string, any>} */ a) => [a.id, a.feedId]));
  const events = replayEvents(snapshot.events, notes, feedById);

  console.log(`\nInstantané ${snapshot.takenAt} — ${articles.length} articles, ${events.length} événements${withLlm ? ' (avec LLM)' : ' (mots-clés seuls)'}`);
  console.table({
    'articles avant': countBySeverity(articles.map((/** @type {Record<string, any>} */ a) => a.severity)),
    'articles après': countBySeverity([...notes.values()].map((n) => n.severity)),
    'événements avant': countBySeverity(events.map((e) => e.severity)),
    'événements après': countBySeverity(events.map((e) => e.newSeverity)),
  });

  const graves = events.filter((e) => SERIOUS.has(e.newSeverity)).sort((a, b) => SEVERITY_RANK[b.newSeverity] - SEVERITY_RANK[a.newSeverity]);
  const toConfirm = events.filter((e) => SERIOUS.has(e.peakSeverity) && SEVERITY_RANK[e.peakSeverity] > SEVERITY_RANK[e.newSeverity]);
  console.log('\nÉvénements retenus high/critical (à lire : défendables ? étrangers ?)');
  for (const e of graves) console.log(`  ${e.newSeverity.padEnd(8)} ${String(e.groups).padStart(2)} gr.  ${e.zone ?? '—'}  ${String(e.title).slice(0, 100)}`);
  console.log(`\nÀ confirmer (signalé high/critical, non corroboré) : ${toConfirm.length}`);
  for (const e of toConfirm) console.log(`  signalé ${e.peakSeverity.padEnd(8)} retenu ${e.newSeverity.padEnd(6)} ${String(e.title).slice(0, 90)}`);

  const critical = events.filter((e) => e.newSeverity === 'critical').length;
  console.log(`\nCritère ≤ 3 événements critical : ${critical} → ${critical <= 3 ? 'OK' : 'ÉCHEC'}`);
  const foreignGraves = graves.filter((e) => e.zone === 'etranger');
  console.log(`Critère aucun événement étranger > medium (zone calculée) : ${foreignGraves.length} → ${foreignGraves.length === 0 ? 'OK' : 'ÉCHEC'}`);

  /** @type {Record<string, unknown>} */
  let metrics = {};
  if (existsSync(LABELS)) {
    const labels = JSON.parse(await readFile(LABELS, 'utf8'));
    const m = labelMetrics(labels, notes);
    metrics = { ...m, overCritical: m.overCritical.map((l) => l.id), foreignAbove: m.foreignAbove.map((l) => l.id) };
    console.log(`\nJeu annoté : ${m.total} articles présents dans l'instantané`);
    console.log(`Critère aucun annoté ≤ medium sorti critical : ${m.overCritical.length} → ${m.overCritical.length === 0 ? 'OK' : 'ÉCHEC'}`);
    for (const l of m.overCritical) console.log(`    ${l.id} ${l.title}`);
    console.log(`Critère ≥ 80 % des annotés high+ restent ≥ medium : ${(m.recall * 100).toFixed(0)} % sur ${m.seriousCount} → ${m.recall >= 0.8 ? 'OK' : 'ÉCHEC'}`);
    console.log(`Critère aucun annoté hors France > medium${withLlm ? '' : ' (indicatif sans --groq)'} : ${m.foreignAbove.length} → ${m.foreignAbove.length === 0 ? 'OK' : 'ÉCHEC'}`);
    for (const l of m.foreignAbove) console.log(`    ${l.id} ${l.title}`);
    console.log('\nPar catégorie (total annotés, graves, graves gardés ≥ medium, sur-critiques)');
    console.table(m.byCategory);
  }

  const out = path.join(ROOT, '.superpowers/classification', `replay-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(out, JSON.stringify({ snapshot: file, withLlm, critical, metrics, graves, toConfirm }, null, 2));
  console.log(`\nRapport → ${path.relative(ROOT, out)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
