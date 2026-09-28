#!/usr/bin/env node
/**
 * snapshot-classification.mjs — Instantané en LECTURE SEULE de la production pour rejouer
 * la classification (spec docs/superpowers/specs/2026-09-28-classification-evenements-design.md § 5.1).
 *
 * Sources : API publique uniquement — /api/news (paginée), /api/events (100 premiers),
 * /api/events/detail. Aucun accès base : DATABASE_URL locale = PRODUCTION.
 * Sortie : .superpowers/classification/snapshot-<AAAA-MM-JJ>.json (dossier ignoré par git).
 *
 * Usage : node scripts/snapshot-classification.mjs [--base https://www.francemonitor.com] [--hours 48]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE = 'https://www.francemonitor.com';
const PAGE_SIZE = 1000;
const DETAIL_PAUSE_MS = 100;

/** @param {string} url */
async function defaultGetJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'FranceMonitor-snapshot/1.0' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

/**
 * Pagine /api/news (tri published_at décroissant) : `before` = date du dernier article + 1 ms,
 * pour ne perdre aucun article de même horodatage à la frontière (les doublons sont écartés).
 * @param {string} base
 * @param {number} sinceMs
 * @param {{ getJson?: (url: string) => Promise<{ items: Array<{ id: number, publishedAt: string | null }> }>, pageSize?: number }} [opts]
 */
export async function fetchNews(base, sinceMs, { getJson = defaultGetJson, pageSize = PAGE_SIZE } = {}) {
  const byId = new Map();
  let before = null;
  for (;;) {
    const q = new URLSearchParams({ since: String(sinceMs), limit: String(pageSize) });
    if (before) q.set('before', before);
    const { items } = await getJson(`${base}/api/news?${q}`);
    let fresh = 0;
    for (const item of items) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
        fresh += 1;
      }
    }
    if (items.length < pageSize || fresh === 0) break;
    const last = items[items.length - 1].publishedAt;
    if (!last) break;
    before = new Date(Date.parse(last) + 1).toISOString();
  }
  return [...byId.values()];
}

/** @param {Record<string, any>} a */
function pickArticle(a) {
  return {
    id: a.id, feedId: a.feedId, feedName: a.feedName ?? null, tier: a.tier ?? null,
    title: a.title, description: a.description ?? null, publishedAt: a.publishedAt ?? null,
    category: a.category, severity: a.severity, confidence: a.confidence, scoredBy: a.scoredBy ?? null,
  };
}

async function main() {
  const { values } = parseArgs({
    options: { base: { type: 'string', default: DEFAULT_BASE }, hours: { type: 'string', default: '48' } },
  });
  const base = String(values.base).replace(/\/$/, '');
  const hours = Number(values.hours);
  const now = Date.now();

  const articles = (await fetchNews(base, now - hours * 3_600_000)).map(pickArticle);
  const { events } = await defaultGetJson(`${base}/api/events?status=active,cooling&limit=100`);
  const withMembers = [];
  for (const e of events) {
    let articleIds = [];
    try {
      const detail = await defaultGetJson(`${base}/api/events/detail?id=${e.id}`);
      articleIds = detail.articles.map((/** @type {{ id: number }} */ a) => a.id);
    } catch (err) {
      console.warn(`détail indisponible pour l'événement ${e.id} :`, err instanceof Error ? err.message : err);
    }
    withMembers.push({
      id: e.id, title: e.title, category: e.category, severity: e.severity, status: e.status,
      independentCount: e.independentCount, articleIds,
    });
    await new Promise((r) => setTimeout(r, DETAIL_PAUSE_MS));
  }

  const outDir = path.join(ROOT, '.superpowers/classification');
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `snapshot-${new Date(now).toISOString().slice(0, 10)}.json`);
  await writeFile(file, JSON.stringify({ takenAt: new Date(now).toISOString(), base, hours, articles, events: withMembers }));
  console.log(`${articles.length} articles, ${withMembers.length} événements → ${path.relative(ROOT, file)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
