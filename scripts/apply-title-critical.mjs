#!/usr/bin/env node
// scripts/apply-title-critical.mjs : rattrapage de la règle « gravité critique imposée par le titre » (21/10/2026) : crash d'un aéronef
// militaire (Mirage 2000D près de Nancy) et faille critique de portée mondiale (failles PHP). Articles collectés depuis 7 jours dont le
// titre relève de la règle : catégorie du titre, gravité signalée critical, gravité retenue après les plafonds du titre ; puis leurs
// événements recalculés par le code de l'ingestion (refreshEvents, journal compris : l'aggravation se voit). Aucun appel LLM.
//
//   node --env-file=.env.development.local scripts/apply-title-critical.mjs           # essai à blanc
//   node --env-file=.env.development.local scripts/apply-title-critical.mjs --apply   # écrit en base
import { neon } from '@neondatabase/serverless';
import { titleQualification } from '../api/_lib/server-classifier.js';
import { refreshEvents } from '../api/_lib/news-events-db.js';
import { encodeReasons } from '../api/_lib/classification-columns.js';
import { SEVERITY_RANK } from '../api/_lib/event-model.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NAMES = ['info', 'low', 'medium', 'high', 'critical'];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant');
  const apply = process.argv.includes('--apply');
  const sql = neon(url);
  const now = Date.now();
  const rows = await sql`
    SELECT id, title, category, severity, event_id FROM news_items
    WHERE collected_at >= ${new Date(now - 7 * DAY_MS).toISOString()}
  `;
  const hits = [];
  for (const r of rows) {
    const q = titleQualification(String(r.title ?? ''));
    if (!q.criticalCategory) continue;
    const severity = NAMES[Math.min(SEVERITY_RANK.critical, SEVERITY_RANK[q.maxSeverity])];
    const reasons = q.reasons.filter((reason) => SEVERITY_RANK.critical > SEVERITY_RANK[reason === 'etranger' ? 'medium' : 'low']);
    hits.push({ id: Number(r.id), eventId: r.event_id === null ? null : Number(r.event_id), title: r.title, before: `${r.category}/${r.severity}`, category: q.criticalCategory, severity, temporality: q.temporality, zone: q.zone, reasons });
  }
  for (const h of hits) console.log(`${h.before} → ${h.category}/${h.severity} | ${h.title}`);
  console.log(`[title-critical] ${hits.length} articles sur ${rows.length}`);
  if (!apply || hits.length === 0) return;
  for (const h of hits) {
    await sql`
      UPDATE news_items SET category = ${h.category}, severity = ${h.severity}, reported_severity = 'critical',
        temporality = ${h.temporality}, zone = ${h.zone}, reasons = ${encodeReasons(h.reasons)}
      WHERE id = ${h.id}
    `;
  }
  const eventIds = [...new Set(hits.map((h) => h.eventId).filter((id) => id !== null))];
  if (eventIds.length > 0) await refreshEvents(sql, eventIds, new Map(), now);
  console.log(`[title-critical] ${hits.length} articles mis à jour, ${eventIds.length} événements recalculés`);
}

main().catch((err) => { console.error(err); process.exit(1); });
