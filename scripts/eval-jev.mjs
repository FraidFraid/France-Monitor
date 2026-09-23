#!/usr/bin/env node
/**
 * scripts/eval-jev.mjs — Jeu d'évaluation Jev (TypeSafe) hors ligne.
 *
 * Cf. docs/audit-2026-09-chargement-jev-ui.md §4.7, étape 1 : avant d'activer
 * NEWS_SCORING en production, mesurer l'accord entre Jev et un étiquetage
 * humain sur un échantillon réel, et estimer le coût. Aucune dépendance npm
 * (fetch natif Node 18+), deux sous-commandes :
 *
 *   node scripts/eval-jev.mjs --export 300
 *     Télécharge les 300 derniers articles depuis
 *     https://www.francemonitor.com/api/news?limit=300 et écrit
 *     data/jev-eval/articles.csv avec des colonnes d'étiquette VIDES à
 *     remplir à la main :
 *       - labelRelevant   : 0 ou 1 (pertinent pour le tableau de bord ?)
 *       - labelSeverity   : 0 à 4 (échelle de la question `severity`, §4.3)
 *       - labelInFrance   : 0 ou 1
 *
 *   TYPESAFE_API_KEY=sk-... node scripts/eval-jev.mjs --run data/jev-eval/articles.csv
 *     Ne traite que les lignes entièrement étiquetées. Score chaque article
 *     avec les mêmes questions/politique que le cron d'ingestion
 *     (api/_lib/jev-questions.js + jev-policy.js), puis affiche :
 *       - accord pertinence  : (labelRelevant==1) vs (!derived.noise)
 *       - accord gravité     : exact, et à ±1 niveau
 *       - precision/recall « alertable » vs une vérité terrain dérivée des
 *         étiquettes (faute de colonne dédiée) :
 *           alertable_vrai := labelRelevant=1 ET labelSeverity>=3 ET labelInFrance=1
 *         (même seuils que jev-policy.derive — à ajuster si les étiqueteurs
 *         ont une définition différente de « alertable »)
 *       - part des réponses avec confidence < 0.5 (sur la question severity)
 *       - tokens d'entrée consommés et coût estimé à 0,042 $ / million
 *
 *   --run accepte aussi --concurrency N (défaut 5).
 *
 * Le CSV utilise un échappement RFC 4180 minimal (virgule/guillemet/retour
 * ligne → champ entre guillemets, guillemets doublés).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildState } from '../api/_lib/jev-questions.js';
import { scoreArticle, JevAuthError, JevRateLimitError, JevServerError, JevTimeoutError, JevValidationError } from '../api/_lib/jev-client.js';
import { derive } from '../api/_lib/jev-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CSV = path.join(ROOT, 'data/jev-eval/articles.csv');
const EXPORT_SOURCE_URL = 'https://www.francemonitor.com/api/news';
const INPUT_TOKEN_COST_PER_MILLION = 0.042;

const CSV_COLUMNS = [
  'id', 'title', 'description', 'link', 'feedName', 'feedRegion', 'tier', 'publishedAt',
  'kwCategory', 'kwSeverity', 'kwConfidence',
  'labelRelevant', 'labelSeverity', 'labelInFrance',
];

// ─── CSV (échappement RFC 4180 minimal, pas de dépendance) ───

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsvLine(fields) {
  return fields.map(csvEscape).join(',');
}

/** Parseur CSV minimal (guillemets, virgules et retours ligne dans les champs). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // ignoré, \n suit
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function rowsToObjects(rows) {
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

// ─── --export ───

async function runExport(count) {
  const url = `${EXPORT_SOURCE_URL}?limit=${encodeURIComponent(count)}`;
  console.log(`[eval-jev] GET ${url}`);
  const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!resp.ok) throw new Error(`export failed: HTTP ${resp.status}`);
  const payload = await resp.json();
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) throw new Error('export failed: 0 items returned');

  const lines = [toCsvLine(CSV_COLUMNS)];
  for (const item of items) {
    lines.push(toCsvLine([
      item.id ?? '',
      item.title ?? '',
      item.description ?? '',
      item.link ?? '',
      item.feedName ?? '',
      item.feedRegion ?? '',
      item.tier ?? '',
      item.publishedAt ?? '',
      item.category ?? '',
      item.severity ?? '',
      item.confidence ?? '',
      '', '', '', // labelRelevant, labelSeverity, labelInFrance — à remplir à la main
    ]));
  }

  await mkdir(dirname(DEFAULT_CSV), { recursive: true });
  await writeFile(DEFAULT_CSV, lines.join('\n') + '\n', 'utf8');
  console.log(`[eval-jev] ${items.length} articles → ${path.relative(ROOT, DEFAULT_CSV)}`);
  console.log('[eval-jev] Remplir labelRelevant (0/1), labelSeverity (0-4), labelInFrance (0/1) à la main,');
  console.log('[eval-jev] puis : TYPESAFE_API_KEY=... node scripts/eval-jev.mjs --run ' + path.relative(ROOT, DEFAULT_CSV));
}

// ─── --run ───

/** Vérité terrain "alertable" dérivée des étiquettes (pas de colonne dédiée, cf. en-tête). */
function labeledAlertable(row) {
  return row.labelRelevant === '1' && Number(row.labelSeverity) >= 3 && row.labelInFrance === '1';
}

