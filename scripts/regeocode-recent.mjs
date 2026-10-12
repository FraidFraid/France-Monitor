#!/usr/bin/env node
// scripts/regeocode-recent.mjs — rattrapage du géocodage des articles récents (12/10/2026).
//
// Le géocodeur a été réparé (PR #20 : passe « préposition + lieu », départements placés, API Adresse au nom exact). Les articles
// déjà en base gardent l'ancienne position : ce script regéocode, avec le code de l'ingestion (geocodeNewsItem), les articles des
// événements actifs et en refroidissement qui n'avaient pas de lieu sûr (aucun, repli régional, API Adresse), écrit les positions
// qui changent, puis recalcule leurs événements (refreshEvents, sans journal de gravité). Aucun appel LLM ; l'API Adresse publique
// n'est appelée que pour les noms absents des dictionnaires (cache en mémoire).
//
//   node --env-file=.env.development.local scripts/regeocode-recent.mjs           # essai à blanc : décompte et exemples
//   node --env-file=.env.development.local scripts/regeocode-recent.mjs --apply   # écrit en base
import { pathToFileURL } from 'node:url';
import { geocodeNewsItem } from '../api/_lib/server-geocoder.js';
import { refreshLegacyEvents } from './reclassify-legacy.mjs';

const STATUSES = ['active', 'cooling'];
const UNSURE = ['region-fallback', 'api-adresse'];
const SAME_SPOT = 0.005; // ~500 m : en deçà, la position ne change pas

/**
 * Nouvelle position d'un article, ou null si elle ne change pas. Pure (hors géocodeur injecté).
 * @param {{ lat: number | null, lon: number | null, source: string | null }} before
 * @param {{ lat: number, lon: number, source: string } | null} after
 */
export function positionChange(before, after) {
  if (after === null) return before.source === null ? null : { lat: null, lon: null, source: null };
  const moved = before.lat === null || before.lon === null
    || Math.abs(after.lat - before.lat) > SAME_SPOT || Math.abs(after.lon - before.lon) > SAME_SPOT;
  return moved || after.source !== before.source ? { lat: after.lat, lon: after.lon, source: after.source } : null;
}

const num = (/** @type {unknown} */ v) => (v === null || v === undefined ? null : Number(v));

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL absente (lancer avec --env-file=.env.development.local)');
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);

  const rows = await sql`
    SELECT n.id, n.event_id, n.title, n.lat, n.lon, n.geocode_source, f.region
    FROM news_items n JOIN news_events e ON e.id = n.event_id LEFT JOIN feeds f ON f.id = n.feed_id
    WHERE e.status = ANY(${STATUSES}::text[]) AND (n.geocode_source IS NULL OR n.geocode_source = ANY(${UNSURE}::text[]))
    ORDER BY n.id`;
  /** @type {Array<{ id: number, eventId: number, title: string, before: object, after: { lat: number | null, lon: number | null, source: string | null } }>} */
  const changes = [];
  const transitions = new Map();
  for (const r of rows) {
    const before = { lat: num(r.lat), lon: num(r.lon), source: r.geocode_source === null ? null : String(r.geocode_source) };
    const geo = await geocodeNewsItem(String(r.title), r.region === null ? undefined : String(r.region));
    const after = positionChange(before, geo);
    if (!after) continue;
    const key = `${before.source ?? 'aucun'} → ${after.source ?? 'aucun'}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
    changes.push({ id: Number(r.id), eventId: Number(r.event_id), title: String(r.title), before, after, place: geo?.locationName ?? null });
  }
  const events = [...new Set(changes.map((c) => c.eventId))];
  console.log(`${rows.length} articles sans lieu sûr dans les événements actifs ou en refroidissement ; ${changes.length} changent de position, ${events.length} événements touchés.`);
  for (const [k, n] of [...transitions].sort((a, b) => b[1] - a[1])) console.log(`  ${k} : ${n}`);
  for (const c of changes.filter((x) => x.after.source !== 'region-fallback').slice(0, 25)) {
    console.log(`  #${c.id} ${String(c.place ?? 'sans lieu').padEnd(22)} | ${c.title.slice(0, 90)}`);
  }
  if (!apply) {
    console.log('Essai à blanc : rien n’est écrit (ajouter --apply).');
    return;
  }
  for (const c of changes) {
    await sql`UPDATE news_items SET lat = ${c.after.lat}, lon = ${c.after.lon}, geocode_source = ${c.after.source} WHERE id = ${c.id}`;
  }
  const logged = await refreshLegacyEvents(sql, events, Date.now());
  console.log(`${changes.length} articles regéocodés, ${events.length} événements recalculés, ${logged} entrées de journal (statuts seulement).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
