#!/usr/bin/env node
// scripts/recompute-event-places.mjs — rattrapage de la zone et du lieu des événements (12/10/2026).
//
// Deux règles de l'agrégat ont changé (api/_lib/event-model.js qualifyEvent, api/_lib/news-events-db.js loadEventArticles) :
// la zone suit la majorité des articles situés (avant : un seul article « France » suffisait), et le lieu ignore le repli du
// geocoder sur le centre de la région du journal (avant : « Arabie saoudite » placée dans le Rhône). Un événement n'est
// recalculé qu'à l'arrivée d'un nouvel article : ce script recalcule les événements actifs et en refroidissement par le code
// de l'ingestion (refreshEvents), sans journal de gravité. Aucun appel LLM ni appel de géocodage extérieur.
//
// Articles : seuls ceux en repli régional dont le titre cite un territoire d'outre-mer (« En Guadeloupe, … ») sont replacés, au
// centre de leur région (REGIONS, résolu sans réseau), comme le fait désormais l'ingestion (extractLocations, passe 0).
//
//   node --env-file=.env.development.local scripts/recompute-event-places.mjs           # essai à blanc : liste les changements
//   node --env-file=.env.development.local scripts/recompute-event-places.mjs --apply   # écrit en base
import { pathToFileURL } from 'node:url';
import { summarizeEvent } from '../api/_lib/event-model.js';
import { loadEventArticles } from '../api/_lib/news-events-db.js';
import { extractLocations, geocodeQuery } from '../api/_lib/server-geocoder.js';
import { refreshLegacyEvents } from './reclassify-legacy.mjs';

const STATUSES = ['active', 'cooling'];
const EVENT_CHUNK = 200;

/**
 * Changements de zone ou de lieu qu'apporteraient les nouvelles règles. Pure.
 * @param {Array<{ id: number, title: string, zone: string | null, lat: number | null, lon: number | null }>} current
 * @param {Map<number, Array<object>>} articlesByEvent
 */
export function placeChanges(current, articlesByEvent) {
  const out = [];
  for (const e of current) {
    const articles = articlesByEvent.get(e.id);
    if (!articles || articles.length === 0) continue;
    const next = summarizeEvent(articles);
    if (next.zone !== e.zone || next.lat !== e.lat || next.lon !== e.lon) {
      out.push({ id: e.id, title: e.title, before: { zone: e.zone, lat: e.lat, lon: e.lon }, after: { zone: next.zone, lat: next.lat, lon: next.lon } });
    }
  }
  return out;
}

const OVERSEAS = new Set(['Guadeloupe', 'Martinique', 'Guyane', 'La Réunion', 'Mayotte']);

/** Territoire d'outre-mer cité par un titre, ou null. Pure. */
export function overseasPlace(/** @type {string} */ title) {
  return extractLocations(title).find((l) => OVERSEAS.has(l)) ?? null;
}

const num = (/** @type {unknown} */ v) => (v === null || v === undefined ? null : Number(v));

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL absente (lancer avec --env-file=.env.development.local)');
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);

  // 1. Articles en repli régional qui citent un territoire d'outre-mer : leur nouvelle position (résolue sans réseau).
  const fallbacks = await sql`
    SELECT n.id, n.title FROM news_items n JOIN news_events e ON e.id = n.event_id
    WHERE e.status = ANY(${STATUSES}::text[]) AND n.geocode_source = 'region-fallback'`;
  /** @type {Map<number, { lat: number, lon: number }>} */
  const relocated = new Map();
  for (const r of fallbacks) {
    const place = overseasPlace(String(r.title));
    const geo = place ? await geocodeQuery(place) : null;
    if (geo && geo.source === 'regions') relocated.set(Number(r.id), { lat: geo.lat, lon: geo.lon });
  }
  console.log(`${fallbacks.length} articles en repli régional, ${relocated.size} replacés en outre-mer d’après leur titre.`);

  const rows = await sql`SELECT id, title, zone, lat, lon FROM news_events WHERE status = ANY(${STATUSES}::text[]) ORDER BY id`;
  const current = rows.map((r) => ({ id: Number(r.id), title: String(r.title), zone: r.zone === null ? null : String(r.zone), lat: num(r.lat), lon: num(r.lon) }));
  const changes = [];
  for (let i = 0; i < current.length; i += EVENT_CHUNK) {
    const chunk = current.slice(i, i + EVENT_CHUNK);
    const byEvent = await loadEventArticles(sql, chunk.map((e) => e.id), new Map());
    // Essai à blanc : les articles replacés comptent déjà à leur nouvelle position.
    for (const articles of byEvent.values()) {
      for (const a of articles) {
        const at = relocated.get(a.id);
        if (at) { a.lat = at.lat; a.lon = at.lon; }
      }
    }
    changes.push(...placeChanges(chunk, byEvent));
  }

  console.log(`${current.length} événements actifs ou en refroidissement, ${changes.length} changeraient de zone ou de lieu.`);
  for (const c of changes) {
    const fmt = (/** @type {{ zone: string | null, lat: number | null, lon: number | null }} */ p) => `${p.zone ?? 'n.d.'} ${p.lat === null ? 'sans lieu' : `${p.lat},${p.lon}`}`;
    console.log(`  #${c.id} ${c.title.slice(0, 70)} : ${fmt(c.before)} → ${fmt(c.after)}`);
  }
  if (!apply) {
    console.log('Essai à blanc : rien n’est écrit (ajouter --apply).');
    return;
  }
  for (const [id, at] of relocated) {
    await sql`UPDATE news_items SET lat = ${at.lat}, lon = ${at.lon}, geocode_source = 'regions' WHERE id = ${id} AND geocode_source = 'region-fallback'`;
  }
  const logged = await refreshLegacyEvents(sql, changes.map((c) => c.id), Date.now());
  console.log(`${relocated.size} articles replacés, ${changes.length} événements recalculés, ${logged} entrées de journal (statuts seulement).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