async function scoreRow(row, apiKey) {
  const state = buildState(
    { title: row.title, description: row.description, published_at: row.publishedAt || null },
    { name: row.feedName || null, region: row.feedRegion || null, tier: row.tier ? Number(row.tier) : null },
  );
  const kw = {
    category: row.kwCategory || 'general',
    severity: row.kwSeverity || 'info',
    confidence: row.kwConfidence ? Number(row.kwConfidence) : 0.2,
  };
  const response = await scoreArticle(state, { apiKey });
  const judgment = derive(response.answers, kw);
  return { judgment, usage: response.usage, severityConfidence: response.answers.severity.confidence };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function runEval(csvPath, concurrency) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error('TYPESAFE_API_KEY is not set — export it before --run');

  const text = await readFile(csvPath, 'utf8');
  const allRows = rowsToObjects(parseCsv(text));
  const labeled = allRows.filter((r) => r.labelRelevant !== '' && r.labelSeverity !== '' && r.labelInFrance !== '');
  console.log(`[eval-jev] ${labeled.length}/${allRows.length} lignes entièrement étiquetées (les autres sont ignorées).`);
  if (labeled.length === 0) {
    console.log('[eval-jev] Rien à évaluer — remplir labelRelevant/labelSeverity/labelInFrance dans le CSV.');
    return;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let errors = 0;
  const outcomes = [];

  await runWithConcurrency(labeled, concurrency, async (row) => {
    try {
      const { judgment, usage, severityConfidence } = await scoreRow(row, apiKey);
      inputTokens += usage?.input_tokens ?? 0;
      outputTokens += usage?.output_tokens ?? 0;
      outcomes.push({ row, judgment, severityConfidence });
    } catch (err) {
      errors += 1;
      const label = err instanceof JevAuthError ? 'auth'
        : err instanceof JevRateLimitError ? 'rate-limit'
        : err instanceof JevValidationError ? 'validation'
        : err instanceof JevServerError ? 'server'
        : err instanceof JevTimeoutError ? 'timeout'
        : 'unknown';
      console.warn(`[eval-jev] id=${row.id} échec (${label}): ${err instanceof Error ? err.message : err}`);
    }
  });

  if (outcomes.length === 0) {
    console.log('[eval-jev] Aucun article scoré avec succès.');
    return;
  }

  // Accord pertinence : label "pertinent" vs !noise dérivé de Jev.
  let relevanceAgree = 0;
  // Accord gravité (label 0..4 vs sevIdx implicite via SEV[severity])
  const SEV = ['info', 'low', 'medium', 'high', 'critical'];
  let severityExact = 0;
  let severityWithin1 = 0;
  let lowConfidenceCount = 0;

  // Precision/recall de `alertable`.
  let tp = 0, fp = 0, fn = 0, tn = 0;

  for (const { row, judgment, severityConfidence } of outcomes) {
    const labelRelevant = row.labelRelevant === '1';
    const jevRelevant = !judgment.noise;
    if (labelRelevant === jevRelevant) relevanceAgree += 1;

    const labelSevIdx = Number(row.labelSeverity);
    const jevSevIdx = SEV.indexOf(judgment.severity);
    if (jevSevIdx === labelSevIdx) severityExact += 1;
    if (Math.abs(jevSevIdx - labelSevIdx) <= 1) severityWithin1 += 1;

    if (severityConfidence < 0.5) lowConfidenceCount += 1;

    const truth = labeledAlertable(row);
    if (truth && judgment.alertable) tp += 1;
    else if (!truth && judgment.alertable) fp += 1;
    else if (truth && !judgment.alertable) fn += 1;
    else tn += 1;
  }

  const n = outcomes.length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const totalTokens = inputTokens + outputTokens;
  const estimatedCost = (inputTokens / 1_000_000) * INPUT_TOKEN_COST_PER_MILLION;

  console.log('');
  console.log(`[eval-jev] ${n} articles scorés avec succès (${errors} échecs).`);
  console.log(`[eval-jev] Accord pertinence (relevant vs !noise)      : ${(100 * relevanceAgree / n).toFixed(1)}%`);
  console.log(`[eval-jev] Accord gravité exact                        : ${(100 * severityExact / n).toFixed(1)}%`);
  console.log(`[eval-jev] Accord gravité à ±1 niveau                  : ${(100 * severityWithin1 / n).toFixed(1)}%`);
  console.log(`[eval-jev] Part confidence(severity) < 0.5              : ${(100 * lowConfidenceCount / n).toFixed(1)}%`);
  console.log(`[eval-jev] alertable — precision                       : ${precision === null ? 'n/a (0 positif prédit)' : (100 * precision).toFixed(1) + '%'} (tp=${tp}, fp=${fp})`);
  console.log(`[eval-jev] alertable — recall                          : ${recall === null ? 'n/a (0 positif réel)' : (100 * recall).toFixed(1) + '%'} (tp=${tp}, fn=${fn})`);
  console.log(`[eval-jev] tokens entrée / sortie                      : ${inputTokens} / ${outputTokens} (total ${totalTokens})`);
  console.log(`[eval-jev] coût estimé (entrée seule, sortie gratuite) : $${estimatedCost.toFixed(4)} pour ce lot de ${n} articles`);
  console.log(`[eval-jev] coût projeté / 1000 articles                : $${((estimatedCost / n) * 1000).toFixed(3)}`);
}

// ─── CLI ───

function parseArgs(argv) {
  const args = { export: null, run: null, concurrency: 5 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--export') args.export = Number(argv[++i]);
    else if (argv[i] === '--run') args.run = argv[++i];
    else if (argv[i] === '--concurrency') args.concurrency = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.export) {
    await runExport(args.export);
  } else if (args.run) {
    await runEval(args.run, args.concurrency || 5);
  } else {
    console.log('Usage:');
    console.log('  node scripts/eval-jev.mjs --export <N>');
    console.log('  TYPESAFE_API_KEY=... node scripts/eval-jev.mjs --run <fichier.csv> [--concurrency 5]');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[eval-jev]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
